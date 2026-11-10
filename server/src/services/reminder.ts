import cron from 'node-cron';
import { db } from '../config/database.js';
import { Task, UserSettings, CalendarSubscription } from '../models/types.js';
import { templates, sendClawbotMessage } from './clawbot.js';
import { syncSubscription } from './calendarSync.js';

export function startReminderScheduler() {
  console.log('⏰ [Scheduler] Reminder & Calendar Sync Worker started (Every 30s)');

  // Run every 30 seconds
  cron.schedule('*/30 * * * * *', async () => {
    try {
      await checkStartReminders();
      await checkEndReminders();
      await checkCalendarSync();
    } catch (err: any) {
      console.error('[Scheduler Error]:', err.message);
    }
  });
}

/**
 * Check and send start reminders
 */
async function checkStartReminders() {
  const now = new Date();

  // Find users and their active settings
  const pendingTasks = db.prepare(`
    SELECT t.*, u.username
    FROM tasks t
    JOIN users u ON t.user_id = u.id
    WHERE t.status = 'scheduled'
      AND t.scheduled_start IS NOT NULL
      AND t.start_reminder_sent = 0
  `).all() as (Task & { username: string })[];

  for (const task of pendingTasks) {
    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(task.user_id) as UserSettings;
    if (!settings) continue;

    const leadMinutes = settings.reminder_before_start_minutes ?? 5;
    const startTime = new Date(task.scheduled_start!);
    const triggerTime = new Date(startTime.getTime() - leadMinutes * 60 * 1000);

    // If within trigger window (from triggerTime up to 3 minutes after start)
    if (now >= triggerTime && now <= new Date(startTime.getTime() + 3 * 60 * 1000)) {
      const sStr = startTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
      const eStr = task.scheduled_end ? new Date(task.scheduled_end).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';

      // Mark as sent immediately to prevent race conditions and repeat sends
      db.prepare("UPDATE tasks SET start_reminder_sent = 1, status = 'in_progress' WHERE id = ?").run(task.id);

      const msg = templates.reminderBeforeStart(task.title, sStr, eStr, leadMinutes);
      await sendClawbotMessage(settings, msg);
      console.log(`[Reminder] Sent START reminder for task #${task.id} (${task.title}) to user #${task.user_id}`);
    }
  }
}

/**
 * Check and send approaching end reminders
 */
async function checkEndReminders() {
  const now = new Date();

  const activeTasks = db.prepare(`
    SELECT t.*, u.username
    FROM tasks t
    JOIN users u ON t.user_id = u.id
    WHERE t.status IN ('scheduled', 'in_progress')
      AND t.scheduled_end IS NOT NULL
      AND t.end_reminder_sent = 0
  `).all() as (Task & { username: string })[];

  for (const task of activeTasks) {
    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(task.user_id) as UserSettings;
    if (!settings) continue;

    const leadMinutes = settings.reminder_before_end_minutes ?? 5;
    const endTime = new Date(task.scheduled_end!);
    const triggerTime = new Date(endTime.getTime() - leadMinutes * 60 * 1000);

    // If within trigger window
    if (now >= triggerTime && now <= new Date(endTime.getTime() + 15 * 60 * 1000)) {
      // Mark as sent immediately to avoid repeat firing
      db.prepare("UPDATE tasks SET end_reminder_sent = 1 WHERE id = ?").run(task.id);

      const msg = templates.reminderBeforeEnd(task.title, leadMinutes);
      await sendClawbotMessage(settings, msg);
      console.log(`[Reminder] Sent END check-in for task #${task.id} (${task.title}) to user #${task.user_id}`);
    }
  }
}

/**
 * Periodically sync external calendar subscriptions
 */
async function checkCalendarSync() {
  const subs = db.prepare(`
    SELECT cs.*, us.calendar_sync_interval_minutes
    FROM calendar_subscriptions cs
    JOIN user_settings us ON cs.user_id = us.user_id
  `).all() as (CalendarSubscription & { calendar_sync_interval_minutes: number })[];

  const now = new Date();

  for (const sub of subs) {
    const intervalMin = sub.calendar_sync_interval_minutes || 60;
    const lastSync = sub.last_sync_at ? new Date(sub.last_sync_at) : new Date(0);

    if (now.getTime() - lastSync.getTime() >= intervalMin * 60 * 1000) {
      try {
        console.log(`[CalendarSync] Auto-syncing calendar subscription #${sub.id} (${sub.name})...`);
        await syncSubscription(sub);
      } catch (err: any) {
        console.error(`[CalendarSync] Auto-sync failed for #${sub.id}:`, err.message);
      }
    }
  }
}
