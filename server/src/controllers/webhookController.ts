import { Request, Response } from 'express';
import { db } from '../config/database.js';
import { UserSettings, Task, ConversationState } from '../models/types.js';
import { parseUserMessageWithLLM } from '../services/llm.js';
import { scheduleTask } from '../services/scheduler.js';
import { templates, sendClawbotMessage } from '../services/clawbot.js';

export async function handleClawbotWebhook(req: Request, res: Response): Promise<void> {
  const { token } = req.params;

  if (!token) {
    res.status(401).json({ error: '缺少 Webhook Token' });
    return;
  }

  // 1. Locate user by webhook token
  const settings = db.prepare('SELECT * FROM user_settings WHERE clawbot_webhook_token = ?').get(token) as UserSettings | undefined;
  if (!settings) {
    res.status(401).json({ error: '无效的 Webhook Token' });
    return;
  }

  const userId = settings.user_id;

  // 2. Extract content from payload
  const body = req.body || {};
  const content = (body.content || body.text || body.message || body.msg || '').toString().trim();
  const fromWxid = body.fromUser || body.wxid || body.from || body.sender;

  // Auto-record user wxid if provided and not yet set
  if (fromWxid && !settings.clawbot_to_wxid) {
    db.prepare('UPDATE user_settings SET clawbot_to_wxid = ? WHERE user_id = ?').run(fromWxid, userId);
    settings.clawbot_to_wxid = fromWxid;
  }

  if (!content) {
    res.json({ reply: '收到空消息' });
    return;
  }

  // 3. Check for existing multi-turn pending state
  const existingConv = db.prepare('SELECT * FROM conversation_states WHERE user_id = ?').get(userId) as ConversationState | undefined;
  let pendingTask: any = null;
  if (existingConv && existingConv.pending_task_json) {
    try {
      pendingTask = JSON.parse(existingConv.pending_task_json);
    } catch {
      pendingTask = null;
    }
  }

  let replyText = '';

  try {
    // 4. LLM parses the user message into structured fields
    const parsed = await parseUserMessageWithLLM(content, settings, pendingTask);
    console.log(`[Webhook] User #${userId} LLM parsed result:`, parsed);

    // 5. State Machine Handling
    if (parsed.intent === 'status_update') {
      // Clear pending conversation state if user switched to status reporting
      db.prepare('DELETE FROM conversation_states WHERE user_id = ?').run(userId);

      const action = parsed.status_action || 'complete';

      // Find nearest active or recent task
      const activeTask = db.prepare(`
        SELECT * FROM tasks
        WHERE user_id = ? AND status IN ('scheduled', 'in_progress')
        ORDER BY CASE status WHEN 'in_progress' THEN 1 ELSE 2 END, scheduled_start ASC
        LIMIT 1
      `).get(userId) as Task | undefined;

      if (!activeTask) {
        replyText = '💡 当前没有正在进行或排程中的待办任务，无需更新状态。';
      } else if (action === 'complete') {
        db.prepare(`
          UPDATE tasks
          SET status = 'completed', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(activeTask.id);
        replyText = templates.taskCompleted(activeTask.title);
      } else if (action === 'extend') {
        const extMin = parsed.extend_minutes || 30;
        const currentEnd = new Date(activeTask.scheduled_end || new Date());
        const newEnd = new Date(currentEnd.getTime() + extMin * 60 * 1000);
        const newEndStr = newEnd.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

        db.prepare(`
          UPDATE tasks
          SET
            scheduled_end = ?,
            duration_minutes = duration_minutes + ?,
            end_reminder_sent = 0,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newEnd.toISOString(), extMin, activeTask.id);

        replyText = templates.taskExtended(activeTask.title, extMin, newEndStr);
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
            SET
              scheduled_start = ?,
              scheduled_end = ?,
              status = 'scheduled',
              start_reminder_sent = 0,
              end_reminder_sent = 0,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(plan.scheduled_start, plan.scheduled_end, activeTask.id);

          const sStr = new Date(plan.scheduled_start).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
          const eStr = new Date(plan.scheduled_end).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
          replyText = templates.taskRescheduled(activeTask.title, sStr, eStr);
        } else {
          replyText = `⚠️ 重新安排失败：${plan.message}`;
        }
      }
    } else if (parsed.intent === 'query_schedule') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const todayTasks = db.prepare(`
        SELECT * FROM tasks
        WHERE user_id = ?
          AND scheduled_start >= ?
          AND scheduled_start <= ?
        ORDER BY scheduled_start ASC
      `).all(userId, todayStart.toISOString(), todayEnd.toISOString()) as Task[];

      const todayStr = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
      replyText = templates.scheduleQueryList(todayTasks, todayStr);
    } else if (parsed.intent === 'create_task') {
      // Merge with pending task if present
      const title = parsed.title || pendingTask?.title || '未命名任务';
      const duration = parsed.duration_minutes || pendingTask?.duration_minutes || null;
      const urgency = parsed.urgency || pendingTask?.urgency || null;
      const importance = parsed.importance || pendingTask?.importance || null;
      const deadline = parsed.deadline || pendingTask?.deadline || null;

      const merged = { title, duration_minutes: duration, urgency, importance, deadline };

      // Check missing fields
      const missing = {
        duration: !duration || duration <= 0,
        deadline: !deadline,
        urgency: !urgency,
        importance: !importance,
      };

      const hasMissing = missing.duration || missing.deadline || missing.urgency || missing.importance;

      if (hasMissing) {
        // Save pending conversation state
        db.prepare(`
          INSERT INTO conversation_states (user_id, current_intent, pending_task_json, missing_fields, updated_at)
          VALUES (?, 'create_task', ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET
            pending_task_json = excluded.pending_task_json,
            missing_fields = excluded.missing_fields,
            updated_at = CURRENT_TIMESTAMP
        `).run(userId, JSON.stringify(merged), JSON.stringify(missing));

        replyText = templates.askMissingFields(title, missing);
      } else {
        // All 4 critical fields are available! Run scheduling algorithm!
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

          const sStr = new Date(plan.scheduled_start).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
          const eStr = new Date(plan.scheduled_end).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });

          replyText = templates.scheduleSuccess(title, sStr, eStr, duration!, urgency!, importance!);
        } else {
          // Save as pending slot
          db.prepare(`
            INSERT INTO tasks (
              user_id, title, duration_minutes, urgency, importance,
              deadline, status
            )
            VALUES (?, ?, ?, ?, ?, ?, 'pending_slot')
          `).run(userId, title, duration, urgency, importance, deadline);

          replyText = templates.scheduleFailed(title, duration!, plan.message);
        }
      }
    } else {
      replyText =
        `🤖【Clawbot 时间管理助手】\n` +
        `收到您的消息！您可以随时对我说：\n` +
        `• "安排明天下午写代码，耗时90分钟，加急5分，周三前交"\n` +
        `• "看看今天的日程"\n` +
        `• "当前任务搞定了 / 提前完成"\n` +
        `• "时间不够，延长半小时"`;
    }
  } catch (err: any) {
    console.error('[Webhook Processing Error]:', err);
    replyText = `⚠️ 助手处理出错：${err.message}\n请检查管理面板中配置的 DeepSeek API Key 是否有效。`;
  }

  // Attempt to push back through Clawbot outbound API
  await sendClawbotMessage(settings, replyText);

  // Also return response directly in HTTP JSON response
  res.json({
    success: true,
    reply: replyText,
  });
}

/**
 * Endpoint for testing Webhook directly from Management Dashboard
 */
export async function testWebhookSimulate(req: Request, res: Response): Promise<void> {
  const { token, content } = req.body;
  if (!token || !content) {
    res.status(400).json({ error: '缺少 token 或 content' });
    return;
  }

  // Wrap into handleClawbotWebhook logic
  req.params = { token };
  req.body = { content };
  await handleClawbotWebhook(req, res);
}
