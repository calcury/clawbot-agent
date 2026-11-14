import crypto from 'node:crypto';
import axios from 'axios';
import { db } from '../config/database.js';
import { UserSettings, Task, ConversationState } from '../models/types.js';
import { parseUserMessageWithLLM } from './llm.js';
import { scheduleTask, replanUserTasks } from './scheduler.js';
import { syncAllUserSubscriptions } from './calendarSync.js';
import { renderCalendarImage, renderTodoListImage } from './cardRenderer.js';
import { templates } from './clawbot.js';
import { addDebugLog } from './debugLogger.js';

const FIXED_BASE_URL = 'https://ilinkai.weixin.qq.com';
const ILINK_APP_ID = 'bot';
const ILINK_CLIENT_VERSION = '132106'; // 2.4.10 encoded: ((2&0xff)<<16)|((4&0xff)<<8)|(10&0xff)
const BOT_TYPE = '3';

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

function generateClientId(): string {
  return `openclaw-weixin-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
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
 * In-memory context token store: userId -> contextToken
 */
const contextTokenMap = new Map<number, string>();

/**
 * 1. Request new QR Code for pairing
 */
export async function requestLoginQRCode(userId: number): Promise<{ qrcode: string; qrcodeUrl: string }> {
  const url = `${FIXED_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`;
  addDebugLog('Weixin', 'info', `用户 #${userId} 请求微信登录配对二维码`, { url });

  const resp = await axios.post(
    url,
    { local_token_list: [] },
    { headers: buildHeaders(), timeout: 15000 }
  );

  const data = resp.data;
  if (!data.qrcode) {
    addDebugLog('Weixin', 'error', `获取微信二维码失败`, data);
    throw new Error('微信接口返回二维码失败: ' + JSON.stringify(data));
  }

  const session: ActiveQRSession = {
    qrcode: data.qrcode,
    qrcodeUrl: data.qrcode_img_content || `https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=${data.qrcode}&bot_type=${BOT_TYPE}`,
    startedAt: Date.now(),
  };

  activeQRSessions.set(userId, session);
  addDebugLog('Weixin', 'success', `成功生成配对二维码: ${session.qrcode.slice(0, 16)}...`);
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

      addDebugLog('Weixin', 'success', `用户 #${userId} 扫码配对成功！已连接微信账号 ${wxUserId}`);

      // Start isolated message transit worker for this user
      weixinTransitManager.startWorker(userId);

      return { status: 'confirmed', userId: wxUserId, botId };
    }

    return { status };
  } catch (err: any) {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      return { status: 'wait' };
    }
    addDebugLog('Weixin', 'warn', `[Weixin QR Poll] 轮询网络异常: ${err.message}`);
    return { status: 'wait' };
  }
}

/**
 * 3. Send text message to user on WeChat via iLink API
 * Matching official OpenClaw Weixin channel wire format
 */
export async function sendWeixinTextMessage(
  baseUrl: string,
  botToken: string,
  fromBotId: string,
  toUserId: string,
  text: string,
  contextToken?: string
): Promise<{ success: boolean; data?: any; error?: string; message_id?: string; ret?: number }> {
  if (!botToken || !toUserId) {
    return { success: false, error: '缺少 botToken 或 toUserId' };
  }

  const clientId = `openclaw-weixin-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const url = `${baseUrl.replace(/\/$/, '')}/ilink/bot/sendmessage`;

  const payload = {
    msg: {
      from_user_id: fromBotId || '',
      to_user_id: toUserId,
      client_id: clientId,
      message_type: 2, // MessageType.BOT = 2
      message_state: 2, // MessageState.FINISH = 2
      context_token: contextToken || undefined,
      item_list: [
        {
          type: 1, // MessageItemType.TEXT = 1
          text_item: { text },
        },
      ],
    },
    base_info: {
      channel_version: '2.4.10',
      bot_agent: 'OpenClaw',
    },
  };

  try {
    addDebugLog('Weixin', 'info', `🚀 下发消息至微信用户: ${toUserId.slice(0, 16)}...`, {
      clientId,
      hasContextToken: Boolean(contextToken),
      preview: text.length > 80 ? text.slice(0, 80) + '...' : text,
    });

    const resp = await axios.post(url, payload, {
      headers: buildHeaders(botToken),
      timeout: 15000,
    });

    const data = resp.data || {};
    const isError =
      (data.ret !== undefined && data.ret !== 0) ||
      (data.errcode !== undefined && data.errcode !== 0);

    if (!isError) {
      addDebugLog('Weixin', 'success', `✅ 微信消息发送成功 (ID: ${data.message_id || 'ok'})`);
      return { success: true, data, message_id: data.message_id, ret: 0 };
    } else {
      const errMsg = data.errmsg || `ret=${data.ret ?? data.errcode ?? 'unknown'}`;
      addDebugLog('Weixin', 'error', `❌ 微信消息发送拒绝: ${errMsg}`, data);
      return { success: false, data, error: errMsg, ret: data.ret ?? data.errcode };
    }
  } catch (err: any) {
    const errDetail = err.response?.data || err.message;
    addDebugLog('Weixin', 'error', `❌ 微信网络下发异常: ${err.message}`, errDetail);
    return { success: false, error: String(errDetail) };
  }
}

function encryptAes128Ecb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/**
 * Send image card to WeChat user via Tencent CDN
 */
export async function sendWeixinImageMessage(
  baseUrl: string,
  botToken: string,
  botId: string,
  toUserId: string,
  imageBuffer: Buffer,
  contextToken?: string
): Promise<{ success: boolean; data?: any; error?: string; message_id?: string }> {
  try {
    const rawsize = imageBuffer.length;
    const rawfilemd5 = crypto.createHash('md5').update(imageBuffer).digest('hex');
    const aeskey = crypto.randomBytes(16);
    const aeskeyHex = aeskey.toString('hex');
    const aeskeyBase64 = Buffer.from(aeskeyHex, 'utf-8').toString('base64');
    const ciphertext = encryptAes128Ecb(imageBuffer, aeskey);
    const filesize = ciphertext.length;
    const filekey = crypto.randomBytes(16).toString('hex');

    addDebugLog('Weixin', 'info', `🚀 请求微信 CDN 上传凭据 (图片大小: ${Math.round(rawsize / 1024)}KB)`);

    // 1. Get CDN upload URL
    const uploadUrlEndpoint = `${baseUrl.replace(/\/$/, '')}/ilink/bot/getuploadurl`;
    const uploadUrlResp = await axios.post(
      uploadUrlEndpoint,
      {
        filekey,
        media_type: 1, // IMAGE
        to_user_id: toUserId,
        rawsize,
        rawfilemd5,
        filesize,
        no_need_thumb: true,
        aeskey: aeskey.toString('hex'),
        base_info: {
          channel_version: '2.4.10',
          bot_agent: 'OpenClaw',
        },
      },
      {
        headers: buildHeaders(botToken),
        timeout: 20000,
      }
    );

    const uploadData = uploadUrlResp.data;
    const uploadFullUrl = uploadData.upload_full_url?.trim();
    const uploadParam = uploadData.upload_param;
    const cdnBaseUrl = 'https://novac2c.cdn.weixin.qq.com/c2c';

    let cdnTargetUrl: string;
    if (uploadFullUrl) {
      cdnTargetUrl = uploadFullUrl;
    } else if (uploadParam) {
      cdnTargetUrl = `${cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
    } else {
      throw new Error(`微信接口未返回 CDN 上传地址: ${JSON.stringify(uploadData)}`);
    }

    addDebugLog('Weixin', 'info', `📤 上传密文图片至微信 CDN...`);

    // 2. Upload ciphertext to CDN
    const cdnResp = await axios.post(cdnTargetUrl, ciphertext, {
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      timeout: 30000,
    });

    const downloadParam = cdnResp.headers['x-encrypted-param'];
    if (!downloadParam) {
      throw new Error('微信 CDN 上传响应缺少 x-encrypted-param 响应头');
    }

    addDebugLog('Weixin', 'success', `✅ 微信 CDN 上传成功，正在下发图片卡片...`);

    // 3. Send Image Message to user
    const sendEndpoint = `${baseUrl.replace(/\/$/, '')}/ilink/bot/sendmessage`;
    const clientId = generateClientId();

    const payload = {
      msg: {
        from_user_id: botId || '',
        to_user_id: toUserId,
        client_id: clientId,
        message_type: 2, // BOT
        message_state: 2, // FINISH
        context_token: contextToken || undefined,
        item_list: [
          {
            type: 2, // IMAGE
            image_item: {
              media: {
                encrypt_query_param: downloadParam,
                aes_key: aeskeyBase64,
                encrypt_type: 1,
              },
              mid_size: filesize,
            },
          },
        ],
      },
      base_info: {
        channel_version: '2.4.10',
        bot_agent: 'OpenClaw',
      },
    };

    const sendResp = await axios.post(sendEndpoint, payload, {
      headers: buildHeaders(botToken),
      timeout: 15000,
    });

    const data = sendResp.data || {};
    const isError =
      (data.ret !== undefined && data.ret !== 0) ||
      (data.errcode !== undefined && data.errcode !== 0);

    if (!isError) {
      addDebugLog('Weixin', 'success', `✅ 微信图片下发成功 (ID: ${data.message_id || 'ok'})`);
      return { success: true, data, message_id: data.message_id };
    } else {
      const errMsg = data.errmsg || `ret=${data.ret ?? data.errcode}`;
      addDebugLog('Weixin', 'error', `❌ 微信图片下发拒绝: ${errMsg}`, data);
      return { success: false, data, error: errMsg };
    }
  } catch (err: any) {
    const detail = err.response?.data || err.message;
    addDebugLog('Weixin', 'error', `❌ 微信图片流程异常: ${err.message}`, detail);
    return { success: false, error: String(detail) };
  }
}

/**
 * 4. Process incoming user WeChat message through LLM & Scheduler
 */
export async function processWeChatMessage(
  userId: number,
  content: string,
  fromUserId: string
): Promise<{
  replyText: string;
  imageBuffer?: Buffer;
  diagnostics?: Record<string, any>;
}> {
  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings;
  if (!settings) {
    return { replyText: '⚠️ 用户未初始化配置' };
  }

  addDebugLog('Weixin', 'info', `📩 接收到微信用户 #${userId} 文本: "${content}"`);

  const trimmed = content.trim();

  // 1. Direct Trigger Command: "查看日历" / "今日日程" / "刷新日历" / "我的日历"
  if (
    trimmed === '查看日历' ||
    trimmed === '日历' ||
    trimmed === '今日日历' ||
    trimmed === '今日日程' ||
    trimmed === '查看日程' ||
    trimmed === '刷新日历' ||
    trimmed === '我的日历' ||
    trimmed === '日程安排' ||
    trimmed.includes('查看日历')
  ) {
    addDebugLog('Weixin', 'info', `[用户 #${userId}] 触发指令: 查看并刷新日历`);
    const syncRes = await syncAllUserSubscriptions(userId);
    const replanRes = replanUserTasks(userId);
    let imageBuffer: Buffer | undefined;
    try {
      imageBuffer = await renderCalendarImage(userId);
    } catch (e: any) {
      addDebugLog('Weixin', 'error', `生成日历卡片图片失败: ${e.message}`);
    }

    const replyText =
      `📅【今日智能日程与排程】\n` +
      `已自动同步最新外部日历并完成自适应排程！\n` +
      `• 外部日程同步：${syncRes.totalEvents} 项\n` +
      `• 待办智能排程：${replanRes.scheduledCount} 项\n` +
      (imageBuffer ? `日程卡片图已在下方发送 👇` : `(图片生成中...)`);

    return {
      replyText,
      imageBuffer,
      diagnostics: { intent: 'view_calendar', syncRes, replanRes },
    };
  }

  // 2. Direct Trigger Command: "查看任务" / "待办清单" / "todo" / "tudo"
  if (
    trimmed === '查看任务' ||
    trimmed === '任务' ||
    trimmed === '我的待办' ||
    trimmed === '待办清单' ||
    trimmed === '任务清单' ||
    trimmed.toLowerCase() === 'todo' ||
    trimmed.toLowerCase() === 'todolist' ||
    trimmed.toLowerCase() === 'tudo' ||
    trimmed.includes('查看任务') ||
    trimmed.includes('待办清单')
  ) {
    addDebugLog('Weixin', 'info', `[用户 #${userId}] 触发指令: 查看待办任务清单`);
    let imageBuffer: Buffer | undefined;
    try {
      imageBuffer = await renderTodoListImage(userId);
    } catch (e: any) {
      addDebugLog('Weixin', 'error', `生成待办清单卡片图片失败: ${e.message}`);
    }

    const countRow = db.prepare(`SELECT count(*) as c FROM tasks WHERE user_id = ? AND status IN ('scheduled', 'in_progress', 'pending')`).get(userId) as any;
    const taskCount = countRow?.c || 0;

    const replyText =
      `📝【待办任务清单 (Todo List)】\n` +
      `您当前共有 ${taskCount} 项待办任务。\n` +
      (imageBuffer ? `任务清单图已在下方发送 👇\n` : '') +
      `💡 可回复“安排任务 [内容]”即刻智能规划，或“完成任务 [名称]”打勾完成。`;

    return {
      replyText,
      imageBuffer,
      diagnostics: { intent: 'view_todos', taskCount },
    };
  }

  // 3. Direct Trigger Command: "重新规划" / "重新排程" / "智能重新排程"
  if (
    trimmed === '重新规划' ||
    trimmed === '重新排程' ||
    trimmed === '刷新排程' ||
    trimmed === '更新日历' ||
    trimmed === '智能排程' ||
    trimmed.includes('重新排程') ||
    trimmed.includes('重新规划')
  ) {
    addDebugLog('Weixin', 'info', `[用户 #${userId}] 触发指令: 强制重新排程`);
    await syncAllUserSubscriptions(userId);
    const replanRes = replanUserTasks(userId);
    let imageBuffer: Buffer | undefined;
    try {
      imageBuffer = await renderCalendarImage(userId);
    } catch (e: any) {
      addDebugLog('Weixin', 'error', `生成日历卡片图片失败: ${e.message}`);
    }

    const replyText =
      `🔄【自适应重新排程已完成】\n` +
      `已结合最新紧急度、截止时间与外部日程重新排布！\n` +
      `• 共规划任务：${replanRes.scheduledCount} 项${replanRes.failedCount > 0 ? `（${replanRes.failedCount} 项暂无合适时段）` : ''}\n` +
      (imageBuffer ? `最新日程图已在下方发送 👇` : '');

    return {
      replyText,
      imageBuffer,
      diagnostics: { intent: 'replan', replanRes },
    };
  }

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
    let parsed: any;
    // Check if user has configured LLM API Key
    if (!settings.llm_api_key || !settings.llm_api_key.trim()) {
      addDebugLog('LLM', 'warn', `用户 #${userId} 未配置 DeepSeek API Key，无法进行语义解析`);
      return {
        replyText:
          `⚠️【系统提醒】您尚未在管理后台配置大模型 API Key。\n` +
          `请登录管理面板（http://${settings.weixin_base_url ? '管理地址' : '5178'}）在「设置」中填入您的 DeepSeek API Key 即可开启智能规划。`,
        diagnostics: { error: '未配置 LLM API Key' },
      };
    }

    parsed = await parseUserMessageWithLLM(content, settings, pendingTask);
    addDebugLog('LLM', 'success', `用户 #${userId} 语义解析成功`, parsed);

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
        const reply = '💡 当前没有正在进行或排程中的待办任务，无需更新状态。';
        return { replyText: reply, diagnostics: { intent: parsed.intent, parsed } };
      }

      if (action === 'complete') {
        db.prepare("UPDATE tasks SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(activeTask.id);
        const reply = templates.taskCompleted(activeTask.title);
        addDebugLog('Scheduler', 'success', `待办 #${activeTask.id} (${activeTask.title}) 标记为已完成`);
        return { replyText: reply, diagnostics: { intent: parsed.intent, parsed, action: 'completed' } };
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

        const reply = templates.taskExtended(activeTask.title, extMin, newEndStr);
        addDebugLog('Scheduler', 'info', `待办 #${activeTask.id} (${activeTask.title}) 延长 ${extMin}m 至 ${newEndStr}`);
        return { replyText: reply, diagnostics: { intent: parsed.intent, parsed, action: 'extend', extMin } };
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
          const reply = templates.taskRescheduled(activeTask.title, sStr, eStr);
          addDebugLog('Scheduler', 'success', `待办 #${activeTask.id} (${activeTask.title}) 重新排程成功: ${sStr} ~ ${eStr}`);
          return { replyText: reply, diagnostics: { intent: parsed.intent, parsed, plan } };
        } else {
          const reply = `⚠️ 重新安排失败：${plan.message}`;
          return { replyText: reply, diagnostics: { intent: parsed.intent, parsed, plan } };
        }
      } else {
        return { replyText: '已了解您的状态更新。', diagnostics: { intent: parsed.intent, parsed } };
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
      const reply = templates.scheduleQueryList(todayTasks, todayStr);
      addDebugLog('Scheduler', 'info', `查询今日日程，共找到 ${todayTasks.length} 项`);
      return { replyText: reply, diagnostics: { intent: parsed.intent, todayTasksCount: todayTasks.length } };
    } else if (parsed.intent === 'create_task') {
      const title = parsed.title || pendingTask?.title || '未命名任务';
      const duration = parsed.duration_minutes || parsed.estimatedMinutes || pendingTask?.duration_minutes || pendingTask?.estimatedMinutes || null;
      let importance = parsed.importance ?? pendingTask?.importance ?? 7.0; // 默认重要度 7.0
      let deadline = parsed.deadline || pendingTask?.deadline || null;
      const dueDate = parsed.dueDate || (deadline ? deadline.split('T')[0] : null) || pendingTask?.dueDate || null;
      if (!deadline && dueDate) {
        deadline = `${dueDate}T23:59:59`;
      }

      // 根据 oxoxox-oxox 算法：如果有 deadline / dueDate，紧迫度可通过 calculateDynamicUrgency 自动推导
      let urgency = parsed.urgency ?? pendingTask?.urgency ?? null;
      if (deadline || dueDate) {
        try {
          const { calculateDynamicUrgency } = await import('../utils/priorityAlgorithm.js');
          const dyn = calculateDynamicUrgency({
            dueDate: dueDate || deadline,
            estimatedMinutes: duration || 30,
            fallbackUrgency: urgency ?? 5.0,
          });
          urgency = dyn.urgency;
        } catch {
          if (!urgency) urgency = 6.0;
        }
      }

      const merged = { title, duration_minutes: duration, urgency, importance, deadline, dueDate };
      const missing = {
        duration: !duration || duration <= 0,
        deadline: !deadline && !dueDate,
        urgency: false, // 紧迫度依据截止期自动推导，不强制追问
        importance: !importance,
      };

      const hasMissing = missing.duration || missing.deadline;

      if (hasMissing) {
        db.prepare(`
          INSERT INTO conversation_states (user_id, current_intent, pending_task_json, missing_fields, updated_at)
          VALUES (?, 'create_task', ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET
            pending_task_json = excluded.pending_task_json,
            missing_fields = excluded.missing_fields,
            updated_at = CURRENT_TIMESTAMP
        `).run(userId, JSON.stringify(merged), JSON.stringify(missing));

        const reply = templates.askMissingFields(title, missing);
        addDebugLog('LLM', 'info', `任务要素缺失，向用户追问: ${title}`, missing);
        return { replyText: reply, diagnostics: { intent: parsed.intent, merged, missing } };
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

          // Dynamically optimize and adjust all tasks according to urgency & deadlines
          replanUserTasks(userId);

          const updatedTask = db.prepare('SELECT * FROM tasks WHERE user_id = ? AND title = ? ORDER BY id DESC LIMIT 1').get(userId, title) as Task;
          const actualStart = updatedTask?.scheduled_start || plan.scheduled_start;
          const actualEnd = updatedTask?.scheduled_end || plan.scheduled_end;

          const sStr = new Date(actualStart).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
          const eStr = new Date(actualEnd).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

          const reply = templates.scheduleSuccess(title, sStr, eStr, duration!, urgency!, importance!);
          addDebugLog('Scheduler', 'success', `新待办规划排程成功: "${title}" (${sStr} ~ ${eStr})`);
          return { replyText: reply, diagnostics: { intent: parsed.intent, plan, task: merged } };
        } else {
          db.prepare(`
            INSERT INTO tasks (
              user_id, title, duration_minutes, urgency, importance,
              deadline, status
            )
            VALUES (?, ?, ?, ?, ?, ?, 'pending_slot')
          `).run(userId, title, duration, urgency, importance, deadline);

          const reply = templates.scheduleFailed(title, duration!, plan.message);
          addDebugLog('Scheduler', 'warn', `新待办规划未找到合适时隙，置为待安排: "${title}" (${plan.message})`);
          return { replyText: reply, diagnostics: { intent: parsed.intent, plan, task: merged } };
        }
      }
    } else {
      const reply =
        `🤖【Clawbot 时间管理助手】\n` +
        `我是您的个人日程规划管家。您可以直接对我说：\n` +
        `• "安排明天下午写代码，耗时90分钟，加急5分，周三前交"\n` +
        `• "今天有哪些待办？"\n` +
        `• "刚刚的任务搞定了"\n` +
        `• "时间不够，延长30分钟"`;
      return { replyText: reply, diagnostics: { intent: 'help' } };
    }
  } catch (err: any) {
    addDebugLog('Weixin', 'error', `处理微信指令异常: ${err.message}`, err.stack);
    return {
      replyText: `⚠️ 助手处理出错：${err.message}\n请检查管理后台设置中 DeepSeek API Key 是否配置有效。`,
      diagnostics: { error: err.message },
    };
  }
}

/**
 * 5. Isolated Background Transit Worker Manager
 * Multi-tenant: Each user has their own independent long-poll worker!
 */
class WeixinTransitManager {
  private activeWorkers = new Map<
    number,
    {
      abortController: AbortController;
      running: boolean;
      startedAt: number;
      lastPollAt: number;
      lastError?: string;
    }
  >();

  public startWorker(userId: number) {
    this.stopWorker(userId);

    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings | undefined;
    if (!settings || !settings.weixin_connected || !settings.weixin_bot_token) {
      return;
    }

    const abortController = new AbortController();
    const now = Date.now();
    this.activeWorkers.set(userId, {
      abortController,
      running: true,
      startedAt: now,
      lastPollAt: now,
    });

    addDebugLog(
      'Weixin',
      'info',
      `🚀 启动用户 #${userId} 的微信独立轮询管道 (WxUser: ${settings.weixin_user_id || 'unnamed'})`
    );
    this.runLongPollLoop(userId, abortController.signal);
  }

  public stopWorker(userId: number) {
    const worker = this.activeWorkers.get(userId);
    if (worker) {
      worker.running = false;
      worker.abortController.abort();
      this.activeWorkers.delete(userId);
      addDebugLog('Weixin', 'info', `🛑 已停止用户 #${userId} 的微信轮询管道`);
    }
  }

  public startAllActiveWorkers() {
    const connectedUsers = db.prepare(`
      SELECT user_id FROM user_settings
      WHERE weixin_connected = 1 AND weixin_bot_token != ''
    `).all() as { user_id: number }[];

    addDebugLog('Weixin', 'info', `🌟 初始化多租户微信轮询: 共 ${connectedUsers.length} 位已连接用户`);
    for (const u of connectedUsers) {
      this.startWorker(u.user_id);
    }
  }

  public getWorkerStatusList() {
    const allSettings = db.prepare(`
      SELECT us.*, u.username, u.role
      FROM user_settings us
      JOIN users u ON us.user_id = u.id
      ORDER BY us.user_id ASC
    `).all() as (UserSettings & { username: string; role: string })[];

    return allSettings.map((s) => {
      const worker = this.activeWorkers.get(s.user_id);
      return {
        userId: s.user_id,
        username: s.username,
        role: s.role,
        weixinConnected: Boolean(s.weixin_connected),
        weixinBotId: s.weixin_bot_id || '',
        weixinUserId: s.weixin_user_id || '',
        weixinBaseUrl: s.weixin_base_url || FIXED_BASE_URL,
        hasBotToken: Boolean(s.weixin_bot_token && s.weixin_bot_token.length > 5),
        hasSyncBuf: Boolean(s.weixin_sync_buf),
        hasContextToken: Boolean(s.weixin_context_token || contextTokenMap.has(s.user_id)),
        hasLlmKey: Boolean(s.llm_api_key && s.llm_api_key.length > 3),
        workerRunning: Boolean(worker?.running),
        startedAt: worker?.startedAt ? new Date(worker.startedAt).toISOString() : null,
        lastPollAt: worker?.lastPollAt ? new Date(worker.lastPollAt).toISOString() : null,
        lastError: worker?.lastError,
      };
    });
  }

  public resetSyncBuf(userId: number) {
    db.prepare('UPDATE user_settings SET weixin_sync_buf = "" WHERE user_id = ?').run(userId);
    addDebugLog('Weixin', 'info', `用户 #${userId} 的 weixin_sync_buf 已重置为初始状态`);
    this.startWorker(userId);
  }

  private async runLongPollLoop(userId: number, signal: AbortSignal) {
    while (!signal.aborted) {
      const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings | undefined;
      if (!settings || !settings.weixin_connected || !settings.weixin_bot_token) {
        this.stopWorker(userId);
        break;
      }

      const worker = this.activeWorkers.get(userId);
      if (worker) {
        worker.lastPollAt = Date.now();
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

        const data = resp.data || {};
        const isApiError =
          (data.ret !== undefined && data.ret !== 0) ||
          (data.errcode !== undefined && data.errcode !== 0);

        if (isApiError) {
          const errCode = data.errcode ?? data.ret;
          const errMsg = data.errmsg || '';
          if (worker) worker.lastError = `ret=${errCode} errmsg=${errMsg}`;
          addDebugLog('Weixin', 'warn', `[用户 #${userId}] getupdates 返回错误码: ${errCode} (${errMsg})`);
          if (errCode === -14) {
            addDebugLog('Weixin', 'error', `[用户 #${userId}] 微信登录凭证已失效 (errcode -14)，请重新在设置中扫码`);
            this.stopWorker(userId);
            break;
          }
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }

        // Valid successful getupdates poll response
        if (worker) worker.lastError = undefined;

        if (data.get_updates_buf && data.get_updates_buf !== syncBuf) {
          db.prepare('UPDATE user_settings SET weixin_sync_buf = ? WHERE user_id = ?').run(data.get_updates_buf, userId);
        }

        const msgs = data.msgs || [];
        if (msgs.length > 0) {
          addDebugLog('Weixin', 'info', `[用户 #${userId}] 收到 ${msgs.length} 条微信消息更新`);
        }

        for (const msg of msgs) {
          const fromUserId = msg.from_user_id;
          // Ignore messages sent by the bot itself
          if (fromUserId === botId) continue;

          // Cache context_token if present
          if (msg.context_token) {
            contextTokenMap.set(userId, msg.context_token);
            db.prepare('UPDATE user_settings SET weixin_context_token = ? WHERE user_id = ?').run(msg.context_token, userId);
            addDebugLog('Weixin', 'info', `[用户 #${userId}] 更新会话 context_token 成功`);
          }

          const itemList = msg.item_list || [];
          for (const item of itemList) {
            if (item.type === 1 && item.text_item?.text) {
              const userText = item.text_item.text.trim();
              addDebugLog('Weixin', 'info', `📩 微信来信 (用户 #${userId}): "${userText}"`);

              // Process through scheduling pipeline
              const { replyText, imageBuffer } = await processWeChatMessage(userId, userText, fromUserId);

              // Use the context token from msg or memory
              const activeContextToken = msg.context_token || contextTokenMap.get(userId) || settings.weixin_context_token;

              // Send text reply back to user
              await sendWeixinTextMessage(
                baseUrl,
                botToken,
                botId,
                fromUserId,
                replyText,
                activeContextToken
              );

              // If an image card was generated (e.g. for "查看日历" or "查看任务"), send image message
              if (imageBuffer) {
                await sendWeixinImageMessage(
                  baseUrl,
                  botToken,
                  botId,
                  fromUserId,
                  imageBuffer,
                  activeContextToken
                );
              }
            }
          }
        }
      } catch (err: any) {
        if (signal.aborted) break;

        // Long-poll timeout is expected and normal
        if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
          continue;
        }

        if (worker) worker.lastError = err.message;
        addDebugLog('Weixin', 'warn', `[用户 #${userId}] 微信轮询连接异常: ${err.message}`);
        // Gentle backoff before retrying
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
}

export const weixinTransitManager = new WeixinTransitManager();
