import { db } from '../config/database.js';
import { Task, UserSettings, ExternalEvent, WorkSlot } from '../models/types.js';

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

export interface ScheduleOptions {
  targetDate: Date;
  workStartHour?: number;          // 默认 08:00
  workEndHour?: number;            // 默认 22:00
  bufferMinutes?: number;          // 固定课程/会议后过渡缓冲，默认 10 分钟
  taskRestMinutes?: number;        // 专注周期/任务间歇休息，默认 10 分钟
  maxContinuousMinutes?: number;   // 单次最长连续专注时长上限，默认 60 分钟 (Ultradian Rhythm)
  maxDailyTaskMinutes?: number;    // 每日自主待办最大负荷上限，默认 330 分钟 (5.5h)
  autoFilterQ4?: boolean;          // 是否过滤 Q4 不自动排程，默认 true
  lunchStartHour?: number;         // 默认 12.0
  lunchEndHour?: number;           // 默认 13.0
  dinnerStartHour?: number;        // 默认 18.0
  dinnerEndHour?: number;          // 默认 19.0
  minChunkMinutes?: number;        // 跨槽拆分时的最小单块时长，默认 30 分钟
  allowSplit?: boolean;            // 当全天无单槽可完整容纳时，是否允许跨槽拆分
}

export interface SchedulingResult {
  success: boolean;
  scheduled_start?: string; // ISO
  scheduled_end?: string;   // ISO
  schedule_blocks?: string; // JSON
  message: string;
}

/**
 * 格式化为本地 YYYY-MM-DD
 */
export function formatLocalDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 将长耗时任务按生理专注极限（默认 60 分钟）切分为专注小节 (Focus Sessions)
 */
export function splitIntoFocusSessions(
  totalMinutes: number,
  maxSessionMinutes: number = 60,
  minTailMinutes: number = 20
): number[] {
  if (totalMinutes <= maxSessionMinutes) {
    return [totalMinutes];
  }

  const sessions: number[] = [];
  let remaining = totalMinutes;

  while (remaining > maxSessionMinutes) {
    const tail = remaining - maxSessionMinutes;
    if (tail > 0 && tail < minTailMinutes) {
      const firstHalf = Math.ceil(remaining / 2 / 5) * 5;
      const secondHalf = remaining - firstHalf;
      sessions.push(firstHalf);
      if (secondHalf > 0) {
        sessions.push(secondHalf);
      }
      remaining = 0;
      break;
    } else {
      sessions.push(maxSessionMinutes);
      remaining -= maxSessionMinutes;
    }
  }

  if (remaining > 0) {
    sessions.push(remaining);
  }

  return sessions;
}

/**
 * 判定空闲槽的生理精力能级 (Energy Zone)
 */
export function classifySlotEnergy(start: Date, durationMinutes: number): EnergyZoneType {
  if (durationMinutes < 45) {
    return 'fragment';
  }
  const startHour = start.getHours() + start.getMinutes() / 60;
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

/**
 * 依据重要度与紧迫度计算四象限
 */
export function calculateQuadrant(importance: number, urgency: number): 'q1' | 'q2' | 'q3' | 'q4' {
  const imp = importance <= 5 ? importance * 2 : importance;
  const urg = urgency <= 5 ? urgency * 2 : urgency;
  const isImportant = imp >= 5;
  const isUrgent = urg >= 5;
  if (isImportant && isUrgent) return 'q1';
  if (isImportant && !isUrgent) return 'q2';
  if (!isImportant && isUrgent) return 'q3';
  return 'q4';
}

/**
 * 计算任务的综合排程优先级得分
 */
export function computeTaskPriorityScore(task: {
  importance: number;
  urgency: number;
  deadline?: string | null;
}, targetDate: Date): number {
  const imp = task.importance <= 5 ? task.importance * 2 : task.importance;
  const urg = task.urgency <= 5 ? task.urgency * 2 : task.urgency;
  const quad = calculateQuadrant(task.importance, task.urgency);

  let baseScore = imp * 1.6 + urg * 1.2;

  if (quad === 'q1') baseScore += 15;
  else if (quad === 'q2') baseScore += 8;
  else if (quad === 'q3') baseScore += 2;

  if (task.deadline) {
    const due = new Date(task.deadline);
    if (!isNaN(due.getTime())) {
      const diffDays = (due.getTime() - targetDate.getTime()) / (1000 * 3600 * 24);
      if (diffDays <= 1) {
        baseScore += 12;
      } else if (diffDays <= 3) {
        baseScore += 6;
      } else if (diffDays <= 7) {
        baseScore += 2;
      }
    }
  }

  return baseScore;
}

/**
 * oxoxox-oxox 单日排程核心算法
 */
function runSingleDaySchedule(
  tasks: Task[],
  fixedEvents: { id: string; title: string; start: Date; end: Date; isAllDay: boolean }[],
  options: ScheduleOptions & {
    releaseTimeMs?: number;
    rolloverTaskIds?: Set<number>;
  }
): {
  scheduledBlocks: ScheduledTaskBlock[];
  scheduledTaskIds: Set<number>;
  unscheduledTaskIds: { taskId: number; remainingMinutes: number; reason: string }[];
} {
  const {
    targetDate,
    workStartHour = 8.0,
    workEndHour = 22.0,
    bufferMinutes = 10,
    taskRestMinutes = 10,
    maxContinuousMinutes = 60,
    maxDailyTaskMinutes = 330,
    autoFilterQ4 = true,
    lunchStartHour = 12.0,
    lunchEndHour = 13.0,
    dinnerStartHour = 18.0,
    dinnerEndHour = 19.0,
    minChunkMinutes = 30,
    allowSplit = true,
    releaseTimeMs,
    rolloverTaskIds,
  } = options;

  const dayStart = new Date(targetDate);
  dayStart.setHours(Math.floor(workStartHour), Math.round((workStartHour % 1) * 60), 0, 0);

  const dayEnd = new Date(targetDate);
  dayEnd.setHours(Math.floor(workEndHour), Math.round((workEndHour % 1) * 60), 0, 0);

  // 当天的固定日历日程 (避开全天日程)
  const dayFixedEvents = fixedEvents
    .filter(e => !e.isAllDay)
    .map(e => {
      const clippedStart = new Date(Math.max(e.start.getTime(), dayStart.getTime()));
      const clippedEnd = new Date(Math.min(e.end.getTime(), dayEnd.getTime()));
      return { ...e, start: clippedStart, end: clippedEnd };
    })
    .filter(e => e.start < e.end)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // 固定日程后预留缓冲
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

  // 自适应午餐 (12:00 ~ 13:00) 与晚餐 (18:00 ~ 19:00) 保护区
  const baseLunchStart = new Date(targetDate);
  baseLunchStart.setHours(Math.floor(lunchStartHour), Math.round((lunchStartHour % 1) * 60), 0, 0);
  const baseLunchEnd = new Date(targetDate);
  baseLunchEnd.setHours(Math.floor(lunchEndHour), Math.round((lunchEndHour % 1) * 60), 0, 0);

  let actualLunchStart = new Date(baseLunchStart);
  for (const ev of dayFixedEvents) {
    if (ev.start < baseLunchEnd && ev.end > actualLunchStart) {
      if (ev.end.getTime() > actualLunchStart.getTime()) {
        actualLunchStart = new Date(ev.end.getTime());
      }
    }
  }
  const actualLunchEnd = new Date(
    Math.min(dayEnd.getTime(), actualLunchStart.getTime() + (lunchEndHour - lunchStartHour) * 3600 * 1000)
  );

  const baseDinnerStart = new Date(targetDate);
  baseDinnerStart.setHours(Math.floor(dinnerStartHour), Math.round((dinnerStartHour % 1) * 60), 0, 0);
  const baseDinnerEnd = new Date(targetDate);
  baseDinnerEnd.setHours(Math.floor(dinnerEndHour), Math.round((dinnerEndHour % 1) * 60), 0, 0);

  let actualDinnerStart = new Date(baseDinnerStart);
  for (const ev of dayFixedEvents) {
    if (ev.start < baseDinnerEnd && ev.end > actualDinnerStart) {
      if (ev.end.getTime() > actualDinnerStart.getTime()) {
        actualDinnerStart = new Date(ev.end.getTime());
      }
    }
  }
  const actualDinnerEnd = new Date(
    Math.min(dayEnd.getTime(), actualDinnerStart.getTime() + (dinnerEndHour - dinnerStartHour) * 3600 * 1000)
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

  // 合并所有占用区间并反求空闲槽
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
      const durationMin = Math.round((busy.start.getTime() - currentCursor.getTime()) / 60000);
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
    const durationMin = Math.round((dayEnd.getTime() - currentCursor.getTime()) / 60000);
    if (durationMin >= 15) {
      rawFreeSlots.push({
        start: new Date(currentCursor),
        end: new Date(dayEnd),
        durationMinutes: durationMin,
      });
    }
  }

  // 14:30 黄金深度区切分
  const afternoonPivot = new Date(targetDate);
  afternoonPivot.setHours(14, 30, 0, 0);

  const workingFreeSlots: TimeSlot[] = [];
  for (const slot of rawFreeSlots) {
    if (slot.start.getTime() < afternoonPivot.getTime() && slot.end.getTime() > afternoonPivot.getTime()) {
      const beforeMin = Math.round((afternoonPivot.getTime() - slot.start.getTime()) / 60000);
      const afterMin = Math.round((slot.end.getTime() - afternoonPivot.getTime()) / 60000);
      if (beforeMin >= 30 && afterMin >= 90) {
        workingFreeSlots.push({
          start: new Date(slot.start),
          end: new Date(afternoonPivot),
          durationMinutes: beforeMin,
          energyZone: classifySlotEnergy(slot.start, beforeMin),
        });
        workingFreeSlots.push({
          start: new Date(afternoonPivot),
          end: new Date(slot.end),
          durationMinutes: afterMin,
          energyZone: classifySlotEnergy(afternoonPivot, afterMin),
        });
        continue;
      }
    }
    workingFreeSlots.push({
      start: new Date(slot.start),
      end: new Date(slot.end),
      durationMinutes: slot.durationMinutes,
      energyZone: classifySlotEnergy(slot.start, slot.durationMinutes),
    });
  }

  const refreshSlots = () => {
    for (const s of workingFreeSlots) {
      s.durationMinutes = Math.max(0, Math.round((s.end.getTime() - s.start.getTime()) / 60000));
      if (s.durationMinutes > 0) {
        s.energyZone = classifySlotEnergy(s.start, s.durationMinutes);
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

  const targetDateStr = formatLocalDate(targetDate);
  const todayStr = formatLocalDate(new Date());

  // 过滤当天候选任务
  const pendingTasks = tasks.filter(t => {
    if (t.status === 'completed') return false;
    if (targetDateStr < todayStr) return false;
    if (t.deadline) {
      const ddlStr = t.deadline.slice(0, 10);
      if (targetDateStr > ddlStr && targetDateStr > todayStr && !rolloverTaskIds?.has(t.id)) {
        return false;
      }
    }
    return true;
  });

  const scheduledBlocks: ScheduledTaskBlock[] = [];
  const scheduledTaskIds = new Set<number>();
  const unscheduledTaskIds: { taskId: number; remainingMinutes: number; reason: string }[] = [];

  const activeCandidates: Task[] = [];
  for (const task of pendingTasks) {
    const quad = calculateQuadrant(task.importance, task.urgency);
    if (autoFilterQ4 && quad === 'q4') {
      unscheduledTaskIds.push({
        taskId: task.id,
        remainingMinutes: task.duration_minutes || 45,
        reason: '象限 IV（不重要不紧急）：默认不自动侵占核心专注日程',
      });
    } else {
      activeCandidates.push(task);
    }
  }

  const getPriority = (t: Task) => {
    const base = computeTaskPriorityScore(t, targetDate);
    return rolloverTaskIds?.has(t.id) ? base + 10 : base;
  };

  const deepTasks = activeCandidates
    .filter(t => {
      const q = calculateQuadrant(t.importance, t.urgency);
      return q === 'q1' || q === 'q2';
    })
    .sort((a, b) => getPriority(b) - getPriority(a));

  const shallowTasks = activeCandidates
    .filter(t => {
      const q = calculateQuadrant(t.importance, t.urgency);
      return q === 'q3' || (q !== 'q1' && q !== 'q2');
    })
    .sort((a, b) => getPriority(b) - getPriority(a));

  const orderedQueue = [...deepTasks, ...shallowTasks];

  let dailyScheduledMinutes = 0;
  const hardDailyCapMinutes = maxDailyTaskMinutes + 30;

  const scoreSlotForTask = (slot: TimeSlot, task: Task, requiredSpanMinutes: number, isContiguousFit: boolean): number => {
    const zone = slot.energyZone || classifySlotEnergy(slot.start, slot.durationMinutes);
    const quad = calculateQuadrant(task.importance, task.urgency);
    let score = 0;

    if (quad === 'q1' || quad === 'q2') {
      if (zone === 'peak') score += 200;
      else if (zone === 'moderate') score += 120;
      else if (zone === 'low') score += 50;
      else score += 10;

      if (isContiguousFit) {
        score += 100;
        const slack = slot.durationMinutes - requiredSpanMinutes;
        score += Math.max(0, 60 - slack * 0.25);
      }

      const hourOfDay = slot.start.getHours() + slot.start.getMinutes() / 60;
      if (quad === 'q1') {
        score += Math.max(0, (22 - hourOfDay) * 4);
      } else {
        score += Math.max(0, (22 - hourOfDay) * 1.5);
      }
    } else {
      if (zone === 'fragment') score += 220;
      else if (zone === 'low') score += 190;
      else if (zone === 'moderate') score += 130;
      else score += 60;

      if (isContiguousFit) {
        const slack = slot.durationMinutes - requiredSpanMinutes;
        score += Math.max(0, 90 - slack * 0.6);
      }
    }

    return score;
  };

  const allocateSessionsInSlot = (
    slot: TimeSlot,
    sessionsToAllocate: number[],
    allocatedList: { start: Date; end: Date; duration: number; zone: EnergyZoneType; breakAfter: number }[]
  ) => {
    const initialZone = slot.energyZone || classifySlotEnergy(slot.start, slot.durationMinutes);

    for (const sessionMin of sessionsToAllocate) {
      if (slot.durationMinutes < sessionMin) break;

      const blockStart = new Date(slot.start);
      const blockEnd = new Date(blockStart.getTime() + sessionMin * 60 * 1000);

      let breakAfter = 0;
      const breakEnd = new Date(blockEnd.getTime() + taskRestMinutes * 60 * 1000);
      if (breakEnd.getTime() <= slot.end.getTime()) {
        breakAfter = taskRestMinutes;
        slot.start = breakEnd;
      } else {
        slot.start = new Date(blockEnd);
      }

      allocatedList.push({
        start: blockStart,
        end: blockEnd,
        duration: sessionMin,
        zone: initialZone,
        breakAfter,
      });

      dailyScheduledMinutes += sessionMin;
      refreshSlots();
    }
  };

  for (const task of orderedQueue) {
    const totalTaskMinutes = task.duration_minutes > 0 ? task.duration_minutes : 45;

    if (dailyScheduledMinutes >= maxDailyTaskMinutes) {
      unscheduledTaskIds.push({
        taskId: task.id,
        remainingMinutes: totalTaskMinutes,
        reason: `今日自主专注负荷已达上限 (${Math.round((maxDailyTaskMinutes / 60) * 10) / 10}h)，自动顺延至次日`,
      });
      continue;
    }

    const remainingCapacity = hardDailyCapMinutes - dailyScheduledMinutes;
    if (remainingCapacity < 20) {
      unscheduledTaskIds.push({
        taskId: task.id,
        remainingMinutes: totalTaskMinutes,
        reason: `今日自主专注负荷已达上限 (${Math.round((maxDailyTaskMinutes / 60) * 10) / 10}h)，自动顺延至次日`,
      });
      continue;
    }

    const plannedSessions = splitIntoFocusSessions(totalTaskMinutes, maxContinuousMinutes);
    const totalContiguousSpan =
      plannedSessions.reduce((acc, m) => acc + m, 0) +
      Math.max(0, plannedSessions.length - 1) * taskRestMinutes;

    const partsAllocated: {
      start: Date;
      end: Date;
      duration: number;
      zone: EnergyZoneType;
      breakAfter: number;
    }[] = [];

    // 尝试寻找单个最贴合的连续槽
    let bestContiguousSlot: TimeSlot | null = null;
    let bestContiguousScore = -Infinity;

    for (const slot of workingFreeSlots) {
      if (slot.durationMinutes >= totalContiguousSpan) {
        const score = scoreSlotForTask(slot, task, totalContiguousSpan, true);
        if (score > bestContiguousScore) {
          bestContiguousScore = score;
          bestContiguousSlot = slot;
        }
      }
    }

    if (bestContiguousSlot && totalTaskMinutes <= remainingCapacity) {
      allocateSessionsInSlot(bestContiguousSlot, plannedSessions, partsAllocated);
    } else if (allowSplit) {
      let remainingToSchedule = Math.min(totalTaskMinutes, remainingCapacity);

      while (remainingToSchedule > 0) {
        const desiredSession = splitIntoFocusSessions(remainingToSchedule, maxContinuousMinutes)[0];

        let chosenSlot: TimeSlot | null = null;
        let chosenScore = -Infinity;

        for (const slot of workingFreeSlots) {
          if (slot.durationMinutes >= desiredSession) {
            const score = scoreSlotForTask(slot, task, desiredSession, true);
            if (score > chosenScore) {
              chosenScore = score;
              chosenSlot = slot;
            }
          }
        }

        if (chosenSlot) {
          allocateSessionsInSlot(chosenSlot, [desiredSession], partsAllocated);
          remainingToSchedule -= desiredSession;
        } else {
          let fallbackSlot: TimeSlot | null = null;
          let fallbackScore = -Infinity;
          const effectiveMinChunk = Math.min(minChunkMinutes, remainingToSchedule);

          for (const slot of workingFreeSlots) {
            if (slot.durationMinutes >= effectiveMinChunk && slot.durationMinutes >= 20) {
              const score = scoreSlotForTask(slot, task, slot.durationMinutes, false) + slot.durationMinutes;
              if (score > fallbackScore) {
                fallbackScore = score;
                fallbackSlot = slot;
              }
            }
          }

          if (fallbackSlot) {
            const allocMin = Math.min(fallbackSlot.durationMinutes, remainingToSchedule, maxContinuousMinutes);
            allocateSessionsInSlot(fallbackSlot, [allocMin], partsAllocated);
            remainingToSchedule -= allocMin;
          } else {
            break;
          }
        }
      }
    }

    const allocatedMinutesSum = partsAllocated.reduce((acc, p) => acc + p.duration, 0);
    const unscheduledMin = Math.max(0, totalTaskMinutes - allocatedMinutesSum);

    if (partsAllocated.length > 0) {
      const quad = calculateQuadrant(task.importance, task.urgency);
      const totalParts = partsAllocated.length;
      const isMultiSession = totalParts > 1;

      partsAllocated.forEach((p, idx) => {
        scheduledBlocks.push({
          id: `sched-${task.id}-p${idx + 1}-${p.start.getTime()}`,
          taskId: task.id,
          title: isMultiSession ? `${task.title} (专注节 ${idx + 1}/${totalParts})` : task.title,
          start: p.start,
          end: p.end,
          durationMinutes: p.duration,
          partIndex: idx + 1,
          totalParts,
          isSplit: isMultiSession,
          quadrant: quad,
          importance: task.importance,
          urgency: task.urgency,
          energyZone: p.zone,
          strategyLabel: getStrategyLabel(p.zone, quad, isMultiSession),
          breakAfterMinutes: p.breakAfter > 0 ? p.breakAfter : undefined,
        });
      });

      scheduledTaskIds.add(task.id);
    }

    if (unscheduledMin > 0) {
      unscheduledTaskIds.push({
        taskId: task.id,
        remainingMinutes: unscheduledMin,
        reason: '当天专注负荷达上限或无合适空闲槽，自动顺延',
      });
    }
  }

  return {
    scheduledBlocks,
    scheduledTaskIds,
    unscheduledTaskIds,
  };
}

/**
 * 依据用户配置与 oxoxox 算法执行全局多日滚动智能排程
 */
export function replanUserTasks(userId: number): {
  success: boolean;
  totalTasks: number;
  scheduledCount: number;
  failedCount: number;
  tasks: Task[];
  summary: string;
} {
  const activeTasks = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ? AND status IN ('scheduled', 'pending', 'pending_slot', 'in_progress')
  `).all(userId) as Task[];

  if (activeTasks.length === 0) {
    return {
      success: true,
      totalTasks: 0,
      scheduledCount: 0,
      failedCount: 0,
      tasks: [],
      summary: '暂无可排程的待办事项',
    };
  }

  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings | undefined;

  let workStartHour = 8.0;
  let workEndHour = 22.0;

  if (settings && settings.work_slots) {
    try {
      const parsedSlots: WorkSlot[] = JSON.parse(settings.work_slots);
      if (Array.isArray(parsedSlots) && parsedSlots.length > 0) {
        const starts = parsedSlots.map(s => {
          const [h, m] = s.start.split(':').map(Number);
          return h + (m || 0) / 60;
        });
        const ends = parsedSlots.map(s => {
          const [h, m] = s.end.split(':').map(Number);
          return h === 0 || h === 24 ? 24 : h + (m || 0) / 60;
        });
        workStartHour = Math.min(...starts);
        workEndHour = Math.max(...ends);
      }
    } catch {}
  }

  const bufferMinutes = settings?.task_buffer_minutes ?? 10;
  const now = new Date();
  const horizonDays = 14;

  // 获取外部日程
  const horizonEnd = new Date(now.getTime() + horizonDays * 86400000);
  const rawExternalEvents = db.prepare(`
    SELECT id, title, start_time, end_time, is_all_day
    FROM external_events
    WHERE user_id = ? AND end_time >= ? AND start_time <= ?
    ORDER BY start_time ASC
  `).all(userId, now.toISOString(), horizonEnd.toISOString()) as any[];

  const parsedFixedEvents = rawExternalEvents.map(e => ({
    id: String(e.id),
    title: e.title,
    start: new Date(e.start_time),
    end: new Date(e.end_time),
    isAllDay: Boolean(e.is_all_day),
  }));

  // 对齐当前时间至 5 分钟刻度下界
  const releaseTimeMsToday = Math.ceil(now.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000);

  const taskMap = new Map<number, Task>(activeTasks.map(t => [t.id, t]));
  const taskAllocations = new Map<number, ScheduledTaskBlock[]>();

  let remainingTaskIds = new Set<number>(activeTasks.map(t => t.id));
  let rolloverTaskIds = new Set<number>();

  for (let dayOffset = 0; dayOffset < horizonDays; dayOffset++) {
    if (remainingTaskIds.size === 0) break;

    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + dayOffset);

    const candidates = Array.from(remainingTaskIds)
      .map(id => taskMap.get(id)!)
      .filter(Boolean);

    const dayResult = runSingleDaySchedule(candidates, parsedFixedEvents, {
      targetDate,
      workStartHour,
      workEndHour,
      bufferMinutes,
      taskRestMinutes: 10,
      maxContinuousMinutes: 60,
      maxDailyTaskMinutes: 330,
      autoFilterQ4: true,
      lunchStartHour: 12.0,
      lunchEndHour: 13.0,
      dinnerStartHour: 18.0,
      dinnerEndHour: 19.0,
      minChunkMinutes: 30,
      allowSplit: true,
      releaseTimeMs: dayOffset === 0 ? releaseTimeMsToday : undefined,
      rolloverTaskIds,
    });

    for (const block of dayResult.scheduledBlocks) {
      if (!taskAllocations.has(block.taskId)) {
        taskAllocations.set(block.taskId, []);
      }
      taskAllocations.get(block.taskId)!.push(block);
    }

    for (const scheduledId of dayResult.scheduledTaskIds) {
      remainingTaskIds.delete(scheduledId);
      rolloverTaskIds.delete(scheduledId);
    }

    // 次日顺延
    const nextRollover = new Set<number>();
    for (const unsched of dayResult.unscheduledTaskIds) {
      if (!unsched.reason.includes('象限 IV')) {
        nextRollover.add(unsched.taskId);
      }
    }
    rolloverTaskIds = nextRollover;
  }

  // 批量持久化到 SQLite 数据库
  let scheduledCount = 0;
  let failedCount = 0;

  for (const t of activeTasks) {
    const blocks = taskAllocations.get(t.id);
    if (blocks && blocks.length > 0) {
      const sortedBlocks = [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
      const firstStart = sortedBlocks[0].start.toISOString();
      const lastEnd = sortedBlocks[sortedBlocks.length - 1].end.toISOString();

      const blockPayload = sortedBlocks.map(b => ({
        start: b.start.toISOString(),
        end: b.end.toISOString(),
        duration: b.durationMinutes,
        partIndex: b.partIndex,
        totalParts: b.totalParts,
        energyZone: b.energyZone,
        strategyLabel: b.strategyLabel,
        breakAfterMinutes: b.breakAfterMinutes,
      }));

      db.prepare(`
        UPDATE tasks
        SET scheduled_start = ?,
            scheduled_end = ?,
            schedule_blocks = ?,
            status = 'scheduled',
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(firstStart, lastEnd, JSON.stringify(blockPayload), t.id);

      t.scheduled_start = firstStart;
      t.scheduled_end = lastEnd;
      t.schedule_blocks = JSON.stringify(blockPayload);
      t.status = 'scheduled';
      scheduledCount++;
    } else {
      db.prepare(`
        UPDATE tasks
        SET scheduled_start = NULL,
            scheduled_end = NULL,
            schedule_blocks = NULL,
            status = 'pending_slot',
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(t.id);

      t.scheduled_start = null;
      t.scheduled_end = null;
      t.schedule_blocks = null;
      t.status = 'pending_slot';
      failedCount++;
    }
  }

  const allUpdatedTasks = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ? AND status IN ('scheduled', 'in_progress', 'completed')
    ORDER BY scheduled_start ASC
  `).all(userId) as Task[];

  return {
    success: true,
    totalTasks: activeTasks.length,
    scheduledCount,
    failedCount,
    tasks: allUpdatedTasks,
    summary: `智能排程完成：共将 ${scheduledCount} 项任务排入日历${failedCount > 0 ? `，${failedCount} 项待办未分配` : ''}`,
  };
}

/**
 * 针对单任务执行智能规划排程（基于 oxoxox 算法）
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
  // 若任务已在库中，直接触发全局自适应重排保证无缝对齐
  if (task.id) {
    const res = replanUserTasks(userId);
    const updated = res.tasks.find(t => t.id === task.id);
    if (updated && updated.scheduled_start && updated.scheduled_end) {
      return {
        success: true,
        scheduled_start: updated.scheduled_start,
        scheduled_end: updated.scheduled_end,
        schedule_blocks: updated.schedule_blocks || undefined,
        message: '排程计算成功并已排入日历',
      };
    }
  }

  // 临时任务模拟排程（例如创建前预排）
  const activeTasks = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ? AND status IN ('scheduled', 'pending', 'pending_slot', 'in_progress')
  `).all(userId) as Task[];

  const simTask: Task = {
    id: task.id || -999,
    user_id: userId,
    title: task.title,
    duration_minutes: task.duration_minutes,
    urgency: task.urgency,
    importance: task.importance,
    deadline: task.deadline || null,
    scheduled_start: null,
    scheduled_end: null,
    status: 'scheduled',
    start_reminder_sent: 0,
    end_reminder_sent: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const simTasks = [simTask, ...activeTasks];

  const now = new Date();
  const rawExternalEvents = db.prepare(`
    SELECT id, title, start_time, end_time, is_all_day
    FROM external_events
    WHERE user_id = ? AND end_time >= ?
    ORDER BY start_time ASC
  `).all(userId, now.toISOString()) as any[];

  const parsedFixedEvents = rawExternalEvents.map(e => ({
    id: String(e.id),
    title: e.title,
    start: new Date(e.start_time),
    end: new Date(e.end_time),
    isAllDay: Boolean(e.is_all_day),
  }));

  const releaseTimeMsToday = Math.ceil(now.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000);

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + dayOffset);

    const dayResult = runSingleDaySchedule(simTasks, parsedFixedEvents, {
      targetDate,
      workStartHour: 8.0,
      workEndHour: 22.0,
      bufferMinutes: 10,
      taskRestMinutes: 10,
      maxContinuousMinutes: 60,
      maxDailyTaskMinutes: 330,
      autoFilterQ4: false,
      releaseTimeMs: dayOffset === 0 ? releaseTimeMsToday : undefined,
    });

    const blocks = dayResult.scheduledBlocks.filter(b => b.taskId === simTask.id);
    if (blocks.length > 0) {
      const sorted = [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
      const sStart = sorted[0].start.toISOString();
      const sEnd = sorted[sorted.length - 1].end.toISOString();
      const blockPayload = sorted.map(b => ({
        start: b.start.toISOString(),
        end: b.end.toISOString(),
        duration: b.durationMinutes,
        partIndex: b.partIndex,
        totalParts: b.totalParts,
        energyZone: b.energyZone,
        strategyLabel: b.strategyLabel,
        breakAfterMinutes: b.breakAfterMinutes,
      }));

      return {
        success: true,
        scheduled_start: sStart,
        scheduled_end: sEnd,
        schedule_blocks: JSON.stringify(blockPayload),
        message: '排程计算成功',
      };
    }
  }

  return {
    success: false,
    message: '在未来14天的工作时间与空闲槽范围内，未找到合适的时间段。',
  };
}
