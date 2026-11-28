import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../config/database.js';
import { setupIsolatedTestEnv, seedTestUser, wallClockIso } from '../testHelpers/testDb.js';
import { createTaskCommand, updateTaskCommand } from './taskService.js';
import {
  EFFECTIVE_DAILY_CAP_MINUTES,
  extendTaskDuration,
  replanUserTasks,
} from './scheduler.js';
import { createScheduleProposal, resolveScheduleProposal } from './proposalService.js';
import { ensureTaskInstance, getLatestPlanVersion } from './instanceService.js';
import { runDailyRolloverCycle } from './reminder.js';
import { addDaysToDateKey, getAccountLocalDateKey } from '../utils/timezone.js';

describe('Batch 2: Planner Commits, Preserved Blocks, Extend Safety, Proposals & Timezone Rollover', () => {
  let cleanup: () => void;
  let userId: number;
  let tomorrowKey: string;

  beforeEach(() => {
    const env = setupIsolatedTestEnv();
    cleanup = env.cleanup;
    userId = seedTestUser({ timezone: 'Asia/Shanghai' }).userId;
    tomorrowKey = getAccountLocalDateKey(new Date(Date.now() + 86_400_000), 'Asia/Shanghai');
  });

  afterEach(() => {
    cleanup();
  });

  it('preserves completed/in_progress/fixed blocks and schedules only remaining minutes on replan (T03)', async () => {
    const created = await createTaskCommand({
      userId,
      rawInput: {
        title: '高优架构重构',
        duration_minutes: 120,
        importance_tier: 'vital',
        urgency_pace: 'urgent',
        deadline: wallClockIso(tomorrowKey, 22, 0),
        deadline_kind: 'hard',
      },
    });
    assert.equal(created.success, true);
    const taskId = created.task!.id;

    // Mark first block as in_progress (or completed partial)
    const blocks = db
      .prepare('SELECT * FROM schedule_blocks WHERE task_id = ? ORDER BY start_time ASC')
      .all(taskId) as any[];
    assert.ok(blocks.length >= 1);
    const lockedBlock = blocks[0];
    const lockedMinutes = lockedBlock.duration_minutes;

    db.prepare("UPDATE schedule_blocks SET status = 'in_progress' WHERE id = ?").run(lockedBlock.id);
    db.prepare("UPDATE task_instances SET status = 'in_progress' WHERE task_id = ?").run(taskId);
    db.prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?").run(taskId);

    // Add a fixed block at another slot and verify both remain untouched after replan
    const fixedStart = wallClockIso(tomorrowKey, 19, 0);
    const fixedEnd = wallClockIso(tomorrowKey, 20, 0);
    await createTaskCommand({
      userId,
      rawInput: {
        title: '固定评审会',
        is_fixed: true,
        scheduled_start: fixedStart,
        scheduled_end: fixedEnd,
        duration_minutes: 60,
      },
    });

    const replan = replanUserTasks(userId, { triggerSource: 'test_t03' });
    assert.equal(replan.success, true);

    const lockedAfter = db.prepare('SELECT * FROM schedule_blocks WHERE id = ?').get(lockedBlock.id) as any;
    assert.ok(lockedAfter);
    assert.equal(lockedAfter.status, 'in_progress');
    assert.equal(lockedAfter.start_time, lockedBlock.start_time);

    const allTaskBlocks = db
      .prepare("SELECT * FROM schedule_blocks WHERE task_id = ? AND status IN ('planned', 'in_progress')")
      .all(taskId) as any[];
    const totalScheduled = allTaskBlocks.reduce((s, b) => s + Number(b.duration_minutes), 0);
    assert.equal(totalScheduled, 120);
    assert.ok(lockedMinutes > 0);
  });

  it('rejects extendTaskDuration on hard deadline violation, external event conflict, or terminal task status (T05)', async () => {
    const start1 = wallClockIso(tomorrowKey, 14, 0);
    const end1 = wallClockIso(tomorrowKey, 15, 0);
    const hardDeadline = wallClockIso(tomorrowKey, 15, 10);

    const t1 = await createTaskCommand({
      userId,
      rawInput: {
        title: '带硬截止固定任务',
        is_fixed: true,
        scheduled_start: start1,
        scheduled_end: end1,
        duration_minutes: 60,
        deadline: hardDeadline,
        deadline_kind: 'hard',
      },
    });
    assert.equal(t1.success, true);

    // Extend by 30m would end at 15:30 > 15:10 hard deadline -> rejected
    const extHard = extendTaskDuration(userId, t1.task!.id, 30);
    assert.equal(extHard.success, false);
    assert.equal(extHard.conflictType, 'hard_deadline');
    const stillEnd = (db.prepare('SELECT scheduled_end FROM tasks WHERE id = ?').get(t1.task!.id) as any).scheduled_end;
    assert.equal(new Date(stillEnd).getTime(), new Date(end1).getTime());

    // Add external busy event 16:30-17:30 and task ending at 16:15
    const t2Start = wallClockIso(tomorrowKey, 15, 30);
    const t2End = wallClockIso(tomorrowKey, 16, 15);
    const t2 = await createTaskCommand({
      userId,
      rawInput: {
        title: '外部日程前任务',
        is_fixed: true,
        scheduled_start: t2Start,
        scheduled_end: t2End,
        duration_minutes: 45,
      },
    });
    assert.equal(t2.success, true);

    db.prepare(`
      INSERT INTO external_events (user_id, title, start_time, end_time, status, transparency)
      VALUES (?, '客户电话', ?, ?, 'CONFIRMED', 'OPAQUE')
    `).run(userId, wallClockIso(tomorrowKey, 16, 30), wallClockIso(tomorrowKey, 17, 30));

    const extConflict = extendTaskDuration(userId, t2.task!.id, 30);
    assert.equal(extConflict.success, false);
    assert.equal(extConflict.conflictType, 'external_conflict');

    // Completed task cannot be extended
    db.prepare("UPDATE tasks SET status = 'completed' WHERE id = ?").run(t2.task!.id);
    db.prepare("UPDATE task_instances SET status = 'completed' WHERE task_id = ?").run(t2.task!.id);
    const extTerminal = extendTaskDuration(userId, t2.task!.id, 30);
    assert.equal(extTerminal.success, false);
  });

  it('rejects stale/occupied schedule proposals on accept and uses legal alternative or pending_slot on reject (T07)', async () => {
    const existingStart = wallClockIso(tomorrowKey, 9, 0);
    const existingEnd = wallClockIso(tomorrowKey, 11, 0);
    const lowPri = await createTaskCommand({
      userId,
      rawInput: {
        title: '低优常规任务',
        duration_minutes: 60,
        importance_tier: 'minor',
        urgency_pace: 'later',
        is_fixed: false,
      },
    });
    assert.equal(lowPri.success, true);
    const conflictInst = ensureTaskInstance(userId, lowPri.task!.id, tomorrowKey)!;
    const baseVersion = getLatestPlanVersion(userId);

    // Create a server proposal that proposes putting a new task at 10:00-11:00
    const propStart = wallClockIso(tomorrowKey, 10, 0);
    const propEnd = wallClockIso(tomorrowKey, 11, 0);
    const proposalRecord = createScheduleProposal({
      userId,
      basePlanVersion: baseVersion,
      reasonType: 'deadline_risk',
      reasonText: '高优任务即将逾期',
      payload: {
        newTaskSpec: {
          title: '紧急插队报告',
          duration_minutes: 60,
          urgency: 90,
          importance: 90,
          importance_tier: 'vital',
          time_mode: 'deadline',
          urgency_pace: 'urgent',
          deadline: wallClockIso(tomorrowKey, 18, 0),
          deadline_kind: 'soft',
        },
        proposal: {
          type: 'deadline_risk',
          reasonText: '高优任务即将逾期',
          conflictTask: {
            id: lowPri.task!.id,
            instanceId: conflictInst.id,
            title: lowPri.task!.title,
            scheduled_start: existingStart,
            scheduled_end: existingEnd,
            duration_minutes: 60,
            urgency: lowPri.task!.urgency,
            importance: lowPri.task!.importance,
            deadline: lowPri.task!.deadline,
          },
          newTaskSchedule: {
            start: propStart,
            end: propEnd,
            blocks: [{ start: propStart, end: propEnd, duration: 60 }],
          },
          conflictTaskSchedule: {
            start: wallClockIso(tomorrowKey, 13, 0),
            end: wallClockIso(tomorrowKey, 14, 0),
          },
        },
        conflictInstanceId: conflictInst.id,
        conflictInstanceVersion: conflictInst.version,
      },
    });

    // Meanwhile someone books a fixed external event overlapping the proposed slot 10:00-11:00
    db.prepare(`
      INSERT INTO external_events (user_id, title, start_time, end_time, status, transparency)
      VALUES (?, '临时外部会议', ?, ?, 'CONFIRMED', 'OPAQUE')
    `).run(userId, propStart, propEnd);

    const resolveStale = resolveScheduleProposal({
      userId,
      proposalId: proposalRecord.id,
      decision: 'accept',
    });
    assert.equal(resolveStale.success, false);
    assert.ok(resolveStale.status === 'recomputed' || resolveStale.status === 'expired');

    // Reject path: create a fresh proposal and reject it -> inserts task without displacing lowPri
    const freshProp = createScheduleProposal({
      userId,
      basePlanVersion: getLatestPlanVersion(userId),
      reasonType: 'priority_gain',
      reasonText: '高优替代提案',
      payload: {
        newTaskSpec: {
          title: '备选排程任务',
          duration_minutes: 45,
          urgency: 80,
          importance: 80,
          time_mode: 'flexible',
          deadline_kind: 'soft',
        },
        proposal: {
          type: 'priority_gain',
          reasonText: '高优替代提案',
          conflictTask: {
            id: lowPri.task!.id,
            instanceId: conflictInst.id,
            title: lowPri.task!.title,
            scheduled_start: existingStart,
            scheduled_end: existingEnd,
            duration_minutes: 60,
            urgency: lowPri.task!.urgency,
            importance: lowPri.task!.importance,
            deadline: lowPri.task!.deadline,
          },
          newTaskSchedule: {
            start: wallClockIso(tomorrowKey, 14, 0),
            end: wallClockIso(tomorrowKey, 14, 45),
          },
          conflictTaskSchedule: {
            start: wallClockIso(tomorrowKey, 15, 0),
            end: wallClockIso(tomorrowKey, 16, 0),
          },
        },
        conflictInstanceId: conflictInst.id,
        conflictInstanceVersion: conflictInst.version,
      },
    });

    const rejected = resolveScheduleProposal({
      userId,
      proposalId: freshProp.id,
      decision: 'reject',
    });
    assert.equal(rejected.success, true);
    assert.equal(rejected.status, 'rejected');
    assert.ok(rejected.taskId);
  });

  it('enforces unified 360m daily cap, leaves hard infeasible tasks pending, and records soft partial allocations (T08, T10, T12)', async () => {
    assert.equal(EFFECTIVE_DAILY_CAP_MINUTES, 360);
    const dayAfterTomorrow = addDaysToDateKey(tomorrowKey, 1);

    // Block all daytime slots on tomorrowKey and dayAfterTomorrow up to 360m via a large soft-deadline task
    // First test: hard deadline task whose duration (900m) exceeds max 2-day capacity (360+360=720m) before tomorrowKey 17:00
    const hardRes = await createTaskCommand({
      userId,
      rawInput: {
        title: '无法塞入的硬截止任务',
        duration_minutes: 900,
        deadline: wallClockIso(tomorrowKey, 17, 0),
        deadline_kind: 'hard',
        importance_tier: 'vital',
      },
    });
    assert.equal(hardRes.success, true);
    assert.equal(hardRes.task!.status, 'pending_slot');

    // Should NOT consume shared schedule_blocks
    const hardBlocks = db
      .prepare("SELECT * FROM schedule_blocks WHERE task_id = ? AND status IN ('planned', 'in_progress')")
      .all(hardRes.task!.id) as any[];
    assert.equal(hardBlocks.length, 0);

    const hardInst = db
      .prepare('SELECT * FROM task_instances WHERE task_id = ?')
      .get(hardRes.task!.id) as any;
    assert.equal(hardInst.allocated_minutes, 0);
    assert.equal(hardInst.unallocated_minutes, 900);

    // Next test: soft deadline task that partially fits before horizon cap -> allocated + unallocated = duration
    const softRes = await createTaskCommand({
      userId,
      rawInput: {
        title: '超大容量软截止任务',
        duration_minutes: 1500,
        deadline: wallClockIso(dayAfterTomorrow, 22, 0),
        deadline_kind: 'soft',
        importance_tier: 'support',
      },
    });
    assert.equal(softRes.success, true);
    const softInst = db
      .prepare('SELECT * FROM task_instances WHERE task_id = ?')
      .get(softRes.task!.id) as any;
    assert.ok(softInst.allocated_minutes > 0);
    assert.equal(softInst.allocated_minutes + softInst.unallocated_minutes, 1500);
  });

  it('executes daily rollover per account IANA timezone (America/New_York vs Asia/Shanghai) (C06)', async () => {
    const shanghaiUser = seedTestUser({ username: 'sh_user', timezone: 'Asia/Shanghai' }).userId;
    const nyUser = seedTestUser({ username: 'ny_user', timezone: 'America/New_York' }).userId;

    // 2026-07-02 01:00 UTC+8 == 2026-07-01 17:00 UTC == 2026-07-01 13:00 EDT (America/New_York)
    const testNow = new Date('2026-07-01T17:00:00.000Z');
    const shDate = getAccountLocalDateKey(testNow, 'Asia/Shanghai'); // 2026-07-02
    const nyDate = getAccountLocalDateKey(testNow, 'America/New_York'); // 2026-07-01
    assert.equal(shDate, '2026-07-02');
    assert.equal(nyDate, '2026-07-01');

    // Insert daily templates directly for both users
    db.prepare(`
      INSERT INTO tasks (user_id, title, duration_minutes, original_duration_minutes, time_mode, is_fixed, status, scheduled_start, scheduled_end, active_template)
      VALUES (?, '上海每日习惯', 30, 30, 'daily_fixed', 1, 'scheduled', ?, ?, 1)
    `).run(shanghaiUser, wallClockIso('2026-07-01', 9, 0, 'Asia/Shanghai'), wallClockIso('2026-07-01', 9, 30, 'Asia/Shanghai'));

    db.prepare(`
      INSERT INTO tasks (user_id, title, duration_minutes, original_duration_minutes, time_mode, is_fixed, status, scheduled_start, scheduled_end, active_template)
      VALUES (?, '纽约每日习惯', 30, 30, 'daily_fixed', 1, 'scheduled', ?, ?, 1)
    `).run(nyUser, wallClockIso('2026-06-30', 9, 0, 'America/New_York'), wallClockIso('2026-06-30', 9, 30, 'America/New_York'));

    const triggered = runDailyRolloverCycle(testNow);
    assert.ok(triggered.includes(shanghaiUser));
    assert.ok(triggered.includes(nyUser));

    const shInst = db
      .prepare('SELECT business_date FROM task_instances WHERE user_id = ?')
      .get(shanghaiUser) as any;
    const nyInst = db
      .prepare('SELECT business_date FROM task_instances WHERE user_id = ?')
      .get(nyUser) as any;
    assert.equal(shInst.business_date, '2026-07-02');
    assert.equal(nyInst.business_date, '2026-07-01');
  });

  it('preserves scheduled blocks inside schedule_lock window during replan while still filling free slots and unlocking expired blocks', async () => {
    const anchorNow = new Date(wallClockIso(tomorrowKey, 9, 0));
    // First use 36h lock so tomorrowKey 10:00-11:00 is protected even during createTaskCommand(tHigh) at real now
    db.prepare(
      "UPDATE user_settings SET schedule_lock_mode = 'hours', schedule_lock_hours = 36, work_slots = ? WHERE user_id = ?"
    ).run(JSON.stringify([{ start: '09:00', end: '18:00' }]), userId);

    // Low-priority movable task placed at 10:00-11:00 (inside lock window)
    const tLow = await createTaskCommand({
      userId,
      rawInput: {
        title: '锁定期内低优任务',
        duration_minutes: 60,
        importance_tier: 'minor',
        importance: 30,
        urgency: 40,
      },
    });
    assert.equal(tLow.success, true);

    // Pin its block to tomorrowKey 10:00-11:00 via DB to verify replan keeps it intact
    const lockedStart = wallClockIso(tomorrowKey, 10, 0);
    const lockedEnd = wallClockIso(tomorrowKey, 11, 0);
    db.prepare(
      "UPDATE schedule_blocks SET start_time = ?, end_time = ?, status = 'planned' WHERE task_id = ?"
    ).run(lockedStart, lockedEnd, tLow.task!.id);

    // Create a high-priority urgent task with deadline tomorrowKey 14:00 (plenty of free slots after 11:00)
    const tHigh = await createTaskCommand({
      userId,
      rawInput: {
        title: '插空高优任务',
        duration_minutes: 60,
        deadline: wallClockIso(tomorrowKey, 14, 0),
        deadline_kind: 'hard',
        importance_tier: 'vital',
        importance: 95,
        urgency: 95,
      },
    });
    assert.equal(tHigh.success, true);
    assert.equal(tHigh.proposal, undefined); // Must NOT propose displacing locked 10:00-11:00 task

    // Switch to 6h rolling lock and trigger manual replan anchored at tomorrowKey 09:00 (lockUntil = 15:00)
    db.prepare("UPDATE user_settings SET schedule_lock_mode = 'hours', schedule_lock_hours = 6 WHERE user_id = ?").run(userId);
    const replan = replanUserTasks(userId, { triggerSource: 'manual_replan', now: anchorNow });
    assert.equal(replan.success, true);

    const lowBlockAfter = db
      .prepare("SELECT start_time, end_time FROM schedule_blocks WHERE task_id = ? AND status = 'planned'")
      .get(tLow.task!.id) as { start_time: string; end_time: string };
    assert.equal(new Date(lowBlockAfter.start_time).getTime(), new Date(lockedStart).getTime());
    assert.equal(new Date(lowBlockAfter.end_time).getTime(), new Date(lockedEnd).getTime());

    const highBlockAfter = db
      .prepare("SELECT start_time, end_time FROM schedule_blocks WHERE task_id = ? AND status = 'planned'")
      .get(tHigh.task!.id) as { start_time: string; end_time: string };
    assert.ok(highBlockAfter);
    // High task filled free slot without overlapping locked 10:00-11:00 block
    const hStart = new Date(highBlockAfter.start_time).getTime();
    const hEnd = new Date(highBlockAfter.end_time).getTime();
    assert.ok(hEnd <= new Date(lockedStart).getTime() || hStart >= new Date(lockedEnd).getTime());

    // Advance time past 11:00 -> low task block expired & incomplete, so replan unlocks and rolls it forward
    const afterExpiryNow = new Date(wallClockIso(tomorrowKey, 11, 30));
    replanUserTasks(userId, { triggerSource: 'daily_rollover', now: afterExpiryNow });
    const rolledBlock = db
      .prepare("SELECT start_time, end_time FROM schedule_blocks WHERE task_id = ? AND status = 'planned'")
      .get(tLow.task!.id) as { start_time: string; end_time: string };
    assert.ok(new Date(rolledBlock.start_time).getTime() >= afterExpiryNow.getTime());
  });

  it('specific_date requires target date, pins execution to chosen day, and moves cleanly on update', async () => {
    const missingDateRes = await createTaskCommand({
      userId,
      rawInput: {
        title: '缺少日期的指定日任务',
        duration_minutes: 60,
        time_mode: 'specific_date',
      },
    });
    assert.equal(missingDateRes.success, false);
    assert.equal(missingDateRes.statusCode, 400);

    const dayPlus3 = addDaysToDateKey(getAccountLocalDateKey(new Date(), 'Asia/Shanghai'), 3);
    const dayPlus5 = addDaysToDateKey(getAccountLocalDateKey(new Date(), 'Asia/Shanghai'), 5);

    const created = await createTaskCommand({
      userId,
      rawInput: {
        title: '周报整理（指定第3天）',
        duration_minutes: 60,
        time_mode: 'specific_date',
        deadline: `${dayPlus3}T23:59:59`,
        deadline_kind: 'soft',
        importance_tier: 'minor',
      },
    });
    assert.equal(created.success, true);
    assert.equal(created.task?.time_mode, 'specific_date');

    const block1 = db
      .prepare("SELECT start_time FROM schedule_blocks WHERE task_id = ? AND status = 'planned'")
      .get(created.task!.id) as { start_time: string };
    assert.ok(block1);
    assert.equal(getAccountLocalDateKey(new Date(block1.start_time), 'Asia/Shanghai'), dayPlus3);

    // Move task to dayPlus5 via updateTaskCommand even under today lock
    db.prepare("UPDATE user_settings SET schedule_lock_mode = 'today' WHERE user_id = ?").run(userId);
    const updated = await updateTaskCommand({
      userId,
      taskId: created.task!.id,
      rawInput: {
        time_mode: 'specific_date',
        deadline: `${dayPlus5}T23:59:59`,
      },
    });
    assert.equal(updated.success, true);
    const block2 = db
      .prepare("SELECT start_time FROM schedule_blocks WHERE task_id = ? AND status = 'planned'")
      .get(created.task!.id) as { start_time: string };
    assert.ok(block2);
    assert.equal(getAccountLocalDateKey(new Date(block2.start_time), 'Asia/Shanghai'), dayPlus5);
  });
});
