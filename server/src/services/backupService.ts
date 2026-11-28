import crypto from 'crypto';
import { db } from '../config/database.js';
import type { ProgressEvent, Task, TaskInstance } from '../models/types.js';
import { getUserTimezone } from './accountService.js';
import { getAccountLocalDateKey, normalizeAccountDeadlineIso } from '../utils/timezone.js';
import { replanUserTasks } from './scheduler.js';
import { ensureTaskInstance, syncLegacyTaskProjection } from './instanceService.js';
import { parseImpactSignalsArray, parseTagsArray } from './taskCommandSchema.js';

export interface BackupTaskPayload {
  sourceId?: string | number;
  sourceFingerprint: string;
  title: string;
  notes?: string | null;
  durationMinutes: number;
  originalDurationMinutes: number;
  importance: number;
  urgency: number;
  importanceTier?: 'vital' | 'support' | 'minor' | null;
  impactSignals?: string[];
  timeMode: 'deadline' | 'specific_date' | 'daily_fixed' | 'flexible';
  recurrenceRule?: string | null;
  urgencyPace?: 'urgent' | 'soon' | 'later';
  importanceManualOverride?: number | null;
  deadline?: string | null;
  deadlineKind: 'hard' | 'soft';
  isFixed: boolean;
  isConcurrent: boolean;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  tags: string[];
  status: Task['status'];
  completedDates: string[];
  activeTemplate: boolean;
  instances?: Array<{
    businessDate: string;
    instanceType: 'once' | 'daily';
    status: TaskInstance['status'];
    estimatedMinutes: number;
    completedMinutes: number;
  }>;
  progressEvents?: Array<{
    commandId: string;
    action: ProgressEvent['action'];
    deltaMinutes: number;
    targetRemainingMinutes?: number | null;
    reason?: string | null;
  }>;
}

export interface BackupArchiveV2 {
  schemaVersion: 2;
  exportedAt: string;
  timezone: string;
  tasks: BackupTaskPayload[];
}

export function computeTaskFingerprint(t: {
  title: string;
  timeMode: string;
  deadline?: string | null;
  deadlineKind?: string | null;
  originalDurationMinutes?: number;
  createdAt?: string;
}): string {
  const raw = [
    t.title.trim(),
    t.timeMode,
    t.deadline || '',
    t.deadlineKind || 'soft',
    String(t.originalDurationMinutes || 0),
    t.createdAt || '',
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

/**
 * 导出完整版本化 JSON 备份（保留硬截止、每日打卡、标签、实例与进度历史 C07）
 */
export function exportUserBackup(userId: number): BackupArchiveV2 {
  const tz = getUserTimezone(userId);
  const tasks = db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY id ASC').all(userId) as Task[];
  const instances = db.prepare('SELECT * FROM task_instances WHERE user_id = ? ORDER BY id ASC').all(userId) as TaskInstance[];
  const events = db.prepare('SELECT * FROM progress_events WHERE user_id = ? ORDER BY id ASC').all(userId) as ProgressEvent[];

  const instByTask = new Map<number, TaskInstance[]>();
  for (const inst of instances) {
    const list = instByTask.get(inst.task_id) || [];
    list.push(inst);
    instByTask.set(inst.task_id, list);
  }
  const eventsByInst = new Map<number, ProgressEvent[]>();
  for (const ev of events) {
    const list = eventsByInst.get(ev.instance_id) || [];
    list.push(ev);
    eventsByInst.set(ev.instance_id, list);
  }

  const exportedTasks: BackupTaskPayload[] = tasks.map(t => {
    const taskInsts = instByTask.get(t.id) || [];
    const taskEvents = taskInsts.flatMap(i => eventsByInst.get(i.id) || []);
    const fp =
      t.source_fingerprint ||
      computeTaskFingerprint({
        title: t.title,
        timeMode: t.time_mode || 'flexible',
        deadline: t.deadline,
        deadlineKind: t.deadline_kind || 'soft',
        originalDurationMinutes: t.original_duration_minutes || t.duration_minutes,
        createdAt: t.created_at,
      });

    return {
      sourceId: t.id,
      sourceFingerprint: fp,
      title: t.title,
      notes: t.notes || null,
      durationMinutes: t.duration_minutes,
      originalDurationMinutes: t.original_duration_minutes || t.duration_minutes,
      importance: t.importance,
      urgency: t.urgency,
      importanceTier: t.importance_tier || null,
      impactSignals: parseImpactSignalsArray(t.impact_signals),
      timeMode: t.time_mode || (t.deadline ? 'deadline' : 'flexible'),
      recurrenceRule: t.recurrence_rule || null,
      urgencyPace: t.urgency_pace || 'soon',
      importanceManualOverride: t.importance_manual_override ?? null,
      deadline: t.deadline || null,
      deadlineKind: t.deadline_kind === 'hard' ? 'hard' : 'soft',
      isFixed: Boolean(t.is_fixed),
      isConcurrent: Boolean(t.is_concurrent),
      scheduledStart: t.scheduled_start || null,
      scheduledEnd: t.scheduled_end || null,
      tags: parseTagsArray(t.tags),
      status: t.status,
      completedDates: parseTagsArray(t.completed_dates),
      activeTemplate: t.active_template !== 0,
      instances: taskInsts.map(i => ({
        businessDate: i.business_date,
        instanceType: i.instance_type,
        status: i.status,
        estimatedMinutes: i.estimated_minutes,
        completedMinutes: i.completed_minutes,
      })),
      progressEvents: taskEvents.map(e => ({
        commandId: e.command_id,
        action: e.action,
        deltaMinutes: e.delta_minutes,
        targetRemainingMinutes: e.target_remaining_minutes ?? null,
        reason: e.reason || null,
      })),
    };
  });

  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    timezone: tz,
    tasks: exportedTasks,
  };
}

/**
 * 兼容旧版看板 JSON 数组或新版 v2 备份载荷的标准化解析
 */
export function normalizeBackupInput(raw: unknown, timezone: string): BackupTaskPayload[] {
  const list: any[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as any).tasks)
    ? (raw as any).tasks
    : [];

  return list
    .filter(item => item && typeof item.title === 'string' && item.title.trim())
    .map((item, idx) => {
      const duration = Math.max(1, Math.round(Number(item.durationMinutes ?? item.estimatedMinutes ?? item.duration_minutes ?? 60)));
      const origDuration = Math.max(duration, Math.round(Number(item.originalDurationMinutes ?? item.original_duration_minutes ?? duration)));
      const deadline = normalizeAccountDeadlineIso(item.deadline ?? item.deadlineAt ?? item.dueDate ?? null, timezone);
      const timeMode: 'deadline' | 'specific_date' | 'daily_fixed' | 'flexible' =
        item.timeMode === 'daily_fixed' || item.time_mode === 'daily_fixed'
          ? 'daily_fixed'
          : item.timeMode === 'specific_date' || item.time_mode === 'specific_date'
          ? 'specific_date'
          : item.timeMode === 'flexible' || item.time_mode === 'flexible'
          ? 'flexible'
          : deadline
          ? 'deadline'
          : 'flexible';
      const deadlineKind: 'hard' | 'soft' =
        item.deadlineKind === 'hard' || item.deadline_kind === 'hard' ? 'hard' : 'soft';
      const status: Task['status'] =
        item.status === 'completed' || item.isCompleted
          ? 'completed'
          : item.status === 'cancelled'
          ? 'cancelled'
          : item.status === 'in_progress'
          ? 'in_progress'
          : item.status === 'scheduled'
          ? 'scheduled'
          : 'pending_slot';

      const fp =
        typeof item.sourceFingerprint === 'string' && item.sourceFingerprint.trim()
          ? item.sourceFingerprint.trim()
          : computeTaskFingerprint({
              title: String(item.title),
              timeMode,
              deadline,
              deadlineKind,
              originalDurationMinutes: origDuration,
              createdAt: String(item.createdAt || item.created_at || idx),
            });

      return {
        sourceId: item.sourceId ?? item.id,
        sourceFingerprint: fp,
        title: String(item.title).trim(),
        notes: item.notes ?? item.description ?? null,
        durationMinutes: duration,
        originalDurationMinutes: origDuration,
        importance: Number.isFinite(Number(item.importance)) ? Number(item.importance) : 58,
        urgency: Number.isFinite(Number(item.urgency)) ? Number(item.urgency) : 50,
        importanceTier: item.importanceTier ?? item.importance_tier ?? null,
        impactSignals: parseImpactSignalsArray(item.impactSignals ?? item.impact_signals),
        timeMode,
        recurrenceRule: item.recurrenceRule ?? item.recurrence_rule ?? null,
        urgencyPace: item.urgencyPace ?? item.urgency_pace ?? 'soon',
        importanceManualOverride: item.importanceManualOverride ?? item.importance_manual_override ?? null,
        deadline,
        deadlineKind,
        isFixed: Boolean(item.isFixed ?? item.is_fixed),
        isConcurrent: Boolean(item.isConcurrent ?? item.is_concurrent),
        scheduledStart: item.scheduledStart ?? item.scheduled_start ?? null,
        scheduledEnd: item.scheduledEnd ?? item.scheduled_end ?? null,
        tags: parseTagsArray(item.tags),
        status,
        completedDates: parseTagsArray(item.completedDates ?? item.completed_dates),
        activeTemplate: item.activeTemplate !== false,
        instances: Array.isArray(item.instances) ? item.instances : undefined,
        progressEvents: Array.isArray(item.progressEvents) ? item.progressEvents : undefined,
      };
    });
}

export interface BackupPreviewResult {
  total: number;
  newCount: number;
  duplicateCount: number;
  items: Array<{
    sourceFingerprint: string;
    title: string;
    action: 'create' | 'skip_duplicate' | 'replace';
    reason?: string;
  }>;
}

function getExistingTaskFingerprintSet(userId: number): Set<string> {
  const existingRows = db
    .prepare(
      'SELECT id, title, time_mode, deadline, deadline_kind, original_duration_minutes, duration_minutes, created_at, source_fingerprint FROM tasks WHERE user_id = ?'
    )
    .all(userId) as Array<Partial<Task> & { id: number; title: string }>;

  const fpSet = new Set<string>();
  for (const r of existingRows) {
    const fp =
      r.source_fingerprint ||
      computeTaskFingerprint({
        title: r.title,
        timeMode: r.time_mode || 'flexible',
        deadline: r.deadline,
        deadlineKind: r.deadline_kind || 'soft',
        originalDurationMinutes: r.original_duration_minutes || r.duration_minutes || 0,
        createdAt: r.created_at,
      });
    fpSet.add(fp);
  }
  return fpSet;
}

export function previewBackupImport(
  userId: number,
  raw: unknown,
  mode: 'merge' | 'replace' = 'merge'
): BackupPreviewResult {
  const tz = getUserTimezone(userId);
  const items = normalizeBackupInput(raw, tz);
  const existingFpSet = getExistingTaskFingerprintSet(userId);

  const previewItems = items.map(item => {
    const isDup = mode === 'merge' && existingFpSet.has(item.sourceFingerprint);
    return {
      sourceFingerprint: item.sourceFingerprint,
      title: item.title,
      action: mode === 'replace' ? ('replace' as const) : isDup ? ('skip_duplicate' as const) : ('create' as const),
      reason: isDup ? '命中相同来源指纹，合并模式下自动跳过' : undefined,
    };
  });

  const duplicateCount = previewItems.filter(i => i.action === 'skip_duplicate').length;
  return {
    total: items.length,
    newCount: items.length - duplicateCount,
    duplicateCount,
    items: previewItems,
  };
}

export interface BackupImportResult {
  success: boolean;
  mode: 'merge' | 'replace';
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  details: Array<{
    sourceFingerprint: string;
    title: string;
    result: 'imported' | 'skipped' | 'failed';
    taskId?: number;
    reason?: string;
  }>;
  planVersion?: number;
}

/**
 * 批量导入备份（C07）：
 * - 在单个数据库事务内按来源指纹去重导入，绝不逐条调用模型或逐条重排
 * - 完整保留硬截止、每日打卡、锁定属性、部分完成进度
 * - 事务提交后统一执行一次重排
 */
export function commitBackupImport(
  userId: number,
  raw: unknown,
  mode: 'merge' | 'replace' = 'merge'
): BackupImportResult {
  const tz = getUserTimezone(userId);
  const now = new Date();
  const items = normalizeBackupInput(raw, tz);

  const txRes = db.transaction(() => {
    if (mode === 'replace') {
      db.prepare(`
        UPDATE notification_outbox
        SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND status IN ('pending', 'failed')
      `).run(userId);
      db.prepare('DELETE FROM tasks WHERE user_id = ?').run(userId);
    }

    const existingFpSet = getExistingTaskFingerprintSet(userId);

    const details: BackupImportResult['details'] = [];
    let importedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const item of items) {
      if (mode === 'merge' && existingFpSet.has(item.sourceFingerprint)) {
        skippedCount++;
        details.push({
          sourceFingerprint: item.sourceFingerprint,
          title: item.title,
          result: 'skipped',
          reason: '已存在相同记录，已跳过',
        });
        continue;
      }

      try {
        const info = db.prepare(`
          INSERT INTO tasks (
            user_id, title, duration_minutes, original_duration_minutes, urgency, importance,
            importance_tier, impact_signals, time_mode, recurrence_rule, urgency_pace, importance_manual_override,
            score_scale, completed_dates, deadline, deadline_kind,
            scheduled_start, scheduled_end, is_fixed, is_concurrent, tags, status,
            notes, active_template, source_fingerprint
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 100, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId,
          item.title,
          item.durationMinutes,
          item.originalDurationMinutes,
          item.urgency,
          item.importance,
          item.importanceTier || null,
          JSON.stringify(item.impactSignals || []),
          item.timeMode,
          item.timeMode === 'daily_fixed' ? item.recurrenceRule || null : null,
          item.urgencyPace || 'soon',
          item.importanceManualOverride ?? null,
          JSON.stringify(item.completedDates || []),
          item.deadline || null,
          item.deadlineKind,
          item.isFixed ? item.scheduledStart || null : null,
          item.isFixed ? item.scheduledEnd || null : null,
          item.isFixed ? 1 : 0,
          item.isConcurrent ? 1 : 0,
          JSON.stringify(item.tags || []),
          item.status,
          item.notes || null,
          item.activeTemplate ? 1 : 0,
          item.sourceFingerprint
        );

        const taskId = Number(info.lastInsertRowid);
        existingFpSet.add(item.sourceFingerprint);

        if (item.instances && item.instances.length > 0) {
          for (const inst of item.instances) {
            db.prepare(`
              INSERT OR IGNORE INTO task_instances (
                task_id, user_id, business_date, instance_type, status,
                estimated_minutes, completed_minutes, plan_status, allocated_minutes, unallocated_minutes
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)
            `).run(
              taskId,
              userId,
              inst.businessDate,
              inst.instanceType,
              inst.status,
              inst.estimatedMinutes,
              inst.completedMinutes,
              Math.max(0, inst.estimatedMinutes - inst.completedMinutes)
            );
          }
        } else {
          ensureTaskInstance(userId, taskId, getAccountLocalDateKey(now, tz), now);
        }

        if (item.isFixed && item.scheduledStart && item.scheduledEnd) {
          const instRow = db
            .prepare('SELECT id FROM task_instances WHERE task_id = ? ORDER BY id DESC LIMIT 1')
            .get(taskId) as { id: number } | undefined;
          if (instRow) {
            db.prepare(`
              INSERT INTO schedule_blocks (
                id, user_id, plan_version, instance_id, task_id,
                start_time, end_time, duration_minutes, part_index, total_parts,
                is_fixed, is_committed, is_concurrent, status
              ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, 1, 1, 1, 1, ?, 'planned')
            `).run(
              `blk-imp-${taskId}-${crypto.randomUUID().slice(0, 8)}`,
              userId,
              instRow.id,
              taskId,
              item.scheduledStart,
              item.scheduledEnd,
              item.durationMinutes,
              item.isConcurrent ? 1 : 0
            );
          }
        }

        syncLegacyTaskProjection(userId, taskId, now);
        importedCount++;
        details.push({
          sourceFingerprint: item.sourceFingerprint,
          title: item.title,
          result: 'imported',
          taskId,
        });
      } catch (err: any) {
        failedCount++;
        details.push({
          sourceFingerprint: item.sourceFingerprint,
          title: item.title,
          result: 'failed',
          reason: err.message,
        });
      }
    }

    return { importedCount, skippedCount, failedCount, details };
  })();

  const replan = replanUserTasks(userId, { triggerSource: 'backup_import' });

  return {
    success: txRes.failedCount === 0,
    mode,
    ...txRes,
    planVersion: replan.planVersion,
  };
}
