export interface User {
  id: number;
  username: string;
  email?: string;
  nickname?: string;
  avatar_url?: string;
  password_hash?: string;
  role: 'user' | 'admin';
  status: 'pending' | 'approved' | 'rejected' | 'banned';
  balance?: number;
  token_secret: string;
  session_version?: number;
  created_at: string;
  updated_at: string;
}

export interface WorkSlot {
  start: string; // "09:00"
  end: string;   // "12:00"
}

export type WeixinConnectionStatus = 'disconnected' | 'connected' | 'rebind_required';
export type ScheduleLockMode = 'none' | 'hours' | 'today' | 'this_week';

export interface UserSettings {
  user_id: number;
  api_mode?: 'official' | 'custom';
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
  advance_deadline_days?: number;
  schedule_lock_mode?: ScheduleLockMode;
  schedule_lock_hours?: number;
  timezone?: string;
  calendar_color?: string | null;
  weixin_connected?: number;
  weixin_status?: WeixinConnectionStatus;
  weixin_bot_token?: string;
  weixin_bot_id?: string;
  weixin_user_id?: string;
  weixin_base_url?: string;
  weixin_sync_buf?: string;
  weixin_nickname?: string;
  weixin_context_token?: string;
  weixin_activated?: number;
  weixin_last_active_at?: string | null;
  updated_at: string;
}

export interface RedemptionCode {
  id: number;
  code: string;
  amount: number;
  status: 'active' | 'used' | 'disabled';
  created_by?: number | null;
  used_by_user_id?: number | null;
  used_by_username?: string | null;
  used_at?: string | null;
  created_at: string;
}

export interface SystemSetting {
  key: string;
  value: string;
  updated_at: string;
}

export interface CalendarSubscription {
  id: number;
  user_id: number;
  name: string;
  url: string;
  color?: string | null;
  last_sync_at: string | null;
  last_attempt_at?: string | null;
  last_success_at?: string | null;
  current_generation?: number;
  sync_status: 'ok' | 'error';
  error_message: string | null;
  created_at: string;
}

export interface ExternalEvent {
  id: number;
  user_id: number;
  subscription_id?: number | null;
  uid?: string | null;
  generation?: number;
  recurrence_id?: string | null;
  status?: string;
  transparency?: string;
  occurrence_start?: string | null;
  course_group_key?: string | null;
  course_group_label?: string | null;
  title: string;
  start_time: string; // ISO
  end_time: string;   // ISO
  is_all_day: number;
  created_at: string;
}

export interface ExternalEventGroupRule {
  id: number;
  user_id: number;
  subscription_id: number;
  group_key: string;
  group_label: string;
  allow_scheduling: number;
  ai_reminder_enabled: number;
  created_at: string;
  updated_at: string;
}

export interface ExternalEventOverride {
  id: number;
  user_id: number;
  subscription_id: number;
  event_uid: string;
  occurrence_start: string;
  group_key?: string | null;
  title?: string | null;
  allow_scheduling: number | null;
  ai_reminder_enabled: number | null;
  created_at: string;
  updated_at: string;
}

export interface ExternalNotificationOutboxRecord {
  id: number;
  user_id: number;
  subscription_id: number;
  event_uid: string;
  occurrence_start: string;
  title: string;
  start_time: string;
  end_time: string;
  is_all_day: number;
  allow_scheduling: number;
  scheduled_fire_at: string;
  expires_at: string;
  status: NotificationStatus;
  idempotency_key: string;
  attempt_count: number;
  next_retry_at?: string | null;
  provider_msg_id?: string | null;
  last_error?: string | null;
  lease_owner?: string | null;
  lease_until?: string | null;
  payload_json: string;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: number;
  user_id: number;
  title: string;
  duration_minutes: number;
  original_duration_minutes?: number;
  session_plan?: string | null;
  urgency: number;    // 0 - 100
  importance: number; // 0 - 100
  importance_tier?: 'vital' | 'support' | 'minor' | null;
  impact_signals?: string | null; // JSON array of ImpactSignal
  time_mode?: 'deadline' | 'specific_date' | 'daily_fixed' | 'flexible' | null;
  recurrence_rule?: string | null; // JSON string of RecurrenceRule { type: 'daily' | 'weekly', daysOfWeek?: number[] }
  urgency_pace?: 'urgent' | 'soon' | 'later' | null;
  importance_manual_override?: number | null;
  completed_dates?: string | null; // JSON array of YYYY-MM-DD
  score_scale?: number | null;
  deadline_kind?: 'hard' | 'soft' | null;
  deadline: string | null; // ISO
  scheduled_start: string | null; // ISO
  scheduled_end: string | null;   // ISO
  schedule_blocks?: string | null; // JSON array of scheduled focus blocks
  tags?: string | null; // JSON array of tag strings
  version?: number;
  active_template?: number;
  source_fingerprint?: string | null;
  is_fixed?: number;        // 1 = 固定任务，不参与自动重排
  is_concurrent?: number;   // 1 = 双线程任务，可与其他任务或日程重叠
  status: 'pending_slot' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'delayed';
  notes?: string | null;
  start_reminder_sent: number;
  end_reminder_sent: number;
  created_at: string;
  updated_at: string;
}

export type TaskInstanceStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type PlanStatus = 'scheduled' | 'partial' | 'pending' | 'conflict';

export interface TaskInstance {
  id: number;
  task_id: number;
  user_id: number;
  business_date: string; // YYYY-MM-DD in account timezone
  instance_type: 'once' | 'daily';
  status: TaskInstanceStatus;
  estimated_minutes: number;
  completed_minutes: number;
  plan_status: PlanStatus;
  allocated_minutes: number;
  unallocated_minutes: number;
  plan_reason?: string | null;
  version: number;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type ProgressAction =
  | 'start'
  | 'complete_part'
  | 'complete'
  | 'cancel'
  | 'reopen'
  | 'extend'
  | 'adjust_estimate';

export interface ProgressEvent {
  id: number;
  user_id: number;
  command_id: string;
  instance_id: number;
  block_id?: string | null;
  action: ProgressAction;
  delta_minutes: number;
  target_remaining_minutes?: number | null;
  reason?: string | null;
  created_at: string;
}

export interface SchedulePlan {
  id: number;
  user_id: number;
  version: number;
  trigger_source: string;
  status: 'committed' | 'superseded';
  summary?: string | null;
  calendar_generation_snapshot?: string | null;
  created_at: string;
}

export type ScheduleBlockStatus =
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'conflict'
  | 'superseded';

export interface ScheduleBlockRecord {
  id: string;
  user_id: number;
  plan_version: number;
  instance_id: number;
  task_id: number;
  start_time: string; // UTC ISO
  end_time: string;   // UTC ISO
  duration_minutes: number;
  part_index: number;
  total_parts: number;
  is_fixed: number;
  is_committed: number;
  is_concurrent: number;
  status: ScheduleBlockStatus;
  replaced_from_block_id?: string | null;
  energy_zone?: string | null;
  strategy_label?: string | null;
  break_after_minutes?: number | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleProposalRecord {
  id: string;
  user_id: number;
  base_plan_version: number;
  reason_type: 'deadline_risk' | 'priority_gain' | 'extend_conflict';
  reason_text: string;
  payload_json: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'superseded';
  expires_at: string;
  resolved_at?: string | null;
  created_at: string;
}

export interface CommandInboxRecord {
  id: number;
  user_id: number;
  channel: 'web' | 'weixin_ilink' | 'webhook' | 'system';
  channel_account_id: string;
  sender_id: string;
  external_msg_id: string;
  idempotency_key?: string | null;
  payload_hash: string;
  status: 'received' | 'processing' | 'completed' | 'failed';
  response_json?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationDraft {
  id: number;
  user_id: number;
  channel: string;
  thread_key: string;
  intent: string;
  draft_json: string;
  missing_fields_json?: string | null;
  version: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export type NotificationStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'unknown'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface NotificationOutboxRecord {
  id: number;
  user_id: number;
  instance_id: number;
  block_id: string;
  plan_version: number;
  reminder_type: 'start' | 'end';
  channel: string;
  scheduled_fire_at: string;
  expires_at: string;
  status: NotificationStatus;
  idempotency_key: string;
  attempt_count: number;
  next_retry_at?: string | null;
  provider_msg_id?: string | null;
  last_error?: string | null;
  lease_owner?: string | null;
  lease_until?: string | null;
  payload_json: string;
  created_at: string;
  updated_at: string;
}

export interface WeixinReplyOutboxRecord {
  id: number;
  user_id: number;
  inbox_id?: number | null;
  channel: string;
  to_user_id: string;
  context_token?: string | null;
  text_content: string;
  image_kind?: 'week_calendar' | 'todo_list' | null;
  image_base64?: string | null;
  text_sent: number;
  image_sent: number;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'expired' | 'cancelled';
  attempt_count: number;
  next_retry_at?: string | null;
  lease_owner?: string | null;
  lease_until?: string | null;
  provider_msg_id?: string | null;
  last_error?: string | null;
  expires_at: string;
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

export interface LLMExtractionAction {
  swap_decision?: 'confirm' | 'reject' | 'other' | null;
  session_action?: 'continue' | 'cancel_session' | 'switch_new' | 'select_candidate' | null;
  selected_candidate_index?: number | null;
  selected_candidate_id?: number | null;
  intent: 'create_task' | 'status_update' | 'query_schedule' | 'delete_item' | 'modify_item' | 'other';
  title?: string | null;
  description?: string | null;
  duration_minutes?: number | null;
  urgency?: number | null;
  importance?: number | null;
  importance_tier?: 'vital' | 'support' | 'minor' | null;
  impact_signals?: string[] | null;
  time_mode?: 'deadline' | 'specific_date' | 'daily_fixed' | 'flexible' | null;
  recurrence_rule?: string | null; // JSON string of RecurrenceRule { type: 'daily' | 'weekly', daysOfWeek?: number[] }
  urgency_pace?: 'urgent' | 'soon' | 'later' | null;
  deadline?: string | null;
  deadline_kind?: 'hard' | 'soft' | null;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
  tags?: string[] | null;
  is_fixed?: boolean | null;
  is_concurrent?: boolean | null;
  fixed_start?: string | null;
  fixed_end?: string | null;
  allow_split?: boolean | null;
  status_action?: 'start' | 'complete' | 'complete_part' | 'extend' | 'reschedule' | 'cancel' | 'reopen' | 'stop_daily' | null;
  reschedule_mode?: 'auto' | 'next_slot' | 'specific_date' | 'specific_time' | null;
  target_time_period?: 'morning' | 'afternoon' | 'evening' | null;
  target_start?: string | null;
  target_end?: string | null;
  source_date?: string | null;
  extend_minutes?: number | null;
  target_task_name?: string | null;
  target_date?: string | null;
  completed_part_index?: number | null;
  completed_minutes?: number | null;
  delete_target?: {
    type?: 'task' | 'calendar_event' | 'auto';
    name?: string | null;
    date?: string | null;
  } | null;
  modify_target?: {
    type?: 'task' | 'calendar_event' | 'auto';
    name?: string | null;
    new_title?: string | null;
    new_duration_minutes?: number | null;
    new_deadline?: string | null;
    deadline_kind?: 'hard' | 'soft' | null;
    new_start?: string | null;
    new_end?: string | null;
    is_fixed?: boolean | null;
    is_concurrent?: boolean | null;
    tags?: string[] | null;
    notes?: string | null;
  } | null;
}

export interface LLMExtractionResult extends LLMExtractionAction {
  extra_actions?: LLMExtractionAction[] | null;
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
