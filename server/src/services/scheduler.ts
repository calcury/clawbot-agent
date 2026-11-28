import {
  deadlineMs,
  recurringDebt,
  selectCalendarBlocksDetailed,
  type OptimizerRejectReason,
  type Window,
} from './calendarOptimizer.js';
import { db } from '../config/database.js';
import {
  Task,
  TaskInstance,
  ScheduleBlockRecord,
  UserSettings,
  WorkSlot,
} from '../models/types.js';
import {
  calculateQuadrant100,
  normalizeScoreTo100,
  calculateDynamicUrgency,
} from '../utils/priorityAlgorithm.js';
import {
  DEFAULT_TIMEZONE,
  addDaysToDateKey,
  getAccountLocalDateKey,
  parseAccountDateOrIso,
  resolveAccountTimezone,
  zonedWallClockToUtc,
} from '../utils/timezone.js';
import { getUserTimezone } from './accountService.js';
import { getExternalPolicyLookup, resolveExternalEventPolicy } from './externalEventPolicyService.js';
import { isDateMatchingRecurrence } from '../utils/recurrence.js';
import {
  cancelStalePastDailyInstances,
  ensureHorizonDailyInstancesForUser,
  ensureTaskInstance,
  ensureTodayDailyInstancesForUser,
  executeInstanceProgressCommand,
  getLatestPlanVersion,
  queueReplanRequest,
  syncLegacyTaskProjection,
} from './instanceService.js';
import {
  commitSchedulePlan,
  getCurrentCalendarGenerations,
  type ProposedInstancePlan,
} from './planCommitService.js';

export type EnergyZoneType = 'peak' | 'moderate' | 'low' | 'fragment';

export interface TimeSlot {
  start: Date;
  end: Date;
  durationMinutes: number;
  energyZone?: EnergyZoneType;
}

export interface ScheduledTaskBlock {
  id: string;
  taskId: number;
  title: string;
  start: Date;
  end: Date;
  durationMinutes: number;
  partIndex?: number;
  totalParts?: number;
  isSplit: boolean;
  quadrant: 'q1' | 'q2' | 'q3' | 'q4';
  importance: number;
  urgency: number;
  energyZone?: EnergyZoneType;
  strategyLabel?: string;
  breakAfterMinutes?: number;
}

export interface RestBlock {
  id: string;
  type: 'lunch' | 'dinner' | 'break';
  title: string;
  start: Date;
  end: Date;
  durationMinutes: number;
}

export interface WorkWindow {
  startHour: number;
  endHour: number;
}

export interface ScheduleOptions {
  targetDate: Date;
  now?: Date;
  timezone?: string;
  workStartHour?: number;
  workEndHour?: number;
  workWindows?: WorkWindow[];
  bufferMinutes?: number;
  taskRestMinutes?: number;
  maxContinuousMinutes?: number;
  maxDailyTaskMinutes?: number;
  exactDailyCapMinutes?: number;
  autoFilterQ4?: boolean;
  lunchStartHour?: number;
  lunchEndHour?: number;
  dinnerStartHour?: number;
  dinnerEndHour?: number;
  minChunkMinutes?: number;
  allowSplit?: boolean;
  allowFutureDailyInstances?: boolean;
  advanceDeadlineDays?: number;
  releaseTimeMs?: number;
  futureWindows?: Window[];
  allocationDebt?: Map<number, number>;
  collectWindows?: (windows: Window[]) => void;
}

export interface ScheduleProposal {
  proposalId?: string;
  type: 'deadline_risk' | 'priority_gain';
  conflictTask: {
    id: number;
    instanceId?: number;
    title: string;
    scheduled_start: string;
    scheduled_end: string;
    duration_minutes: number;
    session_plan?: string | null;
    urgency: number;
    importance: number;
    deadline?: string | null;
  };
  reasonText: string;
  newTaskSchedule: {
    start: string;
    end: string;
    blocks?: any[];
  };
  conflictTaskSchedule: {
    start: string;
    end: string;
    blocks?: any[];
  };
}

export interface SchedulingResult {
  success: boolean;
  scheduled_start?: string;
  scheduled_end?: string;
  schedule_blocks?: string;
  message: string;
  reasonCode?: string;
  proposal?: ScheduleProposal;
}

export const EFFECTIVE_DAILY_CAP_MINUTES = 360;

/**
 * 计算用户配置的“近期日程锁定范围”截止时刻：
 * - none: 不锁定
 * - hours: 从当前时刻往后滚动锁定 N 小时 (now + N*3600s)
 * - today: 锁定账户业务时区当天至 23:59:59.999
 * - this_week: 锁定账户业务时区本周（周一~周日）至周日 23:59:59.999
 */
export function computeScheduleLockUntil(
  settings?: Pick<UserSettings, 'schedule_lock_mode' | 'schedule_lock_hours'>,
  now: Date = new Date(),
  timezone?: string
): Date | null {
  const mode = settings?.schedule_lock_mode || 'none';
  if (mode === 'hours') {
    const hours = Math.max(0, Math.min(168, Math.round(Number(settings?.schedule_lock_hours || 0))));
    if (hours <= 0) return null;
    return new Date(now.getTime() + hours * 3600_000);
  }

  const tz = resolveAccountTimezone(timezone);
  const todayKey = getAccountLocalDateKey(now, tz);

  if (mode === 'today') {
    return zonedWallClockToUtc(todayKey, 23, 59, 59, 999, tz);
  }

  if (mode === 'this_week') {
    const [y, m, d] = todayKey.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay(); // 0=Sun..6=Sat
    const daysUntilSunday = dow === 0 ? 0 : 7 - dow;
    const sundayKey = addDaysToDateKey(todayKey, daysUntilSunday);
    return zonedWallClockToUtc(sundayKey, 23, 59, 59, 999, tz);
  }

  return null;
}

/**
 * 判断单个排程块是否处于锁定保护期内（仅锁定尚未结束的块；已过期未完成的块自动解除锁定）
 */
export function isScheduleBlockTimeLocked(
  blockStartIso: string,
  blockEndIso: string,
  lockUntil: Date | null,
  now: Date = new Date()
): boolean {
  if (!lockUntil) return false;
  const startMs = new Date(blockStartIso).getTime();
  const endMs = new Date(blockEndIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return startMs < lockUntil.getTime() && endMs > now.getTime();
}

/**
 * 格式化为本地 YYYY-MM-DD（支持指定账户时区）
 */
export function formatLocalDate(date: Date = new Date(), timezone?: string): string {
  if (timezone) {
    return getAccountLocalDateKey(date, timezone);
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 解析截止日期（纯日期 YYYY-MM-DD 按指定时区或本地当天 23:59:59 语义解析）
 */
export function parseDeadlineDate(rawDeadline?: string | null, timezone?: string): Date | null {
  if (!rawDeadline) return null;
  if (timezone) {
    return parseAccountDateOrIso(rawDeadline, timezone);
  }
  const trimmed = String(rawDeadline).trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeDeadlineIso(rawDeadline?: string | null, timezone?: string): string | null {
  const parsed = parseDeadlineDate(rawDeadline, timezone);
  return parsed ? parsed.toISOString() : null;
}

function buildDayTime(targetDate: Date, dayKey: string, hourDecimal: number, timezone?: string): Date {
  const wholeHours = Math.floor(hourDecimal);
  const mins = Math.round((hourDecimal - wholeHours) * 60);
  if (timezone) {
    if (wholeHours >= 24) {
      const nextDay = addDaysToDateKey(dayKey, 1);
      return zonedWallClockToUtc(nextDay, wholeHours - 24, mins, 0, 0, timezone);
    }
    return zonedWallClockToUtc(dayKey, wholeHours, mins, 0, 0, timezone);
  }
  const d = new Date(targetDate);
  d.setHours(wholeHours, mins, 0, 0);
  return d;
}

function getHourDecimalInTz(date: Date, timezone?: string): number {
  if (!timezone) {
    return date.getHours() + date.getMinutes() / 60;
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveAccountTimezone(timezone),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find(p => p.type === 'hour')?.value || '0');
  const m = Number(parts.find(p => p.type === 'minute')?.value || '0');
  return (h === 24 ? 0 : h) + m / 60;
}

function parseClockToHour(clock: string, isEndBoundary: boolean): number | null {
  const match = String(clock || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 24 || m < 0 || m >= 60) {
    return null;
  }
  if (h === 24 && m > 0) return null;
  if (isEndBoundary && h === 0 && m === 0) return 24;
  return h + m / 60;
}

/**
 * 解析用户配置的 work_slots 为当日不重叠的有序工作窗口
 */
export function parseWorkSlotWindows(settings?: UserSettings): {
  workStartHour: number;
  workEndHour: number;
  workWindows: WorkWindow[];
} {
  const fallback: WorkWindow[] = [{ startHour: 8, endHour: 22 }];
  if (!settings || settings.work_slots === undefined || settings.work_slots === null) {
    return { workStartHour: 8, workEndHour: 22, workWindows: fallback };
  }

  try {
    let parsedSlots: WorkSlot[] = [];
    if (Array.isArray(settings.work_slots)) {
      parsedSlots = settings.work_slots;
    } else if (typeof settings.work_slots === 'string') {
      const trimmed = settings.work_slots.trim();
      if (!trimmed) {
        return { workStartHour: 0, workEndHour: 0, workWindows: [] };
      }
      if (trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) parsedSlots = parsed;
      } else {
        const parts = trimmed.split(/[,，;\n\r]+/).map(p => p.trim()).filter(Boolean);
        for (const part of parts) {
          const match = part.match(/^(\d{1,2}:\d{2})\s*[-~至到]\s*(\d{1,2}:\d{2})$/);
          if (match) {
            parsedSlots.push({ start: match[1], end: match[2] });
          }
        }
      }
    }

    if (!Array.isArray(parsedSlots) || parsedSlots.length === 0) {
      return { workStartHour: 0, workEndHour: 0, workWindows: [] };
    }

    const raw: WorkWindow[] = [];
    for (const s of parsedSlots) {
      const startHour = parseClockToHour(s?.start, false);
      const endHour = parseClockToHour(s?.end, true);
      if (startHour === null || endHour === null) continue;

      if (endHour <= startHour) {
        if (startHour < 24) {
          raw.push({ startHour: Math.max(0, startHour), endHour: 24 });
        }
        if (endHour > 0 && endHour < 24) {
          raw.push({ startHour: 0, endHour: Math.min(24, endHour) });
        }
      } else {
        raw.push({
          startHour: Math.max(0, startHour),
          endHour: Math.min(24, endHour),
        });
      }
    }

    if (raw.length === 0) {
      return { workStartHour: 0, workEndHour: 0, workWindows: [] };
    }

    raw.sort((a, b) => a.startHour - b.startHour || a.endHour - b.endHour);
    const merged: WorkWindow[] = [];
    for (const w of raw) {
      const prev = merged[merged.length - 1];
      if (prev && w.startHour <= prev.endHour) {
        prev.endHour = Math.max(prev.endHour, w.endHour);
      } else {
        merged.push({ ...w });
      }
    }

    return {
      workStartHour: merged[0].startHour,
      workEndHour: merged[merged.length - 1].endHour,
      workWindows: merged,
    };
  } catch {
    return { workStartHour: 0, workEndHour: 0, workWindows: [] };
  }
}

export interface FixedCalendarBlock {
  id: string;
  title: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
}

/**
 * 读取有效的外部日历忙时事件（过滤旧代次、取消事件、透明空闲事件与用户本地忽略的实例 C01）
 */
export function getActiveExternalBusyEvents(
  userId: number,
  rangeStartIso: string,
  rangeEndIso: string
): FixedCalendarBlock[] {
  const rows = db.prepare(`
    SELECT ee.id, ee.uid, ee.subscription_id, ee.title, ee.start_time, ee.end_time, ee.is_all_day,
           ee.generation, ee.status, ee.transparency, ee.occurrence_start,
           ee.course_group_key, ee.course_group_label,
           cs.current_generation
    FROM external_events ee
    LEFT JOIN calendar_subscriptions cs ON cs.id = ee.subscription_id
    WHERE ee.user_id = ?
      AND ee.end_time >= ?
      AND ee.start_time <= ?
      AND COALESCE(ee.status, 'CONFIRMED') != 'CANCELLED'
      AND COALESCE(ee.transparency, 'OPAQUE') != 'TRANSPARENT'
      AND (ee.subscription_id IS NULL OR COALESCE(ee.generation, 0) = COALESCE(cs.current_generation, 0))
    ORDER BY ee.start_time ASC
  `).all(userId, rangeStartIso, rangeEndIso) as any[];

  const ignoredRows = db.prepare(`
    SELECT subscription_id, event_uid, occurrence_start
    FROM calendar_ignored_instances
    WHERE user_id = ?
  `).all(userId) as Array<{ subscription_id: number; event_uid: string; occurrence_start: string }>;

  const ignoredSet = new Set(
    ignoredRows.map(r => `${r.subscription_id}::${r.event_uid}::${r.occurrence_start}`)
  );

  const policyLookup = getExternalPolicyLookup(userId);

  const result: FixedCalendarBlock[] = [];
  for (const e of rows) {
    const occStart = e.occurrence_start || e.start_time;
    if (e.subscription_id && e.uid && ignoredSet.has(`${e.subscription_id}::${e.uid}::${occStart}`)) {
      continue;
    }
    const policy = resolveExternalEventPolicy(e, policyLookup);
    if (policy.allowScheduling) {
      continue;
    }
    const start = new Date(e.start_time);
    const end = new Date(e.end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;
    result.push({
      id: `ext-${e.id}`,
      title: e.title,
      start,
      end,
      isAllDay: Boolean(e.is_all_day),
    });
  }
  return result;
}

/**
 * 将已排程任务拆解为独立的 schedule_blocks 占用区间
 */
export function taskToBusyEvents(
  task: Pick<Task, 'id' | 'title' | 'scheduled_start' | 'scheduled_end' | 'schedule_blocks' | 'time_mode' | 'recurrence_rule' | 'is_fixed' | 'completed_dates'>,
  idPrefix: string = 'task',
  horizonBaseDate?: Date,
  horizonDays: number = 0,
  timezone?: string
): FixedCalendarBlock[] {
  const results: FixedCalendarBlock[] = [];

  let parsedBlocks: any[] = [];
  if (task.schedule_blocks) {
    try {
      const raw = typeof task.schedule_blocks === 'string'
        ? JSON.parse(task.schedule_blocks)
        : task.schedule_blocks;
      if (Array.isArray(raw)) {
        parsedBlocks = raw;
      }
    } catch {}
  }

  const baseIntervals: { start: Date; end: Date }[] = [];
  if (parsedBlocks.length > 0) {
    parsedBlocks.forEach((b) => {
      if (b?.completed === true || b?.status === 'completed' || b?.status === 'cancelled' || b?.status === 'superseded') return;
      const s = new Date(b?.start || b?.start_time);
      const e = new Date(b?.end || b?.end_time);
      if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && s < e) {
        baseIntervals.push({ start: s, end: e });
      }
    });
  } else if (task.scheduled_start && task.scheduled_end) {
    const s = new Date(task.scheduled_start);
    const e = new Date(task.scheduled_end);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && s < e) {
      baseIntervals.push({ start: s, end: e });
    }
  }

  baseIntervals.forEach((iv, idx) => {
    results.push({
      id: `${idPrefix}-${task.id}-${idx}`,
      title: `[已排] ${task.title}`,
      start: iv.start,
      end: iv.end,
      isAllDay: false,
    });
  });

  if (
    task.time_mode === 'daily_fixed' &&
    task.is_fixed === 1 &&
    horizonBaseDate &&
    horizonDays > 1 &&
    baseIntervals.length > 0
  ) {
    const existingDayKeys = new Set(baseIntervals.map(iv => formatLocalDate(iv.start, timezone)));
    let completedDates: string[] = [];
    if (task.completed_dates) {
      try {
        const parsed = typeof task.completed_dates === 'string'
          ? JSON.parse(task.completed_dates)
          : task.completed_dates;
        if (Array.isArray(parsed)) completedDates = parsed;
      } catch {}
    }

    const baseKey = formatLocalDate(horizonBaseDate, timezone);
    for (let dayOffset = 1; dayOffset < horizonDays; dayOffset++) {
      let dayKey: string;
      let targetDay: Date;
      if (timezone) {
        dayKey = addDaysToDateKey(baseKey, dayOffset);
        targetDay = zonedWallClockToUtc(dayKey, 0, 0, 0, 0, timezone);
      } else {
        targetDay = new Date(horizonBaseDate);
        targetDay.setDate(targetDay.getDate() + dayOffset);
        dayKey = formatLocalDate(targetDay);
      }
      if (existingDayKeys.has(dayKey) || completedDates.includes(dayKey)) continue;
      if (!isDateMatchingRecurrence(timezone ? dayKey : targetDay, task.recurrence_rule)) continue;

      baseIntervals.forEach((iv, idx) => {
        const durationMs = iv.end.getTime() - iv.start.getTime();
        let projStart: Date;
        if (timezone) {
          const hm = getHourDecimalInTz(iv.start, timezone);
          const h = Math.floor(hm);
          const m = Math.round((hm - h) * 60);
          projStart = zonedWallClockToUtc(dayKey, h, m, 0, 0, timezone);
        } else {
          projStart = new Date(targetDay);
          projStart.setHours(iv.start.getHours(), iv.start.getMinutes(), iv.start.getSeconds(), 0);
        }
        const projEnd = new Date(projStart.getTime() + durationMs);
        results.push({
          id: `${idPrefix}-${task.id}-d${dayOffset}-${idx}`,
          title: `[固定每日] ${task.title}`,
          start: projStart,
          end: projEnd,
          isAllDay: false,
        });
      });
    }
  }

  return results;
}

/**
 * 将长耗时任务按最长专注时长均衡切分任务
 */
export function splitIntoFocusSessions(
  totalMinutes: number,
  maxSessionMinutes: number = 90,
  _minTailMinutes: number = 20
): number[] {
  if (totalMinutes <= 0 || maxSessionMinutes <= 0) return [];
  const count = Math.ceil(totalMinutes / maxSessionMinutes);
  if (count === 1) return [totalMinutes];
  const base = Math.floor(totalMinutes / count / 5) * 5;
  const sessions = Array<number>(count).fill(base);
  let remainder = totalMinutes - base * count;
  for (let i = 0; remainder > 0; i = (i + 1) % count) {
    const increment = Math.min(5, remainder, maxSessionMinutes - sessions[i]);
    sessions[i] += increment;
    remainder -= increment;
  }
  return sessions;
}

export function classifySlotEnergy(start: Date, durationMinutes: number, timezone?: string): EnergyZoneType {
  if (durationMinutes < 45) {
    return 'fragment';
  }
  const startHour = getHourDecimalInTz(start, timezone);
  if (startHour >= 12.8 && startHour < 14.4) {
    return 'low';
  }
  if ((startHour >= 7.5 && startHour < 12.0) || (startHour >= 14.4 && startHour < 18.0)) {
    return 'peak';
  }
  return 'moderate';
}

export function getStrategyLabel(zone: EnergyZoneType, quadrant: string, isSessionSplit: boolean): string {
  if (quadrant === 'q3') {
    if (zone === 'fragment') return '碎片时间高效填补';
    if (zone === 'low') return '午后轻量缓冲排程';
    return '浅层事务集中处理';
  }
  if (zone === 'peak') {
    return isSessionSplit ? '黄金时段·番茄节律切分' : '黄金深度专注段';
  }
  if (zone === 'moderate') {
    return isSessionSplit ? '晚间沉浸·节律切分' : '晚间完整推进段';
  }
  if (zone === 'low') {
    return '午后过渡推进段';
  }
  return '紧凑间隙利用';
}

export function calculateQuadrant(
  importance: number,
  urgency: number,
  scoreScale?: number | null
): 'q1' | 'q2' | 'q3' | 'q4' {
  const imp = normalizeScoreTo100(importance, scoreScale);
  const urg = normalizeScoreTo100(urgency, scoreScale);
  return calculateQuadrant100(imp, urg);
}

/**
 * 计算今日剩余工作窗口内的已占用分钟数（基于真实外部日历与独占 schedule_blocks，排除并行轨）
 */
export function computeTodayBusyMinutes(
  userId: number,
  currentTime: Date = new Date(),
  excludeTaskId?: number
): number {
  const tz = getUserTimezone(userId);
  const todayKey = getAccountLocalDateKey(currentTime, tz);
  const dayEnd = zonedWallClockToUtc(todayKey, 22, 0, 0, 0, tz);
  if (dayEnd.getTime() <= currentTime.getTime()) return 0;

  const startIso = currentTime.toISOString();
  const endIso = dayEnd.toISOString();

  const extEvents = getActiveExternalBusyEvents(userId, startIso, endIso).filter(e => !e.isAllDay);
  const intervals: { start: number; end: number }[] = [];

  for (const ev of extEvents) {
    intervals.push({
      start: Math.max(currentTime.getTime(), ev.start.getTime()),
      end: Math.min(dayEnd.getTime(), ev.end.getTime()),
    });
  }

  // Prefer v2 schedule_blocks joined with task_instances when available, else fallback to tasks
  const activeBlocks = db.prepare(`
    SELECT sb.start_time, sb.end_time, sb.task_id, sb.is_concurrent
    FROM schedule_blocks sb
    JOIN task_instances ti ON ti.id = sb.instance_id
    WHERE sb.user_id = ?
      AND sb.status IN ('planned', 'in_progress')
      AND ti.status IN ('pending', 'in_progress')
      AND sb.is_concurrent = 0
      AND sb.end_time > ?
      AND sb.start_time < ?
  `).all(userId, startIso, endIso) as Array<{ start_time: string; end_time: string; task_id: number }>;

  if (activeBlocks.length > 0) {
    for (const b of activeBlocks) {
      if (excludeTaskId !== undefined && b.task_id === excludeTaskId) continue;
      const sMs = Math.max(currentTime.getTime(), new Date(b.start_time).getTime());
      const eMs = Math.min(dayEnd.getTime(), new Date(b.end_time).getTime());
      if (eMs > sMs) intervals.push({ start: sMs, end: eMs });
    }
  } else {
    const scheduledTasks = db.prepare(`
      SELECT id, title, scheduled_start, scheduled_end, schedule_blocks, time_mode, recurrence_rule, is_fixed, is_concurrent, completed_dates
      FROM tasks
      WHERE user_id = ? AND status IN ('scheduled', 'in_progress')
        AND scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL
        AND scheduled_end > ? AND scheduled_start < ?
    `).all(userId, startIso, endIso) as Task[];

    for (const t of scheduledTasks) {
      if (excludeTaskId !== undefined && t.id === excludeTaskId) continue;
      if (t.is_concurrent === 1) continue;
      if (t.time_mode === 'daily_fixed' && t.completed_dates) {
        try {
          const doneDates = JSON.parse(t.completed_dates);
          if (Array.isArray(doneDates) && doneDates.includes(todayKey)) continue;
        } catch {}
      }
      const busyBlocks = taskToBusyEvents(t, 'busy', undefined, 0, tz);
      for (const block of busyBlocks) {
        const sMs = Math.max(currentTime.getTime(), block.start.getTime());
        const eMs = Math.min(dayEnd.getTime(), block.end.getTime());
        if (eMs > sMs) intervals.push({ start: sMs, end: eMs });
      }
    }
  }

  intervals.sort((a, b) => a.start - b.start);
  let busyMs = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const iv of intervals) {
    if (iv.end <= iv.start) continue;
    if (curStart === -1) {
      curStart = iv.start;
      curEnd = iv.end;
    } else if (iv.start <= curEnd) {
      curEnd = Math.max(curEnd, iv.end);
    } else {
      busyMs += curEnd - curStart;
      curStart = iv.start;
      curEnd = iv.end;
    }
  }
  if (curStart !== -1) busyMs += curEnd - curStart;
  return Math.round(busyMs / 60000);
}

export function getSpecificExecutionDateKey(
  task: { time_mode?: string | null; deadline?: string | null },
  timezone?: string
): string | null {
  if (task.time_mode !== 'specific_date' || !task.deadline) return null;
  const raw = String(task.deadline).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = parseDeadlineDate(raw, timezone);
  if (parsed && Number.isFinite(parsed.getTime())) {
    return timezone ? getAccountLocalDateKey(parsed, timezone) : formatLocalDate(parsed);
  }
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function computeTaskPriorityScore(task: {
  importance: number;
  urgency: number;
  score_scale?: number | null;
  time_mode?: string | null;
  deadline?: string | null;
}, targetDate: Date, timezone?: string): number {
  const imp = normalizeScoreTo100(task.importance, task.score_scale);
  const urg = normalizeScoreTo100(task.urgency, task.score_scale);
  const quad = calculateQuadrant100(imp, urg);

  let baseScore = imp * 1.6 + urg * 1.2;

  if (quad === 'q1') baseScore += 150;
  else if (quad === 'q2') baseScore += 80;
  else if (quad === 'q3') baseScore += 20;

  if (task.time_mode === 'daily_fixed') {
    baseScore += 60;
  } else if (task.time_mode === 'specific_date') {
    baseScore += 70;
  }

  const due = parseDeadlineDate(task.deadline, timezone);
  if (due) {
    const diffDays = (due.getTime() - targetDate.getTime()) / (1000 * 3600 * 24);
    if (diffDays <= 1) {
      baseScore += 120;
    } else if (diffDays <= 3) {
      baseScore += 60;
    } else if (diffDays <= 7) {
      baseScore += 20;
    }
  }

  return baseScore;
}

function rejectReasonMessage(
  code: OptimizerRejectReason | 'q4_filtered' | 'deferred_busy_soon' | 'deferred_later_backlog',
  isHard: boolean
): string {
  switch (code) {
    case 'q4_filtered':
      return '象限 IV：默认不自动排程';
    case 'deferred_busy_soon':
      return '近期日程较满，近日规划已顺延待排';
    case 'deferred_later_backlog':
      return '近期较忙或处于冷却期，暂留「远期备忘」待办池';
    case 'hard_deadline_violation':
      return '不可逾期：截止前尚有未分配工作量';
    case 'outside_work_window':
      return '当前无可用工作时段窗口';
    case 'search_budget_exhausted':
      return '搜索空间超出单轮上限，暂未找到可行安排';
    case 'insufficient_capacity':
    default:
      return isHard ? '不可逾期：截止前尚有未分配工作量' : '当天没有更多合适的空闲时段';
  }
}

/**
 * 单日排程核心算法（支持账户时区和细粒度未排原因诊断）
 */
export function runSingleDaySchedule(
  tasks: Task[],
  fixedEvents: { id: string; title: string; start: Date; end: Date; isAllDay: boolean }[],
  options: ScheduleOptions
): {
  scheduledBlocks: ScheduledTaskBlock[];
  scheduledTaskIds: Set<number>;
  unscheduledTaskIds: { taskId: number; remainingMinutes: number; reason: string; reasonCode: string }[];
} {
  const {
    targetDate,
    timezone,
    workStartHour = 8.0,
    workEndHour = 22.0,
    workWindows,
    bufferMinutes = 10,
    taskRestMinutes = 10,
    maxContinuousMinutes = 90,
    maxDailyTaskMinutes = 330,
    exactDailyCapMinutes,
    autoFilterQ4 = true,
    lunchStartHour = 12.0,
    lunchEndHour = 13.0,
    dinnerStartHour = 18.0,
    dinnerEndHour = 19.0,
    minChunkMinutes = 30,
    allowSplit = true,
    advanceDeadlineDays = 0,
    releaseTimeMs,
  } = options;

  const targetDateStr = formatLocalDate(targetDate, timezone);
  const todayStr = formatLocalDate(options.now || new Date(), timezone);

  const dayStart = buildDayTime(targetDate, targetDateStr, workStartHour, timezone);
  const dayEnd = buildDayTime(targetDate, targetDateStr, workEndHour, timezone);

  const dayFixedEvents = fixedEvents
    .map(e => {
      const clippedStart = new Date(Math.max(e.start.getTime(), dayStart.getTime()));
      const clippedEnd = new Date(Math.min(e.end.getTime(), dayEnd.getTime()));
      return { ...e, start: clippedStart, end: clippedEnd };
    })
    .filter(e => e.start < e.end)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const internalBufferIntervals: { start: Date; end: Date; durationMinutes: number }[] = [];
  for (const ev of dayFixedEvents) {
    if (bufferMinutes > 0 && ev.end.getTime() < dayEnd.getTime()) {
      const bufEnd = new Date(Math.min(dayEnd.getTime(), ev.end.getTime() + bufferMinutes * 60 * 1000));
      const overlapsNext = dayFixedEvents.some(
        other => other.id !== ev.id && other.start.getTime() < bufEnd.getTime() && other.end.getTime() > ev.end.getTime()
      );
      if (!overlapsNext && bufEnd.getTime() > ev.end.getTime()) {
        internalBufferIntervals.push({
          start: new Date(ev.end),
          end: bufEnd,
          durationMinutes: Math.round((bufEnd.getTime() - ev.end.getTime()) / 60000),
        });
      }
    }
  }

  const baseLunchStart = buildDayTime(targetDate, targetDateStr, lunchStartHour, timezone);
  const baseLunchEnd = buildDayTime(targetDate, targetDateStr, lunchEndHour, timezone);
  const maxLunchEnd = buildDayTime(targetDate, targetDateStr, 13.5, timezone);

  let actualLunchStart = new Date(baseLunchStart);
  for (const ev of dayFixedEvents) {
    if (ev.start < baseLunchEnd && ev.end > actualLunchStart && ev.end.getTime() > actualLunchStart.getTime()) {
      actualLunchStart = new Date(ev.end.getTime());
    }
  }
  const actualLunchEnd = new Date(
    Math.min(dayEnd.getTime(), maxLunchEnd.getTime(), actualLunchStart.getTime() + (lunchEndHour - lunchStartHour) * 3600 * 1000)
  );

  const baseDinnerStart = buildDayTime(targetDate, targetDateStr, dinnerStartHour, timezone);
  const baseDinnerEnd = buildDayTime(targetDate, targetDateStr, dinnerEndHour, timezone);
  const maxDinnerEnd = buildDayTime(targetDate, targetDateStr, 19.5, timezone);

  let actualDinnerStart = new Date(baseDinnerStart);
  for (const ev of dayFixedEvents) {
    if (ev.start < baseDinnerEnd && ev.end > actualDinnerStart && ev.end.getTime() > actualDinnerStart.getTime()) {
      actualDinnerStart = new Date(ev.end.getTime());
    }
  }
  const actualDinnerEnd = new Date(
    Math.min(dayEnd.getTime(), maxDinnerEnd.getTime(), actualDinnerStart.getTime() + (dinnerEndHour - dinnerStartHour) * 3600 * 1000)
  );

  const visualRestBlocks: RestBlock[] = [];
  if (actualLunchEnd > actualLunchStart) {
    visualRestBlocks.push({
      id: `rest-lunch-${targetDate.getTime()}`,
      type: 'lunch',
      title: '午间休息',
      start: actualLunchStart,
      end: actualLunchEnd,
      durationMinutes: Math.round((actualLunchEnd.getTime() - actualLunchStart.getTime()) / 60000),
    });
  }
  if (actualDinnerEnd > actualDinnerStart) {
    visualRestBlocks.push({
      id: `rest-dinner-${targetDate.getTime()}`,
      type: 'dinner',
      title: '晚间休息',
      start: actualDinnerStart,
      end: actualDinnerEnd,
      durationMinutes: Math.round((actualDinnerEnd.getTime() - actualDinnerStart.getTime()) / 60000),
    });
  }

  const allBusyEntities: { start: Date; end: Date }[] = [
    ...dayFixedEvents.map(e => ({ start: e.start, end: e.end })),
    ...visualRestBlocks.map(r => ({ start: r.start, end: r.end })),
    ...internalBufferIntervals.map(b => ({ start: b.start, end: b.end })),
  ].sort((a, b) => a.start.getTime() - b.start.getTime());

  const mergedBusy: { start: Date; end: Date }[] = [];
  for (const entity of allBusyEntities) {
    if (mergedBusy.length === 0) {
      mergedBusy.push({ start: new Date(entity.start), end: new Date(entity.end) });
    } else {
      const last = mergedBusy[mergedBusy.length - 1];
      if (entity.start.getTime() <= last.end.getTime()) {
        if (entity.end.getTime() > last.end.getTime()) {
          last.end = new Date(entity.end);
        }
      } else {
        mergedBusy.push({ start: new Date(entity.start), end: new Date(entity.end) });
      }
    }
  }

  const rawFreeSlots: TimeSlot[] = [];
  let currentCursor = new Date(dayStart);

  for (const busy of mergedBusy) {
    if (busy.start.getTime() > currentCursor.getTime()) {
      const durationMin = Math.floor((busy.start.getTime() - currentCursor.getTime()) / 60000);
      if (durationMin >= 15) {
        rawFreeSlots.push({
          start: new Date(currentCursor),
          end: new Date(busy.start),
          durationMinutes: durationMin,
        });
      }
    }
    if (busy.end.getTime() > currentCursor.getTime()) {
      currentCursor = new Date(busy.end);
    }
  }

  if (currentCursor.getTime() < dayEnd.getTime()) {
    const durationMin = Math.floor((dayEnd.getTime() - currentCursor.getTime()) / 60000);
    if (durationMin >= 15) {
      rawFreeSlots.push({
        start: new Date(currentCursor),
        end: new Date(dayEnd),
        durationMinutes: durationMin,
      });
    }
  }

  let constrainedFreeSlots: TimeSlot[] = rawFreeSlots;
  if (Array.isArray(workWindows) && workWindows.length > 0) {
    const allowedIntervals = workWindows
      .map(w => {
        const ws = buildDayTime(targetDate, targetDateStr, w.startHour, timezone);
        const we = buildDayTime(targetDate, targetDateStr, w.endHour, timezone);
        return { startMs: ws.getTime(), endMs: we.getTime() };
      })
      .filter(iv => iv.endMs > iv.startMs);

    const intersected: TimeSlot[] = [];
    for (const slot of rawFreeSlots) {
      for (const win of allowedIntervals) {
        const sMs = Math.max(slot.start.getTime(), win.startMs);
        const eMs = Math.min(slot.end.getTime(), win.endMs);
        const durMin = Math.floor((eMs - sMs) / 60000);
        if (durMin >= 15) {
          intersected.push({
            start: new Date(sMs),
            end: new Date(eMs),
            durationMinutes: durMin,
          });
        }
      }
    }
    constrainedFreeSlots = intersected.sort((a, b) => a.start.getTime() - b.start.getTime());
  } else if (Array.isArray(workWindows) && workWindows.length === 0) {
    constrainedFreeSlots = [];
  }

  const workingFreeSlots: TimeSlot[] = constrainedFreeSlots.map(slot => ({
    start: new Date(slot.start),
    end: new Date(slot.end),
    durationMinutes: slot.durationMinutes,
    energyZone: classifySlotEnergy(slot.start, slot.durationMinutes, timezone),
  }));

  const refreshSlots = () => {
    for (const s of workingFreeSlots) {
      s.durationMinutes = Math.max(0, Math.floor((s.end.getTime() - s.start.getTime()) / 60000));
      if (s.durationMinutes > 0) {
        s.energyZone = classifySlotEnergy(s.start, s.durationMinutes, timezone);
      }
    }
  };

  if (releaseTimeMs !== undefined) {
    for (const s of workingFreeSlots) {
      if (s.end.getTime() <= releaseTimeMs) {
        s.start = new Date(s.end);
      } else if (s.start.getTime() < releaseTimeMs) {
        s.start = new Date(releaseTimeMs);
      }
    }
    refreshSlots();
  }

  const dayAnchor = buildDayTime(targetDate, targetDateStr, 0, timezone);
  const windows = workingFreeSlots
    .filter(s => s.durationMinutes > 0)
    .map(s => ({ start: s.start.getTime(), end: s.end.getTime(), day: dayAnchor.getTime() }));
  options.collectWindows?.(windows);

  const scheduledBlocks: ScheduledTaskBlock[] = [];
  const scheduledTaskIds = new Set<number>();
  const unscheduledTaskIds: { taskId: number; remainingMinutes: number; reason: string; reasonCode: string }[] = [];

  const active = tasks.filter(task => {
    if (task.status === 'completed' || task.status === 'cancelled' || targetDateStr < todayStr) return false;
    if (task.time_mode === 'specific_date') {
      const specKey = getSpecificExecutionDateKey(task, timezone);
      if (specKey && targetDateStr < specKey) return false;
      if (specKey && task.deadline_kind === 'hard' && targetDateStr > specKey) return false;
    }
    if (task.time_mode === 'daily_fixed') {
      if (!options.allowFutureDailyInstances && targetDateStr !== todayStr) return false;
      if (!isDateMatchingRecurrence(targetDateStr, task.recurrence_rule)) return false;
      try {
        if (JSON.parse(task.completed_dates || '[]').includes(targetDateStr)) return false;
      } catch {}
    }
    const quadrant = calculateQuadrant(task.importance, task.urgency, task.score_scale);
    if (autoFilterQ4 && quadrant === 'q4' && task.deadline_kind !== 'hard' && task.time_mode !== 'specific_date') {
      unscheduledTaskIds.push({
        taskId: task.id,
        remainingMinutes: task.duration_minutes || 45,
        reason: rejectReasonMessage('q4_filtered', false),
        reasonCode: 'q4_filtered',
      });
      return false;
    }
    return true;
  });

  const cap = exactDailyCapMinutes !== undefined ? exactDailyCapMinutes : maxDailyTaskMinutes + 30;
  const { placements, rejectedReasons } = selectCalendarBlocksDetailed(
    active,
    windows,
    options.futureWindows || [],
    {
      cap,
      rest: taskRestMinutes,
      maxChunk: maxContinuousMinutes,
      minChunk: minChunkMinutes,
      allowSplit,
      advanceDeadlineDays,
      debt: options.allocationDebt,
      timezone,
    }
  );

  for (const [index, task] of active.entries()) {
    const parts = placements.filter(p => p.index === index);
    const quadrant = calculateQuadrant(task.importance, task.urgency, task.score_scale);
    const isSplit = parts.length > 1;
    for (const [part, p] of parts.entries()) {
      const start = new Date(p.start);
      const energyZone = classifySlotEnergy(start, p.minutes, timezone);
      scheduledBlocks.push({
        id: `sched-${task.id}-p${part + 1}-${p.start}`,
        taskId: task.id,
        title: task.title,
        start,
        end: new Date(p.start + p.minutes * 60_000),
        durationMinutes: p.minutes,
        partIndex: part + 1,
        totalParts: parts.length,
        isSplit,
        quadrant,
        importance: task.importance,
        urgency: task.urgency,
        energyZone,
        strategyLabel: getStrategyLabel(energyZone, quadrant, isSplit),
        breakAfterMinutes: p.rest || undefined,
      });
    }
    const remainingMinutes = Math.max(
      0,
      Math.ceil(task.duration_minutes || 45) - parts.reduce((sum, p) => sum + p.minutes, 0)
    );
    if (!remainingMinutes) {
      scheduledTaskIds.add(task.id);
    } else {
      const rCode = rejectedReasons.get(task.id) || (windows.length === 0 ? 'outside_work_window' : 'insufficient_capacity');
      unscheduledTaskIds.push({
        taskId: task.id,
        remainingMinutes,
        reason: rejectReasonMessage(rCode, task.deadline_kind === 'hard'),
        reasonCode: rCode,
      });
    }
  }

  scheduledBlocks.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { scheduledBlocks, scheduledTaskIds, unscheduledTaskIds };
}

function getHorizonWindows(
  now: Date,
  days: number,
  events: FixedCalendarBlock[],
  options: Omit<ScheduleOptions, 'targetDate'>
): Window[][] {
  const baseKey = options.timezone ? getAccountLocalDateKey(now, options.timezone) : null;
  return Array.from({ length: days }, (_, offset) => {
    let targetDate: Date;
    if (options.timezone && baseKey) {
      const dk = addDaysToDateKey(baseKey, offset);
      targetDate = zonedWallClockToUtc(dk, 0, 0, 0, 0, options.timezone);
    } else {
      targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + offset);
    }
    let result: Window[] = [];
    runSingleDaySchedule([], events, {
      ...options,
      targetDate,
      releaseTimeMs: offset === 0 ? options.releaseTimeMs : undefined,
      collectWindows: windows => { result = windows; },
    });
    return result;
  });
}

function sumWindowMinutes(windows: Window[]): number {
  return windows.reduce((sum, w) => sum + Math.max(0, Math.floor((w.end - w.start) / 60_000)), 0);
}

function getTaskAgeDays(createdAt: string | null | undefined, now: Date): number {
  if (!createdAt) return 0;
  const ms = new Date(createdAt).getTime();
  if (!Number.isFinite(ms) || ms >= now.getTime()) return 0;
  return (now.getTime() - ms) / 86_400_000;
}

interface HorizonDayStats {
  unblockedWorkMins: number[];
  fixedInWorkMins: number[];
  dayMovableUsed: number[];
  baseCap: number;
}

function computeHorizonDayStats(
  horizonWindows: Window[][],
  unblockedHorizonWindows: Window[][],
  dayKeys: string[],
  baseCap: number,
  occupiedDailyMinutes?: Map<string, number>
): HorizonDayStats {
  const unblockedWorkMins = unblockedHorizonWindows.map(sumWindowMinutes);
  const freeAfterFixedMins = horizonWindows.map(sumWindowMinutes);
  const fixedInWorkMins = unblockedWorkMins.map((u, idx) => Math.max(0, u - (freeAfterFixedMins[idx] || 0)));
  const dayMovableUsed = dayKeys.map(dk => occupiedDailyMinutes?.get(dk) || 0);
  return { unblockedWorkMins, fixedInWorkMins, dayMovableUsed, baseCap };
}

function getDayDenomMinutes(stats: HorizonDayStats, dOffset: number): number {
  const unblocked = stats.unblockedWorkMins[dOffset] || 0;
  if (unblocked <= 0) return 0;
  const fixed = stats.fixedInWorkMins[dOffset] || 0;
  return Math.max(30, Math.min(unblocked, stats.baseCap + fixed));
}

function getDayOccupancyRatio(stats: HorizonDayStats, dOffset: number): number {
  const denom = getDayDenomMinutes(stats, dOffset);
  if (denom <= 0) return 1;
  const busy = (stats.fixedInWorkMins[dOffset] || 0) + (stats.dayMovableUsed[dOffset] || 0);
  return Math.min(1, Math.max(0, busy / denom));
}

function getRangeOccupancyRatio(stats: HorizonDayStats, startOffset: number, count: number): number {
  const end = Math.min(stats.unblockedWorkMins.length, startOffset + count);
  let busySum = 0;
  let denomSum = 0;
  for (let d = startOffset; d < end; d++) {
    const denom = getDayDenomMinutes(stats, d);
    if (denom <= 0) continue;
    denomSum += denom;
    busySum += Math.min(denom, (stats.fixedInWorkMins[d] || 0) + (stats.dayMovableUsed[d] || 0));
  }
  return denomSum > 0 ? Math.min(1, busySum / denomSum) : 0;
}

/**
 * 在多日规划窗口内为同轨待办执行分阶段负荷感知滚动排程：
 * Tier 1: 有截止日 / 指定执行日 / 周期任务 / 尽快推进(urgent) 弹性任务
 * Tier 2A: 近日规划(soon) — 依据近3日忙碌度自适应顺延并保留约 25% 喘息余量
 * Tier 2B: 远期备忘(later, 方案A) — 冷却期后仅在近期宽松日低密度顺手排入，忙时留存待办池
 */
export function scheduleTaskGroupInHorizon(
  groupTasks: Task[],
  fixedEvents: FixedCalendarBlock[],
  now: Date,
  horizonDays: number,
  config: {
    timezone?: string;
    workStartHour: number;
    workEndHour: number;
    workWindows: WorkWindow[];
    bufferMinutes: number;
    advanceDeadlineDays: number;
    releaseTimeMsToday: number;
    exactDailyCapMinutes?: number;
  },
  taskAllocations: Map<number, ScheduledTaskBlock[]>,
  remainingTaskIds: Set<number>,
  rejectReasonByTaskId?: Map<number, { code: string; text: string }>,
  occupiedDailyMinutes?: Map<string, number>,
  recurringByDate?: Map<string, Array<{ instanceId: number; task: Task }>>,
  recurringAllocations?: Map<number, ScheduledTaskBlock[]>,
  recurringRejectByInstance?: Map<number, { code: string; text: string }>
): void {
  const hasRecurring = Boolean(recurringByDate && recurringByDate.size > 0);
  if (groupTasks.length === 0 && !hasRecurring) return;

  const taskMap = new Map<number, Task>(groupTasks.map(t => [t.id, { ...t }]));
  const progress = groupTasks.map(task => Math.max(0, (task.original_duration_minutes || 0) - task.duration_minutes));
  const totalProgress = progress.reduce((sum, minutes) => sum + minutes, 0);
  const weights = groupTasks.map(task => 0.2 + (normalizeScoreTo100(task.importance, task.score_scale) / 100) ** 2);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const balances = weights.map((weight, index) => (totalWeight > 0 ? totalProgress * weight / totalWeight : 0) - progress[index]);
  const scale = Math.max(1, ...balances.map(balance => Math.abs(balance) / 120));
  const allocationDebt = new Map(groupTasks.map((task, index) => [task.id, balances[index] / scale]));

  const windowOpts = {
    timezone: config.timezone,
    workStartHour: config.workStartHour,
    workEndHour: config.workEndHour,
    workWindows: config.workWindows,
    bufferMinutes: config.bufferMinutes,
    releaseTimeMs: config.releaseTimeMsToday,
  };
  const horizonWindows = getHorizonWindows(now, horizonDays, fixedEvents, windowOpts);
  const unblockedHorizonWindows = getHorizonWindows(now, horizonDays, [], windowOpts);

  const baseKey = config.timezone ? getAccountLocalDateKey(now, config.timezone) : null;
  const dayDates: Date[] = [];
  const dayKeys: string[] = [];
  for (let dayOffset = 0; dayOffset < horizonDays; dayOffset++) {
    const dk = config.timezone && baseKey ? addDaysToDateKey(baseKey, dayOffset) : (() => {
      const d = new Date(now);
      d.setDate(d.getDate() + dayOffset);
      return formatLocalDate(d);
    })();
    dayKeys.push(dk);
    dayDates.push(
      config.timezone && baseKey
        ? zonedWallClockToUtc(dk, 0, 0, 0, 0, config.timezone)
        : (() => {
            const d = new Date(now);
            d.setDate(d.getDate() + dayOffset);
            return d;
          })()
    );
  }

  const baseCap = config.exactDailyCapMinutes ?? EFFECTIVE_DAILY_CAP_MINUTES;
  const stats = computeHorizonDayStats(
    horizonWindows,
    unblockedHorizonWindows,
    dayKeys,
    baseCap,
    occupiedDailyMinutes
  );

  // Track placed blocks as busy events for subsequent passes so Tier 2 never overlaps Tier 1 / 2A blocks
  const dynamicBusyEvents: FixedCalendarBlock[] = [...fixedEvents];

  const coreIds = new Set<number>();
  const soonIds = new Set<number>();
  const laterIds = new Set<number>();
  for (const t of groupTasks) {
    if (t.time_mode === 'flexible' && t.urgency_pace === 'later') {
      laterIds.add(t.id);
    } else if (t.time_mode === 'flexible' && t.urgency_pace !== 'urgent') {
      soonIds.add(t.id);
    } else {
      coreIds.add(t.id);
    }
  }

  const runTierPass = (params: {
    tierTaskIds: Set<number>;
    includeRecurring: boolean;
    minDayOffset?: number;
    prepareDay?: (dayOffset: number, candidateTasks: Task[], dayCapRemaining: number) => {
      admittedTasks: Task[];
      capOverride: number;
    };
  }) => {
    const startDay = params.minDayOffset ?? 0;
    for (let dayOffset = startDay; dayOffset < horizonDays; dayOffset++) {
      const targetDate = dayDates[dayOffset];
      const dkForCap = dayKeys[dayOffset];
      const onceCandidates = Array.from(params.tierTaskIds)
        .filter(id => remainingTaskIds.has(id))
        .map(id => taskMap.get(id)!)
        .filter(Boolean);
      const dayRecurringEntries = params.includeRecurring ? (recurringByDate?.get(dkForCap) || []) : [];
      const dayRecurringTaskIdToInstanceId = new Map<number, number>(
        dayRecurringEntries.map(e => [e.task.id, e.instanceId])
      );
      const rawCandidates = [...onceCandidates, ...dayRecurringEntries.map(e => e.task)];
      if (rawCandidates.length === 0) {
        if (!params.includeRecurring) break;
        continue;
      }

      const dayCapRemaining = Math.max(0, baseCap - (stats.dayMovableUsed[dayOffset] || 0));
      let candidates = rawCandidates;
      let effectiveDayCap = dayCapRemaining;

      if (params.prepareDay) {
        const prep = params.prepareDay(dayOffset, rawCandidates, dayCapRemaining);
        candidates = prep.admittedTasks;
        effectiveDayCap = Math.max(0, Math.min(dayCapRemaining, prep.capOverride));
      }

      if (candidates.length === 0 || effectiveDayCap <= 0) {
        continue;
      }

      const futureWins =
        params.prepareDay
          ? horizonWindows.slice(dayOffset + 1).flat()
          : horizonWindows.slice(dayOffset + 1).flat();

      const dayResult = runSingleDaySchedule(candidates, dynamicBusyEvents, {
        targetDate,
        now,
        timezone: config.timezone,
        workStartHour: config.workStartHour,
        workEndHour: config.workEndHour,
        workWindows: config.workWindows,
        bufferMinutes: config.bufferMinutes,
        taskRestMinutes: 10,
        maxContinuousMinutes: 90,
        maxDailyTaskMinutes: 330,
        exactDailyCapMinutes: effectiveDayCap,
        autoFilterQ4: false,
        lunchStartHour: 12.0,
        lunchEndHour: 13.0,
        dinnerStartHour: 18.0,
        dinnerEndHour: 19.0,
        minChunkMinutes: 30,
        allowSplit: true,
        allowFutureDailyInstances: true,
        advanceDeadlineDays: config.advanceDeadlineDays,
        releaseTimeMs: dayOffset === 0 ? config.releaseTimeMsToday : undefined,
        allocationDebt,
        futureWindows: futureWins,
      });

      for (const block of dayResult.scheduledBlocks) {
        stats.dayMovableUsed[dayOffset] = (stats.dayMovableUsed[dayOffset] || 0) + block.durationMinutes;
        dynamicBusyEvents.push({
          id: `placed-${block.id}`,
          title: block.title,
          start: block.start,
          end: block.end,
          isAllDay: false,
        });

        const recInstanceId = dayRecurringTaskIdToInstanceId.get(block.taskId);
        if (recInstanceId !== undefined) {
          if (recurringAllocations) {
            if (!recurringAllocations.has(recInstanceId)) {
              recurringAllocations.set(recInstanceId, []);
            }
            recurringAllocations.get(recInstanceId)!.push(block);
          }
        } else {
          if (!taskAllocations.has(block.taskId)) {
            taskAllocations.set(block.taskId, []);
          }
          taskAllocations.get(block.taskId)!.push(block);
        }
      }

      for (const scheduledId of dayResult.scheduledTaskIds) {
        if (!dayRecurringTaskIdToInstanceId.has(scheduledId)) {
          remainingTaskIds.delete(scheduledId);
        }
      }

      for (const unsched of dayResult.unscheduledTaskIds) {
        const recInstanceId = dayRecurringTaskIdToInstanceId.get(unsched.taskId);
        if (recInstanceId !== undefined) {
          recurringRejectByInstance?.set(recInstanceId, { code: unsched.reasonCode, text: unsched.reason });
          continue;
        }
        rejectReasonByTaskId?.set(unsched.taskId, { code: unsched.reasonCode, text: unsched.reason });
        if (unsched.reasonCode !== 'q4_filtered') {
          const tRef = taskMap.get(unsched.taskId);
          if (tRef) {
            tRef.duration_minutes = unsched.remainingMinutes;
          }
        } else {
          remainingTaskIds.delete(unsched.taskId);
        }
      }
    }
  };

  // Tier 1: Dated, recurring, and urgent flexible tasks
  if (coreIds.size > 0 || hasRecurring) {
    runTierPass({ tierTaskIds: coreIds, includeRecurring: hasRecurring });
  }

  // Tier 2A: Flexible `soon` ("近日规划") — adapts start day and preserves ~25% breathing slack when busy
  if (soonIds.size > 0) {
    const near3dLoad = getRangeOccupancyRatio(stats, 0, 3);
    runTierPass({
      tierTaskIds: soonIds,
      includeRecurring: false,
      prepareDay: (dayOffset, candidateTasks, dayCapRemaining) => {
        const dayOcc = getDayOccupancyRatio(stats, dayOffset);
        const denom = getDayDenomMinutes(stats, dayOffset);
        let maxCeiling = 0;
        const admitted: Task[] = [];
        for (const task of candidateTasks) {
          const ageDays = getTaskAgeDays(task.created_at, now);
          const taskCeiling = ageDays >= 7 ? 0.85 : 0.75;
          if (dayOffset < 2 && ageDays < 7 && (near3dLoad >= 0.65 || dayOcc >= 0.55)) {
            continue;
          }
          if (dayOcc >= taskCeiling) continue;
          admitted.push(task);
          maxCeiling = Math.max(maxCeiling, taskCeiling);
        }
        if (admitted.length === 0 || denom <= 0) {
          return { admittedTasks: [], capOverride: 0 };
        }
        const currentBusy = (stats.fixedInWorkMins[dayOffset] || 0) + (stats.dayMovableUsed[dayOffset] || 0);
        const slackAllowance = Math.max(0, Math.floor(denom * maxCeiling - currentBusy));
        return { admittedTasks: admitted, capOverride: Math.min(dayCapRemaining, slackAllowance) };
      },
    });
    for (const id of soonIds) {
      if (remainingTaskIds.has(id) && !rejectReasonByTaskId?.has(id)) {
        rejectReasonByTaskId?.set(id, {
          code: 'deferred_busy_soon',
          text: rejectReasonMessage('deferred_busy_soon', false),
        });
      }
    }
  }

  // Tier 2B: Flexible `later` ("远期备忘", Plan A) — 3-day cool-off + low-load admission with 55% ceiling
  if (laterIds.size > 0) {
    const minLaterOffset = horizonDays > 3 ? 3 : 0;
    runTierPass({
      tierTaskIds: laterIds,
      includeRecurring: false,
      minDayOffset: minLaterOffset,
      prepareDay: (dayOffset, candidateTasks, dayCapRemaining) => {
        const near7dLoad = getRangeOccupancyRatio(stats, 0, 7);
        const dayOcc = getDayOccupancyRatio(stats, dayOffset);
        const denom = getDayDenomMinutes(stats, dayOffset);
        const admitted = candidateTasks.filter(task => {
          const ageDays = getTaskAgeDays(task.created_at, now);
          if (ageDays >= 14) {
            return dayOcc < 0.35;
          }
          return near7dLoad < 0.45 && dayOcc < 0.40;
        });
        if (admitted.length === 0 || denom <= 0) {
          return { admittedTasks: [], capOverride: 0 };
        }
        const currentBusy = (stats.fixedInWorkMins[dayOffset] || 0) + (stats.dayMovableUsed[dayOffset] || 0);
        const slackAllowance = Math.max(0, Math.floor(denom * 0.55 - currentBusy));
        return { admittedTasks: admitted, capOverride: Math.min(dayCapRemaining, slackAllowance) };
      },
    });
    for (const id of laterIds) {
      if (remainingTaskIds.has(id)) {
        rejectReasonByTaskId?.set(id, {
          code: 'deferred_later_backlog',
          text: rejectReasonMessage('deferred_later_backlog', false),
        });
      }
    }
  }
}

function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

/**
 * 依据统一约束快照执行全局多日滚动排程，并在单个事务内原子提交新版本计划（T03, T08, T09, T10, T12, C06）。
 */
export function replanUserTasks(
  userId: number,
  options?: { preserveTaskIds?: Set<number>; triggerSource?: string; now?: Date }
): {
  success: boolean;
  planVersion?: number;
  totalTasks: number;
  scheduledCount: number;
  failedCount: number;
  partialCount: number;
  conflictCount?: number;
  tasks: Task[];
  summary: string;
} {
  for (let attempt = 0; attempt < 2; attempt++) {
    const now = options?.now ? new Date(options.now.getTime()) : new Date();
    const tz = getUserTimezone(userId);
    const todayKey = getAccountLocalDateKey(now, tz);
    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings | undefined;
    const { workStartHour, workEndHour, workWindows } = parseWorkSlotWindows(settings);
    const bufferMinutes = settings?.task_buffer_minutes ?? 10;
    const advanceDeadlineDays = settings?.advance_deadline_days ?? 1;
    const horizonDays = 14;

    // 1. Ensure active recurring templates have 14-day horizon instances & stale past daily instances are cancelled
    ensureHorizonDailyInstancesForUser(userId, now, horizonDays);
    cancelStalePastDailyInstances(userId, todayKey);
    const rawTasks = db.prepare(`
      SELECT * FROM tasks
      WHERE user_id = ? AND status != 'cancelled'
    `).all(userId) as Task[];

    for (const t of rawTasks) {
      if (t.status !== 'completed' && t.time_mode !== 'daily_fixed') {
        ensureTaskInstance(userId, t.id, todayKey, now);
      }
    }

    const basePlanVersion = getLatestPlanVersion(userId);
    const calendarGens = getCurrentCalendarGenerations(userId);

    // Load all active instances joined with their task definitions
    const activeInstances = db.prepare(`
      SELECT ti.*, t.title, t.importance, t.urgency, t.score_scale, t.importance_tier,
             t.impact_signals, t.time_mode, t.recurrence_rule, t.urgency_pace, t.deadline, t.deadline_kind,
             t.is_fixed, t.is_concurrent, t.session_plan, t.original_duration_minutes,
             t.completed_dates, t.created_at as task_created_at, t.active_template,
             t.scheduled_start as template_scheduled_start, t.scheduled_end as template_scheduled_end
      FROM task_instances ti
      JOIN tasks t ON t.id = ti.task_id
      WHERE ti.user_id = ?
        AND ti.status IN ('pending', 'in_progress')
        AND t.status != 'cancelled'
    `).all(userId) as Array<
      TaskInstance &
        Task & {
          task_created_at: string;
          active_template: number;
          template_scheduled_start?: string | null;
          template_scheduled_end?: string | null;
        }
    >;

    if (activeInstances.length === 0) {
      const committed = commitSchedulePlan({
        userId,
        expectedPlanVersion: basePlanVersion,
        expectedCalendarGenerations: calendarGens,
        triggerSource: options?.triggerSource || 'replan',
        summary: '暂无可排程的待办事项',
        instancePlans: [],
        taskTitlesById: new Map(),
        settings,
        now,
      });
      if (committed.stale) continue;
      return {
        success: true,
        planVersion: committed.planVersion,
        totalTasks: 0,
        scheduledCount: 0,
        failedCount: 0,
        partialCount: 0,
        conflictCount: 0,
        tasks: [],
        summary: '暂无可排程的待办事项',
      };
    }

    const horizonEnd = new Date(now.getTime() + horizonDays * 86400000);
    const externalBusy = getActiveExternalBusyEvents(userId, now.toISOString(), horizonEnd.toISOString());

    // Load existing blocks for active instances
    const activeBlocksRows = db.prepare(`
      SELECT * FROM schedule_blocks
      WHERE user_id = ? AND status IN ('planned', 'in_progress', 'completed', 'conflict')
      ORDER BY start_time ASC
    `).all(userId) as ScheduleBlockRecord[];

    const blocksByInstance = new Map<number, ScheduleBlockRecord[]>();
    for (const b of activeBlocksRows) {
      const list = blocksByInstance.get(b.instance_id) || [];
      list.push(b);
      blocksByInstance.set(b.instance_id, list);
    }

    const preserveIds = options?.preserveTaskIds;
    const todayBusyMinutes = computeTodayBusyMinutes(userId, now);
    const taskTitlesById = new Map<number, string>();

    // Estimate 3-day horizon load ratio from external events & committed/dated active work for flexible urgency modulation
    const threeDaysMs = now.getTime() + 3 * 86_400_000;
    const extBusy3dMins = externalBusy.reduce((sum, ev) => {
      const s = Math.max(now.getTime(), ev.start.getTime());
      const e = Math.min(threeDaysMs, ev.end.getTime());
      return e > s ? sum + (e - s) / 60_000 : sum;
    }, 0);
    const datedDemand3dMins = activeInstances.reduce((sum, row) => {
      if (row.time_mode === 'flexible' && row.urgency_pace !== 'urgent') return sum;
      if (row.time_mode === 'daily_fixed') {
        if (row.business_date > addDaysToDateKey(todayKey, 2) || !isDateMatchingRecurrence(row.business_date, row.recurrence_rule)) {
          return sum;
        }
      } else if (row.deadline) {
        const dueD = parseDeadlineDate(row.deadline, tz);
        if (dueD && dueD.getTime() > threeDaysMs) return sum;
      }
      return sum + Math.max(0, row.estimated_minutes - row.completed_minutes);
    }, 0);
    const baselineNearTermLoadRatio = Math.min(
      1,
      Math.max(0, (extBusy3dMins + datedDemand3dMins) / (3 * EFFECTIVE_DAILY_CAP_MINUTES))
    );

    const exclusiveFixedBusy: FixedCalendarBlock[] = [...externalBusy];
    const concurrentFixedBusy: FixedCalendarBlock[] = [];
    const lockUntil = computeScheduleLockUntil(settings, now, tz);

    const preservedByInstance = new Map<number, ScheduleBlockRecord[]>();
    const materializedFixedByInstance = new Map<
      number,
      Array<{ start: Date; end: Date; durationMinutes: number; conflict: boolean }>
    >();
    const conflictedBlockIdsByInstance = new Map<number, string[]>();
    const movableTasksToSchedule: Task[] = [];
    const instanceByTaskId = new Map<number, typeof activeInstances[number]>();
    const remainingNeededByInstance = new Map<number, number>();
    const activeInstancesForPlan: typeof activeInstances = [];
    type ActiveInstanceRow = typeof activeInstances[number];
    const recurringExclusiveByDate = new Map<string, Array<{ instanceId: number; task: Task }>>();
    const recurringConcurrentByDate = new Map<string, Array<{ instanceId: number; task: Task }>>();

    for (const row of activeInstances) {
      if (row.time_mode === 'daily_fixed' && !isDateMatchingRecurrence(row.business_date, row.recurrence_rule)) {
        continue;
      }
      activeInstancesForPlan.push(row);
      taskTitlesById.set(row.task_id, row.title);

      // Refresh urgency dynamically for both daily_fixed AND normal tasks (T09)
      const imp100 = normalizeScoreTo100(row.importance, row.score_scale);
      const instBlocks = blocksByInstance.get(row.id) || [];
      const firstBlock = instBlocks.find(b => b.status === 'planned' || b.status === 'in_progress');
      const lastBlock = instBlocks[instBlocks.length - 1];

      const urgRes = calculateDynamicUrgency({
        timeMode: row.time_mode || (row.deadline ? 'deadline' : 'flexible'),
        dueDate: row.deadline || null,
        estimatedMinutes: Math.max(1, row.estimated_minutes - row.completed_minutes),
        importance: imp100,
        urgencyPace: row.urgency_pace || 'soon',
        scheduledStart: firstBlock?.start_time || null,
        scheduledEnd: lastBlock?.end_time || null,
        isCompletedToday: false,
        dailyBusyMinutesAhead: todayBusyMinutes,
        nearTermLoadRatio: baselineNearTermLoadRatio,
        createdAt: row.task_created_at,
        workEndHour,
        currentTime: now,
      });

      const debtBoost = row.time_mode === 'daily_fixed' ? Math.round(15 * recurringDebt({ created_at: row.task_created_at, completed_dates: row.completed_dates }, now)) : 0;
      const nextUrgency = Math.min(100, urgRes.urgency + debtBoost);
      db.prepare('UPDATE tasks SET urgency = ?, importance = ?, score_scale = 100 WHERE id = ?').run(
        nextUrgency,
        imp100,
        row.task_id
      );
      row.urgency = nextUrgency;
      row.importance = imp100;

      // Protected blocks on this instance: completed, in_progress, is_fixed, is_committed, or preserveTaskIds
      const isForcePreserved = Boolean(preserveIds?.has(row.task_id));
      const protectedBlocks: ScheduleBlockRecord[] = [];
      const conflictIds: string[] = [];

      for (const b of instBlocks) {
        const isTimeLocked =
          (b.status === 'planned' || b.status === 'in_progress') &&
          isScheduleBlockTimeLocked(b.start_time, b.end_time, lockUntil, now);
        const isProtected =
          b.status === 'completed' ||
          b.status === 'in_progress' ||
          b.status === 'conflict' ||
          b.is_fixed === 1 ||
          b.is_committed === 1 ||
          isTimeLocked ||
          isForcePreserved;
        if (!isProtected) continue;

        protectedBlocks.push(b);

        if (b.status === 'completed') continue;

        const bs = new Date(b.start_time);
        const be = new Date(b.end_time);

        // Check if fixed/committed/locked exclusive block now conflicts with external busy events
        if (row.is_concurrent !== 1 && (b.is_fixed === 1 || b.is_committed === 1 || isTimeLocked) && b.status !== 'in_progress') {
          const hitsExternal = externalBusy.some(ext => intervalsOverlap(bs, be, ext.start, ext.end));
          if (hitsExternal) {
            conflictIds.push(b.id);
          }
        }

        const busyEntry: FixedCalendarBlock = {
          id: `protected-${b.id}`,
          title: `[受保护] ${row.title}`,
          start: bs,
          end: be,
          isAllDay: false,
        };
        if (row.is_concurrent === 1) {
          concurrentFixedBusy.push(busyEntry);
        } else {
          exclusiveFixedBusy.push(busyEntry);
        }
      }

      // Materialize rolled-over daily_fixed fixed block for newly generated day instances
      if (
        row.time_mode === 'daily_fixed' &&
        row.is_fixed === 1 &&
        row.active_template !== 0 &&
        protectedBlocks.length === 0 &&
        row.template_scheduled_start &&
        row.template_scheduled_end
      ) {
        const tmplStart = new Date(row.template_scheduled_start);
        const tmplEnd = new Date(row.template_scheduled_end);
        const durMs = Math.max(60000, tmplEnd.getTime() - tmplStart.getTime());
        const hm = getHourDecimalInTz(tmplStart, tz);
        const hh = Math.floor(hm);
        const mm = Math.round((hm - hh) * 60);
        const dayStart = zonedWallClockToUtc(row.business_date, hh, mm, 0, 0, tz);
        const dayEnd = new Date(dayStart.getTime() + durMs);
        const hitsBusy =
          row.is_concurrent !== 1 &&
          exclusiveFixedBusy.some(busy => intervalsOverlap(dayStart, dayEnd, busy.start, busy.end));
        materializedFixedByInstance.set(row.id, [
          {
            start: dayStart,
            end: dayEnd,
            durationMinutes: Math.max(1, Math.round(durMs / 60000)),
            conflict: hitsBusy,
          },
        ]);
        const busyEntry: FixedCalendarBlock = {
          id: `daily-fixed-mat-${row.id}`,
          title: `[固定周期] ${row.title}`,
          start: dayStart,
          end: dayEnd,
          isAllDay: false,
        };
        if (row.is_concurrent === 1) concurrentFixedBusy.push(busyEntry);
        else exclusiveFixedBusy.push(busyEntry);
      }

      preservedByInstance.set(row.id, protectedBlocks);
      if (conflictIds.length > 0) {
        conflictedBlockIdsByInstance.set(row.id, conflictIds);
      }

      const activeProtectedMins =
        protectedBlocks.filter(b => b.status !== 'completed').reduce((sum, b) => sum + b.duration_minutes, 0) +
        (materializedFixedByInstance.get(row.id)?.reduce((s, m) => s + m.durationMinutes, 0) || 0);
      const totalRemMins = Math.max(0, row.estimated_minutes - row.completed_minutes);
      const unallocatedToPlan = Math.max(0, totalRemMins - activeProtectedMins);
      remainingNeededByInstance.set(row.id, unallocatedToPlan);

      // Fixed tasks keep their fixed blocks; only non-fixed instances with unallocated minutes get scheduled
      if (row.is_fixed !== 1 && !isForcePreserved && unallocatedToPlan > 0) {
        const candidateTask: Task = {
          id: row.task_id,
          user_id: userId,
          title: row.title,
          duration_minutes: unallocatedToPlan,
          original_duration_minutes: row.original_duration_minutes || row.estimated_minutes,
          session_plan: row.session_plan,
          urgency: row.urgency,
          importance: row.importance,
          importance_tier: row.importance_tier,
          impact_signals: row.impact_signals,
          time_mode: row.time_mode,
          recurrence_rule: row.recurrence_rule,
          urgency_pace: row.urgency_pace,
          completed_dates: row.completed_dates,
          score_scale: 100,
          deadline_kind: row.deadline_kind,
          deadline: row.deadline,
          scheduled_start: null,
          scheduled_end: null,
          is_fixed: 0,
          is_concurrent: row.is_concurrent,
          status: 'pending_slot',
          start_reminder_sent: 0,
          end_reminder_sent: 0,
          created_at: row.task_created_at,
          updated_at: row.updated_at,
        };
        if (row.time_mode === 'daily_fixed') {
          const byDate = row.is_concurrent === 1 ? recurringConcurrentByDate : recurringExclusiveByDate;
          const list = byDate.get(row.business_date) || [];
          list.push({ instanceId: row.id, task: candidateTask });
          byDate.set(row.business_date, list);
        } else {
          instanceByTaskId.set(row.task_id, row);
          movableTasksToSchedule.push(candidateTask);
        }
      }
    }

    const releaseTimeMsToday = Math.ceil(now.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000);
    const horizonConfig = {
      timezone: tz,
      workStartHour,
      workEndHour,
      workWindows,
      bufferMinutes,
      advanceDeadlineDays,
      releaseTimeMsToday,
      exactDailyCapMinutes: EFFECTIVE_DAILY_CAP_MINUTES,
    };

    const usedMovableExclusiveByDay = new Map<string, number>();
    const usedMovableConcurrentByDay = new Map<string, number>();
    for (const row of activeInstancesForPlan) {
      if (row.is_fixed === 1) continue;
      const preserved = preservedByInstance.get(row.id) || [];
      for (const b of preserved) {
        if (b.status === 'completed') continue;
        const bk = getAccountLocalDateKey(new Date(b.start_time), tz);
        const m = row.is_concurrent === 1 ? usedMovableConcurrentByDay : usedMovableExclusiveByDay;
        m.set(bk, (m.get(bk) || 0) + b.duration_minutes);
      }
    }

    const recurringAllocatedByInstance = new Map<number, ScheduledTaskBlock[]>();
    const recurringRejectByInstance = new Map<number, { code: string; text: string }>();

    const taskAllocations = new Map<number, ScheduledTaskBlock[]>();
    const remainingTaskIds = new Set<number>(movableTasksToSchedule.map(t => t.id));
    const rejectReasonByTaskId = new Map<number, { code: string; text: string }>();

    const exclusiveTasks = movableTasksToSchedule.filter(t => t.is_concurrent !== 1);
    const concurrentTasks = movableTasksToSchedule.filter(t => t.is_concurrent === 1);

    scheduleTaskGroupInHorizon(
      exclusiveTasks,
      exclusiveFixedBusy,
      now,
      horizonDays,
      horizonConfig,
      taskAllocations,
      remainingTaskIds,
      rejectReasonByTaskId,
      usedMovableExclusiveByDay,
      recurringExclusiveByDate,
      recurringAllocatedByInstance,
      recurringRejectByInstance
    );
    scheduleTaskGroupInHorizon(
      concurrentTasks,
      concurrentFixedBusy,
      now,
      horizonDays,
      { ...horizonConfig, bufferMinutes: 0 },
      taskAllocations,
      remainingTaskIds,
      rejectReasonByTaskId,
      usedMovableConcurrentByDay,
      recurringConcurrentByDate,
      recurringAllocatedByInstance,
      recurringRejectByInstance
    );

    const instancePlans: ProposedInstancePlan[] = [];
    let scheduledCount = 0;
    let failedCount = 0;
    let partialCount = 0;
    let hardPending = 0;
    let conflictCount = 0;

    for (const row of activeInstancesForPlan) {
      const preserved = preservedByInstance.get(row.id) || [];
      const materialized = materializedFixedByInstance.get(row.id) || [];
      const conflictIds = conflictedBlockIdsByInstance.get(row.id) || [];
      const activeProtectedMins = preserved
        .filter(b => b.status !== 'completed')
        .reduce((sum, b) => sum + b.duration_minutes, 0);
      const materializedMins = materialized.reduce((sum, m) => sum + m.durationMinutes, 0);

      let allocatedMovable =
        row.time_mode === 'daily_fixed' && row.is_fixed !== 1
          ? recurringAllocatedByInstance.get(row.id) || []
          : taskAllocations.get(row.task_id) || [];
      const stillUnallocated =
        row.time_mode === 'daily_fixed' && row.is_fixed !== 1
          ? remainingNeededByInstance.get(row.id)! > 0 && allocatedMovable.length === 0
          : remainingTaskIds.has(row.task_id);
      const rejectInfo =
        row.time_mode === 'daily_fixed' && row.is_fixed !== 1
          ? recurringRejectByInstance.get(row.id)
          : rejectReasonByTaskId.get(row.task_id);

      // Hard deadline check: must fit 100% before deadline, otherwise drop movable blocks and keep pending
      if (row.deadline_kind === 'hard' && row.is_fixed !== 1) {
        const due = parseDeadlineDate(row.deadline, tz);
        const violatesDue = due ? allocatedMovable.some(b => b.end.getTime() > due.getTime()) : false;
        if (stillUnallocated || violatesDue) {
          allocatedMovable = [];
          hardPending++;
        }
      }

      const sortedNew = [...allocatedMovable].sort((a, b) => a.start.getTime() - b.start.getTime());
      const newMins = sortedNew.reduce((s, b) => s + b.durationMinutes, 0);
      const totalAllocated = activeProtectedMins + materializedMins + newMins;
      const totalRemNeeded = Math.max(0, row.estimated_minutes - row.completed_minutes);
      const unallocatedMins = Math.max(0, totalRemNeeded - totalAllocated);

      let planStatus: ProposedInstancePlan['planStatus'] = 'pending';
      let planReason: string | null = null;
      const hasMaterializedConflict = materialized.some(m => m.conflict);

      if (conflictIds.length > 0 || hasMaterializedConflict) {
        planStatus = 'conflict';
        planReason = '已固定或已确认时段与外部日程冲突';
        conflictCount++;
      } else if (totalAllocated > 0 && unallocatedMins === 0) {
        planStatus = 'scheduled';
        scheduledCount++;
      } else if (totalAllocated > 0 && unallocatedMins > 0) {
        planStatus = 'partial';
        planReason = rejectInfo?.text || '超出规划窗口或当日容量，已部分排入';
        scheduledCount++;
        partialCount++;
      } else {
        planStatus = 'pending';
        const specKey = getSpecificExecutionDateKey(row, tz);
        const horizonEndKey = addDaysToDateKey(todayKey, horizonDays - 1);
        if (specKey && specKey > horizonEndKey) {
          planReason = `计划于 ${specKey} 执行（暂未进入近 ${horizonDays} 天排程窗口）`;
        } else {
          planReason =
            row.deadline_kind === 'hard' && rejectInfo?.code !== 'q4_filtered'
              ? '不可逾期：截止前容量不足，未能完整排入'
              : rejectInfo?.text || '暂无合适空闲时段';
        }
        failedCount++;
      }

      const allNewBlocks = [
        ...materialized.map((m, idx) => ({
          startTime: m.start.toISOString(),
          endTime: m.end.toISOString(),
          durationMinutes: m.durationMinutes,
          partIndex: idx + 1,
          totalParts: materialized.length,
          isFixed: true,
          isCommitted: true,
          isConcurrent: row.is_concurrent === 1,
          energyZone: null,
          strategyLabel: null,
          breakAfterMinutes: null,
        })),
        ...sortedNew.map((b, idx) => {
          const totalParts = preserved.filter(p => p.status !== 'completed').length + materialized.length + sortedNew.length;
          const offset = preserved.filter(p => p.status !== 'completed').length + materialized.length;
          return {
            startTime: b.start.toISOString(),
            endTime: b.end.toISOString(),
            durationMinutes: b.durationMinutes,
            partIndex: offset + idx + 1,
            totalParts,
            isFixed: false,
            isCommitted: false,
            isConcurrent: row.is_concurrent === 1,
            energyZone: b.energyZone,
            strategyLabel: b.strategyLabel,
            breakAfterMinutes: b.breakAfterMinutes,
          };
        }),
      ];

      instancePlans.push({
        instanceId: row.id,
        taskId: row.task_id,
        planStatus,
        allocatedMinutes: totalAllocated,
        unallocatedMinutes: unallocatedMins,
        planReason,
        preservedBlocks: preserved,
        conflictedBlockIds: conflictIds,
        newBlocks: allNewBlocks,
      });
    }

    const summary = `智能排程完成：共将 ${scheduledCount} 项任务排入日历${partialCount > 0 ? `（其中 ${partialCount} 项仅部分排入）` : ''}${failedCount > 0 ? `，${failedCount} 项待办未分配` : ''}${hardPending > 0 ? `，其中 ${hardPending} 项不可逾期任务未找到完整方案` : ''}${conflictCount > 0 ? `，${conflictCount} 项存在日历冲突` : ''}`;

    const commitRes = commitSchedulePlan({
      userId,
      expectedPlanVersion: basePlanVersion,
      expectedCalendarGenerations: calendarGens,
      triggerSource: options?.triggerSource || 'replan',
      summary,
      instancePlans,
      taskTitlesById,
      settings,
      now,
    });

    if (commitRes.stale) {
      continue; // Retry once on concurrent version change
    }

    const allUpdatedTasks = db.prepare(`
      SELECT * FROM tasks
      WHERE user_id = ? AND status IN ('scheduled', 'in_progress', 'completed')
      ORDER BY scheduled_start ASC
    `).all(userId) as Task[];

    return {
      success: true,
      planVersion: commitRes.planVersion,
      totalTasks: activeInstances.length,
      scheduledCount,
      failedCount,
      partialCount,
      conflictCount,
      tasks: allUpdatedTasks,
      summary,
    };
  }

  return {
    success: false,
    totalTasks: 0,
    scheduledCount: 0,
    failedCount: 0,
    partialCount: 0,
    tasks: [],
    summary: '排程提交版本冲突，请重试',
  };
}

/**
 * 在未来 14 天时间窗口内模拟单任务排程（与全局重排共用相同容量、时区与截止约束 T08, T10）
 */
function simulateTaskInHorizon(
  userId: number,
  task: {
    id?: number;
    title: string;
    duration_minutes: number;
    session_plan?: string | null;
    deadline_kind?: Task['deadline_kind'];
    urgency_pace?: Task['urgency_pace'];
    time_mode?: Task['time_mode'];
    is_concurrent?: number;
    completed_dates?: string | null;
    score_scale?: number | null;
    urgency: number;
    importance: number;
    deadline?: string | null;
  },
  fixedEvents: FixedCalendarBlock[],
  settings?: UserSettings,
  occupiedDailyMinutes?: Map<string, number>
): {
  success: boolean;
  scheduled_start?: string;
  scheduled_end?: string;
  schedule_blocks?: string;
  accumulatedBlocks: ScheduledTaskBlock[];
  reasonCode: string;
  message: string;
} {
  const now = new Date();
  const tz = resolveAccountTimezone(settings?.timezone);
  const simTask: Task = {
    id: task.id || -999,
    user_id: userId,
    title: task.title,
    duration_minutes: task.duration_minutes,
    session_plan: task.session_plan,
    deadline_kind: task.deadline_kind,
    urgency_pace: task.urgency_pace,
    time_mode: task.time_mode,
    is_concurrent: task.is_concurrent,
    completed_dates: task.completed_dates,
    score_scale: task.score_scale,
    urgency: task.urgency,
    importance: task.importance,
    deadline: task.deadline || null,
    scheduled_start: null,
    scheduled_end: null,
    status: 'scheduled',
    start_reminder_sent: 0,
    end_reminder_sent: 0,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  const simQuad = calculateQuadrant(task.importance, task.urgency, task.score_scale);
  if (simQuad === 'q4' && task.deadline_kind !== 'hard' && task.time_mode !== 'specific_date' && task.time_mode !== 'flexible') {
    return {
      success: false,
      reasonCode: 'q4_filtered',
      message: '象限 IV（不重要且不紧急）：默认不自动排程占用核心时段',
      accumulatedBlocks: [],
    };
  }

  const { workStartHour, workEndHour, workWindows } = parseWorkSlotWindows(settings);
  const bufferMinutes = task.is_concurrent === 1 ? 0 : (settings?.task_buffer_minutes ?? 10);
  const advanceDeadlineDays = settings?.advance_deadline_days ?? 1;
  const releaseTimeMsToday = Math.ceil(now.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000);
  const accumulatedBlocks: ScheduledTaskBlock[] = [];
  let remainingMinutesToSim = task.duration_minutes;
  const maxDays = task.time_mode === 'daily_fixed' ? 1 : 14;
  const simWindowOpts = {
    timezone: tz,
    workStartHour,
    workEndHour,
    workWindows,
    bufferMinutes,
    releaseTimeMs: releaseTimeMsToday,
  };
  const horizonWindows = getHorizonWindows(now, maxDays, fixedEvents, simWindowOpts);
  const unblockedHorizonWindows = getHorizonWindows(now, maxDays, [], simWindowOpts);

  const baseKey = getAccountLocalDateKey(now, tz);
  const dayKeysSim = Array.from({ length: maxDays }, (_, i) => addDaysToDateKey(baseKey, i));
  const simStats = computeHorizonDayStats(
    horizonWindows,
    unblockedHorizonWindows,
    dayKeysSim,
    EFFECTIVE_DAILY_CAP_MINUTES,
    occupiedDailyMinutes
  );
  const near3dSimLoad = getRangeOccupancyRatio(simStats, 0, 3);
  const near7dSimLoad = getRangeOccupancyRatio(simStats, 0, 7);
  const isDeferredSoonFlex = task.time_mode === 'flexible' && task.urgency_pace !== 'urgent' && task.urgency_pace !== 'later';
  const isDeferredLaterFlex = task.time_mode === 'flexible' && task.urgency_pace === 'later';
  let lastReasonCode = isDeferredLaterFlex
    ? 'deferred_later_backlog'
    : isDeferredSoonFlex
    ? 'deferred_busy_soon'
    : 'insufficient_capacity';

  for (let dayOffset = isDeferredLaterFlex && maxDays > 3 ? 3 : 0; dayOffset < maxDays; dayOffset++) {
    if (remainingMinutesToSim <= 0) break;
    const dayKey = dayKeysSim[dayOffset];
    const specKey = getSpecificExecutionDateKey(simTask, tz);
    if (specKey && dayKey < specKey) continue;
    if (specKey && simTask.deadline_kind === 'hard' && dayKey > specKey) continue;
    const targetDate = zonedWallClockToUtc(dayKey, 0, 0, 0, 0, tz);

    const dayOcc = getDayOccupancyRatio(simStats, dayOffset);
    const denom = getDayDenomMinutes(simStats, dayOffset);
    let remainingCapMinutes = Math.max(0, EFFECTIVE_DAILY_CAP_MINUTES - (simStats.dayMovableUsed[dayOffset] || 0));

    if (isDeferredSoonFlex) {
      if (dayOffset < 2 && (near3dSimLoad >= 0.65 || dayOcc >= 0.55)) continue;
      if (dayOcc >= 0.75 || denom <= 0) continue;
      const busyOnDay = (simStats.fixedInWorkMins[dayOffset] || 0) + (simStats.dayMovableUsed[dayOffset] || 0);
      remainingCapMinutes = Math.min(remainingCapMinutes, Math.max(0, Math.floor(denom * 0.75 - busyOnDay)));
    } else if (isDeferredLaterFlex) {
      if (near7dSimLoad >= 0.45 || dayOcc >= 0.40 || denom <= 0) continue;
      const busyOnDay = (simStats.fixedInWorkMins[dayOffset] || 0) + (simStats.dayMovableUsed[dayOffset] || 0);
      remainingCapMinutes = Math.min(remainingCapMinutes, Math.max(0, Math.floor(denom * 0.55 - busyOnDay)));
    }

    if (remainingCapMinutes <= 0) continue;

    simTask.duration_minutes = remainingMinutesToSim;

    const dayResult = runSingleDaySchedule([simTask], fixedEvents, {
      targetDate,
      timezone: tz,
      workStartHour,
      workEndHour,
      workWindows,
      bufferMinutes,
      taskRestMinutes: 10,
      maxContinuousMinutes: 90,
      maxDailyTaskMinutes: 330,
      exactDailyCapMinutes: remainingCapMinutes,
      autoFilterQ4: false,
      advanceDeadlineDays,
      releaseTimeMs: dayOffset === 0 ? releaseTimeMsToday : undefined,
      futureWindows: horizonWindows.slice(dayOffset + 1).flat(),
    });

    const blocks = dayResult.scheduledBlocks.filter(b => b.taskId === simTask.id);
    if (blocks.length > 0) {
      accumulatedBlocks.push(...blocks);
      const allocatedToday = blocks.reduce((sum, b) => sum + b.durationMinutes, 0);
      remainingMinutesToSim = Math.max(0, remainingMinutesToSim - allocatedToday);
    }
    const unsched = dayResult.unscheduledTaskIds.find(u => u.taskId === simTask.id);
    if (unsched) lastReasonCode = unsched.reasonCode;
  }

  const due = parseDeadlineDate(task.deadline, tz);
  const violatesHard =
    task.deadline_kind === 'hard' &&
    due &&
    accumulatedBlocks.some(b => b.end.getTime() > due.getTime());

  if (accumulatedBlocks.length > 0 && remainingMinutesToSim <= 0 && !violatesHard) {
    const sorted = [...accumulatedBlocks].sort((a, b) => a.start.getTime() - b.start.getTime());
    const sStart = sorted[0].start.toISOString();
    const sEnd = sorted[sorted.length - 1].end.toISOString();
    const totalParts = sorted.length;
    const blockPayload = sorted.map((b, idx) => ({
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      duration: b.durationMinutes,
      partIndex: idx + 1,
      totalParts,
      energyZone: b.energyZone,
      strategyLabel: b.strategyLabel,
      breakAfterMinutes: b.breakAfterMinutes,
    }));

    return {
      success: true,
      scheduled_start: sStart,
      scheduled_end: sEnd,
      schedule_blocks: JSON.stringify(blockPayload),
      accumulatedBlocks,
      reasonCode: 'ok',
      message: '排程计算成功',
    };
  }

  return {
    success: false,
    reasonCode: task.deadline_kind === 'hard' ? 'hard_deadline_violation' : lastReasonCode,
    message:
      task.deadline_kind === 'hard'
        ? '排程窗口内未找到能在硬截止前完整完成的方案。'
        : rejectReasonMessage(lastReasonCode as any, false),
    accumulatedBlocks: [],
  };
}

/**
 * 针对单任务执行试排与冲突提案计算
 */
export function scheduleTask(
  userId: number,
  task: {
    id?: number;
    title: string;
    duration_minutes: number;
    session_plan?: string | null;
    deadline_kind?: Task['deadline_kind'];
    urgency_pace?: Task['urgency_pace'];
    time_mode?: Task['time_mode'];
    is_concurrent?: number;
    completed_dates?: string | null;
    score_scale?: number | null;
    urgency: number;
    importance: number;
    deadline?: string | null;
  }
): SchedulingResult {
  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings | undefined;
  const tz = resolveAccountTimezone(settings?.timezone);
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + 14 * 86400000);
  const parsedFixedEvents = getActiveExternalBusyEvents(userId, now.toISOString(), horizonEnd.toISOString());

  const existingScheduledTasks = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ?
      AND status IN ('scheduled', 'in_progress')
      AND scheduled_start IS NOT NULL
      AND scheduled_end IS NOT NULL
      AND (? IS NULL OR id != ?)
    ORDER BY scheduled_start ASC
  `).all(userId, task.id || null, task.id || null) as Task[];

  const buildBusyAndDailyLoad = (items: Task[], isConcurrentTrack: boolean) => {
    const busy: FixedCalendarBlock[] = isConcurrentTrack ? [] : [...parsedFixedEvents];
    const dailyMinutes = new Map<string, number>();

    for (const et of items) {
      if (isConcurrentTrack) {
        if (et.is_concurrent === 1) {
          busy.push(...taskToBusyEvents(et, 'task', now, 14, tz));
        }
        continue;
      }
      if (et.is_concurrent === 1) continue;
      const blocks = taskToBusyEvents(et, 'task', now, 14, tz);
      busy.push(...blocks);
      // Match global replan: only movable (non-fixed) tasks count toward daily auto-schedule capacity
      if (et.is_fixed !== 1) {
        for (const b of blocks) {
          const dayKey = getAccountLocalDateKey(b.start, tz);
          const mins = Math.max(0, Math.round((b.end.getTime() - b.start.getTime()) / 60000));
          dailyMinutes.set(dayKey, (dailyMinutes.get(dayKey) || 0) + mins);
        }
      }
    }

    return { busy, dailyMinutes };
  };

  const isConcurrentTask = task.is_concurrent === 1;
  const { busy: baseFixedEvents, dailyMinutes: occupiedDailyMinutes } = buildBusyAndDailyLoad(existingScheduledTasks, isConcurrentTask);

  const directPlan = simulateTaskInHorizon(userId, task, baseFixedEvents, settings, occupiedDailyMinutes);

  if (
    isConcurrentTask ||
    task.time_mode === 'daily_fixed' ||
    (calculateQuadrant(task.importance, task.urgency, task.score_scale) === 'q4' && task.deadline_kind !== 'hard')
  ) {
    return directPlan;
  }

  let cannotFinishInTime = false;
  const newTaskDeadline = parseDeadlineDate(task.deadline, tz);
  if (!directPlan.success) {
    cannotFinishInTime = true;
  } else if (newTaskDeadline) {
    const directEndTime = new Date(directPlan.scheduled_end!).getTime();
    if (directEndTime > newTaskDeadline.getTime()) {
      cannotFinishInTime = true;
    }
  }

  const newTaskScore = computeTaskPriorityScore(task, now, tz);

  // Only future, unstarted, movable, non-daily tasks outside schedule lock window are eligible to be swapped
  const lockUntil = computeScheduleLockUntil(settings, now, tz);
  const futureCandidates = existingScheduledTasks.filter(t => {
    if (t.is_fixed === 1 || t.time_mode === 'daily_fixed' || t.is_concurrent === 1 || t.status === 'in_progress') {
      return false;
    }
    const startTime = new Date(t.scheduled_start!).getTime();
    const endTime = new Date(t.scheduled_end!).getTime();
    if (!(startTime > now.getTime() && endTime > now.getTime())) {
      return false;
    }
    if (lockUntil) {
      const blocks = taskToBusyEvents(t, 'task', now, 14, tz);
      if (blocks.some(b => isScheduleBlockTimeLocked(b.start.toISOString(), b.end.toISOString(), lockUntil, now))) {
        return false;
      }
    }
    return true;
  });

  interface ViableProposal {
    candidate: Task;
    simNew: ReturnType<typeof simulateTaskInHorizon>;
    simCandidate: ReturnType<typeof simulateTaskInHorizon>;
    scoreDiff: number;
    timeSavedMinutes: number;
  }

  const viableProposals: ViableProposal[] = [];

  for (const candidate of futureCandidates) {
    const candidateScore = computeTaskPriorityScore(candidate, now, tz);
    const candidateStartTime = new Date(candidate.scheduled_start!).getTime();

    let isCandidateEligible = false;

    if (cannotFinishInTime) {
      if (!newTaskDeadline || candidateStartTime < newTaskDeadline.getTime()) {
        isCandidateEligible = true;
      }
    } else if (directPlan.scheduled_start) {
      const directStartTime = new Date(directPlan.scheduled_start).getTime();
      const isEarlier = candidateStartTime < directStartTime - 45 * 60 * 1000;
      const scoreDiff = newTaskScore - candidateScore;
      const newUrg = normalizeScoreTo100(task.urgency, 100);
      const candUrg = normalizeScoreTo100(candidate.urgency, candidate.score_scale);
      const newImp = normalizeScoreTo100(task.importance, 100);
      const urgDiff = newUrg - candUrg;
      const isSignificantGain =
        scoreDiff >= 120 ||
        urgDiff >= 25 ||
        (newImp >= 70 && newUrg >= 70 && candUrg < 60);

      if (isEarlier && isSignificantGain) {
        isCandidateEligible = true;
      }
    }

    if (!isCandidateEligible) continue;

    const remainingWithoutCandidate = existingScheduledTasks.filter(t => t.id !== candidate.id);
    const { busy: testFixedWithoutCandidate, dailyMinutes: dailyWithoutCandidate } = buildBusyAndDailyLoad(
      remainingWithoutCandidate,
      false
    );

    const simNew = simulateTaskInHorizon(userId, task, testFixedWithoutCandidate, settings, dailyWithoutCandidate);
    if (!simNew.success || !simNew.scheduled_start || !simNew.scheduled_end) continue;

    if (newTaskDeadline && new Date(simNew.scheduled_end).getTime() > newTaskDeadline.getTime()) {
      continue;
    }

    if (!cannotFinishInTime && directPlan.scheduled_start) {
      if (new Date(simNew.scheduled_start).getTime() >= new Date(directPlan.scheduled_start).getTime()) {
        continue;
      }
    }

    const newSimBusyBlocks =
      simNew.accumulatedBlocks.length > 0
        ? simNew.accumulatedBlocks.map((b, idx) => ({
            id: `sim-new-task-${idx}`,
            title: task.title,
            start: b.start,
            end: b.end,
            isAllDay: false,
          }))
        : [
            {
              id: 'sim-new-task-0',
              title: task.title,
              start: new Date(simNew.scheduled_start),
              end: new Date(simNew.scheduled_end),
              isAllDay: false,
            },
          ];

    const testFixedWithNewTask = [...testFixedWithoutCandidate, ...newSimBusyBlocks];
    const dailyWithNewTask = new Map(dailyWithoutCandidate);
    for (const b of newSimBusyBlocks) {
      const dk = getAccountLocalDateKey(b.start, tz);
      const mins = Math.max(0, Math.round((b.end.getTime() - b.start.getTime()) / 60000));
      dailyWithNewTask.set(dk, (dailyWithNewTask.get(dk) || 0) + mins);
    }

    const simCandidate = simulateTaskInHorizon(userId, candidate, testFixedWithNewTask, settings, dailyWithNewTask);
    if (!simCandidate.success || !simCandidate.scheduled_start || !simCandidate.scheduled_end) {
      continue;
    }

    const candidateDeadline = parseDeadlineDate(candidate.deadline, tz);
    if (candidateDeadline && new Date(simCandidate.scheduled_end).getTime() > candidateDeadline.getTime()) {
      continue;
    }

    const timeSavedMinutes = directPlan.scheduled_start
      ? Math.round((new Date(directPlan.scheduled_start).getTime() - new Date(simNew.scheduled_start).getTime()) / 60000)
      : 120;

    viableProposals.push({
      candidate,
      simNew,
      simCandidate,
      scoreDiff: newTaskScore - candidateScore,
      timeSavedMinutes,
    });
  }

  let bestProposal: ScheduleProposal | undefined;

  if (viableProposals.length > 0) {
    viableProposals.sort((a, b) => {
      if (cannotFinishInTime) {
        return new Date(a.simNew.scheduled_end!).getTime() - new Date(b.simNew.scheduled_end!).getTime();
      }
      return b.scoreDiff * 2 + b.timeSavedMinutes / 10 - (a.scoreDiff * 2 + a.timeSavedMinutes / 10);
    });

    const best = viableProposals[0];
    const reasonText = cannotFinishInTime
      ? task.deadline
        ? `截止时间紧迫（${new Date(task.deadline).toLocaleString('zh-CN', { timeZone: tz, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}），原日程无充足空闲时段按时完成`
        : '原日程无充足空闲时段在有效时间内完成'
      : `重要紧迫度更高（优先级评分 ${Math.round(newTaskScore)} vs ${Math.round(computeTaskPriorityScore(best.candidate, now, tz))}），顶替排入黄金时段可大幅提升推进效率`;

    bestProposal = {
      type: cannotFinishInTime ? 'deadline_risk' : 'priority_gain',
      conflictTask: {
        id: best.candidate.id,
        title: best.candidate.title,
        scheduled_start: best.candidate.scheduled_start!,
        scheduled_end: best.candidate.scheduled_end!,
        duration_minutes: best.candidate.duration_minutes,
        urgency: best.candidate.urgency,
        importance: best.candidate.importance,
        deadline: best.candidate.deadline,
      },
      reasonText,
      newTaskSchedule: {
        start: best.simNew.scheduled_start!,
        end: best.simNew.scheduled_end!,
        blocks: best.simNew.schedule_blocks ? JSON.parse(best.simNew.schedule_blocks) : [],
      },
      conflictTaskSchedule: {
        start: best.simCandidate.scheduled_start!,
        end: best.simCandidate.scheduled_end!,
        blocks: best.simCandidate.schedule_blocks ? JSON.parse(best.simCandidate.schedule_blocks) : [],
      },
    };
  }

  if (bestProposal) {
    return {
      success: directPlan.success,
      scheduled_start: directPlan.scheduled_start,
      scheduled_end: directPlan.scheduled_end,
      schedule_blocks: directPlan.schedule_blocks,
      reasonCode: directPlan.reasonCode,
      message: directPlan.success ? '排程计算成功，但有更优调整建议' : '按原日程无法在有效时间内完成，已生成同步调整建议',
      proposal: bestProposal,
    };
  }

  return directPlan;
}

/**
 * 完成分段任务或指定时长的部分任务（委派给统一的实例进度命令并触发重排 T04, T06）
 */
export function completeTaskPart(
  userId: number,
  taskId: number,
  completedMinutes?: number,
  partIndex?: number,
  options?: {
    blockId?: string;
    commandId?: string;
    expectedPlanVersion?: number;
    expectedInstanceVersion?: number;
    businessDate?: string;
  }
): {
  success: boolean;
  staleVersion?: boolean;
  currentPlanVersion?: number;
  message: string;
  remainingMinutes: number;
  isAllCompleted: boolean;
  task?: Task;
} {
  const res = executeInstanceProgressCommand({
    userId,
    taskId,
    action: 'complete_part',
    completedMinutes,
    partIndex,
    blockId: options?.blockId,
    commandId: options?.commandId,
    expectedPlanVersion: options?.expectedPlanVersion,
    expectedInstanceVersion: options?.expectedInstanceVersion,
    businessDate: options?.businessDate,
  });

  if (res.success && res.needsReplan) {
    replanUserTasks(userId, { triggerSource: 'complete_part' });
    const latestTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task | undefined;
    return {
      success: true,
      message: res.message,
      remainingMinutes: res.remainingMinutes,
      isAllCompleted: res.isAllCompleted,
      task: latestTask || res.task,
    };
  }

  return {
    success: res.success,
    staleVersion: res.staleVersion,
    currentPlanVersion: res.currentPlanVersion,
    message: res.message,
    remainingMinutes: res.remainingMinutes,
    isAllCompleted: res.isAllCompleted,
    task: res.task,
  };
}

export function buildExtendedScheduleBlocks(
  rawScheduleBlocks: string | null | undefined,
  scheduledStart: string | null | undefined,
  scheduledEnd: string | null | undefined,
  currentDurationMinutes: number,
  newEnd: Date,
  extendMinutes: number
): string | null {
  let blocks: any[] = [];
  if (rawScheduleBlocks) {
    try {
      const parsed = typeof rawScheduleBlocks === 'string'
        ? JSON.parse(rawScheduleBlocks)
        : rawScheduleBlocks;
      if (Array.isArray(parsed)) {
        blocks = parsed.map(b => ({ ...b }));
      }
    } catch {}
  }

  const newEndIso = newEnd.toISOString();

  if (blocks.length > 0) {
    const lastIdx = blocks.length - 1;
    const last = blocks[lastIdx];
    const lastStartMs = new Date(last.start).getTime();
    const fallbackOldDur = !Number.isNaN(lastStartMs) && scheduledEnd
      ? Math.max(0, Math.round((new Date(scheduledEnd).getTime() - lastStartMs) / 60000))
      : 0;
    const prevBlockDur = typeof last.duration === 'number' && last.duration > 0
      ? last.duration
      : fallbackOldDur;
    last.end = newEndIso;
    last.duration = Math.max(1, prevBlockDur + extendMinutes);
    return JSON.stringify(blocks);
  }

  if (scheduledStart) {
    return JSON.stringify([
      {
        start: scheduledStart,
        end: newEndIso,
        duration: Math.max(1, currentDurationMinutes + extendMinutes),
      },
    ]);
  }

  return null;
}

/**
 * 延长任务当前排程结束时间（T05）：
 * - 先校验实例非终态（已完成/已取消不可延长）
 * - 校验硬截止时间：延长后不得晚于 deadline
 * - 校验延伸段是否落入有效工作窗口（若配置了 work_slots）
 * - 校验是否与同轨外部日程或固定/已确认块重叠；冲突时保留原计划不写入
 */
export function extendTaskDuration(
  userId: number,
  taskId: number,
  extendMinutes: number = 30
): {
  success: boolean;
  message: string;
  conflictType?: 'terminal_status' | 'hard_deadline' | 'external_conflict' | 'fixed_block_conflict' | 'work_window_violation';
  newEnd?: Date;
  newEndStr?: string;
  task?: Task;
} {
  const now = new Date();
  const tz = getUserTimezone(userId);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId) as Task | undefined;
  if (!task) {
    return { success: false, message: '未找到指定任务' };
  }

  const todayKey = getAccountLocalDateKey(now, tz);
  const instance = ensureTaskInstance(userId, taskId, todayKey, now);
  if (!instance) {
    return { success: false, message: '未找到任务实例' };
  }

  if (instance.status === 'completed' || instance.status === 'cancelled' || task.status === 'completed' || task.status === 'cancelled') {
    return {
      success: false,
      conflictType: 'terminal_status',
      message: '已完成或已取消的任务无法延长时段',
    };
  }

  const activeBlocks = db.prepare(`
    SELECT * FROM schedule_blocks
    WHERE instance_id = ? AND status IN ('planned', 'in_progress')
    ORDER BY start_time ASC
  `).all(instance.id) as ScheduleBlockRecord[];

  const targetBlock = activeBlocks.find(b => b.status === 'in_progress') || activeBlocks[activeBlocks.length - 1];
  const currentEndIso = targetBlock?.end_time || task.scheduled_end;
  if (!currentEndIso) {
    return { success: false, message: '该任务未安排时间，无法延长' };
  }

  const extMin = Number(extendMinutes) > 0 ? Math.round(Number(extendMinutes)) : 30;
  const currentEnd = new Date(currentEndIso);
  const newEnd = new Date(currentEnd.getTime() + extMin * 60 * 1000);

  // 1. Check hard deadline constraint
  if (task.deadline_kind === 'hard' && task.deadline) {
    const due = parseDeadlineDate(task.deadline, tz);
    if (due && newEnd.getTime() > due.getTime()) {
      const dueStr = due.toLocaleString('zh-CN', { timeZone: tz, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
      return {
        success: false,
        conflictType: 'hard_deadline',
        message: `延长 ${extMin} 分钟后将超出硬截止时间（${dueStr}），原计划已保留`,
      };
    }
  }

  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings | undefined;
  const { workWindows } = parseWorkSlotWindows(settings);

  // 2. Check work window containment for non-fixed tasks when workWindows are configured
  if (task.is_fixed !== 1 && workWindows.length > 0) {
    const extStartKey = getAccountLocalDateKey(currentEnd, tz);
    const extEndKey = getAccountLocalDateKey(new Date(newEnd.getTime() - 1), tz);
    const fitsInAnyWindow = (dateKey: string, s: Date, e: Date) =>
      workWindows.some(w => {
        const ws = buildDayTime(s, dateKey, w.startHour, tz);
        const we = buildDayTime(s, dateKey, w.endHour, tz);
        return s.getTime() >= ws.getTime() && e.getTime() <= we.getTime();
      });

    const fitsStartDay = fitsInAnyWindow(extStartKey, currentEnd, newEnd);
    const fitsEndDay = extStartKey !== extEndKey ? fitsInAnyWindow(extEndKey, currentEnd, newEnd) : false;
    if (!fitsStartDay && !fitsEndDay) {
      return {
        success: false,
        conflictType: 'work_window_violation',
        message: `延长 ${extMin} 分钟后超出配置的工作时段，原计划已保留`,
      };
    }
  }

  // 3. Check conflict against same-track external events & fixed/committed blocks
  if (task.is_concurrent !== 1) {
    const externalBusy = getActiveExternalBusyEvents(userId, currentEnd.toISOString(), newEnd.toISOString());
    const hitExt = externalBusy.find(e => intervalsOverlap(currentEnd, newEnd, e.start, e.end));
    if (hitExt) {
      return {
        success: false,
        conflictType: 'external_conflict',
        message: `延长时段与外部日程「${hitExt.title}」冲突，原计划已保留`,
      };
    }
  }

  const otherProtectedBlocks = db.prepare(`
    SELECT sb.*, t.title
    FROM schedule_blocks sb
    JOIN tasks t ON t.id = sb.task_id
    WHERE sb.user_id = ?
      AND sb.instance_id != ?
      AND sb.status IN ('planned', 'in_progress')
      AND sb.is_concurrent = ?
      AND (sb.is_fixed = 1 OR sb.is_committed = 1 OR sb.status = 'in_progress')
      AND sb.end_time > ?
      AND sb.start_time < ?
  `).all(userId, instance.id, task.is_concurrent ? 1 : 0, currentEnd.toISOString(), newEnd.toISOString()) as Array<ScheduleBlockRecord & { title: string }>;

  if (otherProtectedBlocks.length > 0) {
    return {
      success: false,
      conflictType: 'fixed_block_conflict',
      message: `延长时段与已锁定任务「${otherProtectedBlocks[0].title}」冲突，原计划已保留`,
    };
  }

  // 4. All checks passed -> apply atomically and trigger replan for movable tasks
  db.transaction(() => {
    db.prepare(`
      UPDATE task_instances
      SET estimated_minutes = estimated_minutes + ?,
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(extMin, instance.id);

    if (targetBlock) {
      db.prepare(`
        UPDATE schedule_blocks
        SET end_time = ?,
            duration_minutes = duration_minutes + ?,
            is_committed = 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newEnd.toISOString(), extMin, targetBlock.id);
    }

    db.prepare(`
      INSERT INTO progress_events (user_id, command_id, instance_id, block_id, action, delta_minutes, reason)
      VALUES (?, ?, ?, ?, 'extend', ?, ?)
    `).run(userId, `ext-${taskId}-${Date.now()}`, instance.id, targetBlock?.id || null, extMin, `延长 ${extMin} 分钟`);

    db.prepare(`
      UPDATE tasks
      SET original_duration_minutes = COALESCE(original_duration_minutes, duration_minutes) + ?,
          end_reminder_sent = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(extMin, taskId);

    queueReplanRequest(userId, `extend_instance:${instance.id}`);
    syncLegacyTaskProjection(userId, taskId, now);
  })();

  replanUserTasks(userId, { preserveTaskIds: new Set([taskId]), triggerSource: 'extend' });

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task | undefined;
  const newEndStr = newEnd.toLocaleTimeString('zh-CN', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return {
    success: true,
    message: `任务「${task.title}」已延长 ${extMin} 分钟`,
    newEnd,
    newEndStr,
    task: updated,
  };
}

export type SingleRescheduleMode = 'auto' | 'next_slot' | 'specific_date' | 'specific_time';
export type TimePeriodPreference = 'morning' | 'afternoon' | 'evening';

export interface SingleRescheduleOptions {
  userId: number;
  taskId: number;
  instanceId?: number;
  blockId?: string;
  businessDate?: string;
  mode?: SingleRescheduleMode;
  targetDate?: string | null;
  targetTimePeriod?: TimePeriodPreference | null;
  targetStart?: string | null;
  targetEnd?: string | null;
  allowProposal?: boolean;
  unpinFixed?: boolean;
  triggerSource?: string;
  now?: Date;
}

export interface SingleRescheduleResult {
  success: boolean;
  statusCode: number;
  message: string;
  task?: Task;
  instance?: TaskInstance;
  planVersion?: number;
  previousSchedule?: {
    start: string | null;
    end: string | null;
    blocks: Array<{ start: string; end: string; duration: number }>;
  };
  newSchedule?: {
    start: string | null;
    end: string | null;
    blocks: Array<{ start: string; end: string; duration: number }>;
  };
  proposal?: ScheduleProposal;
  targetInstanceId?: number;
  targetInstanceVersion?: number;
}

function getPeriodBoundsMs(
  dateKey: string,
  period: TimePeriodPreference | null | undefined,
  timezone: string
): { startMs: number; endMs: number } | null {
  if (!period) return null;
  const dayStart = zonedWallClockToUtc(dateKey, 0, 0, 0, 0, timezone).getTime();
  if (period === 'morning') {
    return {
      startMs: dayStart + 6 * 3600_000,
      endMs: dayStart + 12 * 3600_000,
    };
  }
  if (period === 'afternoon') {
    return {
      startMs: dayStart + 12 * 3600_000,
      endMs: dayStart + 18 * 3600_000,
    };
  }
  return {
    startMs: dayStart + 18 * 3600_000,
    endMs: dayStart + 24 * 3600_000,
  };
}

function formatSlotBrief(startIso: string, endIso: string, tz: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sStr = s.toLocaleString('zh-CN', {
    timeZone: tz,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const eStr = e.toLocaleTimeString('zh-CN', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${sStr}–${eStr}`;
}

/**
 * 针对单个任务（或周期任务的单天实例）执行再排期，保留其余已排定任务不变。
 * 支持四种模式：
 * - auto：为当前未排期或需自动安排的任务寻找最合适空闲时段
 * - next_slot：跳过当前已排时段，向后（或避开原时段）寻找下一个可用时段
 * - specific_date：从指定日期（及可选上午/下午/晚上偏好）开始寻找空闲时段
 * - specific_time：直接校验并落位到指定起止时间，冲突时支持返回移动提案
 */
export function rescheduleSingleTask(options: SingleRescheduleOptions): SingleRescheduleResult {
  const { userId, taskId } = options;

  for (let attempt = 0; attempt < 2; attempt++) {
    const now = options.now ? new Date(options.now.getTime()) : new Date();
    const tz = getUserTimezone(userId);
    const todayKey = getAccountLocalDateKey(now, tz);
    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings | undefined;
    const { workStartHour, workEndHour, workWindows } = parseWorkSlotWindows(settings);
    const bufferMinutes = settings?.task_buffer_minutes ?? 10;
    const advanceDeadlineDays = settings?.advance_deadline_days ?? 1;
    const horizonDays = 14;

    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId) as Task | undefined;
    if (!task) {
      return { success: false, statusCode: 404, message: '任务不存在' };
    }
    if (task.status === 'cancelled') {
      return { success: false, statusCode: 400, message: '已取消的任务无法再排期' };
    }
    if (task.time_mode !== 'daily_fixed' && task.status === 'completed') {
      return { success: false, statusCode: 400, message: '已完成的任务无法再排期，请先恢复待办' };
    }

    let instance: TaskInstance | undefined;
    if (options.instanceId) {
      instance = db
        .prepare('SELECT * FROM task_instances WHERE id = ? AND task_id = ? AND user_id = ?')
        .get(options.instanceId, taskId, userId) as TaskInstance | undefined;
    } else if (options.blockId) {
      const blk = db
        .prepare('SELECT instance_id FROM schedule_blocks WHERE id = ? AND task_id = ? AND user_id = ?')
        .get(options.blockId, taskId, userId) as { instance_id: number } | undefined;
      if (blk) {
        instance = db
          .prepare('SELECT * FROM task_instances WHERE id = ? AND user_id = ?')
          .get(blk.instance_id, userId) as TaskInstance | undefined;
      }
    }

    if (!instance) {
      const resolvedBizDate =
        options.businessDate && /^\d{4}-\d{2}-\d{2}$/.test(options.businessDate)
          ? options.businessDate
          : task.time_mode === 'daily_fixed'
          ? todayKey
          : todayKey;
      instance = ensureTaskInstance(userId, taskId, resolvedBizDate, now) || undefined;
    }

    if (!instance) {
      return { success: false, statusCode: 404, message: '未找到可排期的任务实例' };
    }
    if (instance.status === 'completed' || instance.status === 'cancelled') {
      return { success: false, statusCode: 400, message: '该次任务已完成或已取消，无法再排期' };
    }

    const basePlanVersion = getLatestPlanVersion(userId);
    const calendarGens = getCurrentCalendarGenerations(userId);

    // Load all active instances & blocks so other tasks remain intact
    const activeInstances = db.prepare(`
      SELECT ti.*, t.title, t.importance, t.urgency, t.score_scale, t.importance_tier,
             t.impact_signals, t.time_mode, t.recurrence_rule, t.urgency_pace, t.deadline, t.deadline_kind,
             t.is_fixed, t.is_concurrent, t.session_plan, t.original_duration_minutes,
             t.completed_dates, t.created_at as task_created_at
      FROM task_instances ti
      JOIN tasks t ON t.id = ti.task_id
      WHERE ti.user_id = ?
        AND ti.status IN ('pending', 'in_progress')
        AND t.status != 'cancelled'
    `).all(userId) as Array<TaskInstance & Task & { task_created_at: string }>;

    const activeBlocksRows = db.prepare(`
      SELECT * FROM schedule_blocks
      WHERE user_id = ? AND status IN ('planned', 'in_progress', 'completed', 'conflict')
      ORDER BY start_time ASC
    `).all(userId) as ScheduleBlockRecord[];

    const blocksByInstance = new Map<number, ScheduleBlockRecord[]>();
    for (const b of activeBlocksRows) {
      const list = blocksByInstance.get(b.instance_id) || [];
      list.push(b);
      blocksByInstance.set(b.instance_id, list);
    }

    const targetBlocks = blocksByInstance.get(instance.id) || [];
    const completedBlocks = targetBlocks.filter(b => b.status === 'completed');
    const inProgressBlocks = targetBlocks.filter(b => b.status === 'in_progress');
    const movableOldBlocks = targetBlocks.filter(b => b.status === 'planned' || b.status === 'conflict');

    const previousSchedule = {
      start: movableOldBlocks[0]?.start_time || null,
      end: movableOldBlocks[movableOldBlocks.length - 1]?.end_time || null,
      blocks: movableOldBlocks.map(b => ({
        start: b.start_time,
        end: b.end_time,
        duration: b.duration_minutes,
      })),
    };

    const resolvedMode: SingleRescheduleMode = options.targetStart
      ? 'specific_time'
      : options.targetDate
      ? 'specific_date'
      : options.mode || (movableOldBlocks.length > 0 ? 'next_slot' : 'auto');

    if (
      task.is_fixed === 1 &&
      resolvedMode !== 'specific_time' &&
      !options.unpinFixed &&
      instance.instance_type !== 'daily'
    ) {
      return {
        success: false,
        statusCode: 400,
        message: '该任务为固定时间任务，请指定具体新时段，或选择解除固定后再智能排期',
        previousSchedule,
      };
    }

    const inProgressMins = inProgressBlocks.reduce((s, b) => s + b.duration_minutes, 0);
    const remainingToSchedule = Math.max(
      0,
      instance.estimated_minutes - instance.completed_minutes - inProgressMins
    );

    if (remainingToSchedule <= 0) {
      return {
        success: false,
        statusCode: 400,
        message: '该任务已无剩余待排期工时',
        previousSchedule,
      };
    }

    const isConcurrent = task.is_concurrent === 1;
    const targetTrackVal = isConcurrent ? 1 : 0;
    const taskTitlesById = new Map<number, string>();
    const otherSameTrackBlocks: Array<ScheduleBlockRecord & { title: string; taskObj?: Task }> = [];
    const occupiedDailyMinutes = new Map<string, number>();

    for (const row of activeInstances) {
      taskTitlesById.set(row.task_id, row.title);
      if (row.id === instance.id) continue;
      const instBlocks = blocksByInstance.get(row.id) || [];
      for (const b of instBlocks) {
        if (b.status === 'completed') continue;
        if (b.is_concurrent === targetTrackVal) {
          otherSameTrackBlocks.push({ ...b, title: row.title, taskObj: row });
          if (b.is_fixed !== 1) {
            const dk = getAccountLocalDateKey(new Date(b.start_time), tz);
            occupiedDailyMinutes.set(dk, (occupiedDailyMinutes.get(dk) || 0) + b.duration_minutes);
          }
        }
      }
    }

    // Also include own in-progress blocks on busy track & daily cap
    for (const b of inProgressBlocks) {
      const dk = getAccountLocalDateKey(new Date(b.start_time), tz);
      occupiedDailyMinutes.set(dk, (occupiedDailyMinutes.get(dk) || 0) + b.duration_minutes);
    }

    const searchAnchorDate =
      options.targetDate && /^\d{4}-\d{2}-\d{2}$/.test(options.targetDate)
        ? zonedWallClockToUtc(options.targetDate, 0, 0, 0, 0, tz)
        : now;
    const effectiveAnchor = searchAnchorDate.getTime() > now.getTime() ? searchAnchorDate : now;
    const horizonEnd = new Date(Math.max(now.getTime(), effectiveAnchor.getTime()) + (horizonDays + 2) * 86400_000);
    const externalBusy = isConcurrent
      ? []
      : getActiveExternalBusyEvents(userId, now.toISOString(), horizonEnd.toISOString());

    const buildTrackBusy = (extraBusy: FixedCalendarBlock[] = []): FixedCalendarBlock[] => [
      ...externalBusy,
      ...otherSameTrackBlocks.map(b => ({
        id: `other-${b.id}`,
        title: b.title,
        start: new Date(b.start_time),
        end: new Date(b.end_time),
        isAllDay: false,
      })),
      ...inProgressBlocks.map(b => ({
        id: `inprog-${b.id}`,
        title: task.title,
        start: new Date(b.start_time),
        end: new Date(b.end_time),
        isAllDay: false,
      })),
      ...extraBusy,
    ];

    const ceil5Now = Math.ceil(now.getTime() / (5 * 60_000)) * (5 * 60_000);
    const dueDateObj = parseDeadlineDate(task.deadline, tz);
    const quad = calculateQuadrant100(task.importance, task.urgency, task.score_scale ?? undefined);

    let computedNewBlocks: ProposedInstancePlan['newBlocks'] = [];
    let unallocatedAfter = 0;
    let planReasonAfter: string | null = null;

    if (resolvedMode === 'specific_time') {
      const startDate = parseAccountDateOrIso(options.targetStart, tz);
      if (!startDate) {
        return { success: false, statusCode: 400, message: '无效的目标开始时间格式', previousSchedule };
      }
      let endDate = options.targetEnd ? parseAccountDateOrIso(options.targetEnd, tz) : null;
      if (options.targetEnd && !endDate) {
        return { success: false, statusCode: 400, message: '无效的目标结束时间格式', previousSchedule };
      }
      if (!endDate) {
        endDate = new Date(startDate.getTime() + remainingToSchedule * 60_000);
      }
      if (endDate.getTime() <= startDate.getTime()) {
        return { success: false, statusCode: 400, message: '结束时间必须晚于开始时间', previousSchedule };
      }
      if (task.deadline_kind === 'hard' && dueDateObj && endDate.getTime() > dueDateObj.getTime()) {
        return {
          success: false,
          statusCode: 400,
          message: `目标时段超出硬截止时间，已保留「${task.title}」原排程`,
          previousSchedule,
        };
      }

      if (!isConcurrent) {
        const specificExternal = getActiveExternalBusyEvents(userId, startDate.toISOString(), endDate.toISOString());
        const hitExt = specificExternal.find(e => !e.isAllDay && intervalsOverlap(startDate, endDate!, e.start, e.end));
        if (hitExt) {
          return {
            success: false,
            statusCode: 409,
            message: `目标时段与外部日程「${hitExt.title}」冲突，原日程已保留`,
            previousSchedule,
          };
        }
      }

      const hitInProg = inProgressBlocks.find(b =>
        intervalsOverlap(startDate, endDate!, new Date(b.start_time), new Date(b.end_time))
      );
      if (hitInProg) {
        return {
          success: false,
          statusCode: 409,
          message: '目标时段与该任务正在进行的时段冲突',
          previousSchedule,
        };
      }

      const overlappingOther = otherSameTrackBlocks.filter(b =>
        intervalsOverlap(startDate, endDate!, new Date(b.start_time), new Date(b.end_time))
      );
      if (overlappingOther.length > 0) {
        const lockUntil = computeScheduleLockUntil(settings, now, tz);
        const lockedHit = overlappingOther.find(
          b =>
            b.is_fixed === 1 ||
            b.is_committed === 1 ||
            b.status === 'in_progress' ||
            isScheduleBlockTimeLocked(b.start_time, b.end_time, lockUntil, now)
        );
        if (lockedHit) {
          return {
            success: false,
            statusCode: 409,
            message: `目标时段与已锁定任务「${lockedHit.title}」冲突，原日程已保留`,
            previousSchedule,
          };
        }

        const uniqueConflictTaskIds = Array.from(new Set(overlappingOther.map(b => b.task_id)));
        if (options.allowProposal && uniqueConflictTaskIds.length === 1 && overlappingOther[0].taskObj) {
          const conflictTask = overlappingOther[0].taskObj;
          const durMins = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 60_000));
          const otherMinusConflict = otherSameTrackBlocks.filter(b => b.task_id !== conflictTask.id);
          const conflictSimBusy: FixedCalendarBlock[] = [
            ...externalBusy,
            ...otherMinusConflict.map(b => ({
              id: `other-${b.id}`,
              title: b.title,
              start: new Date(b.start_time),
              end: new Date(b.end_time),
              isAllDay: false,
            })),
            {
              id: `resched-target-${task.id}`,
              title: task.title,
              start: startDate,
              end: endDate,
              isAllDay: false,
            },
          ];
          const conflictDaily = new Map<string, number>();
          for (const b of otherMinusConflict) {
            if (b.is_fixed !== 1) {
              const dk = getAccountLocalDateKey(new Date(b.start_time), tz);
              conflictDaily.set(dk, (conflictDaily.get(dk) || 0) + b.duration_minutes);
            }
          }
          const targetDk = getAccountLocalDateKey(startDate, tz);
          conflictDaily.set(targetDk, (conflictDaily.get(targetDk) || 0) + durMins);

          const conflictRemaining = conflictTask.duration_minutes || overlappingOther.reduce((s, b) => s + b.duration_minutes, 0);
          const simAlt = simulateTaskInHorizon(
            userId,
            {
              id: conflictTask.id,
              title: conflictTask.title,
              duration_minutes: conflictRemaining,
              session_plan: conflictTask.session_plan,
              deadline_kind: conflictTask.deadline_kind,
              urgency_pace: conflictTask.urgency_pace,
              time_mode: conflictTask.time_mode,
              is_concurrent: conflictTask.is_concurrent,
              completed_dates: conflictTask.completed_dates,
              score_scale: conflictTask.score_scale,
              urgency: conflictTask.urgency,
              importance: conflictTask.importance,
              deadline: conflictTask.deadline,
            },
            conflictSimBusy,
            settings,
            conflictDaily
          );

          if (simAlt.success && simAlt.scheduled_start && simAlt.scheduled_end) {
            const zone = classifySlotEnergy(startDate, durMins, tz);
            const targetBlocksPayload = [
              {
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                duration: durMins,
                partIndex: 1,
                totalParts: 1,
                energyZone: zone,
                strategyLabel: '指定改期',
              },
            ];
            return {
              success: true,
              statusCode: 200,
              message: `目标时段与「${conflictTask.title}」重叠，已生成同步调整建议`,
              task,
              instance,
              previousSchedule,
              targetInstanceId: instance.id,
              targetInstanceVersion: instance.version,
              proposal: {
                type: 'priority_gain',
                conflictTask: {
                  id: conflictTask.id,
                  title: conflictTask.title,
                  scheduled_start: conflictTask.scheduled_start || overlappingOther[0].start_time,
                  scheduled_end: conflictTask.scheduled_end || overlappingOther[0].end_time,
                  duration_minutes: conflictTask.duration_minutes,
                  urgency: conflictTask.urgency,
                  importance: conflictTask.importance,
                  deadline: conflictTask.deadline,
                },
                reasonText: '您指定了该时段执行当前任务',
                newTaskSchedule: {
                  start: startDate.toISOString(),
                  end: endDate.toISOString(),
                  blocks: targetBlocksPayload,
                },
                conflictTaskSchedule: {
                  start: simAlt.scheduled_start,
                  end: simAlt.scheduled_end,
                  blocks: simAlt.schedule_blocks ? JSON.parse(simAlt.schedule_blocks) : [],
                },
              },
            };
          }
        }

        return {
          success: false,
          statusCode: 409,
          message: `目标时段已被「${overlappingOther[0].title}」占用，原日程已保留`,
          previousSchedule,
        };
      }

      const durMins = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 60_000));
      const zone = classifySlotEnergy(startDate, durMins, tz);
      computedNewBlocks = [
        {
          startTime: startDate.toISOString(),
          endTime: endDate.toISOString(),
          durationMinutes: durMins,
          partIndex: 1,
          totalParts: 1,
          isFixed: Boolean(task.is_fixed && !options.unpinFixed && instance.instance_type === 'once'),
          isCommitted: true,
          isConcurrent,
          energyZone: zone,
          strategyLabel: '单次指定再排期',
          breakAfterMinutes: null,
        },
      ];
    } else {
      // Algorithmic single-task slot search: auto / next_slot / specific_date
      const runSearchFrom = (
        startDateKey: string,
        minStartMs: number,
        maxDaysToSearch: number,
        extraBusy: FixedCalendarBlock[] = [],
        periodFilter?: TimePeriodPreference | null
      ): ScheduledTaskBlock[] => {
        const busyAll = buildTrackBusy(extraBusy);
        const simTask: Task = {
          ...task,
          duration_minutes: remainingToSchedule,
          original_duration_minutes: instance!.estimated_minutes,
          is_fixed: 0,
          status: 'pending_slot',
          score_scale: 100,
          time_mode: task.time_mode === 'daily_fixed' ? 'flexible' : task.time_mode,
        };
        const results: ScheduledTaskBlock[] = [];
        let rem = remainingToSchedule;
        const baseSearchDate = zonedWallClockToUtc(startDateKey, 0, 0, 0, 0, tz);
        const horizonWins = getHorizonWindows(baseSearchDate, maxDaysToSearch, busyAll, {
          timezone: tz,
          workStartHour,
          workEndHour,
          workWindows,
          bufferMinutes: isConcurrent ? 0 : bufferMinutes,
          releaseTimeMs: minStartMs,
        });

        for (let offset = 0; offset < maxDaysToSearch; offset++) {
          if (rem <= 0) break;
          const dk = addDaysToDateKey(startDateKey, offset);
          const targetDay = zonedWallClockToUtc(dk, 0, 0, 0, 0, tz);
          const usedDay = occupiedDailyMinutes.get(dk) || 0;
          const dayCap = Math.max(0, EFFECTIVE_DAILY_CAP_MINUTES - usedDay);
          if (dayCap <= 0) continue;

          // If periodFilter is requested on the first day, mask out intervals outside that period
          const dayExtraBusy: FixedCalendarBlock[] = [...busyAll];
          let dayMinMs = Math.max(ceil5Now, minStartMs);
          if (offset === 0 && periodFilter) {
            const pBounds = getPeriodBoundsMs(dk, periodFilter, tz);
            if (pBounds) {
              dayMinMs = Math.max(dayMinMs, pBounds.startMs);
              const dayEndMs = zonedWallClockToUtc(dk, 0, 0, 0, 0, tz).getTime() + 24 * 3600_000;
              if (pBounds.endMs < dayEndMs) {
                dayExtraBusy.push({
                  id: `period-after-${dk}`,
                  title: '时段边界限制',
                  start: new Date(pBounds.endMs),
                  end: new Date(dayEndMs),
                  isAllDay: false,
                });
              }
            }
          }

          simTask.duration_minutes = rem;
          const dayRes = runSingleDaySchedule([simTask], dayExtraBusy, {
            targetDate: targetDay,
            now,
            timezone: tz,
            workStartHour,
            workEndHour,
            workWindows,
            bufferMinutes: isConcurrent ? 0 : bufferMinutes,
            taskRestMinutes: 10,
            maxContinuousMinutes: 90,
            maxDailyTaskMinutes: 330,
            exactDailyCapMinutes: dayCap,
            autoFilterQ4: false,
            advanceDeadlineDays,
            releaseTimeMs: dayMinMs,
            futureWindows: horizonWins.slice(offset + 1).flat(),
          });

          const placed = dayRes.scheduledBlocks.filter(b => b.taskId === simTask.id);
          if (placed.length > 0) {
            results.push(...placed);
            rem = Math.max(0, rem - placed.reduce((s, b) => s + b.durationMinutes, 0));
          }
        }
        return results;
      };

      let foundBlocks: ScheduledTaskBlock[] = [];

      if (resolvedMode === 'specific_date' && options.targetDate) {
        const targetDk = options.targetDate;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDk)) {
          return { success: false, statusCode: 400, message: '无效的目标日期格式，应为 YYYY-MM-DD', previousSchedule };
        }
        if (targetDk < todayKey) {
          return { success: false, statusCode: 400, message: '目标日期不能早于今天，原日程已保留', previousSchedule };
        }
        const dayStartMs = zonedWallClockToUtc(targetDk, 0, 0, 0, 0, tz).getTime();
        const searchStartMs = Math.max(ceil5Now, dayStartMs);
        // 1. Try targetDate with optional period preference first
        foundBlocks = runSearchFrom(targetDk, searchStartMs, 1, [], options.targetTimePeriod);
        // 2. If period was requested and targetDate period is full, try full targetDate
        if (
          (foundBlocks.length === 0 || foundBlocks.reduce((s, b) => s + b.durationMinutes, 0) < remainingToSchedule) &&
          options.targetTimePeriod
        ) {
          const wholeDayBlocks = runSearchFrom(targetDk, searchStartMs, 1, [], null);
          if (wholeDayBlocks.reduce((s, b) => s + b.durationMinutes, 0) > foundBlocks.reduce((s, b) => s + b.durationMinutes, 0)) {
            foundBlocks = wholeDayBlocks;
          }
        }
        // 3. If still incomplete or empty, roll forward from targetDate across 14 days
        if (foundBlocks.length === 0 || (task.deadline_kind === 'hard' && foundBlocks.reduce((s, b) => s + b.durationMinutes, 0) < remainingToSchedule)) {
          const multiDayBlocks = runSearchFrom(targetDk, searchStartMs, horizonDays, [], null);
          if (multiDayBlocks.length > 0) {
            foundBlocks = multiDayBlocks;
          }
        }
      } else if (resolvedMode === 'next_slot' && movableOldBlocks.length > 0) {
        const currentEndMs = new Date(movableOldBlocks[movableOldBlocks.length - 1].end_time).getTime();
        const forwardStartMs = Math.max(ceil5Now, currentEndMs);
        const forwardDk = getAccountLocalDateKey(new Date(forwardStartMs), tz);

        // 1. Search strictly after current scheduled end
        foundBlocks = runSearchFrom(forwardDk, forwardStartMs, horizonDays);

        // 2. If nothing fits after current end (or violates hard deadline), search from now while blocking original slots
        const forwardValid =
          foundBlocks.length > 0 &&
          !(task.deadline_kind === 'hard' && dueDateObj && foundBlocks.some(b => b.end.getTime() > dueDateObj.getTime()));
        if (!forwardValid) {
          const avoidCurrentBusy: FixedCalendarBlock[] = movableOldBlocks.map((b, idx) => ({
            id: `avoid-old-${idx}`,
            title: '原排程时段',
            start: new Date(b.start_time),
            end: new Date(b.end_time),
            isAllDay: false,
          }));
          foundBlocks = runSearchFrom(todayKey, ceil5Now, horizonDays, avoidCurrentBusy);
        }
      } else {
        // 'auto' mode
        foundBlocks = runSearchFrom(todayKey, ceil5Now, horizonDays);
      }

      // Check hard deadline compliance
      const allocatedSum = foundBlocks.reduce((s, b) => s + b.durationMinutes, 0);
      const violatesHard =
        task.deadline_kind === 'hard' &&
        dueDateObj &&
        (allocatedSum < remainingToSchedule || foundBlocks.some(b => b.end.getTime() > dueDateObj.getTime()));

      if (foundBlocks.length === 0 || violatesHard) {
        return {
          success: false,
          statusCode: 400,
          message:
            resolvedMode === 'next_slot'
              ? `未找到其他可替代的空闲时段，已保留「${task.title}」原排程`
              : task.deadline_kind === 'hard'
              ? `「${task.title}」为不可逾期任务，目标范围内剩余容量不足`
              : `「${task.title}」暂无合适空闲时段`,
          previousSchedule,
        };
      }

      const sortedFound = [...foundBlocks].sort((a, b) => a.start.getTime() - b.start.getTime());
      const offsetParts = inProgressBlocks.length;
      const totalParts = offsetParts + sortedFound.length;

      computedNewBlocks = sortedFound.map((b, idx) => ({
        startTime: b.start.toISOString(),
        endTime: b.end.toISOString(),
        durationMinutes: b.durationMinutes,
        partIndex: offsetParts + idx + 1,
        totalParts,
        isFixed: false,
        isCommitted: resolvedMode !== 'auto',
        isConcurrent,
        energyZone: b.energyZone || classifySlotEnergy(b.start, b.durationMinutes, tz),
        strategyLabel:
          resolvedMode === 'next_slot'
            ? '顺延再排期'
            : resolvedMode === 'specific_date'
            ? '改期重排'
            : b.strategyLabel || getStrategyLabel(b.energyZone || 'moderate', quad, totalParts > 1),
        breakAfterMinutes: b.breakAfterMinutes || null,
      }));
      unallocatedAfter = Math.max(0, remainingToSchedule - allocatedSum);
      if (unallocatedAfter > 0) {
        planReasonAfter = '窗口内可用时段有限，已部分排入';
      }
    }

    // Build commit payload preserving all other active instances
    const instancePlans: ProposedInstancePlan[] = [];
    for (const row of activeInstances) {
      const existingBlocks = blocksByInstance.get(row.id) || [];
      if (row.id === instance.id) {
        const preservedTarget = [...completedBlocks, ...inProgressBlocks];
        const newMins = computedNewBlocks.reduce((s, b) => s + b.durationMinutes, 0);
        const totalAllocated = inProgressMins + newMins;
        const planStatus: ProposedInstancePlan['planStatus'] =
          unallocatedAfter === 0 ? 'scheduled' : 'partial';

        instancePlans.push({
          instanceId: instance.id,
          taskId: task.id,
          planStatus,
          allocatedMinutes: totalAllocated,
          unallocatedMinutes: unallocatedAfter,
          planReason: planReasonAfter,
          preservedBlocks: preservedTarget,
          newBlocks: computedNewBlocks,
        });
      } else {
        instancePlans.push({
          instanceId: row.id,
          taskId: row.task_id,
          planStatus: row.plan_status,
          allocatedMinutes: row.allocated_minutes,
          unallocatedMinutes: row.unallocated_minutes,
          planReason: row.plan_reason ?? null,
          preservedBlocks: existingBlocks,
          newBlocks: [],
        });
      }
    }

    const newStart = computedNewBlocks[0]?.startTime || null;
    const newEnd = computedNewBlocks[computedNewBlocks.length - 1]?.endTime || null;
    const summarySlot = newStart && newEnd ? formatSlotBrief(newStart, newEnd, tz) : '待定';
    const summary = `单次再排期：已将「${task.title}」安排至 ${summarySlot}`;

    if (options.unpinFixed && task.is_fixed === 1 && instance.instance_type === 'once') {
      db.prepare('UPDATE tasks SET is_fixed = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(
        task.id,
        userId
      );
    }
    if (resolvedMode === 'specific_time' && task.is_fixed === 1 && instance.instance_type === 'once' && newStart && newEnd) {
      db.prepare(
        'UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
      ).run(newStart, newEnd, task.id, userId);
    }

    const commitRes = commitSchedulePlan({
      userId,
      expectedPlanVersion: basePlanVersion,
      expectedCalendarGenerations: calendarGens,
      triggerSource: options.triggerSource || `single_reschedule_${resolvedMode}`,
      summary,
      instancePlans,
      taskTitlesById,
      settings,
      now,
    });

    if (commitRes.stale) {
      continue;
    }

    const updatedTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as Task;
    const updatedInst = db.prepare('SELECT * FROM task_instances WHERE id = ?').get(instance.id) as TaskInstance;

    const newSchedule = {
      start: newStart,
      end: newEnd,
      blocks: computedNewBlocks.map(b => ({
        start: b.startTime,
        end: b.endTime,
        duration: b.durationMinutes,
      })),
    };

    const prevText =
      previousSchedule.start && previousSchedule.end
        ? `（原时段 ${formatSlotBrief(previousSchedule.start, previousSchedule.end, tz)}）`
        : '';

    const message =
      unallocatedAfter > 0
        ? `已为「${task.title}」安排部分时段至 ${summarySlot}，剩余 ${unallocatedAfter} 分钟未排入${prevText}`
        : `已将「${task.title}」单次再排期至 ${summarySlot}${prevText}`;

    return {
      success: true,
      statusCode: 200,
      message,
      task: updatedTask,
      instance: updatedInst,
      planVersion: commitRes.planVersion,
      previousSchedule,
      newSchedule,
    };
  }

  return {
    success: false,
    statusCode: 409,
    message: '排程版本并发冲突，请重试',
  };
}
