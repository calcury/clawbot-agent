import { db } from '../config/database.js';
import type { ExternalEvent, Task, TaskInstance, UserSettings } from '../models/types.js';
import { getUserTimezone } from './accountService.js';
import {
  addDaysToDateKey,
  getAccountDayBoundsUtc,
  getAccountLocalDateKey,
  getAccountLocalTimeHm,
  parseAccountDateOrIso,
  zonedWallClockToUtc,
} from '../utils/timezone.js';
import { isDateMatchingRecurrence } from '../utils/recurrence.js';
import {
  ensureTaskInstance,
  executeInstanceProgressCommand,
  getLatestPlanVersion,
  syncLegacyTaskProjection,
} from './instanceService.js';
import { planTaskWithLLM } from './llm.js';
import {
  computeTodayBusyMinutes,
  extendTaskDuration,
  getActiveExternalBusyEvents,
  replanUserTasks,
  scheduleTask,
  type ScheduleProposal,
} from './scheduler.js';
import { createScheduleProposal } from './proposalService.js';
import {
  createTaskCommandSchema,
  normalizeCommandDeadline,
  normalizeRecurrenceRuleForMode,
  parseImpactSignalsArray,
  parseTagsArray,
  resolveTaskPriorityScores,
  updateTaskCommandSchema,
  validateFixedInterval,
} from './taskCommandSchema.js';

function resolveInitialBusinessDate(
  timeMode: string,
  recurrenceRule: string | null,
  fixedStartIso: string | null,
  deadlineIso: string | null,
  now: Date,
  tz: string
): string {
  if (fixedStartIso) {
    return getAccountLocalDateKey(new Date(fixedStartIso), tz);
  }
  const todayKey = getAccountLocalDateKey(now, tz);
  if (timeMode === 'specific_date' && deadlineIso) {
    const d = parseAccountDateOrIso(deadlineIso, tz);
    if (d) return getAccountLocalDateKey(d, tz);
  }
  if (timeMode !== 'daily_fixed') return todayKey;
  for (let offset = 0; offset < 7; offset++) {
    const candidate = offset === 0 ? todayKey : addDaysToDateKey(todayKey, offset);
    if (isDateMatchingRecurrence(candidate, recurrenceRule)) {
      return candidate;
    }
  }
  return todayKey;
}

export type TargetResolution =
  | { status: 'found_task'; task: Task; instance?: TaskInstance | null }
  | { status: 'found_external'; event: ExternalEvent }
  | { status: 'ambiguous'; candidates: Array<{ id: number; type: 'task' | 'calendar_event'; title: string; date?: string; status?: string }> }
  | { status: 'not_found'; message: string };

/**
 * 统一目标消歧（M01）：
 * - 优先使用明确 taskId / instanceId
 * - 按名称匹配时按类型与可选日期筛选；命中多项时列出候选，绝不回退到首个或最新无关任务
 */
export function resolveCommandTarget(params: {
  userId: number;
  taskId?: number;
  instanceId?: number;
  name?: string | null;
  type?: 'task' | 'calendar_event' | 'auto';
  date?: string | null;
  includeCompleted?: boolean;
}): TargetResolution {
  const tz = getUserTimezone(params.userId);
  const now = new Date();
  const targetDate = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : getAccountLocalDateKey(now, tz);

  if (params.instanceId) {
    const inst = db
      .prepare('SELECT * FROM task_instances WHERE id = ? AND user_id = ?')
      .get(params.instanceId, params.userId) as TaskInstance | undefined;
    if (!inst) {
      return { status: 'not_found', message: '未找到指定的任务实例' };
    }
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(inst.task_id, params.userId) as Task;
    return { status: 'found_task', task, instance: inst };
  }

  if (params.taskId) {
    const task = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
      .get(params.taskId, params.userId) as Task | undefined;
    if (!task) {
      return { status: 'not_found', message: '未找到指定任务' };
    }
    const inst = ensureTaskInstance(params.userId, task.id, targetDate, now);
    return { status: 'found_task', task, instance: inst };
  }

  const trimmedName = (params.name || '').trim();
  if (!trimmedName) {
    return { status: 'not_found', message: '请明确说明要操作的任务或日程名称' };
  }

  const wantType = params.type || 'auto';
  const taskCandidates: Task[] = [];
  if (wantType === 'task' || wantType === 'auto') {
    const statusFilter = params.includeCompleted ? "status != 'cancelled'" : "status NOT IN ('completed', 'cancelled')";
    const rows = db.prepare(`
      SELECT * FROM tasks
      WHERE user_id = ? AND title LIKE ? AND ${statusFilter}
      ORDER BY id DESC
    `).all(params.userId, `%${trimmedName}%`) as Task[];

    // Check exact title match first if multiple fuzzy matches exist
    const exact = rows.filter(r => r.title.trim().toLowerCase() === trimmedName.toLowerCase());
    taskCandidates.push(...(exact.length > 0 ? exact : rows));
  }

  const eventCandidates: ExternalEvent[] = [];
  if (wantType === 'calendar_event' || (wantType === 'auto' && taskCandidates.length === 0)) {
    let query = `
      SELECT ee.*
      FROM external_events ee
      LEFT JOIN calendar_subscriptions cs ON cs.id = ee.subscription_id
      WHERE ee.user_id = ? AND ee.title LIKE ?
        AND (ee.subscription_id IS NULL OR COALESCE(ee.generation, 0) = COALESCE(cs.current_generation, 0))
        AND COALESCE(ee.status, 'CONFIRMED') != 'CANCELLED'
    `;
    const queryParams: any[] = [params.userId, `%${trimmedName}%`];
    if (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
      const bounds = getAccountDayBoundsUtc(params.date, tz);
      query += ' AND ee.end_time >= ? AND ee.start_time <= ?';
      queryParams.push(bounds.start.toISOString(), bounds.end.toISOString());
    }
    query += ' ORDER BY ee.start_time ASC';
    const evRows = db.prepare(query).all(...queryParams) as ExternalEvent[];
    const exactEv = evRows.filter(e => e.title.trim().toLowerCase() === trimmedName.toLowerCase());
    eventCandidates.push(...(exactEv.length > 0 ? exactEv : evRows));
  }

  const combinedCount = taskCandidates.length + eventCandidates.length;
  if (combinedCount === 0) {
    return { status: 'not_found', message: `未找到包含「${trimmedName}」的任务或日程` };
  }

  if (combinedCount > 1) {
    return {
      status: 'ambiguous',
      candidates: [
        ...taskCandidates.slice(0, 5).map(t => ({
          id: t.id,
          type: 'task' as const,
          title: t.title,
          date: t.scheduled_start ? getAccountLocalDateKey(new Date(t.scheduled_start), tz) : undefined,
          status: t.status,
        })),
        ...eventCandidates.slice(0, 5).map(e => ({
          id: e.id,
          type: 'calendar_event' as const,
          title: e.title,
          date: getAccountLocalDateKey(new Date(e.start_time), tz),
        })),
      ],
    };
  }

  if (taskCandidates.length === 1) {
    const task = taskCandidates[0];
    const inst = ensureTaskInstance(params.userId, task.id, targetDate, now);
    return { status: 'found_task', task, instance: inst };
  }

  return { status: 'found_external', event: eventCandidates[0] };
}

function alignFixedIntervalToRecurrence(
  startIso: string,
  endIso: string,
  timeMode: string | null | undefined,
  recurrenceRule: string | null,
  tz: string
): { startIso: string; endIso: string } {
  if (timeMode !== 'daily_fixed') return { startIso, endIso };
  const s = new Date(startIso);
  const e = new Date(endIso);
  const baseDateKey = getAccountLocalDateKey(s, tz);
  if (isDateMatchingRecurrence(baseDateKey, recurrenceRule)) {
    return { startIso, endIso };
  }
  const [hh, mm] = getAccountLocalTimeHm(s, tz).split(':').map(Number);
  const durMs = Math.max(60000, e.getTime() - s.getTime());
  for (let offset = 1; offset <= 7; offset++) {
    const dk = addDaysToDateKey(baseDateKey, offset);
    if (isDateMatchingRecurrence(dk, recurrenceRule)) {
      const nextStart = zonedWallClockToUtc(dk, hh, mm, 0, 0, tz);
      const nextEnd = new Date(nextStart.getTime() + durMs);
      return { startIso: nextStart.toISOString(), endIso: nextEnd.toISOString() };
    }
  }
  return { startIso, endIso };
}

function checkFixedOverlapWithExisting(
  userId: number,
  startIso: string,
  endIso: string,
  isConcurrent: boolean,
  excludeTaskId?: number,
  options?: { timeMode?: string | null; recurrenceRule?: string | null; timezone?: string }
): string | null {
  if (isConcurrent) return null;
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();

  const ext = getActiveExternalBusyEvents(userId, startIso, endIso);
  const hitExt = ext.find(e => !e.isAllDay && e.start.getTime() < endMs && e.end.getTime() > startMs);
  if (hitExt) {
    return `固定时段与外部日程「${hitExt.title}」冲突`;
  }

  const overlapStmt = db.prepare(`
    SELECT sb.*, t.title
    FROM schedule_blocks sb
    JOIN tasks t ON t.id = sb.task_id
    WHERE sb.user_id = ?
      AND sb.status IN ('planned', 'in_progress')
      AND sb.is_concurrent = 0
      AND (sb.is_fixed = 1 OR sb.is_committed = 1)
      AND (? IS NULL OR sb.task_id != ?)
      AND sb.end_time > ?
      AND sb.start_time < ?
    LIMIT 1
  `);

  const overlappingFixed = overlapStmt.get(userId, excludeTaskId ?? null, excludeTaskId ?? null, startIso, endIso) as
    | { title: string }
    | undefined;

  if (overlappingFixed) {
    return `固定时段与已有固定任务「${overlappingFixed.title}」重叠冲突`;
  }

  const fixedTemplates = options?.timezone
    ? (db.prepare(`
        SELECT id, title, scheduled_start, scheduled_end, recurrence_rule, completed_dates
        FROM tasks
        WHERE user_id = ?
          AND time_mode = 'daily_fixed'
          AND is_fixed = 1
          AND is_concurrent = 0
          AND COALESCE(active_template, 1) = 1
          AND status != 'cancelled'
          AND scheduled_start IS NOT NULL
          AND scheduled_end IS NOT NULL
          AND (? IS NULL OR id != ?)
      `).all(userId, excludeTaskId ?? null, excludeTaskId ?? null) as Array<{
        id: number;
        title: string;
        scheduled_start: string;
        scheduled_end: string;
        recurrence_rule: string | null;
        completed_dates: string | null;
      }>)
    : [];

  const checkTemplateOverlapOnDate = (dk: string, occStartMs: number, occEndMs: number): string | null => {
    if (!options?.timezone) return null;
    const tz = options.timezone;
    for (const tmpl of fixedTemplates) {
      const tmplStart = new Date(tmpl.scheduled_start);
      const tmplEnd = new Date(tmpl.scheduled_end);
      const tmplStartKey = getAccountLocalDateKey(tmplStart, tz);
      if (dk < tmplStartKey) continue;
      if (!isDateMatchingRecurrence(dk, tmpl.recurrence_rule)) continue;
      try {
        const done = JSON.parse(tmpl.completed_dates || '[]');
        if (Array.isArray(done) && done.includes(dk)) continue;
      } catch {}
      const [thh, tmm] = getAccountLocalTimeHm(tmplStart, tz).split(':').map(Number);
      const tDurMs = Math.max(60000, tmplEnd.getTime() - tmplStart.getTime());
      const tOccStart = zonedWallClockToUtc(dk, thh, tmm, 0, 0, tz).getTime();
      const tOccEnd = tOccStart + tDurMs;
      if (tOccStart < occEndMs && tOccEnd > occStartMs) {
        return `固定时段在 ${dk} 与已有固定周期任务「${tmpl.title}」重叠冲突`;
      }
    }
    return null;
  };

  if (options?.timezone) {
    const initDk = getAccountLocalDateKey(new Date(startIso), options.timezone);
    const initTmplErr = checkTemplateOverlapOnDate(initDk, startMs, endMs);
    if (initTmplErr) return initTmplErr;
  }

  if (options?.timeMode === 'daily_fixed' && options.timezone) {
    const tz = options.timezone;
    const baseDate = getAccountLocalDateKey(new Date(startIso), tz);
    const [hh, mm] = getAccountLocalTimeHm(new Date(startIso), tz).split(':').map(Number);
    const durMs = Math.max(60000, endMs - startMs);
    for (let offset = 1; offset < 14; offset++) {
      const dk = addDaysToDateKey(baseDate, offset);
      if (!isDateMatchingRecurrence(dk, options.recurrenceRule)) continue;
      const occStart = zonedWallClockToUtc(dk, hh, mm, 0, 0, tz);
      const occEnd = new Date(occStart.getTime() + durMs);
      const hitFutureFixed = overlapStmt.get(
        userId,
        excludeTaskId ?? null,
        excludeTaskId ?? null,
        occStart.toISOString(),
        occEnd.toISOString()
      ) as { title: string } | undefined;
      if (hitFutureFixed) {
        return `固定时段在 ${dk} 与已有固定任务「${hitFutureFixed.title}」重叠冲突`;
      }
      const hitTemplateErr = checkTemplateOverlapOnDate(dk, occStart.getTime(), occEnd.getTime());
      if (hitTemplateErr) return hitTemplateErr;
    }
  }
  return null;
}

export interface CreateTaskServiceResult {
  success: boolean;
  statusCode: number;
  message: string;
  task?: Task;
  instance?: TaskInstance | null;
  planVersion?: number;
  proposal?: ScheduleProposal & { proposalId: string };
  replan?: ReturnType<typeof replanUserTasks>;
}

/**
 * 共享任务创建服务（T01, T02, T11, T13）：
 * - 先做命令校验、硬截止校验与固定区间/冲突校验
 * - 用户已显式传入耗时时不强制依赖模型；仅未传耗时时调用模型估算
 * - 在同一事务内写入 task、task_instance 与固定块，再执行排程发布
 */
export async function createTaskCommand(params: {
  userId: number;
  rawInput: Record<string, any>;
  allowProposal?: boolean;
  dryRun?: boolean;
}): Promise<CreateTaskServiceResult> {
  const tz = getUserTimezone(params.userId);
  const now = new Date();
  const raw = params.rawInput || {};

  const hasExplicitDuration =
    raw.duration_minutes !== undefined && raw.duration_minutes !== null && raw.duration_minutes !== '';

  if (
    hasExplicitDuration &&
    (!Number.isInteger(Number(raw.duration_minutes)) ||
      Number(raw.duration_minutes) <= 0 ||
      Number(raw.duration_minutes) > 100000)
  ) {
    return { success: false, statusCode: 400, message: '预计耗时必须为有效的正整数分钟数' };
  }

  const normalizedInput = {
    title: raw.title,
    notes: raw.notes ?? null,
    duration_minutes: hasExplicitDuration ? Number(raw.duration_minutes) : null,
    has_explicit_duration: hasExplicitDuration,
    importance: raw.importance !== undefined && raw.importance !== null ? Number(raw.importance) : null,
    urgency: raw.urgency !== undefined && raw.urgency !== null ? Number(raw.urgency) : null,
    importance_tier: raw.importance_tier ?? null,
    impact_signals: parseImpactSignalsArray(raw.impact_signals),
    importance_manual_override:
      raw.importance_manual_override !== undefined &&
      raw.importance_manual_override !== null &&
      raw.importance_manual_override !== ''
        ? Number(raw.importance_manual_override)
        : null,
    score_scale: raw.score_scale ?? 100,
    time_mode: raw.time_mode ?? null,
    recurrence_rule: raw.recurrence_rule ?? null,
    urgency_pace: raw.urgency_pace ?? null,
    deadline: raw.deadline ?? null,
    deadline_kind: raw.deadline_kind ?? null,
    is_fixed: Boolean(raw.is_fixed),
    is_concurrent: Boolean(raw.is_concurrent),
    scheduled_start: raw.scheduled_start ?? null,
    scheduled_end: raw.scheduled_end ?? null,
    tags: parseTagsArray(raw.tags),
    auto_schedule: raw.auto_schedule !== undefined ? Boolean(raw.auto_schedule) : true,
    session_plan: Array.isArray(raw.session_plan) ? raw.session_plan : null,
    source_fingerprint: raw.source_fingerprint ?? null,
  };

  const parsedCmd = createTaskCommandSchema.safeParse(normalizedInput);
  if (!parsedCmd.success) {
    return {
      success: false,
      statusCode: 400,
      message: parsedCmd.error.issues[0]?.message || '任务参数无效',
    };
  }
  const cmd = parsedCmd.data;

  // 1. Validate deadline and hard deadline early BEFORE any LLM call (T13)
  const normalizedDeadline = normalizeCommandDeadline(cmd.deadline, tz);
  const deadlineKind: 'hard' | 'soft' = cmd.deadline_kind === 'hard' ? 'hard' : 'soft';
  if (cmd.time_mode === 'specific_date' && !normalizedDeadline) {
    return { success: false, statusCode: 400, message: '指定执行日期的任务需要提供具体日期' };
  }
  if (deadlineKind === 'hard' && !normalizedDeadline) {
    return { success: false, statusCode: 400, message: '不可逾期任务需要有效的截止时间' };
  }

  // 2. Validate fixed interval BEFORE any LLM call (T02)
  const fixedCheck = validateFixedInterval({
    isFixed: Boolean(cmd.is_fixed),
    startRaw: cmd.scheduled_start,
    endRaw: cmd.scheduled_end,
    durationMinutes: cmd.duration_minutes ?? null,
    deadlineIso: normalizedDeadline,
    deadlineKind,
    timezone: tz,
  });
  if (!fixedCheck.valid) {
    return { success: false, statusCode: 400, message: fixedCheck.error || '固定时段参数无效' };
  }

  if (cmd.is_fixed && fixedCheck.startIso && fixedCheck.endIso) {
    const earlyTimeMode = cmd.time_mode || (normalizedDeadline ? 'deadline' : 'flexible');
    const earlyRecurrenceRule = normalizeRecurrenceRuleForMode(cmd.recurrence_rule, earlyTimeMode);
    const aligned = alignFixedIntervalToRecurrence(
      fixedCheck.startIso,
      fixedCheck.endIso,
      earlyTimeMode,
      earlyRecurrenceRule,
      tz
    );
    fixedCheck.startIso = aligned.startIso;
    fixedCheck.endIso = aligned.endIso;
    const overlapErr = checkFixedOverlapWithExisting(
      params.userId,
      fixedCheck.startIso,
      fixedCheck.endIso,
      Boolean(cmd.is_concurrent),
      undefined,
      { timeMode: earlyTimeMode, recurrenceRule: earlyRecurrenceRule, timezone: tz }
    );
    if (overlapErr) {
      return { success: false, statusCode: 409, message: overlapErr };
    }
  }

  // 3. Resolve duration & optional semantic sessions
  let finalDuration = fixedCheck.durationMinutes ?? cmd.duration_minutes ?? null;
  let sessionPlan: number[] | null = cmd.session_plan ?? null;

  if (!finalDuration || finalDuration <= 0) {
    try {
      const plan = await planTaskWithLLM(params.userId, cmd.title, undefined, cmd.notes || undefined, {
        dryRun: params.dryRun,
      });
      finalDuration = plan.minutes;
      sessionPlan = plan.sessions;
    } catch (err: any) {
      return {
        success: false,
        statusCode: 400,
        message: err.message || '无法预估任务耗时，请检查 LLM 配置或填写预计耗时',
      };
    }
  } else if (!sessionPlan && !cmd.is_fixed && finalDuration > 90 && raw.use_llm_sessions) {
    try {
      const plan = await planTaskWithLLM(params.userId, cmd.title, finalDuration, cmd.notes || undefined, {
        dryRun: params.dryRun,
      });
      sessionPlan = plan.sessions;
    } catch {
      sessionPlan = null;
    }
  }

  // 4. Compute unified 100-scale scores
  const todayBusy = computeTodayBusyMinutes(params.userId, now);
  const scores = resolveTaskPriorityScores({
    durationMinutes: finalDuration,
    isFixed: Boolean(cmd.is_fixed),
    importance: cmd.importance,
    urgency: cmd.urgency,
    importanceTier: cmd.importance_tier,
    impactSignals: parseImpactSignalsArray(cmd.impact_signals),
    manualOverride: cmd.importance_manual_override,
    scoreScale: cmd.score_scale,
    timeMode: cmd.time_mode,
    urgencyPace: cmd.urgency_pace,
    deadlineIso: normalizedDeadline,
    scheduledStartIso: fixedCheck.startIso,
    scheduledEndIso: fixedCheck.endIso,
    dailyBusyMinutesAhead: todayBusy,
  });

  // 5. Optional proposal check (used by Weixin / interactive flow when displacing movable future slots)
  if (params.allowProposal && !cmd.is_fixed && cmd.auto_schedule !== false) {
    const prePlan = scheduleTask(params.userId, {
      title: cmd.title,
      duration_minutes: finalDuration,
      session_plan: sessionPlan ? JSON.stringify(sessionPlan) : null,
      deadline_kind: deadlineKind,
      urgency_pace: scores.urgencyPace,
      time_mode: scores.timeMode,
      is_concurrent: cmd.is_concurrent ? 1 : 0,
      urgency: scores.urgency,
      importance: scores.importance,
      deadline: normalizedDeadline,
    });

    if (prePlan.proposal) {
      const conflictInst = ensureTaskInstance(
        params.userId,
        prePlan.proposal.conflictTask.id,
        getAccountLocalDateKey(now, tz),
        now
      );
      if (conflictInst) {
        const propRecord = createScheduleProposal({
          userId: params.userId,
          basePlanVersion: getLatestPlanVersion(params.userId),
          reasonType: prePlan.proposal.type,
          reasonText: prePlan.proposal.reasonText,
          payload: {
            newTaskSpec: {
              title: cmd.title,
              duration_minutes: finalDuration,
              original_duration_minutes: finalDuration,
              urgency: scores.urgency,
              importance: scores.importance,
              importance_tier: scores.importanceTier,
              impact_signals: scores.impactSignals,
              time_mode: scores.timeMode,
              urgency_pace: scores.urgencyPace,
              deadline: normalizedDeadline,
              deadline_kind: deadlineKind,
              is_concurrent: Boolean(cmd.is_concurrent),
              tags: cmd.tags,
              notes: cmd.notes || null,
              session_plan: sessionPlan,
            },
            proposal: prePlan.proposal,
            conflictInstanceId: conflictInst.id,
            conflictInstanceVersion: conflictInst.version,
            fallbackDirectPlan:
              prePlan.success && prePlan.scheduled_start && prePlan.scheduled_end
                ? {
                    start: prePlan.scheduled_start,
                    end: prePlan.scheduled_end,
                    blocks: prePlan.schedule_blocks ? JSON.parse(prePlan.schedule_blocks) : [],
                  }
                : null,
          },
        });

        return {
          success: true,
          statusCode: 202,
          message: '按当前日程排程存在冲突或更优调整建议，请确认是否同步调整',
          proposal: { ...prePlan.proposal, proposalId: propRecord.id },
        };
      }
    }
  }

  const recurrenceRuleJson = normalizeRecurrenceRuleForMode(cmd.recurrence_rule, scores.timeMode);

  // 6. Atomic DB insert of task + task_instance (+ fixed block if fixed)
  let newTaskId = 0;
  let newInstanceId = 0;

  db.transaction(() => {
    const initialStatus: Task['status'] = cmd.is_fixed && fixedCheck.startIso && fixedCheck.endIso ? 'scheduled' : 'pending_slot';
    const fixedBlocksJson =
      cmd.is_fixed && fixedCheck.startIso && fixedCheck.endIso
        ? JSON.stringify([{ start: fixedCheck.startIso, end: fixedCheck.endIso, duration: finalDuration }])
        : null;

    const res = db.prepare(`
      INSERT INTO tasks (
        user_id, title, duration_minutes, original_duration_minutes, urgency, importance,
        importance_tier, impact_signals, time_mode, recurrence_rule, urgency_pace, importance_manual_override,
        score_scale, completed_dates, deadline, deadline_kind,
        scheduled_start, scheduled_end, is_fixed, is_concurrent, tags, status,
        schedule_blocks, session_plan, notes, version, active_template, source_fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 100, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
    `).run(
      params.userId,
      cmd.title,
      finalDuration,
      finalDuration,
      scores.urgency,
      scores.importance,
      scores.importanceTier,
      JSON.stringify(scores.impactSignals),
      scores.timeMode,
      recurrenceRuleJson,
      scores.urgencyPace,
      scores.manualOverride,
      normalizedDeadline,
      deadlineKind,
      fixedCheck.startIso,
      fixedCheck.endIso,
      cmd.is_fixed ? 1 : 0,
      cmd.is_concurrent ? 1 : 0,
      JSON.stringify(cmd.tags || []),
      initialStatus,
      fixedBlocksJson,
      sessionPlan ? JSON.stringify(sessionPlan) : null,
      cmd.notes || null,
      cmd.source_fingerprint || null
    );

    newTaskId = Number(res.lastInsertRowid);
    const initialBizDate = resolveInitialBusinessDate(scores.timeMode, recurrenceRuleJson, fixedCheck.startIso, normalizedDeadline, now, tz);
    const inst = ensureTaskInstance(params.userId, newTaskId, initialBizDate, now)!;
    newInstanceId = inst.id;

    if (cmd.is_fixed && fixedCheck.startIso && fixedCheck.endIso) {
      const planVer = getLatestPlanVersion(params.userId);
      db.prepare(`
        INSERT INTO schedule_blocks (
          id, user_id, plan_version, instance_id, task_id,
          start_time, end_time, duration_minutes, part_index, total_parts,
          is_fixed, is_committed, is_concurrent, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, ?, 'planned')
      `).run(
        `blk-${newTaskId}-${newInstanceId}-fixed`,
        params.userId,
        planVer,
        newInstanceId,
        newTaskId,
        fixedCheck.startIso,
        fixedCheck.endIso,
        finalDuration,
        cmd.is_concurrent ? 1 : 0
      );
      syncLegacyTaskProjection(params.userId, newTaskId, now);
    }
  })();

  let replan: ReturnType<typeof replanUserTasks> | undefined;
  if (cmd.auto_schedule !== false || cmd.is_fixed) {
    replan = replanUserTasks(params.userId, { triggerSource: 'create_task' });
  }

  const createdTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(newTaskId) as Task;
  const createdInst = db.prepare('SELECT * FROM task_instances WHERE id = ?').get(newInstanceId) as TaskInstance | null;

  const msg = createdTask.scheduled_start
    ? cmd.is_fixed
      ? '固定任务已创建并锁定时间段！'
      : '任务已创建并排入日历'
    : createdInst?.plan_reason
    ? `任务已创建，${createdInst.plan_reason}`
    : '任务已创建，暂未找到合适时段';

  return {
    success: true,
    statusCode: 201,
    message: msg,
    task: createdTask,
    instance: createdInst,
    planVersion: replan?.planVersion,
    replan,
  };
}

/**
 * 共享任务局部更新服务（T01, T02, T11）：
 * - 拒绝越权状态直写、校验固定时间区间与冲突
 * - 显式更新局部字段，保护既有 tags / deadline_kind / 历史已投入工时
 */
export async function updateTaskCommand(params: {
  userId: number;
  taskId: number;
  rawInput: Record<string, any>;
}): Promise<CreateTaskServiceResult> {
  const tz = getUserTimezone(params.userId);
  const now = new Date();
  const existing = db
    .prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
    .get(params.taskId, params.userId) as Task | undefined;

  if (!existing) {
    return { success: false, statusCode: 404, message: '任务不存在' };
  }

  const raw = params.rawInput || {};
  const normalizedInput: Record<string, any> = {};
  if (raw.title !== undefined) normalizedInput.title = raw.title;
  if (raw.notes !== undefined) normalizedInput.notes = raw.notes;
  if (raw.duration_minutes !== undefined && raw.duration_minutes !== null && raw.duration_minutes !== '') {
    normalizedInput.duration_minutes = Number(raw.duration_minutes);
  }
  if (raw.importance !== undefined && raw.importance !== null) normalizedInput.importance = Number(raw.importance);
  if (raw.urgency !== undefined && raw.urgency !== null) normalizedInput.urgency = Number(raw.urgency);
  if (raw.importance_tier !== undefined) normalizedInput.importance_tier = raw.importance_tier;
  if (raw.impact_signals !== undefined) normalizedInput.impact_signals = parseImpactSignalsArray(raw.impact_signals);
  if (raw.importance_manual_override !== undefined) {
    normalizedInput.importance_manual_override =
      raw.importance_manual_override !== null && raw.importance_manual_override !== ''
        ? Number(raw.importance_manual_override)
        : null;
  }
  if (raw.score_scale !== undefined) normalizedInput.score_scale = raw.score_scale;
  if (raw.time_mode !== undefined) normalizedInput.time_mode = raw.time_mode;
  if (raw.recurrence_rule !== undefined) normalizedInput.recurrence_rule = raw.recurrence_rule;
  if (raw.urgency_pace !== undefined) normalizedInput.urgency_pace = raw.urgency_pace;
  if (raw.deadline !== undefined) normalizedInput.deadline = raw.deadline;
  if (raw.deadline_kind !== undefined) normalizedInput.deadline_kind = raw.deadline_kind;
  if (raw.is_fixed !== undefined) normalizedInput.is_fixed = Boolean(raw.is_fixed);
  if (raw.is_concurrent !== undefined) normalizedInput.is_concurrent = Boolean(raw.is_concurrent);
  if (raw.scheduled_start !== undefined) normalizedInput.scheduled_start = raw.scheduled_start;
  if (raw.scheduled_end !== undefined) normalizedInput.scheduled_end = raw.scheduled_end;
  if (raw.tags !== undefined) normalizedInput.tags = parseTagsArray(raw.tags);
  if (raw.expected_version !== undefined) normalizedInput.expected_version = Number(raw.expected_version);

  const parsedCmd = updateTaskCommandSchema.safeParse(normalizedInput);
  if (!parsedCmd.success) {
    return {
      success: false,
      statusCode: 400,
      message: parsedCmd.error.issues[0]?.message || '更新参数无效',
    };
  }
  const cmd = parsedCmd.data;

  if (cmd.expected_version !== undefined && existing.version !== undefined && cmd.expected_version !== existing.version) {
    return { success: false, statusCode: 409, message: '任务已被其他操作修改，请刷新后重试' };
  }

  const nextTitle = cmd.title ?? existing.title;
  const nextIsFixed = cmd.is_fixed !== undefined ? cmd.is_fixed : Boolean(existing.is_fixed);
  const nextIsConcurrent = cmd.is_concurrent !== undefined ? cmd.is_concurrent : Boolean(existing.is_concurrent);
  const nextDeadline =
    cmd.deadline !== undefined
      ? normalizeCommandDeadline(cmd.deadline, tz)
      : normalizeCommandDeadline(existing.deadline, tz);
  const nextDeadlineKind: 'hard' | 'soft' =
    cmd.deadline_kind ?? (nextDeadline ? (existing.deadline_kind === 'hard' ? 'hard' : 'soft') : 'soft');
  const effectiveCandidateMode = cmd.time_mode ?? existing.time_mode;

  if (effectiveCandidateMode === 'specific_date' && !nextDeadline) {
    return { success: false, statusCode: 400, message: '指定执行日期的任务需要提供具体日期' };
  }
  if (nextDeadlineKind === 'hard' && !nextDeadline) {
    return { success: false, statusCode: 400, message: '不可逾期任务需要有效的截止时间' };
  }

  const nextDuration = cmd.duration_minutes ?? existing.duration_minutes;
  const nextStartRaw = cmd.scheduled_start !== undefined ? cmd.scheduled_start : existing.scheduled_start;
  const nextEndRaw = cmd.scheduled_end !== undefined ? cmd.scheduled_end : existing.scheduled_end;

  const fixedCheck = validateFixedInterval({
    isFixed: nextIsFixed,
    startRaw: nextStartRaw,
    endRaw: nextEndRaw,
    durationMinutes: cmd.duration_minutes ?? (nextIsFixed ? nextDuration : null),
    deadlineIso: nextDeadline,
    deadlineKind: nextDeadlineKind,
    timezone: tz,
  });

  if (!fixedCheck.valid) {
    return { success: false, statusCode: 400, message: fixedCheck.error || '固定时段参数无效' };
  }

  if (nextIsFixed && fixedCheck.startIso && fixedCheck.endIso) {
    const earlyTimeMode = cmd.time_mode ?? existing.time_mode;
    const earlyRecurrenceRule =
      cmd.recurrence_rule !== undefined
        ? normalizeRecurrenceRuleForMode(cmd.recurrence_rule, earlyTimeMode)
        : normalizeRecurrenceRuleForMode(existing.recurrence_rule, earlyTimeMode);
    const aligned = alignFixedIntervalToRecurrence(
      fixedCheck.startIso,
      fixedCheck.endIso,
      earlyTimeMode,
      earlyRecurrenceRule,
      tz
    );
    fixedCheck.startIso = aligned.startIso;
    fixedCheck.endIso = aligned.endIso;
    const overlapErr = checkFixedOverlapWithExisting(
      params.userId,
      fixedCheck.startIso,
      fixedCheck.endIso,
      nextIsConcurrent,
      existing.id,
      { timeMode: earlyTimeMode, recurrenceRule: earlyRecurrenceRule, timezone: tz }
    );
    if (overlapErr) {
      return { success: false, statusCode: 409, message: overlapErr };
    }
  }

  const finalDuration = fixedCheck.durationMinutes ?? nextDuration;
  const nextTags = cmd.tags !== undefined ? cmd.tags : parseTagsArray(existing.tags);
  const nextSignals = cmd.impact_signals !== undefined ? cmd.impact_signals : parseImpactSignalsArray(existing.impact_signals);

  const todayKey = getAccountLocalDateKey(now, tz);
  const inst = ensureTaskInstance(params.userId, existing.id, todayKey, now);
  const isCompletedToday = inst?.status === 'completed';

  const scores = resolveTaskPriorityScores({
    durationMinutes: finalDuration,
    isFixed: nextIsFixed,
    importance: cmd.importance !== undefined ? cmd.importance : existing.importance,
    urgency: cmd.urgency !== undefined ? cmd.urgency : existing.urgency,
    importanceTier: cmd.importance_tier !== undefined ? cmd.importance_tier : existing.importance_tier,
    impactSignals: parseImpactSignalsArray(nextSignals),
    manualOverride:
      cmd.importance_manual_override !== undefined
        ? cmd.importance_manual_override
        : existing.importance_manual_override,
    scoreScale: cmd.score_scale ?? existing.score_scale ?? 100,
    timeMode: cmd.time_mode ?? existing.time_mode,
    urgencyPace: cmd.urgency_pace ?? existing.urgency_pace,
    deadlineIso: nextDeadline,
    scheduledStartIso: nextIsFixed ? fixedCheck.startIso : existing.scheduled_start,
    scheduledEndIso: nextIsFixed ? fixedCheck.endIso : existing.scheduled_end,
    isCompletedToday,
    dailyBusyMinutesAhead: computeTodayBusyMinutes(params.userId, now, existing.id),
    createdAt: existing.created_at,
  });

  const nextVersion = (existing.version || 1) + 1;
  const nextRecurrenceRule =
    cmd.recurrence_rule !== undefined
      ? normalizeRecurrenceRuleForMode(cmd.recurrence_rule, scores.timeMode)
      : normalizeRecurrenceRuleForMode(existing.recurrence_rule, scores.timeMode);

  db.transaction(() => {
    db.prepare(`
      UPDATE tasks
      SET title = ?,
          duration_minutes = ?,
          original_duration_minutes = CASE
            WHEN ? != duration_minutes THEN COALESCE(original_duration_minutes, 0) + (? - duration_minutes)
            ELSE original_duration_minutes
          END,
          urgency = ?,
          importance = ?,
          importance_tier = ?,
          impact_signals = ?,
          time_mode = ?,
          recurrence_rule = ?,
          urgency_pace = ?,
          importance_manual_override = ?,
          score_scale = 100,
          deadline = ?,
          deadline_kind = ?,
          scheduled_start = COALESCE(?, scheduled_start),
          scheduled_end = COALESCE(?, scheduled_end),
          is_fixed = ?,
          is_concurrent = ?,
          tags = ?,
          notes = ?,
          version = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(
      nextTitle,
      finalDuration,
      finalDuration,
      finalDuration,
      scores.urgency,
      scores.importance,
      scores.importanceTier,
      JSON.stringify(scores.impactSignals),
      scores.timeMode,
      nextRecurrenceRule,
      scores.urgencyPace,
      scores.manualOverride,
      nextDeadline,
      nextDeadlineKind,
      nextIsFixed && fixedCheck.startIso ? fixedCheck.startIso : null,
      nextIsFixed && fixedCheck.endIso ? fixedCheck.endIso : null,
      nextIsFixed ? 1 : 0,
      nextIsConcurrent ? 1 : 0,
      JSON.stringify(nextTags),
      cmd.notes !== undefined ? cmd.notes : existing.notes,
      nextVersion,
      existing.id,
      params.userId
    );

    if (inst) {
      if (
        scores.timeMode === 'daily_fixed' &&
        !isDateMatchingRecurrence(todayKey, nextRecurrenceRule) &&
        inst.status === 'pending' &&
        inst.completed_minutes === 0
      ) {
        db.prepare(`
          UPDATE task_instances
          SET status = 'cancelled', allocated_minutes = 0, unallocated_minutes = 0, version = version + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(inst.id);
        db.prepare(`
          UPDATE schedule_blocks
          SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
          WHERE instance_id = ? AND status IN ('planned', 'conflict')
        `).run(inst.id);
      } else {
        // Update active instance estimated_minutes preserving already completed minutes
      const nextEstimated = Math.max(inst.completed_minutes, inst.completed_minutes + finalDuration);
      db.prepare(`
        UPDATE task_instances
        SET estimated_minutes = ?,
            version = version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(cmd.duration_minutes !== undefined ? nextEstimated : Math.max(inst.estimated_minutes, finalDuration), inst.id);

      if (nextIsFixed && fixedCheck.startIso && fixedCheck.endIso) {
        db.prepare(`
          UPDATE schedule_blocks
          SET status = 'superseded', updated_at = CURRENT_TIMESTAMP
          WHERE instance_id = ? AND status IN ('planned', 'conflict')
        `).run(inst.id);

        const planVer = getLatestPlanVersion(params.userId);
        db.prepare(`
          INSERT INTO schedule_blocks (
            id, user_id, plan_version, instance_id, task_id,
            start_time, end_time, duration_minutes, part_index, total_parts,
            is_fixed, is_committed, is_concurrent, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, ?, 'planned')
        `).run(
          `blk-${existing.id}-${inst.id}-fixed-${nextVersion}`,
          params.userId,
          planVer,
          inst.id,
          existing.id,
          fixedCheck.startIso,
          fixedCheck.endIso,
          finalDuration,
          nextIsConcurrent ? 1 : 0
        );
      } else if (cmd.is_fixed === false && existing.is_fixed === 1) {
        // Unpinned: mark old fixed blocks superseded so planner reschedules cleanly
        db.prepare(`
          UPDATE schedule_blocks
          SET is_fixed = 0, is_committed = 0, status = 'superseded', updated_at = CURRENT_TIMESTAMP
          WHERE instance_id = ? AND status IN ('planned', 'conflict')
        `).run(inst.id);
      } else if (
        scores.timeMode === 'specific_date' &&
        (existing.time_mode !== 'specific_date' || existing.deadline !== nextDeadline)
      ) {
        // Explicit move to a specific execution date: release any previously planned blocks so it moves cleanly
        db.prepare(`
          UPDATE schedule_blocks
          SET is_fixed = 0, is_committed = 0, status = 'superseded', updated_at = CURRENT_TIMESTAMP
          WHERE instance_id = ? AND status IN ('planned', 'conflict')
        `).run(inst.id);
        if (nextDeadline) {
          const parsedTarget = parseAccountDateOrIso(nextDeadline, tz);
          if (parsedTarget) {
            const targetDk = getAccountLocalDateKey(parsedTarget, tz);
            db.prepare(`
              UPDATE task_instances
              SET business_date = ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ? AND instance_type = 'once'
            `).run(targetDk, inst.id);
          }
        }
      }
      }

      // Sync unstarted future recurring instances/blocks when recurring schedule parameters change
      if (scores.timeMode === 'daily_fixed') {
        const templateChanged =
          cmd.scheduled_start !== undefined ||
          cmd.scheduled_end !== undefined ||
          cmd.is_fixed !== undefined ||
          cmd.is_concurrent !== undefined ||
          cmd.duration_minutes !== undefined ||
          cmd.recurrence_rule !== undefined;
        if (templateChanged) {
          db.prepare(`
            UPDATE task_instances
            SET estimated_minutes = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
            WHERE task_id = ? AND instance_type = 'daily' AND business_date > ? AND status = 'pending' AND completed_minutes = 0
          `).run(finalDuration, existing.id, todayKey);
          db.prepare(`
            UPDATE schedule_blocks
            SET is_fixed = 0, is_committed = 0, status = 'superseded', updated_at = CURRENT_TIMESTAMP
            WHERE task_id = ? AND status IN ('planned', 'conflict')
              AND instance_id IN (
                SELECT id FROM task_instances
                WHERE task_id = ? AND instance_type = 'daily' AND business_date > ? AND status = 'pending'
              )
          `).run(existing.id, existing.id, todayKey);
        }
      }
      syncLegacyTaskProjection(params.userId, existing.id, now);
    }
  })();

  // Optional async LLM session re-split guarded by task version (T11)
  if (raw.use_llm_sessions && (finalDuration !== existing.duration_minutes || nextTitle !== existing.title)) {
    try {
      const plan = await planTaskWithLLM(params.userId, nextTitle, finalDuration, cmd.notes ?? existing.notes ?? undefined);
      const currentTask = db.prepare('SELECT version FROM tasks WHERE id = ?').get(existing.id) as { version: number } | undefined;
      if (currentTask && currentTask.version === nextVersion) {
        db.prepare('UPDATE tasks SET session_plan = ? WHERE id = ? AND version = ?').run(
          JSON.stringify(plan.sessions),
          existing.id,
          nextVersion
        );
      }
    } catch {}
  }

  const replan = replanUserTasks(params.userId, { triggerSource: 'update_task' });
  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(existing.id) as Task;
  const updatedInst = inst ? (db.prepare('SELECT * FROM task_instances WHERE id = ?').get(inst.id) as TaskInstance) : null;

  return {
    success: true,
    statusCode: 200,
    message: updated.scheduled_start ? '任务更新成功并已同步更新排程' : `任务已更新（${updatedInst?.plan_reason || '待安排时段'}）`,
    task: updated,
    instance: updatedInst,
    planVersion: replan.planVersion,
    replan,
  };
}

export function deleteTaskCommand(userId: number, taskId: number): { success: boolean; message: string; planVersion?: number } {
  const existing = db.prepare('SELECT id, title FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId) as
    | { id: number; title: string }
    | undefined;
  if (!existing) {
    return { success: false, message: '任务不存在' };
  }

  db.transaction(() => {
    // Cancel pending notifications before cascade delete
    db.prepare(`
      UPDATE notification_outbox
      SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND instance_id IN (SELECT id FROM task_instances WHERE task_id = ?)
        AND status IN ('pending', 'failed')
    `).run(userId, taskId);
    db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(taskId, userId);
  })();

  const replan = replanUserTasks(userId, { triggerSource: 'delete_task' });
  return {
    success: true,
    message: `已删除任务「${existing.title}」并更新日历排程`,
    planVersion: replan.planVersion,
  };
}

export function ignoreExternalCalendarInstance(userId: number, eventId: number): { success: boolean; message: string; planVersion?: number } {
  const ev = db.prepare('SELECT * FROM external_events WHERE id = ? AND user_id = ?').get(eventId, userId) as ExternalEvent | undefined;
  if (!ev) {
    return { success: false, message: '未找到指定外部日程' };
  }

  db.transaction(() => {
    if (ev.subscription_id && ev.uid) {
      db.prepare(`
        INSERT OR IGNORE INTO calendar_ignored_instances (
          user_id, subscription_id, event_uid, occurrence_start, title
        ) VALUES (?, ?, ?, ?, ?)
      `).run(userId, ev.subscription_id, ev.uid, ev.occurrence_start || ev.start_time, ev.title);
    }
    db.prepare('DELETE FROM external_events WHERE id = ? AND user_id = ?').run(eventId, userId);
  })();

  const replan = replanUserTasks(userId, { triggerSource: 'ignore_external_event' });
  return {
    success: true,
    message: `已本地忽略外部日程「${ev.title}」（后续同步不再复现）`,
    planVersion: replan.planVersion,
  };
}

export function executeQuickActionCommand(params: {
  userId: number;
  taskId: number;
  action: 'start' | 'complete' | 'reopen' | 'cancel' | 'extend' | 'stop_daily';
  extendMinutes?: number;
  businessDate?: string;
  targetRemainingMinutes?: number;
  commandId?: string;
}): {
  success: boolean;
  statusCode: number;
  message: string;
  task?: Task;
  planVersion?: number;
} {
  if (params.action === 'extend') {
    const ext = extendTaskDuration(params.userId, params.taskId, params.extendMinutes ?? 30);
    return {
      success: ext.success,
      statusCode: ext.success ? 200 : 400,
      message: ext.message,
      task: ext.task,
      planVersion: getLatestPlanVersion(params.userId),
    };
  }

  const prog = executeInstanceProgressCommand({
    userId: params.userId,
    taskId: params.taskId,
    action: params.action,
    businessDate: params.businessDate,
    targetRemainingMinutes: params.targetRemainingMinutes,
    commandId: params.commandId,
  });

  if (!prog.success) {
    return {
      success: false,
      statusCode: prog.staleVersion ? 409 : 400,
      message: prog.message,
    };
  }

  let planVersion = getLatestPlanVersion(params.userId);
  if (prog.needsReplan) {
    const replan = replanUserTasks(params.userId, { triggerSource: `action_${params.action}` });
    planVersion = replan.planVersion ?? planVersion;
  }

  const updatedTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(params.taskId) as Task | undefined;
  return {
    success: true,
    statusCode: 200,
    message: prog.message,
    task: updatedTask,
    planVersion,
  };
}
