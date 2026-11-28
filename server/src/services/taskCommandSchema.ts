import { z } from 'zod';
import {
  calculateDynamicImportance,
  calculateDynamicUrgency,
  inferTierFromScore,
  normalizeScoreTo100,
  type ImpactSignal,
  type ImportanceTier,
  type TimeMode,
  type UrgencyPace,
} from '../utils/priorityAlgorithm.js';
import { normalizeAccountDeadlineIso, parseAccountDateOrIso } from '../utils/timezone.js';
import { parseRecurrenceRule, stringifyRecurrenceRule } from '../utils/recurrence.js';

export function normalizeRecurrenceRuleForMode(rawRule: unknown, timeMode?: string | null): string | null {
  if (timeMode !== 'daily_fixed') return null;
  if (rawRule === undefined || rawRule === null || rawRule === '') {
    return stringifyRecurrenceRule({ type: 'daily' });
  }
  return stringifyRecurrenceRule(parseRecurrenceRule(typeof rawRule === 'string' ? rawRule : JSON.stringify(rawRule)));
}

export function parseTagsArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return Array.from(new Set(raw.map(v => String(v).trim()).filter(Boolean)));
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return Array.from(new Set(parsed.map(v => String(v).trim()).filter(Boolean)));
      }
    } catch {
      return Array.from(
        new Set(
          raw
            .split(/[,，]/)
            .map(s => s.trim())
            .filter(Boolean)
        )
      );
    }
  }
  return [];
}

export function parseImpactSignalsArray(raw: unknown): ImpactSignal[] {
  const valid: Set<string> = new Set([
    'blocks_others',
    'irreversible_cost',
    'long_term_compound',
    'daily_keystone',
  ]);
  const arr = parseTagsArray(raw);
  return arr.filter(s => valid.has(s)) as ImpactSignal[];
}

export const createTaskCommandSchema = z.object({
  title: z.string().trim().min(1, '请输入任务标题').max(300, '任务标题过长'),
  notes: z.string().nullable().optional(),
  duration_minutes: z.number().int().min(1, '预计耗时必须大于 0').max(100000, '预计耗时超出上限').nullable().optional(),
  has_explicit_duration: z.boolean().optional(),
  importance: z.number().finite().min(0).max(100).nullable().optional(),
  urgency: z.number().finite().min(0).max(100).nullable().optional(),
  importance_tier: z.enum(['vital', 'support', 'minor']).nullable().optional(),
  impact_signals: z.array(z.string()).optional(),
  importance_manual_override: z.number().finite().min(0).max(100).nullable().optional(),
  score_scale: z.number().int().optional(),
  time_mode: z.enum(['deadline', 'specific_date', 'daily_fixed', 'flexible']).nullable().optional(),
  recurrence_rule: z.any().nullable().optional(),
  urgency_pace: z.enum(['urgent', 'soon', 'later']).nullable().optional(),
  deadline: z.string().nullable().optional(),
  deadline_kind: z.enum(['hard', 'soft']).nullable().optional(),
  is_fixed: z.boolean().optional(),
  is_concurrent: z.boolean().optional(),
  scheduled_start: z.string().nullable().optional(),
  scheduled_end: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  auto_schedule: z.boolean().optional(),
  session_plan: z.array(z.number().int().min(1)).nullable().optional(),
  source_fingerprint: z.string().nullable().optional(),
});

export type ValidatedCreateTaskInput = z.infer<typeof createTaskCommandSchema>;

export const updateTaskCommandSchema = z.object({
  title: z.string().trim().min(1, '任务标题不能为空').max(300).optional(),
  notes: z.string().nullable().optional(),
  duration_minutes: z.number().int().min(1, '预计耗时必须大于 0').max(100000).optional(),
  importance: z.number().finite().min(0).max(100).optional(),
  urgency: z.number().finite().min(0).max(100).optional(),
  importance_tier: z.enum(['vital', 'support', 'minor']).nullable().optional(),
  impact_signals: z.array(z.string()).optional(),
  importance_manual_override: z.number().finite().min(0).max(100).nullable().optional(),
  score_scale: z.number().int().optional(),
  time_mode: z.enum(['deadline', 'specific_date', 'daily_fixed', 'flexible']).optional(),
  recurrence_rule: z.any().nullable().optional(),
  urgency_pace: z.enum(['urgent', 'soon', 'later']).optional(),
  deadline: z.string().nullable().optional(),
  deadline_kind: z.enum(['hard', 'soft']).optional(),
  is_fixed: z.boolean().optional(),
  is_concurrent: z.boolean().optional(),
  scheduled_start: z.string().nullable().optional(),
  scheduled_end: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  expected_version: z.number().int().min(1).optional(),
});

export type ValidatedUpdateTaskInput = z.infer<typeof updateTaskCommandSchema>;

export interface FixedIntervalValidationResult {
  valid: boolean;
  startIso: string | null;
  endIso: string | null;
  durationMinutes: number | null;
  error?: string;
}

/**
 * 统一校验固定时间段（T02）：
 * - 起止必须构成正向时间区间 (end > start)
 * - 若显式传入 duration_minutes 且同时有起止，允许最多 1 分钟舍入差，否则报错提示起止与耗时不一致
 * - 只有开始时间和耗时时，自动推算结束时间
 * - 不可超过硬截止时间
 */
export function validateFixedInterval(params: {
  isFixed: boolean;
  startRaw?: string | null;
  endRaw?: string | null;
  durationMinutes?: number | null;
  deadlineIso?: string | null;
  deadlineKind?: 'hard' | 'soft' | null;
  timezone: string;
}): FixedIntervalValidationResult {
  if (!params.isFixed) {
    return {
      valid: true,
      startIso: null,
      endIso: null,
      durationMinutes: params.durationMinutes ?? null,
    };
  }

  const startDate = parseAccountDateOrIso(params.startRaw, params.timezone);
  let endDate = parseAccountDateOrIso(params.endRaw, params.timezone);

  if (!startDate) {
    return {
      valid: false,
      startIso: null,
      endIso: null,
      durationMinutes: params.durationMinutes ?? null,
      error: '固定任务需要有效的开始时间',
    };
  }

  if (!endDate && params.durationMinutes && params.durationMinutes > 0) {
    endDate = new Date(startDate.getTime() + params.durationMinutes * 60_000);
  }

  if (!endDate) {
    return {
      valid: false,
      startIso: startDate.toISOString(),
      endIso: null,
      durationMinutes: params.durationMinutes ?? null,
      error: '固定任务需要明确的结束时间或预计耗时',
    };
  }

  const diffMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60_000);
  if (diffMinutes <= 0) {
    return {
      valid: false,
      startIso: null,
      endIso: null,
      durationMinutes: null,
      error: '固定任务结束时间必须晚于开始时间',
    };
  }

  if (
    params.durationMinutes !== undefined &&
    params.durationMinutes !== null &&
    params.durationMinutes > 0 &&
    Math.abs(diffMinutes - params.durationMinutes) > 1
  ) {
    return {
      valid: false,
      startIso: null,
      endIso: null,
      durationMinutes: null,
      error: `固定时段跨度（${diffMinutes} 分钟）与预计耗时（${params.durationMinutes} 分钟）不一致`,
    };
  }

  if (params.deadlineKind === 'hard' && params.deadlineIso) {
    const dueDate = parseAccountDateOrIso(params.deadlineIso, params.timezone);
    if (dueDate && endDate.getTime() > dueDate.getTime()) {
      return {
        valid: false,
        startIso: null,
        endIso: null,
        durationMinutes: null,
        error: '固定时段不能超过硬截止时间',
      };
    }
  }

  return {
    valid: true,
    startIso: startDate.toISOString(),
    endIso: endDate.toISOString(),
    durationMinutes: diffMinutes,
  };
}

/**
 * 根据三阶认知定级、耗时、影响因子与时间模式推导规范化的 100 分制重要度与紧迫度（M07, T01）。
 */
export function resolveTaskPriorityScores(params: {
  durationMinutes: number;
  isFixed: boolean;
  importance?: number | null;
  urgency?: number | null;
  importanceTier?: ImportanceTier | null;
  impactSignals?: ImpactSignal[];
  manualOverride?: number | null;
  scoreScale?: number | null;
  timeMode?: TimeMode | null;
  urgencyPace?: UrgencyPace | null;
  deadlineIso?: string | null;
  scheduledStartIso?: string | null;
  scheduledEndIso?: string | null;
  isCompletedToday?: boolean;
  dailyBusyMinutesAhead: number;
  nearTermLoadRatio?: number | null;
  createdAt?: string | Date | null;
}): {
  importance: number;
  urgency: number;
  importanceTier: ImportanceTier;
  impactSignals: ImpactSignal[];
  manualOverride: number | null;
  timeMode: TimeMode;
  urgencyPace: UrgencyPace;
} {
  const scale = params.scoreScale ?? 100;
  const signals = params.impactSignals || [];
  const manualOverride =
    params.manualOverride !== undefined && params.manualOverride !== null
      ? normalizeScoreTo100(params.manualOverride, scale)
      : null;

  let importanceTier: ImportanceTier;
  let importance: number;

  if (params.importanceTier === 'vital' || params.importanceTier === 'support' || params.importanceTier === 'minor') {
    importanceTier = params.importanceTier;
    importance = calculateDynamicImportance({
      tier: importanceTier,
      estimatedMinutes: params.durationMinutes,
      impactSignals: signals,
      isFixed: params.isFixed,
      manualOverride,
    }).importance;
  } else {
    importance =
      params.importance !== undefined && params.importance !== null
        ? normalizeScoreTo100(params.importance, scale)
        : 58;
    importanceTier = inferTierFromScore(importance);
  }

  const timeMode: TimeMode =
    params.timeMode === 'daily_fixed' ||
    params.timeMode === 'flexible' ||
    params.timeMode === 'specific_date' ||
    params.timeMode === 'deadline'
      ? params.timeMode
      : params.deadlineIso
      ? 'deadline'
      : 'flexible';

  const urgencyPace: UrgencyPace =
    params.urgencyPace === 'urgent' || params.urgencyPace === 'later' || params.urgencyPace === 'soon'
      ? params.urgencyPace
      : 'soon';

  const fallbackUrg100 =
    params.urgency !== undefined && params.urgency !== null
      ? normalizeScoreTo100(params.urgency, scale)
      : 50;

  const urgency = calculateDynamicUrgency({
    timeMode,
    dueDate: params.deadlineIso || null,
    estimatedMinutes: params.durationMinutes,
    importance,
    urgencyPace,
    scheduledStart: params.scheduledStartIso || null,
    scheduledEnd: params.scheduledEndIso || null,
    isCompletedToday: params.isCompletedToday,
    dailyBusyMinutesAhead: params.dailyBusyMinutesAhead,
    nearTermLoadRatio: params.nearTermLoadRatio,
    createdAt: params.createdAt,
    fallbackUrgency: fallbackUrg100,
  }).urgency;

  return {
    importance,
    urgency,
    importanceTier,
    impactSignals: signals,
    manualOverride,
    timeMode,
    urgencyPace,
  };
}

export function normalizeCommandDeadline(
  rawDeadline: string | null | undefined,
  timezone: string
): string | null {
  return normalizeAccountDeadlineIso(rawDeadline, timezone);
}
