import crypto from 'node:crypto';
import axios from 'axios';
import { db } from '../config/database.js';
import { UserSettings, Task, ConversationState } from '../models/types.js';
import { parseUserMessageWithLLM } from './llm.js';
import { scheduleTask } from './scheduler.js';
import { templates } from './clawbot.js';

const FIXED_BASE_URL = 'https://ilinkai.weixin.qq.com';
const ILINK_APP_ID = 'bot';
const ILINK_CLIENT_VERSION = '132106'; // 2.4.10 encoded
const BOT_TYPE = '3';

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': ILINK_CLIENT_VERSION,
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
  };
  if (token) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

interface ActiveQRSession {
  qrcode: string;
  qrcodeUrl: string;
  startedAt: number;
}

const activeQRSessions = new Map<number, ActiveQRSession>();

/**
 * 1. Request new QR Code for pairing
 */
export async function requestLoginQRCode(userId: number): Promise<{ qrcode: string; qrcodeUrl: string }> {
  const url = `${FIXED_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`;
  const resp = await axios.post(
    url,
    { local_token_list: [] },
    { headers: buildHeaders(), timeout: 15000 }
  );

  const data = resp.data;
  if (!data.qrcode) {
    throw new Error('微信接口返回二维码失败: ' + JSON.stringify(data));
  }

  const session: ActiveQRSession = {
    qrcode: data.qrcode,
    qrcodeUrl: data.qrcode_img_content || `https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=${data.qrcode}&bot_type=${BOT_TYPE}`,
    startedAt: Date.now(),
  };

  activeQRSessions.set(userId, session);
  return { qrcode: session.qrcode, qrcodeUrl: session.qrcodeUrl };
}

/**
 * 2. Check QR Code scanning & confirmation status (Long-poll)
 */
export async function checkLoginQRStatus(userId: number): Promise<{
  status: 'wait' | 'scaned' | 'confirmed' | 'expired';
  userId?: string;
  botId?: string;
}> {
  const session = activeQRSessions.get(userId);
  if (!session) {
    return { status: 'expired' };
  }

  // QR Code expires after 5 minutes
  if (Date.now() - session.startedAt > 5 * 60 * 1000) {
    activeQRSessions.delete(userId);
    return { status: 'expired' };
  }

  const url = `${FIXED_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(session.qrcode)}`;

  try {
    const resp = await axios.get(url, {
      headers: buildHeaders(),
      timeout: 30000, // 30s long poll
    });

    const data = resp.data;
    const status = data.status || 'wait';

    if (status === 'confirmed' && data.bot_token) {
      const botToken = data.bot_token;
      const botId = data.ilink_bot_id || '';
      const wxUserId = data.ilink_user_id || '';
      const baseUrl = data.baseurl || FIXED_BASE_URL;

      // Persist credentials for this user in SQLite
      db.prepare(`
        UPDATE user_settings
        SET
          weixin_connected = 1,
          weixin_bot_token = ?,
          weixin_bot_id = ?,
          weixin_user_id = ?,
          weixin_base_url = ?,
          clawbot_to_wxid = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `).run(botToken, botId, wxUserId, baseUrl, wxUserId, userId);

      activeQRSessions.delete(userId);

      // Start isolated message transit worker for this user
      weixinTransitManager.startWorker(userId);

      return { status: 'confirmed', userId: wxUserId, botId };
    }

    return { status };
  } catch (err: any) {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      return { status: 'wait' };
    }
    console.warn(`[Weixin QR Poll] Network error:`, err.message);
    return { status: 'wait' };
  }
}

/**
 * 3. Send text message to user on WeChat via iLink API
 */
export async function sendWeixinTextMessage(
  baseUrl: string,
  botToken: string,
  fromBotId: string,
  toUserId: string,
  text: string
): Promise<boolean> {
  if (!botToken || !toUserId) return false;

  const url = `${baseUrl.replace(/\/$/, '')}/ilink/bot/sendmessage`;
  try {
    await axios.post(
      url,
      {
        msg: {
          from_user_id: fromBotId || 'bot',
          to_user_id: toUserId,
          client_msg_id: `claw-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          msg_type: 1, // Text message
          item_list: [
            {
              type: 1,
              text_item: { text },
            },
          ],
        },
        base_info: {
          channel_version: '2.4.10',
          bot_agent: 'OpenClaw',
        },
      },
      {
        headers: buildHeaders(botToken),
        timeout: 15000,
      }
    );
    return true;
  } catch (err: any) {
    console.error(`[Weixin Send Error]:`, err.response?.data || err.message);
    return false;
  }
}

/**
 * 4. Process incoming user WeChat message through LLM & Scheduler
 */
export async function processWeChatMessage(
  userId: number,
  content: string,
  fromUserId: string
): Promise<string> {
  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings;
  if (!settings) return '用户未初始化配置';

  // Check multi-turn conversation state
  const existingConv = db.prepare('SELECT * FROM conversation_states WHERE user_id = ?').get(userId) as ConversationState | undefined;
  let pendingTask: any = null;
  if (existingConv && existingConv.pending_task_json) {
    try {
      pendingTask = JSON.parse(existingConv.pending_task_json);
    } catch {
      pendingTask = null;
    }
  }

  try {
    const parsed = await parseUserMessageWithLLM(content, settings, pendingTask);
    console.log(`[Weixin Transit] User #${userId} LLM parsed result:`, parsed);

    if (parsed.intent === 'status_update') {
      db.prepare('DELETE FROM conversation_states WHERE user_id = ?').run(userId);
      const action = parsed.status_action || 'complete';

      const activeTask = db.prepare(`
        SELECT * FROM tasks
        WHERE user_id = ? AND status IN ('scheduled', 'in_progress')
        ORDER BY CASE status WHEN 'in_progress' THEN 1 ELSE 2 END, scheduled_start ASC
        LIMIT 1
      `).get(userId) as Task | undefined;

      if (!activeTask) {
        return '💡 当前没有正在进行或排程中的待办任务，无需更新状态。';
      }

      if (action === 'complete') {
        db.prepare('UPDATE tasks SET status = "completed", updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(activeTask.id);
        return templates.taskCompleted(activeTask.title);
      } else if (action === 'extend') {
        const extMin = parsed.extend_minutes || 30;
        const currentEnd = new Date(activeTask.scheduled_end || new Date());
        const newEnd = new Date(currentEnd.getTime() + extMin * 60 * 1000);
        const newEndStr = newEnd.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

        db.prepare(`
          UPDATE tasks
          SET scheduled_end = ?, duration_minutes = duration_minutes + ?, end_reminder_sent = 0, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newEnd.toISOString(), extMin, activeTask.id);

        return templates.taskExtended(activeTask.title, extMin, newEndStr);
      } else if (action === 'reschedule') {
        const plan = scheduleTask(userId, {
          id: activeTask.id,
          title: activeTask.title,
          duration_minutes: activeTask.duration_minutes,
          urgency: activeTask.urgency,
          importance: activeTask.importance,
          deadline: activeTask.deadline,
        });

        if (plan.success && plan.scheduled_start && plan.scheduled_end) {
          db.prepare(`
            UPDATE tasks
            SET scheduled_start = ?, scheduled_end = ?, status = 'scheduled', start_reminder_sent = 0, end_reminder_sent = 0, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(plan.scheduled_start, plan.scheduled_end, activeTask.id);

          const sStr = new Date(plan.scheduled_start).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
          const eStr = new Date(plan.scheduled_end).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
          return templates.taskRescheduled(activeTask.title, sStr, eStr);
        } else {
          return `⚠️ 重新安排失败：${plan.message}`;
        }
      } else {
        return '已了解您的状态更新。';
      }
    } else if (parsed.intent === 'query_schedule') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const todayTasks = db.prepare(`
        SELECT * FROM tasks
        WHERE user_id = ? AND scheduled_start >= ? AND scheduled_start <= ?
        ORDER BY scheduled_start ASC
      `).all(userId, todayStart.toISOString(), todayEnd.toISOString()) as Task[];

      const todayStr = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
      return templates.scheduleQueryList(todayTasks, todayStr);
    } else if (parsed.intent === 'create_task') {
      const title = parsed.title || pendingTask?.title || '未命名任务';
      const duration = parsed.duration_minutes || pendingTask?.duration_minutes || null;
      const urgency = parsed.urgency || pendingTask?.urgency || null;
      const importance = parsed.importance || pendingTask?.importance || null;
      const deadline = parsed.deadline || pendingTask?.deadline || null;

      const merged = { title, duration_minutes: duration, urgency, importance, deadline };
      const missing = {
        duration: !duration || duration <= 0,
        deadline: !deadline,
        urgency: !urgency,
        importance: !importance,
      };

      const hasMissing = missing.duration || missing.deadline || missing.urgency || missing.importance;

      if (hasMissing) {
        db.prepare(`
          INSERT INTO conversation_states (user_id, current_intent, pending_task_json, missing_fields, updated_at)
          VALUES (?, 'create_task', ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET
            pending_task_json = excluded.pending_task_json,
            missing_fields = excluded.missing_fields,
            updated_at = CURRENT_TIMESTAMP
        `).run(userId, JSON.stringify(merged), JSON.stringify(missing));

        return templates.askMissingFields(title, missing);
      } else {
        db.prepare('DELETE FROM conversation_states WHERE user_id = ?').run(userId);

        const plan = scheduleTask(userId, {
          title,
          duration_minutes: duration!,
          urgency: urgency!,
          importance: importance!,
          deadline: deadline,
        });

        if (plan.success && plan.scheduled_start && plan.scheduled_end) {
          db.prepare(`
            INSERT INTO tasks (
              user_id, title, duration_minutes, urgency, importance,
              deadline, scheduled_start, scheduled_end, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
          `).run(userId, title, duration, urgency, importance, deadline, plan.scheduled_start, plan.scheduled_end);

          const sStr = new Date(plan.scheduled_start).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
          const eStr = new Date(plan.scheduled_end).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

          return templates.scheduleSuccess(title, sStr, eStr, duration!, urgency!, importance!);
        } else {
          db.prepare(`
            INSERT INTO tasks (
              user_id, title, duration_minutes, urgency, importance,
              deadline, status
            )
            VALUES (?, ?, ?, ?, ?, ?, 'pending_slot')
          `).run(userId, title, duration, urgency, importance, deadline);

          return templates.scheduleFailed(title, duration!, plan.message);
        }
      }
    } else {
      return (
        `🤖【Clawbot 时间管理助手】\n` +
        `我是您的个人日程规划管家。您可以直接对我说：\n` +
        `• "安排明天下午写代码，耗时90分钟，加急5分，周三前交"\n` +
        `• "今天有哪些待办？"\n` +
        `• "刚刚的任务搞定了"\n` +
        `• "时间不够，延长30分钟"`
      );
    }
  } catch (err: any) {
    console.error('[Weixin Process Error]:', err);
    return `⚠️ 助手处理出错：${err.message}\n请检查管理面板中的 DeepSeek API Key 是否配置有效。`;
  }
}

/**
 * 5. Isolated Background Transit Worker Manager
 * Multi-tenant: Each user has their own independent long-poll worker!
 */
class WeixinTransitManager {
  private activeWorkers = new Map<number, { abortController: AbortController; running: boolean }>();

  public startWorker(userId: number) {
    this.stopWorker(userId);

    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings | undefined;
    if (!settings || !settings.weixin_connected || !settings.weixin_bot_token) {
      return;
    }

    const abortController = new AbortController();
    this.activeWorkers.set(userId, { abortController, running: true });

    console.log(`🚀 [Weixin Transit] Started isolated worker for User #${userId} (WxUser: ${settings.weixin_user_id})`);
    this.runLongPollLoop(userId, abortController.signal);
  }

  public stopWorker(userId: number) {
    const worker = this.activeWorkers.get(userId);
    if (worker) {
      worker.running = false;
      worker.abortController.abort();
      this.activeWorkers.delete(userId);
      console.log(`🛑 [Weixin Transit] Stopped worker for User #${userId}`);
    }
  }

  public startAllActiveWorkers() {
    const connectedUsers = db.prepare(`
      SELECT user_id FROM user_settings
      WHERE weixin_connected = 1 AND weixin_bot_token != ''
    `).all() as { user_id: number }[];

    console.log(`🌟 [Weixin Transit] Bootstrapping workers for ${connectedUsers.length} connected user(s)...`);
    for (const u of connectedUsers) {
      this.startWorker(u.user_id);
    }
  }

  private async runLongPollLoop(userId: number, signal: AbortSignal) {
    while (!signal.aborted) {
      const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings | undefined;
      if (!settings || !settings.weixin_connected || !settings.weixin_bot_token) {
        this.stopWorker(userId);
        break;
      }

      const baseUrl = settings.weixin_base_url || FIXED_BASE_URL;
      const botToken = settings.weixin_bot_token;
      const botId = settings.weixin_bot_id || '';
      const syncBuf = settings.weixin_sync_buf || '';

      try {
        const url = `${baseUrl.replace(/\/$/, '')}/ilink/bot/getupdates`;
        const resp = await axios.post(
          url,
          {
            get_updates_buf: syncBuf,
            base_info: {
              channel_version: '2.4.10',
              bot_agent: 'OpenClaw',
            },
          },
          {
            headers: buildHeaders(botToken),
            timeout: 35000, // 35s long-poll
            signal,
          }
        );

        const data = resp.data;
        if (data && data.ret === 0) {
          if (data.get_updates_buf && data.get_updates_buf !== syncBuf) {
            db.prepare('UPDATE user_settings SET weixin_sync_buf = ? WHERE user_id = ?').run(data.get_updates_buf, userId);
          }

          const msgs = data.msgs || [];
          for (const msg of msgs) {
            const fromUserId = msg.from_user_id;
            // Ignore messages sent by the bot itself
            if (fromUserId === botId) continue;

            const itemList = msg.item_list || [];
            for (const item of itemList) {
              if (item.type === 1 && item.text_item?.text) {
                const userText = item.text_item.text.trim();
                console.log(`📩 [Weixin Inbound User #${userId}] From: ${fromUserId}, Text: "${userText}"`);

                // Process through scheduling pipeline
                const replyText = await processWeChatMessage(userId, userText, fromUserId);

                // Send reply back to user
                await sendWeixinTextMessage(baseUrl, botToken, botId, fromUserId, replyText);
                console.log(`📤 [Weixin Outbound User #${userId}] Replied to ${fromUserId}`);
              }
            }
          }
        }
      } catch (err: any) {
        if (signal.aborted) break;

        // Long-poll timeout is expected
        if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
          continue;
        }

        console.warn(`[Weixin Transit User #${userId}] Poll loop error:`, err.message);
        // Exponential/gentle backoff before retrying
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
}

export const weixinTransitManager = new WeixinTransitManager();
