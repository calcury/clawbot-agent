export interface User {
  id: number;
  username: string;
  password_hash?: string;
  role: 'user' | 'admin';
  status: 'pending' | 'approved' | 'rejected';
  token_secret: string;
  created_at: string;
  updated_at: string;
}

export interface WorkSlot {
  start: string; // "09:00"
  end: string;   // "12:00"
}

export interface UserSettings {
  user_id: number;
  llm_endpoint: string;
  llm_api_key: string;
  llm_model: string;
  clawbot_webhook_token: string;
  clawbot_outbound_url: string;
  clawbot_outbound_key: string;
  clawbot_to_wxid: string;
  work_slots: string; // JSON array of WorkSlot
  task_buffer_minutes: number;
  reminder_before_start_minutes: number;
  reminder_before_end_minutes: number;
  calendar_sync_interval_minutes: number;
  weixin_connected?: number;
  weixin_bot_token?: string;
  weixin_bot_id?: string;
  weixin_user_id?: string;
  weixin_base_url?: string;
  weixin_sync_buf?: string;
  weixin_nickname?: string;
  weixin_context_token?: string;
  updated_at: string;
}

export interface CalendarSubscription {
  id: number;
  user_id: number;
  name: string;
  url: string;
  last_sync_at: string | null;
  sync_status: 'ok' | 'error';
  error_message: string | null;
  created_at: string;
}

export interface ExternalEvent {
  id: number;
  user_id: number;
  subscription_id?: number | null;
  uid?: string | null;
  title: string;
  start_time: string; // ISO
  end_time: string;   // ISO
  is_all_day: number;
  created_at: string;
}

export interface Task {
  id: number;
  user_id: number;
  title: string;
  duration_minutes: number;
  urgency: number;    // 1 - 5
  importance: number; // 1 - 5
  deadline: string | null; // ISO
  scheduled_start: string | null; // ISO
  scheduled_end: string | null;   // ISO
  status: 'pending_slot' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'delayed';
  notes?: string | null;
  start_reminder_sent: number;
  end_reminder_sent: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationState {
  id: number;
  user_id: number;
  current_intent: string | null;
  pending_task_json: string | null;
  missing_fields: string | null;
  updated_at: string;
}

export interface LLMExtractionResult {
  intent: 'create_task' | 'status_update' | 'query_schedule' | 'other';
  title?: string | null;
  description?: string | null;
  duration_minutes?: number | null;
  urgency?: number | null; // 0.0 - 10.0
  importance?: number | null; // 0.0 - 10.0
  deadline?: string | null; // ISO 8601 string or YYYY-MM-DD
  dueDate?: string | null; // 对齐 oxoxox-oxox: YYYY-MM-DD
  estimatedMinutes?: number | null; // 对齐 oxoxox-oxox: 预计耗时分钟数
  tags?: string[] | null; // 标签列表
  status_action?: 'complete' | 'extend' | 'reschedule' | 'cancel' | null;
  extend_minutes?: number | null;
  target_task_name?: string | null;
}

export interface ClawbotWebhookPayload {
  token?: string;
  fromUser?: string;
  toUser?: string;
  content: string;
  msgId?: string;
  msgType?: string;
  raw?: any;
}
