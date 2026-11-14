import ical from 'node-ical';
import icalGenerator, { ICalAlarmType, ICalEventStatus } from 'ical-generator';
import { db } from '../config/database.js';
import { CalendarSubscription, Task } from '../models/types.js';

/**
 * Synchronize a single external calendar subscription
 */
export async function syncSubscription(sub: CalendarSubscription): Promise<{ count: number }> {
  let fetchUrl = sub.url.trim();
  if (fetchUrl.startsWith('webcal://')) {
    fetchUrl = 'https://' + fetchUrl.substring(9);
  }

  try {
    const events = await ical.async.fromURL(fetchUrl);

    // Clean up old events for this subscription
    db.prepare('DELETE FROM external_events WHERE subscription_id = ?').run(sub.id);

    const now = new Date();
    const futureLimit = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days ahead
    const pastLimit = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);   // 7 days past

    const insertStmt = db.prepare(`
      INSERT INTO external_events (user_id, subscription_id, uid, title, start_time, end_time, is_all_day)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let insertedCount = 0;

    for (const k in events) {
      if (!Object.prototype.hasOwnProperty.call(events, k)) continue;
      const ev = events[k] as any;

      if (!ev || ev.type !== 'VEVENT') continue;

      const title = ev.summary || '无标题外部日程';
      const uid = ev.uid || `${sub.id}-${Date.now()}-${Math.random()}`;

      // Handle recurring events
      if (ev.rrule) {
        try {
          const dates = ev.rrule.between(pastLimit, futureLimit, true);
          const durationMs = ev.end && ev.start ? ev.end.getTime() - ev.start.getTime() : 3600000;

          for (const recurrenceDate of dates) {
            const rStart = recurrenceDate;
            const rEnd = new Date(rStart.getTime() + durationMs);
            const isAllDay = (ev as any).datetype === 'date' ? 1 : 0;

            insertStmt.run(
              sub.user_id,
              sub.id,
              `${uid}-${rStart.getTime()}`,
              title,
              rStart.toISOString(),
              rEnd.toISOString(),
              isAllDay
            );
            insertedCount++;
          }
        } catch (rruleErr) {
          console.warn(`RRULE expansion warning for event "${title}":`, rruleErr);
        }
      } else if (ev.start) {
        const start = new Date(ev.start);
        const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + 3600000);
        const isAllDay = (ev as any).datetype === 'date' ? 1 : 0;

        if (end >= pastLimit && start <= futureLimit) {
          insertStmt.run(
            sub.user_id,
            sub.id,
            uid,
            title,
            start.toISOString(),
            end.toISOString(),
            isAllDay
          );
          insertedCount++;
        }
      }
    }

    db.prepare(`
      UPDATE calendar_subscriptions
      SET last_sync_at = datetime('now', 'localtime'), sync_status = 'ok', error_message = NULL
      WHERE id = ?
    `).run(sub.id);

    return { count: insertedCount };
  } catch (err: any) {
    db.prepare(`
      UPDATE calendar_subscriptions
      SET sync_status = 'error', error_message = ?
      WHERE id = ?
    `).run(err.message, sub.id);
    throw err;
  }
}

/**
 * Synchronize all subscriptions belonging to a user
 */
export async function syncAllUserSubscriptions(userId: number): Promise<{ totalEvents: number; subscriptionsSynced: number }> {
  const subs = db.prepare('SELECT * FROM calendar_subscriptions WHERE user_id = ?').all(userId) as CalendarSubscription[];
  let totalEvents = 0;
  let subscriptionsSynced = 0;

  for (const sub of subs) {
    try {
      const res = await syncSubscription(sub);
      totalEvents += res.count;
      subscriptionsSynced++;
    } catch (err: any) {
      console.warn(`[Calendar] Failed to sync subscription #${sub.id} (${sub.name}):`, err.message);
    }
  }

  return { totalEvents, subscriptionsSynced };
}

/**
 * Generate iCalendar format string for dedicated TODO export
 */
export function generateUserTodoIcal(userId: number, username: string): string {
  const cal = icalGenerator({
    name: `${username} 的 Clawbot 智能待办日历`,
    description: '由 Clawbot 微信助手与 oxoxox 四象限算法智能规划的待办日历',
    timezone: 'Asia/Shanghai',
  });

  const tasks = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ?
      AND scheduled_start IS NOT NULL
      AND scheduled_end IS NOT NULL
      AND status IN ('scheduled', 'in_progress', 'completed')
    ORDER BY scheduled_start ASC
  `).all(userId) as Task[];

  for (const t of tasks) {
    const isCompleted = t.status === 'completed';
    const statusIcon = isCompleted ? '✅' : '📌';

    let blocks: {
      start: string;
      end: string;
      duration?: number;
      partIndex?: number;
      totalParts?: number;
      strategyLabel?: string;
    }[] = [];

    if (t.schedule_blocks) {
      try {
        blocks = typeof t.schedule_blocks === 'string' ? JSON.parse(t.schedule_blocks) : t.schedule_blocks;
      } catch {}
    }

    if (blocks.length === 0 && t.scheduled_start && t.scheduled_end) {
      blocks = [{ start: t.scheduled_start, end: t.scheduled_end }];
    }

    blocks.forEach((block, bIdx) => {
      const partSuffix = block.totalParts && block.totalParts > 1 ? ` (${block.partIndex || bIdx + 1}/${block.totalParts}节)` : '';
      const summary = `${statusIcon} ${t.title}${partSuffix}`;

      const descLines = [
        `【Clawbot × oxoxox 智能排程】`,
        `待办事项：${t.title}`,
        block.strategyLabel ? `排程策略：${block.strategyLabel}` : '',
        `任务状态：${isCompleted ? '已完成' : '待进行'}`,
        `预计耗时：${t.duration_minutes} 分钟`,
        `紧急程度：${t.urgency} / 5  ·  重要程度：${t.importance} / 5`,
        t.deadline ? `截止时间：${new Date(t.deadline).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}` : '',
        t.notes ? `备注：${t.notes}` : '',
      ].filter(Boolean);

      const event = cal.createEvent({
        id: `clawbot-task-${t.id}-${bIdx}@clawbot.local`,
        start: new Date(block.start),
        end: new Date(block.end),
        summary,
        description: descLines.join('\n'),
        status: isCompleted ? ICalEventStatus.CONFIRMED : ICalEventStatus.TENTATIVE,
      });

      // 5 minutes before alarm
      event.createAlarm({
        type: ICalAlarmType.display,
        trigger: 300,
        description: `【开始提醒】待办任务【${t.title}】即将开始！`,
      });
    });
  }

  return cal.toString();
}
