import { db } from '../config/database.js';
import { Task, UserSettings, WorkSlot } from '../models/types.js';

interface TimeInterval {
  start: Date;
  end: Date;
}

interface FreeSlot {
  start: Date;
  end: Date;
  durationMinutes: number;
}

export interface SchedulingResult {
  success: boolean;
  scheduled_start?: string; // ISO
  scheduled_end?: string;   // ISO
  message: string;
}

/**
 * Merge overlapping or contiguous time intervals
 */
function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (intervals.length <= 1) return intervals;
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: TimeInterval[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];

    if (curr.start.getTime() <= prev.end.getTime()) {
      if (curr.end.getTime() > prev.end.getTime()) {
        prev.end = curr.end;
      }
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

/**
 * Subtract busy intervals from a master permitted window
 */
function subtractIntervals(window: TimeInterval, busyIntervals: TimeInterval[]): FreeSlot[] {
  let freeIntervals: TimeInterval[] = [{ start: window.start, end: window.end }];

  for (const busy of busyIntervals) {
    const nextFree: TimeInterval[] = [];
    for (const free of freeIntervals) {
      // No overlap
      if (busy.end <= free.start || busy.start >= free.end) {
        nextFree.push(free);
        continue;
      }

      // Left piece
      if (busy.start > free.start) {
        nextFree.push({ start: free.start, end: busy.start });
      }

      // Right piece
      if (busy.end < free.end) {
        nextFree.push({ start: busy.end, end: free.end });
      }
    }
    freeIntervals = nextFree;
  }

  return freeIntervals
    .map(slot => ({
      start: slot.start,
      end: slot.end,
      durationMinutes: Math.floor((slot.end.getTime() - slot.start.getTime()) / (1000 * 60)),
    }))
    .filter(slot => slot.durationMinutes > 0);
}

/**
 * Generate all permitted working windows for a given date range based on user's work_slots config
 */
function generateWorkingWindows(
  startDate: Date,
  endDate: Date,
  workSlots: WorkSlot[]
): TimeInterval[] {
  const windows: TimeInterval[] = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  const finalDate = new Date(endDate);
  finalDate.setHours(23, 59, 59, 999);

  while (current <= finalDate) {
    const year = current.getFullYear();
    const month = current.getMonth();
    const day = current.getDate();

    for (const slot of workSlots) {
      const [startHour, startMin] = slot.start.split(':').map(Number);
      let [endHour, endMin] = slot.end.split(':').map(Number);

      const slotStart = new Date(year, month, day, startHour, startMin, 0, 0);
      let slotEnd: Date;

      if (endHour === 24) {
        slotEnd = new Date(year, month, day + 1, 0, 0, 0, 0);
      } else if (endHour < startHour) {
        // e.g. overnight slot 23:00 to 02:00
        slotEnd = new Date(year, month, day + 1, endHour, endMin, 0, 0);
      } else {
        slotEnd = new Date(year, month, day, endHour, endMin, 0, 0);
      }

      windows.push({ start: slotStart, end: slotEnd });
    }

    current.setDate(current.getDate() + 1);
  }

  return windows.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Smart Scheduling Algorithm using Time-Slot Optimization & Dynamic Scoring
 */
export function scheduleTask(
  userId: number,
  task: {
    id?: number;
    title: string;
    duration_minutes: number;
    urgency: number;
    importance: number;
    deadline?: string | null;
  }
): SchedulingResult {
  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings;
  let workSlots: WorkSlot[] = [
    { start: '09:00', end: '12:00' },
    { start: '13:00', end: '18:00' },
    { start: '19:00', end: '24:00' },
    { start: '00:00', end: '02:00' },
  ];

  if (settings && settings.work_slots) {
    try {
      workSlots = JSON.parse(settings.work_slots);
    } catch {
      // fallback
    }
  }

  const bufferMinutes = settings?.task_buffer_minutes ?? 10;
  const now = new Date();

  // Search horizon: from now until deadline or up to 7 days ahead
  let horizonEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (task.deadline) {
    const ddlDate = new Date(task.deadline);
    if (!isNaN(ddlDate.getTime()) && ddlDate > now) {
      horizonEnd = ddlDate;
    }
  }

  // 1. Fetch busy intervals: External Calendar Events
  const externalEvents = db.prepare(`
    SELECT start_time, end_time FROM external_events
    WHERE user_id = ? AND end_time > ? AND start_time < ?
  `).all(userId, now.toISOString(), horizonEnd.toISOString()) as { start_time: string; end_time: string }[];

  // 2. Fetch busy intervals: Existing scheduled tasks
  const scheduledTasks = db.prepare(`
    SELECT id, scheduled_start, scheduled_end FROM tasks
    WHERE user_id = ?
      AND status IN ('scheduled', 'in_progress')
      AND scheduled_end > ?
      AND scheduled_start < ?
      ${task.id ? `AND id != ${task.id}` : ''}
  `).all(userId, now.toISOString(), horizonEnd.toISOString()) as { id: number; scheduled_start: string; scheduled_end: string }[];

  const busyList: TimeInterval[] = [];

  for (const ext of externalEvents) {
    const bStart = new Date(new Date(ext.start_time).getTime() - bufferMinutes * 60 * 1000);
    const bEnd = new Date(new Date(ext.end_time).getTime() + bufferMinutes * 60 * 1000);
    busyList.push({ start: bStart, end: bEnd });
  }

  for (const t of scheduledTasks) {
    const bStart = new Date(new Date(t.scheduled_start).getTime() - bufferMinutes * 60 * 1000);
    const bEnd = new Date(new Date(t.scheduled_end).getTime() + bufferMinutes * 60 * 1000);
    busyList.push({ start: bStart, end: bEnd });
  }

  const mergedBusy = mergeIntervals(busyList);

  // 3. Generate permissible working windows
  const rawWindows = generateWorkingWindows(now, horizonEnd, workSlots);

  // Filter & clamp windows relative to now and deadline
  const clampedWindows: TimeInterval[] = [];
  for (const win of rawWindows) {
    const wStart = win.start < now ? now : win.start;
    const wEnd = task.deadline && win.end > new Date(task.deadline) ? new Date(task.deadline) : win.end;

    if (wStart < wEnd) {
      clampedWindows.push({ start: wStart, end: wEnd });
    }
  }

  // 4. Calculate available free slots
  const candidateSlots: FreeSlot[] = [];
  for (const win of clampedWindows) {
    const slots = subtractIntervals(win, mergedBusy);
    for (const slot of slots) {
      if (slot.durationMinutes >= task.duration_minutes) {
        candidateSlots.push(slot);
      }
    }
  }

  if (candidateSlots.length === 0) {
    return {
      success: false,
      message: `在截止时间（${task.deadline || '7天内'}）与工作时间范围内，未找到连续 ${task.duration_minutes} 分钟的空闲时间段。`,
    };
  }

  // 5. Dynamic Optimization / Scoring
  // Urgency (1-5): High urgency strongly penalizes scheduling far from now
  // Importance (1-5): High importance prefers daytime / high-focus blocks
  // Fragmentation: Prefer slots where leftover duration is either 0 or cleanly usable (> 30 mins)
  let bestSlot: FreeSlot = candidateSlots[0];
  let bestScore = -Infinity;

  for (const slot of candidateSlots) {
    const hoursFromNow = (slot.start.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Urgency penalty: higher urgency penalizes waiting hours much more severely
    const urgencyWeight = (task.urgency || 3) * 2.5;
    const delayPenalty = hoursFromNow * urgencyWeight;

    // Remaining slack penalty
    const leftover = slot.durationMinutes - task.duration_minutes;
    const fragmentPenalty = (leftover > 0 && leftover < 20) ? 15 : 0;

    // Time-of-day affinity (09:00 - 18:00 gets slight positive score for high importance)
    const startHour = slot.start.getHours();
    const primeHourBonus = (startHour >= 9 && startHour <= 17) ? (task.importance || 3) * 5 : 0;

    const totalScore = 1000 - delayPenalty - fragmentPenalty + primeHourBonus;

    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestSlot = slot;
    }
  }

  const finalStart = new Date(bestSlot.start);
  // Align to minute boundary (no seconds/millis)
  finalStart.setSeconds(0, 0);

  const finalEnd = new Date(finalStart.getTime() + task.duration_minutes * 60 * 1000);

  return {
    success: true,
    scheduled_start: finalStart.toISOString(),
    scheduled_end: finalEnd.toISOString(),
    message: '排程计算成功',
  };
}
