import { Response } from 'express';
import crypto from 'crypto';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { UserSettings } from '../models/types.js';

export function getSettings(req: AuthenticatedRequest, res: Response): void {
  const userId = req.user!.id;
  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings | undefined;

  const host = req.get('host') || 'localhost:5178';
  const protocol = req.protocol;

  const webhookUrl = `${protocol}://${host}/api/webhook/clawbot/${settings?.clawbot_webhook_token || ''}`;
  const icalSubscriptionUrl = `${protocol}://${host}/api/calendar/subscribe/${req.user!.token_secret}.ics`;

  res.json({
    settings: settings || null,
    urls: {
      webhookUrl,
      icalSubscriptionUrl,
      webcalUrl: icalSubscriptionUrl.replace(/^https?:/, 'webcal:'),
    },
  });
}

export function updateSettings(req: AuthenticatedRequest, res: Response): void {
  const userId = req.user!.id;
  const {
    llm_endpoint,
    llm_api_key,
    llm_model,
    clawbot_outbound_url,
    clawbot_outbound_key,
    clawbot_to_wxid,
    work_slots,
    task_buffer_minutes,
    reminder_before_start_minutes,
    reminder_before_end_minutes,
    calendar_sync_interval_minutes,
  } = req.body;

  // Validate work_slots JSON
  let workSlotsStr = work_slots;
  if (typeof work_slots === 'object') {
    workSlotsStr = JSON.stringify(work_slots);
  } else if (typeof work_slots === 'string') {
    try {
      JSON.parse(work_slots);
    } catch {
      res.status(400).json({ error: '工作时段格式错误，需为有效的 JSON 数组' });
      return;
    }
  }

  db.prepare(`
    INSERT INTO user_settings (
      user_id, llm_endpoint, llm_api_key, llm_model,
      clawbot_outbound_url, clawbot_outbound_key, clawbot_to_wxid,
      work_slots, task_buffer_minutes, reminder_before_start_minutes,
      reminder_before_end_minutes, calendar_sync_interval_minutes,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      llm_endpoint = COALESCE(excluded.llm_endpoint, user_settings.llm_endpoint),
      llm_api_key = COALESCE(excluded.llm_api_key, user_settings.llm_api_key),
      llm_model = COALESCE(excluded.llm_model, user_settings.llm_model),
      clawbot_outbound_url = COALESCE(excluded.clawbot_outbound_url, user_settings.clawbot_outbound_url),
      clawbot_outbound_key = COALESCE(excluded.clawbot_outbound_key, user_settings.clawbot_outbound_key),
      clawbot_to_wxid = COALESCE(excluded.clawbot_to_wxid, user_settings.clawbot_to_wxid),
      work_slots = COALESCE(excluded.work_slots, user_settings.work_slots),
      task_buffer_minutes = COALESCE(excluded.task_buffer_minutes, user_settings.task_buffer_minutes),
      reminder_before_start_minutes = COALESCE(excluded.reminder_before_start_minutes, user_settings.reminder_before_start_minutes),
      reminder_before_end_minutes = COALESCE(excluded.reminder_before_end_minutes, user_settings.reminder_before_end_minutes),
      calendar_sync_interval_minutes = COALESCE(excluded.calendar_sync_interval_minutes, user_settings.calendar_sync_interval_minutes),
      updated_at = CURRENT_TIMESTAMP
  `).run(
    userId,
    llm_endpoint ?? 'https://api.deepseek.com/v1',
    llm_api_key ?? '',
    llm_model ?? 'deepseek-chat',
    clawbot_outbound_url ?? '',
    clawbot_outbound_key ?? '',
    clawbot_to_wxid ?? '',
    workSlotsStr,
    task_buffer_minutes ?? 10,
    reminder_before_start_minutes ?? 5,
    reminder_before_end_minutes ?? 5,
    calendar_sync_interval_minutes ?? 60
  );

  res.json({ message: '配置已保存成功！' });
}

export function regenerateWebhookToken(req: AuthenticatedRequest, res: Response): void {
  const userId = req.user!.id;
  const newToken = crypto.randomBytes(16).toString('hex');

  db.prepare(`
    UPDATE user_settings
    SET clawbot_webhook_token = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(newToken, userId);

  res.json({ message: 'Webhook Token 已重新生成', token: newToken });
}
