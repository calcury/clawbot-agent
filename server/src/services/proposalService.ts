import crypto from 'crypto';
import { db } from '../config/database.js';
import type {
  ScheduleBlockRecord,
  ScheduleProposalRecord,
  Task,
  TaskInstance,
} from '../models/types.js';
import { getUserTimezone } from './accountService.js';
import { getAccountLocalDateKey } from '../utils/timezone.js';
import {
  ensureTaskInstance,
  getLatestPlanVersion,
  syncLegacyTaskProjection,
} from './instanceService.js';
import {
  getActiveExternalBusyEvents,
  replanUserTasks,
  scheduleTask,
  type ScheduleProposal,
} from './scheduler.js';

export interface ProposalPayload {
  newTaskSpec: {
    title: string;
    duration_minutes: number;
    original_duration_minutes?: number;
    urgency: number;
    importance: number;
    importance_tier?: 'vital' | 'support' | 'minor' | null;
    impact_signals?: string[];
    time_mode?: 'deadline' | 'specific_date' | 'daily_fixed' | 'flexible';
    urgency_pace?: 'urgent' | 'soon' | 'later';
    deadline?: string | null;
    deadline_kind?: 'hard' | 'soft';
    is_concurrent?: boolean;
    tags?: string[];
    notes?: string | null;
    session_plan?: number[] | null;
  };
  targetTaskId?: number;
  targetInstanceId?: number;
  targetInstanceVersion?: number;
  proposal: ScheduleProposal;
  conflictInstanceId: number;
  conflictInstanceVersion: number;
  fallbackDirectPlan?: {
    start: string;
    end: string;
    blocks?: any[];
  } | null;
}

export interface ResolveProposalResult {
  success: boolean;
  status: 'accepted' | 'rejected' | 'expired' | 'recomputed' | 'already_resolved' | 'not_found';
  message: string;
  taskId?: number;
  planVersion?: number;
  newProposal?: ScheduleProposal & { proposalId: string };
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * 在服务端持久化带计划版本和有效期的冲突调整提案（T07）。
 */
export function createScheduleProposal(params: {
  userId: number;
  basePlanVersion: number;
  reasonType: 'deadline_risk' | 'priority_gain' | 'extend_conflict';
  reasonText: string;
  payload: ProposalPayload;
  ttlMinutes?: number;
}): ScheduleProposalRecord {
  const id = `prop-${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + (params.ttlMinutes ?? 15) * 60_000).toISOString();

  db.prepare(`
    INSERT INTO schedule_proposals (
      id, user_id, base_plan_version, reason_type, reason_text, payload_json, status, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    id,
    params.userId,
    params.basePlanVersion,
    params.reasonType,
    params.reasonText,
    JSON.stringify(params.payload),
    expiresAt
  );

  return db.prepare('SELECT * FROM schedule_proposals WHERE id = ?').get(id) as ScheduleProposalRecord;
}

function insertTaskFromSpec(userId: number, spec: ProposalPayload['newTaskSpec'], tz: string, now: Date): { taskId: number; instanceId: number } {
  const info = db.prepare(`
    INSERT INTO tasks (
      user_id, title, duration_minutes, original_duration_minutes, urgency, importance,
      importance_tier, impact_signals, time_mode, urgency_pace, score_scale,
      deadline, deadline_kind, is_fixed, is_concurrent, tags, notes, session_plan, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 100, ?, ?, 0, ?, ?, ?, ?, 'pending_slot')
  `).run(
    userId,
    spec.title,
    spec.duration_minutes,
    spec.original_duration_minutes || spec.duration_minutes,
    spec.urgency,
    spec.importance,
    spec.importance_tier || null,
    JSON.stringify(spec.impact_signals || []),
    spec.time_mode || (spec.deadline ? 'deadline' : 'flexible'),
    spec.urgency_pace || 'soon',
    spec.deadline || null,
    spec.deadline_kind || 'soft',
    spec.is_concurrent ? 1 : 0,
    JSON.stringify(spec.tags || []),
    spec.notes || null,
    spec.session_plan ? JSON.stringify(spec.session_plan) : null
  );

  const taskId = Number(info.lastInsertRowid);
  const inst = ensureTaskInstance(userId, taskId, getAccountLocalDateKey(now, tz), now)!;
  return { taskId, instanceId: inst.id };
}

function writeCommittedBlocksForInstance(params: {
  userId: number;
  planVersion: number;
  instanceId: number;
  taskId: number;
  isConcurrent: boolean;
  blocks: Array<{ start: string; end: string; duration?: number; energyZone?: string; strategyLabel?: string; breakAfterMinutes?: number }>;
}): void {
  // Supersede previous active movable blocks on this instance
  db.prepare(`
    UPDATE schedule_blocks
    SET status = 'superseded', updated_at = CURRENT_TIMESTAMP
    WHERE instance_id = ? AND status IN ('planned', 'conflict')
  `).run(params.instanceId);

  const stmt = db.prepare(`
    INSERT INTO schedule_blocks (
      id, user_id, plan_version, instance_id, task_id,
      start_time, end_time, duration_minutes, part_index, total_parts,
      is_fixed, is_committed, is_concurrent, status, energy_zone, strategy_label, break_after_minutes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, 'planned', ?, ?, ?)
  `);

  params.blocks.forEach((b, idx) => {
    const dur =
      b.duration && b.duration > 0
        ? b.duration
        : Math.max(1, Math.round((new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000));
    stmt.run(
      `blk-${params.taskId}-${params.instanceId}-${crypto.randomUUID().slice(0, 8)}`,
      params.userId,
      params.planVersion,
      params.instanceId,
      params.taskId,
      new Date(b.start).toISOString(),
      new Date(b.end).toISOString(),
      dur,
      idx + 1,
      params.blocks.length,
      params.isConcurrent ? 1 : 0,
      b.energyZone || null,
      b.strategyLabel || null,
      b.breakAfterMinutes || null
    );
  });
}

function validateProposedSlotsAgainstCurrentBusy(
  userId: number,
  excludeInstanceIds: number[],
  slotsToCheck: Array<{ start: string; end: string }>
): string | null {
  if (slotsToCheck.length === 0) return '提案不包含有效的排程时段';

  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const s of slotsToCheck) {
    const sm = new Date(s.start).getTime();
    const em = new Date(s.end).getTime();
    if (!Number.isFinite(sm) || !Number.isFinite(em) || em <= sm) return '提案时段格式无效';
    if (sm < minMs) minMs = sm;
    if (em > maxMs) maxMs = em;
  }

  const extEvents = getActiveExternalBusyEvents(userId, new Date(minMs).toISOString(), new Date(maxMs).toISOString());
  for (const slot of slotsToCheck) {
    const ss = new Date(slot.start).getTime();
    const se = new Date(slot.end).getTime();
    const hitExt = extEvents.find(e => intervalsOverlap(ss, se, e.start.getTime(), e.end.getTime()));
    if (hitExt) {
      return `提案时段已被外部日程「${hitExt.title}」占用`;
    }
  }

  const otherBlocks = db.prepare(`
    SELECT sb.*, t.title
    FROM schedule_blocks sb
    JOIN tasks t ON t.id = sb.task_id
    WHERE sb.user_id = ?
      AND sb.status IN ('planned', 'in_progress')
      AND sb.is_concurrent = 0
      AND sb.end_time > ?
      AND sb.start_time < ?
  `).all(userId, new Date(minMs).toISOString(), new Date(maxMs).toISOString()) as Array<ScheduleBlockRecord & { title: string }>;

  const excludeSet = new Set(excludeInstanceIds);
  for (const slot of slotsToCheck) {
    const ss = new Date(slot.start).getTime();
    const se = new Date(slot.end).getTime();
    const hitBlock = otherBlocks.find(
      b => !excludeSet.has(b.instance_id) && intervalsOverlap(ss, se, new Date(b.start_time).getTime(), new Date(b.end_time).getTime())
    );
    if (hitBlock) {
      return `提案时段已被任务「${hitBlock.title}」占用`;
    }
  }

  return null;
}

/**
 * 核对并应用/拒绝服务端排程提案（T07）：
 * - 校验有效期、plan_version、冲突实例版本及实时占用碰撞
 * - 若过期或输入已变化：不应用旧提案，重新计算并在有新提案时返回新提案供用户再次确认
 * - 拒绝或超时后：采用当前约束下不移动旧承诺的合法备选，无可行备选则列入待安排
 */
export function resolveScheduleProposal(params: {
  userId: number;
  proposalId: string;
  decision: 'accept' | 'reject';
}): ResolveProposalResult {
  const now = new Date();
  const tz = getUserTimezone(params.userId);
  const record = db
    .prepare('SELECT * FROM schedule_proposals WHERE id = ? AND user_id = ?')
    .get(params.proposalId, params.userId) as ScheduleProposalRecord | undefined;

  if (!record) {
    return { success: false, status: 'not_found', message: '未找到对应的排程调整提案' };
  }

  if (record.status === 'accepted' || record.status === 'rejected') {
    return {
      success: true,
      status: 'already_resolved',
      message: record.status === 'accepted' ? '该调整提案已应用' : '该调整提案已拒绝',
    };
  }

  let payload: ProposalPayload;
  try {
    payload = JSON.parse(record.payload_json) as ProposalPayload;
  } catch {
    return { success: false, status: 'not_found', message: '提案数据已损坏' };
  }

  const isExpired = record.status === 'expired' || new Date(record.expires_at).getTime() <= now.getTime();
  const currentPlanVersion = getLatestPlanVersion(params.userId);
  const conflictInst = db
    .prepare('SELECT * FROM task_instances WHERE id = ? AND user_id = ?')
    .get(payload.conflictInstanceId, params.userId) as TaskInstance | undefined;

  // Reject path or expired fallback path: adopt non-displacing alternative under current constraints
  if (params.decision === 'reject' || isExpired) {
    if (payload.targetTaskId) {
      db.prepare(`
        UPDATE schedule_proposals
        SET status = ?, resolved_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(isExpired ? 'expired' : 'rejected', record.id);

      return {
        success: true,
        status: isExpired ? 'expired' : 'rejected',
        message: isExpired
          ? `⌛ 原改期提案已过期，已保持「${payload.newTaskSpec.title}」与「${payload.proposal.conflictTask.title}」原日程不变。`
          : `👌 已保持原日程不变，「${payload.newTaskSpec.title}」与「${payload.proposal.conflictTask.title}」均未调整。`,
        taskId: payload.targetTaskId,
        planVersion: currentPlanVersion,
      };
    }

    let createdTaskId = 0;
    db.transaction(() => {
      db.prepare(`
        UPDATE schedule_proposals
        SET status = ?, resolved_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(isExpired ? 'expired' : 'rejected', record.id);

      const created = insertTaskFromSpec(params.userId, payload.newTaskSpec, tz, now);
      createdTaskId = created.taskId;
    })();

    const replan = replanUserTasks(params.userId, {
      triggerSource: isExpired ? 'proposal_expired_fallback' : 'proposal_rejected',
    });
    const createdTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(createdTaskId) as Task | undefined;

    const prefix = isExpired ? '⌛ 原调整提案已过期，已按最新约束重新安排。\n' : '👌 已保持原日程不变。\n';
    const detail =
      createdTask?.scheduled_start && createdTask?.scheduled_end
        ? `「${payload.newTaskSpec.title}」已安排至其他可用空闲时段。`
        : `由于暂无合适空闲时段，「${payload.newTaskSpec.title}」已放入待安排清单。`;

    return {
      success: true,
      status: isExpired ? 'expired' : 'rejected',
      message: prefix + detail,
      taskId: createdTaskId,
      planVersion: replan.planVersion,
    };
  }

  // Accept path: strictly verify version, instance state, and live occupancy
  const existingTargetInst = payload.targetInstanceId
    ? (db
        .prepare('SELECT * FROM task_instances WHERE id = ? AND user_id = ?')
        .get(payload.targetInstanceId, params.userId) as TaskInstance | undefined)
    : undefined;

  const targetStale = payload.targetTaskId
    ? !existingTargetInst ||
      existingTargetInst.status === 'completed' ||
      existingTargetInst.status === 'cancelled' ||
      (payload.targetInstanceVersion !== undefined && existingTargetInst.version !== payload.targetInstanceVersion)
    : false;

  const versionStale =
    record.base_plan_version !== currentPlanVersion ||
    !conflictInst ||
    conflictInst.status === 'completed' ||
    conflictInst.status === 'cancelled' ||
    conflictInst.version !== payload.conflictInstanceVersion ||
    targetStale;

  const newBlocks =
    payload.proposal.newTaskSchedule.blocks && payload.proposal.newTaskSchedule.blocks.length > 0
      ? payload.proposal.newTaskSchedule.blocks
      : [{ start: payload.proposal.newTaskSchedule.start, end: payload.proposal.newTaskSchedule.end }];

  const conflictBlocks =
    payload.proposal.conflictTaskSchedule.blocks && payload.proposal.conflictTaskSchedule.blocks.length > 0
      ? payload.proposal.conflictTaskSchedule.blocks
      : [{ start: payload.proposal.conflictTaskSchedule.start, end: payload.proposal.conflictTaskSchedule.end }];

  const excludeInstIds = payload.targetInstanceId
    ? [payload.conflictInstanceId, payload.targetInstanceId]
    : [payload.conflictInstanceId];

  const occupancyError = !versionStale
    ? validateProposedSlotsAgainstCurrentBusy(params.userId, excludeInstIds, [...newBlocks, ...conflictBlocks])
    : '日程计划或冲突任务已发生变化';

  if (versionStale || occupancyError) {
    db.prepare(`
      UPDATE schedule_proposals
      SET status = 'superseded', resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(record.id);

    if (payload.targetTaskId) {
      return {
        success: false,
        status: 'recomputed',
        message: `原改期提案已失效（${occupancyError}），请重新发起单次再排期。`,
      };
    }

    // Recompute under current constraints
    const freshPlan = scheduleTask(params.userId, {
      title: payload.newTaskSpec.title,
      duration_minutes: payload.newTaskSpec.duration_minutes,
      time_mode: payload.newTaskSpec.time_mode,
      is_concurrent: payload.newTaskSpec.is_concurrent ? 1 : 0,
      deadline_kind: payload.newTaskSpec.deadline_kind,
      urgency_pace: payload.newTaskSpec.urgency_pace,
      urgency: payload.newTaskSpec.urgency,
      importance: payload.newTaskSpec.importance,
      deadline: payload.newTaskSpec.deadline,
    });

    if (freshPlan.proposal) {
      const targetConflictInst = ensureTaskInstance(
        params.userId,
        freshPlan.proposal.conflictTask.id,
        getAccountLocalDateKey(now, tz),
        now
      );
      if (targetConflictInst) {
        const freshRec = createScheduleProposal({
          userId: params.userId,
          basePlanVersion: currentPlanVersion,
          reasonType: freshPlan.proposal.type,
          reasonText: freshPlan.proposal.reasonText,
          payload: {
            newTaskSpec: payload.newTaskSpec,
            proposal: freshPlan.proposal,
            conflictInstanceId: targetConflictInst.id,
            conflictInstanceVersion: targetConflictInst.version,
            fallbackDirectPlan: freshPlan.success && freshPlan.scheduled_start && freshPlan.scheduled_end
              ? {
                  start: freshPlan.scheduled_start,
                  end: freshPlan.scheduled_end,
                  blocks: freshPlan.schedule_blocks ? JSON.parse(freshPlan.schedule_blocks) : [],
                }
              : null,
          },
        });
        return {
          success: false,
          status: 'recomputed',
          message: `原提案已失效（${occupancyError}），已重新计算最新调整建议，请确认新方案。`,
          newProposal: { ...freshPlan.proposal, proposalId: freshRec.id },
        };
      }
    }

    return {
      success: false,
      status: 'recomputed',
      message: `原提案已失效（${occupancyError}），请重新发起排程。`,
    };
  }

  // Valid -> commit both tasks with committed blocks inside transaction, then replan remaining movables
  let affectedTaskId = payload.targetTaskId || 0;
  let affectedInstanceId = payload.targetInstanceId || 0;
  db.transaction(() => {
    db.prepare(`
      UPDATE schedule_proposals
      SET status = 'accepted', resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(record.id);

    if (!affectedTaskId || !affectedInstanceId) {
      const created = insertTaskFromSpec(params.userId, payload.newTaskSpec, tz, now);
      affectedTaskId = created.taskId;
      affectedInstanceId = created.instanceId;
    }

    writeCommittedBlocksForInstance({
      userId: params.userId,
      planVersion: currentPlanVersion,
      instanceId: affectedInstanceId,
      taskId: affectedTaskId,
      isConcurrent: Boolean(payload.newTaskSpec.is_concurrent),
      blocks: newBlocks,
    });

    writeCommittedBlocksForInstance({
      userId: params.userId,
      planVersion: currentPlanVersion,
      instanceId: conflictInst!.id,
      taskId: conflictInst!.task_id,
      isConcurrent: false,
      blocks: conflictBlocks,
    });

    db.prepare('UPDATE task_instances SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (?, ?)').run(
      affectedInstanceId,
      conflictInst!.id
    );

    syncLegacyTaskProjection(params.userId, affectedTaskId, now);
    syncLegacyTaskProjection(params.userId, conflictInst!.task_id, now);
  })();

  const replan = replanUserTasks(params.userId, {
    preserveTaskIds: new Set([affectedTaskId, conflictInst!.task_id]),
    triggerSource: 'proposal_accepted',
  });

  return {
    success: true,
    status: 'accepted',
    message: `已同步调整「${payload.proposal.conflictTask.title}」并安排「${payload.newTaskSpec.title}」`,
    taskId: affectedTaskId,
    planVersion: replan.planVersion,
  };
}
