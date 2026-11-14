import { formatLocalDate, isTaskLastDay } from '../types/task';
import type { TaskItem } from '../types/task';
import type {
  CalendarEvent,
  TimeSlot,
  ScheduledTaskBlock,
  RestBlock,
  DayScheduleResult,
  EnergyZoneType,
} from '../types/calendar';

export interface ScheduleOptions {
  targetDate: Date;
  workStartHour?: number;          // 默认 08:00
  workEndHour?: number;            // 默认 22:00
  bufferMinutes?: number;          // 固定课程/会议后过渡缓冲，默认 10 分钟
  taskRestMinutes?: number;        // 专注周期/任务间歇休息，默认 10 分钟
  maxContinuousMinutes?: number;   // 单次最长连续专注时长上限，默认 60 分钟 (Ultradian Rhythm)
  maxDailyTaskMinutes?: number;    // 每日自主待办最大负荷上限，默认 330 分钟 (5.5h，弹性至 6h)
  autoFilterQ4?: boolean;          // 是否默认过滤 Q4 不自动排程，默认 true
  lunchStartHour?: number;         // 默认 12.0
  lunchEndHour?: number;           // 默认 13.0
  dinnerStartHour?: number;        // 默认 18.0
  dinnerEndHour?: number;          // 默认 19.0
  minChunkMinutes?: number;        // 跨槽拆分时的最小单块时长，默认 30 分钟
  allowSplit?: boolean;            // 当全天无单槽可完整容纳时，是否允许跨槽拆分
}

/**
 * 将长耗时任务按生理专注极限（默认 60 分钟）切分为合理的专注小节（Focus Sessions）
 * - 若总时长 <= 60m：保持单节不拆分
 * - 若总时长 > 60m：每满 60m 切分一节；若最后一节尾块 < 20m（如 70m -> 60m + 10m），
 *   则将最后两节均衡化（如 70m -> 40m + 30m），避免产生过于细碎的尾巴
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
      // 均衡拆分最后两节（按 5 分钟粒度对齐）
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
 * 判定某个空闲槽所属的生理精力能级（Energy Zone）
 */
function classifySlotEnergy(start: Date, durationMinutes: number): EnergyZoneType {
  if (durationMinutes < 45) {
    return 'fragment'; // 课间或会议间的短碎片（<45m）
  }
  const startHour = start.getHours() + start.getMinutes() / 60;
  // 午后犯困恢复期：13:00 ~ 14:30
  if (startHour >= 12.8 && startHour < 14.4) {
    return 'low';
  }
  // 黄金深度专注期：上午 08:00~12:00，下午 14:30~18:00
  if ((startHour >= 7.5 && startHour < 12.0) || (startHour >= 14.4 && startHour < 18.0)) {
    return 'peak';
  }
  // 晚间常规推进期：18:30 ~ 22:00
  return 'moderate';
}

function getStrategyLabel(zone: EnergyZoneType, quadrant: string, isSessionSplit: boolean): string {
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
 * 计算任务的综合排程优先级得分（融合四象限属性、重要度、紧迫度与 EDF 截止期迫近度）
 */
function computeTaskPriorityScore(task: TaskItem, targetDate: Date): number {
  let baseScore = task.importance * 1.6 + task.urgency * 1.2;

  // 象限层级基准加权：Q1 危机/立即做 > Q2 深度核心 > Q3 浅层速办
  if (task.quadrant === 'q1') baseScore += 15;
  else if (task.quadrant === 'q2') baseScore += 8;
  else if (task.quadrant === 'q3') baseScore += 2;

  // EDF (Earliest Deadline First) 截止期临近加权
  if (task.dueDate) {
    const due = new Date(task.dueDate + 'T23:59:59');
    const diffDays = (due.getTime() - targetDate.getTime()) / (1000 * 3600 * 24);
    if (diffDays <= 1) {
      baseScore += 12; // 今日或已逾期：极高优先
    } else if (diffDays <= 3) {
      baseScore += 6;  // 3天内到期
    } else if (diffDays <= 7) {
      baseScore += 2;
    }
  }

  return baseScore;
}

export interface TimelineLayoutBox {
  id: string;
  colIndex: number;
  totalCols: number;
  colSpan: number;
  leftPercent: number;
  widthPercent: number;
}

/**
 * 扫描线 + 区间图着色分栏算法 (Sweep-Line Clustering + Interval Graph Coloring)
 * 复杂度 O(N log N)，用于解决日历视图中重叠或紧凑日程的左右分栏自适应宽度排版
 */
export function computeTimelineLayout<T extends { id: string; start: Date; end: Date }>(
  items: T[],
  minVisualMinutes: number = 18
): Map<string, TimelineLayoutBox> {
  const layoutMap = new Map<string, TimelineLayoutBox>();
  if (items.length === 0) return layoutMap;

  // 归一化时间区间（保证最小视觉高度对应的时长，防止极短块在视觉上与下方块重叠）
  const normalized = items
    .map((item) => {
      const startMs = item.start.getTime();
      const rawEndMs = item.end.getTime();
      const minEndMs = startMs + minVisualMinutes * 60 * 1000;
      return {
        id: item.id,
        startMs,
        endMs: Math.max(rawEndMs, minEndMs),
      };
    })
    .sort((a, b) => {
      if (a.startMs !== b.startMs) return a.startMs - b.startMs;
      return b.endMs - a.endMs; // 同起点时，长事件优先排在左侧列
    });

  // Step 1: 扫描线算法切分独立冲突连通分量 (Clusters)
  type NormItem = (typeof normalized)[number];
  const clusters: NormItem[][] = [];
  let currentCluster: NormItem[] = [];
  let clusterMaxEnd = -Infinity;

  for (const item of normalized) {
    if (currentCluster.length === 0) {
      currentCluster.push(item);
      clusterMaxEnd = item.endMs;
    } else if (item.startMs < clusterMaxEnd) {
      // 与当前簇存在时间交集
      currentCluster.push(item);
      if (item.endMs > clusterMaxEnd) {
        clusterMaxEnd = item.endMs;
      }
    } else {
      // 当前活跃集归零，封存独立簇
      clusters.push(currentCluster);
      currentCluster = [item];
      clusterMaxEnd = item.endMs;
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  // Step 2: 在每个独立冲突簇内执行贪心区间图着色 (Greedy Column Assignment) 与向右跨列扩展
  for (const cluster of clusters) {
    // columns[c] 记录第 c 列当前排入的所有项
    const columns: NormItem[][] = [];
    const itemColMap = new Map<string, number>();

    for (const item of cluster) {
      let assignedCol = -1;
      for (let c = 0; c < columns.length; c++) {
        const lastInCol = columns[c][columns[c].length - 1];
        if (lastInCol.endMs <= item.startMs) {
          assignedCol = c;
          columns[c].push(item);
          break;
        }
      }
      if (assignedCol === -1) {
        assignedCol = columns.length;
        columns.push([item]);
      }
      itemColMap.set(item.id, assignedCol);
    }

    const totalCols = columns.length;

    // Step 3: 向右跨列扩展 (Column Span Expansion)
    for (const item of cluster) {
      const colIndex = itemColMap.get(item.id) ?? 0;
      let colSpan = 1;

      for (let nextCol = colIndex + 1; nextCol < totalCols; nextCol++) {
        const hasConflictInNextCol = columns[nextCol].some(
          (other) => other.startMs < item.endMs && other.endMs > item.startMs
        );
        if (hasConflictInNextCol) {
          break;
        }
        colSpan++;
      }

      const totalUsableWidth = 97; // 左右各留 1.5% 边距
      const baseColWidth = totalUsableWidth / totalCols;
      const gapPct = totalCols > 1 ? 0.5 : 0;
      const leftPercent = 1.5 + colIndex * baseColWidth;
      const widthPercent = Math.max(10, colSpan * baseColWidth - gapPct);

      layoutMap.set(item.id, {
        id: item.id,
        colIndex,
        totalCols,
        colSpan,
        leftPercent,
        widthPercent,
      });
    }
  }

  return layoutMap;
}

/**
 * 单日排程核心执行器（支持传入当日释放时间基线 releaseTimeMs 与跨日顺延加权）
 */
function runSingleDaySchedule(
  tasks: TaskItem[],
  fixedEvents: CalendarEvent[],
  options: ScheduleOptions & {
    releaseTimeMs?: number;
    rolloverTaskIds?: Set<string>;
  }
): DayScheduleResult {
  const {
    targetDate,
    workStartHour = 8.0,
    workEndHour = 22.0,
    bufferMinutes = 10,
    taskRestMinutes = 10,
    maxContinuousMinutes = 60,
    maxDailyTaskMinutes = 330, // 默认 5.5 小时自主专注上限
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

  // 1. 构造当天工作时间边界
  const dayStart = new Date(targetDate);
  dayStart.setHours(Math.floor(workStartHour), Math.round((workStartHour % 1) * 60), 0, 0);

  const dayEnd = new Date(targetDate);
  dayEnd.setHours(Math.floor(workEndHour), Math.round((workEndHour % 1) * 60), 0, 0);

  // 2. 提取当天的固定日历日程
  const dayFixedEvents = fixedEvents
    .filter((e) => !e.isAllDay)
    .map((e) => {
      const clippedStart = new Date(Math.max(e.start.getTime(), dayStart.getTime()));
      const clippedEnd = new Date(Math.min(e.end.getTime(), dayEnd.getTime()));
      return {
        ...e,
        start: clippedStart,
        end: clippedEnd,
      };
    })
    .filter((e) => e.start < e.end)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // 独立渲染的休息卡片仅保留午休与晚餐（>=30m），10m 课间/番茄钟缓冲转为内联留白，彻底消除 12px 细条挤压
  const visualRestBlocks: RestBlock[] = [];
  const internalBufferIntervals: { start: Date; end: Date; durationMinutes: number }[] = [];

  // 固定日程后自动预留课间/会后内联缓冲 (bufferMinutes = 10m)
  for (const ev of dayFixedEvents) {
    if (bufferMinutes > 0 && ev.end.getTime() < dayEnd.getTime()) {
      const bufEnd = new Date(Math.min(dayEnd.getTime(), ev.end.getTime() + bufferMinutes * 60 * 1000));
      const overlapsNext = dayFixedEvents.some(
        (other) => other.id !== ev.id && other.start.getTime() < bufEnd.getTime() && other.end.getTime() > ev.end.getTime()
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

  // 3. 构造午餐保护区 (12:00 ~ 13:00) 与晚餐保护区 (18:00 ~ 19:00)，自适应避让拖堂或课程
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

  if (actualLunchEnd > actualLunchStart) {
    visualRestBlocks.push({
      id: `rest-lunch-${targetDate.getTime()}`,
      type: 'lunch',
      title: '午间休息 (Lunch Break)',
      start: actualLunchStart,
      end: actualLunchEnd,
      durationMinutes: Math.round((actualLunchEnd.getTime() - actualLunchStart.getTime()) / 60000),
    });
  }

  if (actualDinnerEnd > actualDinnerStart) {
    visualRestBlocks.push({
      id: `rest-dinner-${targetDate.getTime()}`,
      type: 'dinner',
      title: '晚间休息 (Dinner Break)',
      start: actualDinnerStart,
      end: actualDinnerEnd,
      durationMinutes: Math.round((actualDinnerEnd.getTime() - actualDinnerStart.getTime()) / 60000),
    });
  }

  // 4. 合并所有不可动区间（固定课程 + 课后内联缓冲 + 午晚餐）并求逆得到纯净空闲区间
  const allBusyEntities: { start: Date; end: Date }[] = [
    ...dayFixedEvents.map((e) => ({ start: e.start, end: e.end })),
    ...visualRestBlocks.map((r) => ({ start: r.start, end: r.end })),
    ...internalBufferIntervals.map((b) => ({ start: b.start, end: b.end })),
  ].sort((a, b) => a.start.getTime() - b.start.getTime());

  const mergedBusyIntervals: { start: Date; end: Date }[] = [];
  for (const entity of allBusyEntities) {
    if (mergedBusyIntervals.length === 0) {
      mergedBusyIntervals.push({ start: new Date(entity.start), end: new Date(entity.end) });
    } else {
      const last = mergedBusyIntervals[mergedBusyIntervals.length - 1];
      if (entity.start.getTime() <= last.end.getTime()) {
        if (entity.end.getTime() > last.end.getTime()) {
          last.end = new Date(entity.end);
        }
      } else {
        mergedBusyIntervals.push({ start: new Date(entity.start), end: new Date(entity.end) });
      }
    }
  }

  const rawFreeSlots: TimeSlot[] = [];
  let currentCursor = new Date(dayStart);

  for (const busy of mergedBusyIntervals) {
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

  // 5. 生理节律分界切分：若下午大块空闲跨越 14:30（且 14:30 前 >= 30m，14:30 后 >= 90m），
  //    则在 14:30 处划分为「午后恢复区 (13:00~14:30)」与「下午黄金深度区 (14:30~18:00)」
  const afternoonPivot = new Date(targetDate);
  afternoonPivot.setHours(14, 30, 0, 0);

  const workingFreeSlots: TimeSlot[] = [];
  for (const slot of rawFreeSlots) {
    if (
      slot.start.getTime() < afternoonPivot.getTime() &&
      slot.end.getTime() > afternoonPivot.getTime()
    ) {
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

  // 辅助函数：实时更新所有剩余空闲槽的时长与精力标签
  const refreshSlots = () => {
    for (const s of workingFreeSlots) {
      s.durationMinutes = Math.max(0, Math.round((s.end.getTime() - s.start.getTime()) / 60000));
      if (s.durationMinutes > 0) {
        s.energyZone = classifySlotEnergy(s.start, s.durationMinutes);
      }
    }
  };

  // 将空闲槽裁剪到指定释放时间 releaseTimeMs 之后（用于满足未完成任务 r_j >= t_now 约束）
  const clampSlotsToReleaseTime = (minStartMs: number) => {
    for (const s of workingFreeSlots) {
      if (s.end.getTime() <= minStartMs) {
        s.start = new Date(s.end);
      } else if (s.start.getTime() < minStartMs) {
        s.start = new Date(minStartMs);
      }
    }
    refreshSlots();
  };

  // 6. 待办事项分类与多维优先级排序
  const targetDateStr = formatLocalDate(targetDate);
  const todayStr = formatLocalDate(new Date());

  // 过去日期：只展示在当天实际打卡完成的任务，不把未完成任务排进过去的日子
  const pendingTasks = tasks.filter((t) => {
    if (t.completedDates?.includes(targetDateStr)) {
      return true;
    }
    if (targetDateStr < todayStr) {
      return false;
    }
    if (t.isCompleted) {
      return false;
    }
    // 若任务是由前序日期顺延下来的 (rolloverTaskIds)，即使超过原定 dueDate 也允许在次日继续排入
    if (t.dueDate && targetDateStr > t.dueDate && targetDateStr > todayStr && !rolloverTaskIds?.has(t.id)) {
      return false;
    }
    return true;
  });

  const scheduledTasks: ScheduledTaskBlock[] = [];
  const unscheduledTasks: { taskId: string; title: string; remainingMinutes: number; reason: string }[] = [];

  // 6.1 拦截 Q4（不重要且不紧急）任务
  const activeCandidates: TaskItem[] = [];
  for (const task of pendingTasks) {
    if (autoFilterQ4 && task.quadrant === 'q4' && !task.completedDates?.includes(targetDateStr)) {
      const est = task.estimatedMinutes && task.estimatedMinutes > 0 ? task.estimatedMinutes : 45;
      unscheduledTasks.push({
        taskId: task.id,
        title: task.title,
        remainingMinutes: est,
        reason: '象限 IV（不重要不紧急）：默认不自动侵占核心专注日程',
      });
    } else {
      activeCandidates.push(task);
    }
  }

  const getPriorityWithRollover = (t: TaskItem) => {
    const base = computeTaskPriorityScore(t, targetDate);
    return rolloverTaskIds?.has(t.id) ? base + 10 : base;
  };

  // 已在当天打卡完成的任务优先按全天槽位排入，随后应用 r_j >= t_now 释放时间约束排入未完成任务
  const completedOnDayCandidates = activeCandidates
    .filter((t) => t.completedDates?.includes(targetDateStr))
    .sort((a, b) => getPriorityWithRollover(b) - getPriorityWithRollover(a));

  const uncompletedCandidates = activeCandidates.filter(
    (t) => !t.completedDates?.includes(targetDateStr)
  );

  const deepTasks = uncompletedCandidates
    .filter((t) => t.quadrant === 'q1' || t.quadrant === 'q2')
    .sort((a, b) => getPriorityWithRollover(b) - getPriorityWithRollover(a));

  const shallowTasks = uncompletedCandidates
    .filter((t) => t.quadrant === 'q3' || (t.quadrant !== 'q1' && t.quadrant !== 'q2'))
    .sort((a, b) => getPriorityWithRollover(b) - getPriorityWithRollover(a));

  const orderedQueue = [...completedOnDayCandidates, ...deepTasks, ...shallowTasks];

  let dailyScheduledMinutes = 0;
  let totalTaskBreakMinutes = 0;
  const hardDailyCapMinutes = maxDailyTaskMinutes + 30;
  let hasAppliedReleaseClamp = false;

  /**
   * 为指定任务评估某个空闲槽的匹配得分（分数越高越契合）
   */
  const scoreSlotForTask = (
    slot: TimeSlot,
    task: TaskItem,
    requiredSpanMinutes: number,
    isContiguousFit: boolean
  ): number => {
    const zone = slot.energyZone || classifySlotEnergy(slot.start, slot.durationMinutes);
    let score = 0;

    if (task.quadrant === 'q1' || task.quadrant === 'q2') {
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
      if (task.quadrant === 'q1') {
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

  /**
   * 在指定 slot 中依次推入一组专注小节 (sessions)，并在每节后自动预留 10m 内联休息间隙
   */
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
        totalTaskBreakMinutes += taskRestMinutes;
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

  // 若没有任何已完成任务需要先排，且存在 releaseTimeMs，则直接裁剪空闲槽起点
  if (completedOnDayCandidates.length === 0 && releaseTimeMs !== undefined) {
    clampSlotsToReleaseTime(releaseTimeMs);
    hasAppliedReleaseClamp = true;
  }

  // 7. 执行智能排程主循环
  for (const task of orderedQueue) {
    const isCompletedOnDay = Boolean(task.completedDates?.includes(targetDateStr));
    if (!isCompletedOnDay && !hasAppliedReleaseClamp && releaseTimeMs !== undefined) {
      clampSlotsToReleaseTime(releaseTimeMs);
      hasAppliedReleaseClamp = true;
    }

    const totalTaskMinutes = task.estimatedMinutes && task.estimatedMinutes > 0 ? task.estimatedMinutes : 45;

    if (dailyScheduledMinutes >= maxDailyTaskMinutes) {
      unscheduledTasks.push({
        taskId: task.id,
        title: task.title,
        remainingMinutes: totalTaskMinutes,
        reason: `今日自主专注负荷已达上限 (${Math.round((maxDailyTaskMinutes / 60) * 10) / 10}h)，自动顺延至次日`,
      });
      continue;
    }

    const remainingCapacity = hardDailyCapMinutes - dailyScheduledMinutes;
    if (remainingCapacity < 20) {
      unscheduledTasks.push({
        taskId: task.id,
        title: task.title,
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

    if (!workingFreeSlots.some((s) => s.durationMinutes >= totalContiguousSpan)) {
      for (let i = 0; i < workingFreeSlots.length - 1; i++) {
        const curr = workingFreeSlots[i];
        const next = workingFreeSlots[i + 1];
        if (
          curr.durationMinutes > 0 &&
          next.durationMinutes > 0 &&
          curr.end.getTime() === next.start.getTime() &&
          curr.durationMinutes + next.durationMinutes >= totalContiguousSpan
        ) {
          curr.end = new Date(next.end);
          next.start = new Date(next.end);
          refreshSlots();
          break;
        }
      }
    }

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
              const score =
                scoreSlotForTask(slot, task, slot.durationMinutes, false) + slot.durationMinutes;
              if (score > fallbackScore) {
                fallbackScore = score;
                fallbackSlot = slot;
              }
            }
          }

          if (fallbackSlot) {
            const allocMin = Math.min(
              fallbackSlot.durationMinutes,
              remainingToSchedule,
              maxContinuousMinutes
            );
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
      const totalParts = partsAllocated.length;
      const isMultiSession = totalParts > 1;
      const isDoneOnTargetDay = Boolean(
        task.isCompleted || task.completedDates?.includes(targetDateStr)
      );
      const isLastDayOfTask = isTaskLastDay(task, targetDateStr);

      partsAllocated.forEach((p, idx) => {
        scheduledTasks.push({
          id: `sched-${task.id}-p${idx + 1}-${p.start.getTime()}`,
          taskId: task.id,
          title: isMultiSession ? `${task.title} (专注节 ${idx + 1}/${totalParts})` : task.title,
          start: p.start,
          end: p.end,
          durationMinutes: p.duration,
          partIndex: idx + 1,
          totalParts,
          isSplit: isMultiSession,
          quadrant: task.quadrant,
          importance: task.importance,
          urgency: task.urgency,
          isCompleted: isDoneOnTargetDay,
          isFinalCompleted: Boolean(task.isCompleted),
          isLastDay: isLastDayOfTask,
          energyZone: p.zone,
          strategyLabel: getStrategyLabel(p.zone, task.quadrant, isMultiSession),
          breakAfterMinutes: p.breakAfter > 0 ? p.breakAfter : undefined,
        });
      });
    }

    if (unscheduledMin > 0) {
      let reason =
        releaseTimeMs !== undefined && releaseTimeMs >= dayEnd.getTime()
          ? '今日工作时段已结束，已自动顺延至明日排程'
          : '当天剩余时段无匹配的高效空闲槽，已自动顺延至次日';
      if (dailyScheduledMinutes >= maxDailyTaskMinutes) {
        reason =
          allocatedMinutesSum > 0
            ? `已排 ${allocatedMinutesSum}m，剩余 ${unscheduledMin}m 因今日专注负荷达上限顺延至次日`
            : `今日自主专注负荷已达上限 (${Math.round((maxDailyTaskMinutes / 60) * 10) / 10}h)，自动顺延至次日`;
      } else if (!allowSplit && allocatedMinutesSum === 0) {
        reason = `无单个连续空闲槽可容纳 ${totalTaskMinutes}m（已开启防切碎保护）`;
      } else if (allocatedMinutesSum > 0) {
        reason = `已排 ${allocatedMinutesSum}m，剩余 ${unscheduledMin}m 自动顺延至次日`;
      }

      unscheduledTasks.push({
        taskId: task.id,
        title: task.title,
        remainingMinutes: unscheduledMin,
        reason,
      });
    }
  }

  const mergedVisualRestBlocks = mergeAdjacentRestBlocks(visualRestBlocks);
  const fixedBufferMinutesSum = internalBufferIntervals.reduce((acc, b) => acc + b.durationMinutes, 0);
  const totalBusyMinutes = dayFixedEvents.reduce(
    (acc, ev) => acc + Math.round((ev.end.getTime() - ev.start.getTime()) / 60000),
    0
  );
  const totalScheduledMinutes = scheduledTasks.reduce((acc, st) => acc + st.durationMinutes, 0);
  const totalRestMinutes =
    mergedVisualRestBlocks.reduce((acc, rb) => acc + rb.durationMinutes, 0) +
    fixedBufferMinutesSum +
    totalTaskBreakMinutes;
  const remainingFreeMinutes = workingFreeSlots.reduce(
    (acc, s) => acc + (s.durationMinutes >= 15 ? s.durationMinutes : 0),
    0
  );

  return {
    dateStr: targetDateStr,
    fixedEvents: dayFixedEvents,
    scheduledTasks: scheduledTasks.sort((a, b) => a.start.getTime() - b.start.getTime()),
    restBlocks: mergedVisualRestBlocks,
    freeSlots: workingFreeSlots.filter((s) => s.durationMinutes >= 15),
    unscheduledTasks,
    stats: {
      totalBusyMinutes,
      totalScheduledMinutes,
      totalRestMinutes,
      totalFreeMinutes: remainingFreeMinutes,
    },
  };
}

/**
 * 智能排程引擎（支持当前时间基线约束 r_j >= t_now 与多日滚动顺延 Multi-Day Rolling Horizon）：
 * 1. 当天排程遵守 r_j >= t_now：未完成事项自动从当前时间（5分钟粒度对齐）之后开始排布
 * 2. 跨日滚动顺延：今日因时间不足或达到 5.5h 认知上限未排完的任务，自动顺延并提权进入次日排程
 * 3. 生理节律分区与内联缓冲：午晚餐独立展示，10m 课间/番茄钟缓冲化为内联呼吸留白
 */
export function generateDaySchedule(
  tasks: TaskItem[],
  fixedEvents: CalendarEvent[],
  options: ScheduleOptions
): DayScheduleResult {
  const now = new Date();
  const todayStr = formatLocalDate(now);
  const targetDateStr = formatLocalDate(options.targetDate);

  // 对齐当前时间到下一个 5 分钟刻度，作为“今天”未完成任务的释放时间下界 r_j >= t_now
  const releaseTimeMsToday = Math.ceil(now.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000);

  if (targetDateStr === todayStr) {
    return runSingleDaySchedule(tasks, fixedEvents, {
      ...options,
      releaseTimeMs: releaseTimeMsToday,
    });
  }

  if (targetDateStr < todayStr) {
    return runSingleDaySchedule(tasks, fixedEvents, options);
  }

  // 未来日期：执行从今日 (D_0) 到目标日 (D_k) 的多日滚动排程模拟，捕获前序日期顺延下来的溢出任务
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const targetStart = new Date(options.targetDate);
  targetStart.setHours(0, 0, 0, 0);

  const diffDays = Math.min(
    14,
    Math.round((targetStart.getTime() - todayStart.getTime()) / (24 * 3600 * 1000))
  );

  let rolloverTaskIds = new Set<string>();
  const rolloverRemainingMinutes = new Map<string, number>();

  for (let d = 0; d < diffDays; d++) {
    const simDate = new Date(todayStart);
    simDate.setDate(simDate.getDate() + d);

    const simResult = runSingleDaySchedule(tasks, fixedEvents, {
      ...options,
      targetDate: simDate,
      releaseTimeMs: d === 0 ? releaseTimeMsToday : undefined,
      rolloverTaskIds,
    });

    const nextRolloverIds = new Set<string>();
    for (const unsched of simResult.unscheduledTasks) {
      // Q4 被拦截的不算作跨日紧急顺延
      if (!unsched.reason.includes('象限 IV')) {
        nextRolloverIds.add(unsched.taskId);
        rolloverRemainingMinutes.set(unsched.taskId, unsched.remainingMinutes);
      }
    }
    rolloverTaskIds = nextRolloverIds;
  }

  // 若某些仅在今天截止的溢出任务顺延到了目标日，动态带上剩余时长参与目标日排程
  const adjustedTasksForTarget = tasks.map((t) => {
    if (rolloverTaskIds.has(t.id) && rolloverRemainingMinutes.has(t.id)) {
      return {
        ...t,
        estimatedMinutes: rolloverRemainingMinutes.get(t.id),
      };
    }
    return t;
  });

  return runSingleDaySchedule(adjustedTasksForTarget, fixedEvents, {
    ...options,
    rolloverTaskIds,
  });
}

/**
 * 合并时间上相邻（首尾相接）或重叠的 Break Time，避免连续出现碎片化休息卡片
 */
export function mergeAdjacentRestBlocks(blocks: RestBlock[]): RestBlock[] {
  if (blocks.length <= 1) return blocks;

  const sorted = [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: RestBlock[] = [];

  for (const block of sorted) {
    if (merged.length === 0) {
      merged.push({ ...block });
    } else {
      const prev = merged[merged.length - 1];
      if (block.start.getTime() <= prev.end.getTime()) {
        if (block.end.getTime() > prev.end.getTime()) {
          prev.end = new Date(block.end);
          prev.durationMinutes = Math.round((prev.end.getTime() - prev.start.getTime()) / 60000);
        }
      } else {
        merged.push({ ...block });
      }
    }
  }

  return merged;
}
