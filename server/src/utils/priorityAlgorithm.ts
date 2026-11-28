/**
 * 100 分制双维优先级引擎：
 * 1. 重要度自动算分：三阶认知定级 + 耗时规模 + 客观影响因子 + 固定约束 + 档位软边界钳位（支持可选手动覆盖）
 * 2. 紧迫度三模式动态引擎：
 *    - deadline：截止日期/大致日期 + LLF 最小松弛度 + 重要度前置缓冲耦合
 *    - daily_fixed：每日固定/例行任务，结合今日日程排程区间与剩余空闲负荷动态计算
 *    - flexible：无固定截止日期的弹性节奏 + 重要度微调
 */

export const SCORE_MIN = 0;
export const SCORE_MAX = 100;
export const PRIORITY_THRESHOLD = 50;

export type QuadrantId = 'q1' | 'q2' | 'q3' | 'q4';
export type ImportanceTier = 'vital' | 'support' | 'minor';
export type ImpactSignal =
  | 'blocks_others'
  | 'irreversible_cost'
  | 'long_term_compound'
  | 'daily_keystone';
export type TimeMode = 'deadline' | 'specific_date' | 'daily_fixed' | 'flexible';
export type UrgencyPace = 'urgent' | 'soon' | 'later';

export interface ImportanceTierConfig {
  key: ImportanceTier;
  label: string;
  description: string;
  base: number;
  min: number;
  max: number;
}

export const IMPORTANCE_TIERS_CONFIG: Record<ImportanceTier, ImportanceTierConfig> = {
  vital: {
    key: 'vital',
    label: '核心战略',
    description: '直接决定核心目标、关键交付、健康或重大里程碑',
    base: 82,
    min: 70,
    max: 100,
  },
  support: {
    key: 'support',
    label: '日常推进',
    description: '维持主线运转的常规任务、沟通协作或日常提升',
    base: 58,
    min: 45,
    max: 72,
  },
  minor: {
    key: 'minor',
    label: '琐碎杂务',
    description: '低杠杆行政杂事、外部临时打扰或可批量清理事项',
    base: 25,
    min: 10,
    max: 44,
  },
};

export const IMPACT_SIGNAL_WEIGHTS: Record<ImpactSignal, { label: string; delta: number }> = {
  blocks_others: { label: '影响他人/关键交付', delta: 7 },
  irreversible_cost: { label: '逾期/错过代价高', delta: 6 },
  long_term_compound: { label: '长期复利/成长健康', delta: 5 },
  daily_keystone: { label: '每日核心基石习惯', delta: 4 },
};

export function clampScore100(value: number): number {
  const safe = Number.isFinite(value) ? value : PRIORITY_THRESHOLD;
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(safe)));
}

/**
 * 将历史 1~5 分制或 0~10 分制安全归一化到 0~100 分制
 */
export function normalizeScoreTo100(
  rawScore: number | null | undefined,
  scoreScale?: number | null
): number {
  if (rawScore === null || rawScore === undefined || !Number.isFinite(rawScore)) {
    return PRIORITY_THRESHOLD;
  }
  if (scoreScale === 100 || rawScore > 10) {
    return clampScore100(rawScore);
  }
  if (scoreScale === 10) {
    return clampScore100(rawScore * 10);
  }
  if (scoreScale === 5) {
    return clampScore100(rawScore <= 5 ? rawScore * 20 : rawScore * 10);
  }
  // 未知历史记录兜底：<=5 按 5 分制放大，<=10 按 10 分制放大
  if (rawScore <= 5) return clampScore100(rawScore * 20);
  if (rawScore <= 10) return clampScore100(rawScore * 10);
  return clampScore100(rawScore);
}

export function inferTierFromScore(importance100: number): ImportanceTier {
  if (importance100 >= 70) return 'vital';
  if (importance100 >= 45) return 'support';
  return 'minor';
}

export function calculateQuadrant100(
  importance100: number,
  urgency100: number,
  threshold: number = PRIORITY_THRESHOLD
): QuadrantId {
  const isImportant = importance100 >= threshold;
  const isUrgent = urgency100 >= threshold;
  if (isImportant && isUrgent) return 'q1';
  if (isImportant && !isUrgent) return 'q2';
  if (!isImportant && isUrgent) return 'q3';
  return 'q4';
}

export interface DynamicImportanceParams {
  tier?: ImportanceTier | null;
  estimatedMinutes?: number;
  impactSignals?: ImpactSignal[];
  isFixed?: boolean;
  manualOverride?: number | null;
}

export interface DynamicImportanceResult {
  importance: number;
  autoImportance: number;
  isManualOverride: boolean;
  tier: ImportanceTier;
  breakdownText: string;
}

export function calculateDynamicImportance({
  tier = 'support',
  estimatedMinutes = 30,
  impactSignals = [],
  isFixed = false,
  manualOverride = null,
}: DynamicImportanceParams): DynamicImportanceResult {
  const safeTier: ImportanceTier =
    tier === 'vital' || tier === 'support' || tier === 'minor' ? tier : 'support';
  const cfg = IMPORTANCE_TIERS_CONFIG[safeTier];

  const minutes = Number.isFinite(estimatedMinutes) && estimatedMinutes > 0 ? estimatedMinutes : 30;
  let effortDelta = 0;
  if (minutes >= 240) effortDelta = 8;
  else if (minutes >= 120) effortDelta = 5;
  else if (minutes >= 60) effortDelta = 2;
  else if (minutes <= 15) effortDelta = -3;

  const uniqueSignals = Array.from(new Set(impactSignals)).filter(
    (s): s is ImpactSignal => s in IMPACT_SIGNAL_WEIGHTS
  );
  const rawImpactDelta = uniqueSignals.reduce(
    (sum, s) => sum + IMPACT_SIGNAL_WEIGHTS[s].delta,
    0
  );
  const impactDelta = Math.min(14, rawImpactDelta);

  const fixedDelta = isFixed ? 4 : 0;

  const rawAuto = cfg.base + effortDelta + impactDelta + fixedDelta;
  const autoImportance = Math.min(cfg.max, Math.max(cfg.min, Math.round(rawAuto)));

  const parts = [`${cfg.label}基准 ${cfg.base}`];
  if (effortDelta !== 0) parts.push(`耗时 ${effortDelta > 0 ? '+' : ''}${effortDelta}`);
  if (impactDelta > 0) parts.push(`影响因子 +${impactDelta}`);
  if (fixedDelta > 0) parts.push(`固定日程 +${fixedDelta}`);

  const hasOverride = manualOverride !== null && manualOverride !== undefined && Number.isFinite(manualOverride);
  const importance = hasOverride ? clampScore100(manualOverride!) : autoImportance;

  return {
    importance,
    autoImportance,
    isManualOverride: hasOverride,
    tier: safeTier,
    breakdownText: hasOverride
      ? `手动覆盖 ${importance}（算法测算 ${autoImportance}：${parts.join(' · ')}）`
      : parts.join(' · '),
  };
}

export interface DynamicUrgencyParams {
  timeMode?: TimeMode | null;
  dueDate: string | null;
  estimatedMinutes?: number;
  importance?: number; // 0 ~ 100
  urgencyPace?: UrgencyPace | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  isCompletedToday?: boolean;
  dailyBusyMinutesAhead?: number | null;
  dailyFreeMinutesRemaining?: number | null;
  nearTermLoadRatio?: number | null; // 0 ~ 1: 近期(未来3~7天)可用时段忙碌度
  createdAt?: string | Date | null; // 用于弹性任务的温和老化防饥饿加权
  workEndHour?: number;
  fallbackUrgency?: number; // 0 ~ 100
  currentTime?: Date;
}

export interface DynamicUrgencyResult {
  urgency: number;
  slackHours: number | null;
  remainingHours: number | null;
  statusText: string;
}

function parseDueDateTime(dueDate: string): Date {
  if (dueDate.includes('T')) {
    return new Date(dueDate);
  }
  const [year, month, day] = dueDate.split('-').map(Number);
  return new Date(year, month - 1, day, 23, 59, 59);
}

function projectTimeOntoDay(isoOrTime: string, day: Date): Date | null {
  if (/^\d{2}:\d{2}$/.test(isoOrTime)) {
    const [hh, mm] = isoOrTime.split(':').map(Number);
    const d = new Date(day);
    d.setHours(hh, mm, 0, 0);
    return d;
  }
  const parsed = new Date(isoOrTime);
  if (Number.isNaN(parsed.getTime())) return null;
  const d = new Date(day);
  d.setHours(parsed.getHours(), parsed.getMinutes(), parsed.getSeconds(), 0);
  return d;
}

function formatHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * 计算 0~100 动态紧迫度：
 * - 综合考虑截止日期/时段、预计耗时（LLF）、每日日程空闲度、以及事件重要度耦合
 */
export function calculateDynamicUrgency({
  timeMode,
  dueDate,
  estimatedMinutes = 30,
  importance = PRIORITY_THRESHOLD,
  urgencyPace = 'soon',
  scheduledStart = null,
  scheduledEnd = null,
  isCompletedToday = false,
  dailyBusyMinutesAhead = null,
  dailyFreeMinutesRemaining = null,
  nearTermLoadRatio = null,
  createdAt = null,
  workEndHour = 22,
  fallbackUrgency = PRIORITY_THRESHOLD,
  currentTime = new Date(),
}: DynamicUrgencyParams): DynamicUrgencyResult {
  const safeImp = clampScore100(importance);
  const impNorm = (safeImp - 50) / 50; // -1.0 ~ +1.0
  // 重要度前置缓冲系数：重要度越高，越需要提前留出准备余量
  const leadFactor = 1 + impNorm * 0.45; // 0.55 ~ 1.45
  const effortHours = Math.max(0.2, (estimatedMinutes || 30) / 60);
  const effectiveEffortHours = effortHours * leadFactor;

  const effectiveMode: TimeMode =
    timeMode === 'daily_fixed' ||
    timeMode === 'flexible' ||
    timeMode === 'specific_date' ||
    timeMode === 'deadline'
      ? timeMode
      : dueDate
      ? 'deadline'
      : 'flexible';

  // ---------------- 模式 B：每日固定 / 例行任务 ----------------
  if (effectiveMode === 'daily_fixed') {
    if (isCompletedToday) {
      return {
        urgency: 15,
        slackHours: null,
        remainingHours: null,
        statusText: '今日已完成 · 明日恢复',
      };
    }

    // 每日剩余可用空闲评估（结合外部日历与今日已排日程）
    const dayEnd = new Date(currentTime);
    dayEnd.setHours(Math.floor(workEndHour), Math.round((workEndHour % 1) * 60), 0, 0);
    if (dayEnd.getTime() <= currentTime.getTime()) {
      dayEnd.setHours(23, 59, 59, 0);
    }
    const remainingDayHours = Math.max(
      0,
      (dayEnd.getTime() - currentTime.getTime()) / (1000 * 60 * 60)
    );
    const freeHoursToday =
      dailyFreeMinutesRemaining !== null && dailyFreeMinutesRemaining !== undefined
        ? Math.max(0, dailyFreeMinutesRemaining / 60)
        : dailyBusyMinutesAhead !== null && dailyBusyMinutesAhead !== undefined
        ? Math.max(0, remainingDayHours - dailyBusyMinutesAhead / 60)
        : remainingDayHours * 0.72;

    const dailySlackHours = freeHoursToday - effectiveEffortHours;

    // 情况 1：今天已锁定/排入具体时间区间 [slotStart, slotEnd]
    if (scheduledStart && scheduledEnd) {
      const slotStart = projectTimeOntoDay(scheduledStart, currentTime);
      const slotEnd = projectTimeOntoDay(scheduledEnd, currentTime);
      if (slotStart && slotEnd && slotEnd.getTime() > slotStart.getTime()) {
        const minsToStart = (slotStart.getTime() - currentTime.getTime()) / 60000;
        const minsToEnd = (slotEnd.getTime() - currentTime.getTime()) / 60000;

        if (minsToEnd <= 0) {
          return {
            urgency: clampScore100(94 + (safeImp / 100) * 4),
            slackHours: Math.round((minsToEnd / 60) * 10) / 10,
            remainingHours: Math.round((minsToEnd / 60) * 10) / 10,
            statusText: `今日 ${formatHHMM(slotStart)}–${formatHHMM(slotEnd)} 未完成`,
          };
        }

        if (minsToStart <= 0 && minsToEnd > 0) {
          return {
            urgency: clampScore100(92 + (safeImp / 100) * 6),
            slackHours: Math.round((minsToEnd / 60) * 10) / 10,
            remainingHours: Math.round((minsToEnd / 60) * 10) / 10,
            statusText: `正在进行 (${formatHHMM(slotStart)}–${formatHHMM(slotEnd)})`,
          };
        }

        if (minsToStart <= 30) {
          const score = 86 + (1 - minsToStart / 30) * 7 + impNorm * 2;
          return {
            urgency: clampScore100(score),
            slackHours: Math.round((minsToStart / 60) * 10) / 10,
            remainingHours: Math.round((minsToStart / 60) * 10) / 10,
            statusText: `${Math.ceil(minsToStart)} 分钟后开始 (${formatHHMM(slotStart)})`,
          };
        }

        if (minsToStart <= 180) {
          const score = 70 + (1 - (minsToStart - 30) / 150) * 16 + impNorm * 3;
          return {
            urgency: clampScore100(score),
            slackHours: Math.round((minsToStart / 60) * 10) / 10,
            remainingHours: Math.round((minsToStart / 60) * 10) / 10,
            statusText: `今日 ${formatHHMM(slotStart)} 排定`,
          };
        }

        // 距离今日固定时段较远，结合今日日程剩余压力与重要度计算
        const pressureBoost =
          dailySlackHours <= 1.0 ? 10 : dailySlackHours <= 2.5 ? 5 : 0;
        const base = 52 + (1 - Math.min(1, (minsToStart - 180) / 600)) * 14;
        return {
          urgency: clampScore100(base + impNorm * 4 + pressureBoost),
          slackHours: Math.round(dailySlackHours * 10) / 10,
          remainingHours: Math.round((minsToStart / 60) * 10) / 10,
          statusText:
            pressureBoost > 0
              ? `今日 ${formatHHMM(slotStart)} · 日程较满`
              : `今日 ${formatHHMM(slotStart)} 排定`,
        };
      }
    }

    // 情况 2：每日例行但尚未排入固定时段（按今日日程空闲松弛度动态计算）
    let score: number;
    let statusText: string;
    const freeText = `${Math.round(freeHoursToday * 10) / 10}h`;

    if (dailySlackHours <= 0) {
      score = 94 + impNorm * 3;
      statusText = `今日日程已满 (余 ${freeText} 不足)`;
    } else if (dailySlackHours <= 1.5) {
      score = 82 + (1 - dailySlackHours / 1.5) * 10 + impNorm * 3;
      statusText = `今日空档极紧 (仅余 ${freeText})`;
    } else if (dailySlackHours <= 3.5) {
      score = 68 + (1 - (dailySlackHours - 1.5) / 2.0) * 14 + impNorm * 3;
      statusText = `今日日程较忙 (余 ${freeText})`;
    } else if (dailySlackHours <= 6.0) {
      score = 56 + (1 - (dailySlackHours - 3.5) / 2.5) * 12 + impNorm * 3;
      statusText = `今日待排 (余 ${freeText} 空档)`;
    } else {
      score = 50 + impNorm * 3;
      statusText = `今日从容待排 (余 ${freeText} 空档)`;
    }

    return {
      urgency: Math.min(98, Math.max(48, clampScore100(score))),
      slackHours: Math.round(dailySlackHours * 10) / 10,
      remainingHours: Math.round(remainingDayHours * 10) / 10,
      statusText,
    };
  }

  // ---------------- 模式 C：弹性无截止日任务（近期负荷感知 + 温和老化防饥饿） ----------------
  if (effectiveMode === 'flexible' || !dueDate) {
    const safePace: UrgencyPace =
      urgencyPace === 'urgent' || urgencyPace === 'later' || urgencyPace === 'soon'
        ? urgencyPace
        : 'soon';
    const paceBase =
      safePace === 'urgent' ? 80 : safePace === 'later' ? 25 : 55;

    const hasLoadSignal =
      nearTermLoadRatio !== null &&
      nearTermLoadRatio !== undefined &&
      Number.isFinite(nearTermLoadRatio);
    const clampedLoad = hasLoadSignal
      ? Math.max(0, Math.min(1, nearTermLoadRatio!))
      : null;

    let loadDelta = 0;
    if (clampedLoad !== null) {
      if (safePace === 'urgent') {
        loadDelta = clampedLoad >= 0.7 ? 4 : clampedLoad >= 0.5 ? 2 : 0;
      } else if (safePace === 'soon') {
        if (clampedLoad >= 0.65) {
          loadDelta = -Math.round(((clampedLoad - 0.65) / 0.35) * 14);
        } else if (clampedLoad < 0.35) {
          loadDelta = Math.round(((0.35 - clampedLoad) / 0.35) * 5);
        }
      } else {
        // later: 忙碌时明显退让；极清闲时小幅上浮
        if (clampedLoad >= 0.45) {
          loadDelta = -Math.round(((clampedLoad - 0.45) / 0.55) * 10);
        } else if (clampedLoad < 0.25) {
          loadDelta = 3;
        }
      }
    }

    let ageDays = 0;
    if (createdAt) {
      const createdMs = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
      if (Number.isFinite(createdMs) && createdMs < currentTime.getTime()) {
        ageDays = (currentTime.getTime() - createdMs) / 86_400_000;
      }
    }

    const busyAgingScale = clampedLoad !== null && clampedLoad >= 0.75 ? 0.5 : 1;
    let agingDelta = 0;
    if (safePace === 'urgent') {
      agingDelta = Math.min(6, Math.floor(ageDays / 2));
    } else if (safePace === 'soon') {
      agingDelta = ageDays <= 2 ? 0 : Math.min(10, Math.floor((ageDays - 2) * busyAgingScale));
    } else {
      agingDelta = ageDays <= 5 ? 0 : Math.min(10, Math.floor((ageDays - 5) * 0.6 * busyAgingScale));
    }

    const score = dueDate
      ? paceBase
      : timeMode === 'flexible'
      ? paceBase + impNorm * 5 + loadDelta + agingDelta
      : fallbackUrgency + impNorm * 4 + Math.round(loadDelta * 0.5);

    const paceText =
      safePace === 'urgent'
        ? '弹性 · 尽快推进'
        : safePace === 'later'
        ? clampedLoad !== null && clampedLoad >= 0.45
          ? '弹性 · 忙时暂留备忘池'
          : ageDays >= 14
          ? `弹性 · 远期备忘（待排 ${Math.floor(ageDays)} 天）`
          : '弹性 · 远期备忘'
        : clampedLoad !== null && clampedLoad >= 0.65
        ? '弹性 · 近期较忙，顺延待排'
        : clampedLoad !== null && clampedLoad < 0.35
        ? '弹性 · 近日空闲可推进'
        : '弹性 · 近日规划';

    return {
      urgency: Math.min(92, Math.max(10, clampScore100(score))),
      slackHours: null,
      remainingHours: null,
      statusText: dueDate ? '已设定时间' : paceText,
    };
  }

  // ---------------- 模式 A：截止日期 / 指定执行日 + LLF + 重要度耦合 ----------------
  const dueDateTime = parseDueDateTime(dueDate);
  const diffMs = dueDateTime.getTime() - currentTime.getTime();
  const remainingHours = diffMs / (1000 * 60 * 60);
  const effectiveSlackHours = remainingHours - effectiveEffortHours;
  const isSpecificDateMode = effectiveMode === 'specific_date';

  let timeUrgency: number;
  let statusText: string;

  if (remainingHours <= 0) {
    timeUrgency = 100;
    const overdueDays = Math.abs(Math.floor(remainingHours / 24));
    statusText = isSpecificDateMode
      ? overdueDays > 0
        ? `已过执行日 ${overdueDays} 天`
        : '今日执行窗口已过'
      : overdueDays > 0
      ? `已逾期 ${overdueDays} 天`
      : '今天已逾期';
  } else if (effectiveSlackHours <= 0) {
    timeUrgency = 97;
    statusText = isSpecificDateMode ? '当日执行缓冲紧张，建议优先安排' : '耗时与重要缓冲超限，急需启动';
  } else if (effectiveSlackHours <= 12) {
    timeUrgency = 90 + (1 - effectiveSlackHours / 12) * 7;
    statusText = isSpecificDateMode
      ? `今日执行（余 ${Math.max(1, Math.round(remainingHours))} 小时）`
      : `余 ${Math.max(1, Math.round(remainingHours))} 小时截止`;
  } else if (effectiveSlackHours <= 24) {
    timeUrgency = 76 + (1 - (effectiveSlackHours - 12) / 12) * 14;
    statusText = isSpecificDateMode ? '计划 24 小时内执行' : '24小时内到期';
  } else if (effectiveSlackHours <= 72) {
    timeUrgency = 56 + (1 - (effectiveSlackHours - 24) / 48) * 20;
    const days = Math.ceil(remainingHours / 24);
    statusText = isSpecificDateMode ? `计划 ${days} 天后执行` : `余 ${days} 天截止`;
  } else if (effectiveSlackHours <= 168) {
    timeUrgency = 36 + (1 - (effectiveSlackHours - 72) / 96) * 20;
    const days = Math.ceil(remainingHours / 24);
    statusText = isSpecificDateMode ? `计划 ${days} 天后执行` : `余 ${days} 天截止`;
  } else if (effectiveSlackHours <= 720) {
    timeUrgency = 20 + (1 - (effectiveSlackHours - 168) / 552) * 16;
    const days = Math.ceil(remainingHours / 24);
    statusText = isSpecificDateMode ? `计划 ${days} 天后执行` : `余 ${days} 天截止`;
  } else {
    timeUrgency = 12;
    statusText = isSpecificDateMode ? '远期指定执行日任务' : '长期从容任务';
  }

  // 仅在 7 天窗口内叠加重要度协同加权，避免远期核心任务被误推入 Q1
  const proximityWeight =
    remainingHours <= 0
      ? 0
      : remainingHours <= 72
      ? 1
      : remainingHours <= 168
      ? (168 - remainingHours) / 96
      : 0;
  const importanceBoost = impNorm * 6 * proximityWeight;

  const finalUrgency = clampScore100(timeUrgency + importanceBoost);

  return {
    urgency: finalUrgency,
    slackHours: Math.round(effectiveSlackHours * 10) / 10,
    remainingHours: Math.round(remainingHours * 10) / 10,
    statusText,
  };
}
