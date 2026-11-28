import { deadlinePressure, recurringDebt } from './calendarOptimizer.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Task, UserSettings } from '../models/types.js';
import {
  buildExtendedScheduleBlocks,
  computeScheduleLockUntil,
  formatLocalDate,
  isScheduleBlockTimeLocked,
  parseDeadlineDate,
  parseWorkSlotWindows,
  runSingleDaySchedule,
  scheduleTaskGroupInHorizon,
  splitIntoFocusSessions,
  taskToBusyEvents,
  getSpecificExecutionDateKey,
} from './scheduler.js';
import { findDueReminderBlockIndex } from './reminder.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    user_id: 1,
    title: '测试任务',
    duration_minutes: 60,
    urgency: 80,
    importance: 80,
    score_scale: 100,
    deadline: null,
    scheduled_start: null,
    scheduled_end: null,
    status: 'pending_slot',
    start_reminder_sent: 0,
    end_reminder_sent: 0,
    created_at: '2026-11-22T00:00:00.000Z',
    updated_at: '2026-11-22T00:00:00.000Z',
    ...overrides,
  };
}

test('parseWorkSlotWindows preserves disjoint windows and midnight boundaries', () => {
  const settings = {
    work_slots: JSON.stringify([
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '18:00' },
      { start: '19:00', end: '24:00' },
      { start: '00:00', end: '02:00' },
    ]),
  } as UserSettings;

  const parsed = parseWorkSlotWindows(settings);
  assert.equal(parsed.workStartHour, 0);
  assert.equal(parsed.workEndHour, 24);
  assert.deepEqual(parsed.workWindows, [
    { startHour: 0, endHour: 2 },
    { startHour: 9, endHour: 12 },
    { startHour: 13, endHour: 18 },
    { startHour: 19, endHour: 24 },
  ]);

  const endMidnightSettings = {
    work_slots: JSON.stringify([{ start: '19:00', end: '00:00' }]),
  } as UserSettings;
  const endMidnight = parseWorkSlotWindows(endMidnightSettings);
  assert.deepEqual(endMidnight.workWindows, [{ startHour: 19, endHour: 24 }]);

  const halfPastMidnight = parseWorkSlotWindows({
    work_slots: JSON.stringify([{ start: '00:00', end: '00:30' }]),
  } as UserSettings);
  assert.deepEqual(halfPastMidnight.workWindows, [{ startHour: 0, endHour: 0.5 }]);
});

test('runSingleDaySchedule respects disjoint workWindows and avoids sleeping hours & non-work gaps', () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const { workStartHour, workEndHour, workWindows } = parseWorkSlotWindows({
    work_slots: JSON.stringify([
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '18:00' },
      { start: '19:00', end: '24:00' },
      { start: '00:00', end: '02:00' },
    ]),
  } as UserSettings);

  // Fill daytime morning and afternoon with fixed events so task must pick 19:00-20:00 (not 02:00-09:00!)
  const morningBusyStart = new Date(tomorrow);
  morningBusyStart.setHours(9, 0, 0, 0);
  const afternoonBusyEnd = new Date(tomorrow);
  afternoonBusyEnd.setHours(18, 0, 0, 0);

  const fixedEvents = [
    {
      id: 'ext-1',
      title: '全天会议',
      start: morningBusyStart,
      end: afternoonBusyEnd,
      isAllDay: false,
    },
  ];

  const task = makeTask({ id: 10, duration_minutes: 60, importance: 90, urgency: 90 });
  const res = runSingleDaySchedule([task], fixedEvents, {
    targetDate: tomorrow,
    workStartHour,
    workEndHour,
    workWindows,
  });

  assert.equal(res.scheduledBlocks.length, 1);
  const block = res.scheduledBlocks[0];
  const startHour = block.start.getHours() + block.start.getMinutes() / 60;
  // Must NOT be placed in 02:00-09:00 sleeping hours and should prefer 19:00 evening over 00:00-02:00 late night
  assert.ok(startHour >= 19 && startHour < 24, `Expected evening >=19:00, got hour=${startHour}`);
});

test('runSingleDaySchedule prioritizes slots ending before same-day deadline and allows deadline-day scheduling', () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const deadline = new Date(tomorrow);
  deadline.setHours(14, 30, 0, 0);

  // Busy 08:00 - 12:30, leaving 13:00-14:30 (low energy, before DDL) and 15:00-18:00 (peak energy, AFTER DDL)
  const busyStart = new Date(tomorrow);
  busyStart.setHours(8, 0, 0, 0);
  const busyEnd = new Date(tomorrow);
  busyEnd.setHours(12, 30, 0, 0);

  const task = makeTask({
    id: 11,
    duration_minutes: 60,
    importance: 85,
    urgency: 90,
    deadline: deadline.toISOString(),
  });

  const res = runSingleDaySchedule([task], [
    { id: 'busy-am', title: '上午占用', start: busyStart, end: busyEnd, isAllDay: false },
  ], {
    targetDate: tomorrow,
    workStartHour: 8,
    workEndHour: 22,
    advanceDeadlineDays: 1,
  });

  assert.equal(res.scheduledBlocks.length, 1);
  assert.ok(
    res.scheduledBlocks[0].end.getTime() <= deadline.getTime(),
    `Expected block to end at or before ${deadline.toISOString()}, got ${res.scheduledBlocks[0].end.toISOString()}`
  );
});

test('taskToBusyEvents splits schedule_blocks cleanly and projects locked daily_fixed tasks', () => {
  const day1Start = '2026-11-23T09:00:00.000Z';
  const day1End = '2026-11-23T10:00:00.000Z';
  const day2Start = '2026-11-24T15:00:00.000Z';
  const day2End = '2026-11-24T16:00:00.000Z';

  const splitTask = makeTask({
    id: 21,
    title: '分段长任务',
    scheduled_start: day1Start,
    scheduled_end: day2End,
    schedule_blocks: JSON.stringify([
      { start: day1Start, end: day1End, completed: true },
      { start: day2Start, end: day2End, completed: false },
    ]),
  });

  // Only uncompleted block (day2) should be emitted, NOT one 31-hour span from day1Start to day2End!
  const splitBusy = taskToBusyEvents(splitTask, 'task');
  assert.equal(splitBusy.length, 1);
  assert.equal(splitBusy[0].start.toISOString(), day2Start);
  assert.equal(splitBusy[0].end.toISOString(), day2End);

  const baseDate = new Date(2026, 10, 22, 10, 0, 0, 0);
  const dailyStart = new Date(2026, 10, 22, 19, 0, 0, 0);
  const dailyEnd = new Date(2026, 10, 22, 20, 0, 0, 0);
  const doneTomorrowKey = formatLocalDate(new Date(2026, 10, 23, 0, 0, 0, 0));

  const dailyFixedTask = makeTask({
    id: 22,
    title: '每日运动',
    time_mode: 'daily_fixed',
    is_fixed: 1,
    scheduled_start: dailyStart.toISOString(),
    scheduled_end: dailyEnd.toISOString(),
    completed_dates: JSON.stringify([doneTomorrowKey]),
  });

  const projected = taskToBusyEvents(dailyFixedTask, 'fixed-task', baseDate, 3);
  // Day 0 (22nd) + Day 2 (24th), skipping Day 1 (23rd) because it is in completed_dates
  assert.equal(projected.length, 2);
  assert.equal(formatLocalDate(projected[0].start), formatLocalDate(baseDate));
  assert.equal(formatLocalDate(projected[1].start), formatLocalDate(new Date(2026, 10, 24)));
});

test('parseWorkSlotWindows handles overnight slots and plain-text strings', () => {
  const overnight = parseWorkSlotWindows({
    work_slots: JSON.stringify([{ start: '20:00', end: '02:00' }]),
  } as UserSettings);
  assert.equal(overnight.workStartHour, 0);
  assert.equal(overnight.workEndHour, 24);
  assert.deepEqual(overnight.workWindows, [
    { startHour: 0, endHour: 2 },
    { startHour: 20, endHour: 24 },
  ]);

  const plainText = parseWorkSlotWindows({
    work_slots: '09:00-12:00, 14:00-18:00',
  } as UserSettings);
  assert.equal(plainText.workStartHour, 9);
  assert.equal(plainText.workEndHour, 18);
  assert.deepEqual(plainText.workWindows, [
    { startHour: 9, endHour: 12 },
    { startHour: 14, endHour: 18 },
  ]);
});

test('runSingleDaySchedule strictly clamps blocks within workWindows without fractional overshoot', () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const { workStartHour, workEndHour, workWindows } = parseWorkSlotWindows({
    work_slots: JSON.stringify([{ start: '14:00', end: '18:00' }]),
  } as UserSettings);

  // External event ends at 16:50:20, leaving 59m40s + 10m buffer? Use bufferMinutes=0 -> 59m40s before 18:00:00.
  // Should NOT schedule a 60m block that spills to 18:00:20 past work window end 18:00:00!
  const extStart = new Date(tomorrow);
  extStart.setHours(14, 0, 0, 0);
  const extEnd = new Date(tomorrow);
  extEnd.setHours(17, 0, 20, 0);

  const task = makeTask({ id: 31, duration_minutes: 60, importance: 90, urgency: 90 });
  const res = runSingleDaySchedule([task], [
    { id: 'ext-sec', title: '带秒会议', start: extStart, end: extEnd, isAllDay: false },
  ], {
    targetDate: tomorrow,
    workStartHour,
    workEndHour,
    workWindows,
    bufferMinutes: 0,
  });

  const windowEnd = new Date(tomorrow);
  windowEnd.setHours(18, 0, 0, 0);
  for (const b of res.scheduledBlocks) {
    assert.ok(b.end.getTime() <= windowEnd.getTime(), `Block ${b.end.toISOString()} exceeded work window end ${windowEnd.toISOString()}`);
  }
});

test('parseDeadlineDate treats date-only strings as local 23:59:59 instead of UTC 00:00Z', () => {
  const parsed = parseDeadlineDate('2026-11-23');
  assert.ok(parsed !== null);
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 10);
  assert.equal(parsed.getDate(), 23);
  assert.equal(parsed.getHours(), 23);
  assert.equal(parsed.getMinutes(), 59);
  assert.equal(parsed.getSeconds(), 59);
});

test('runSingleDaySchedule caps lunch push at 13:30 and dinner push at 19:30', () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  // Busy blocks covering 10:00-12:30 (pushes lunch to 12:30-13:30) and 17:00-19:45 (exceeds 19:30 dinner cap)
  // Expect 13:30-17:00 and 19:45-22:00 to remain schedulable without pushed dinner eating 19:45-20:45!
  const b1Start = new Date(tomorrow);
  b1Start.setHours(9, 0, 0, 0);
  const b1End = new Date(tomorrow);
  b1End.setHours(12, 30, 0, 0);

  const b2Start = new Date(tomorrow);
  b2Start.setHours(13, 30, 0, 0);
  const b2End = new Date(tomorrow);
  b2End.setHours(19, 45, 0, 0);

  const task = makeTask({ id: 32, duration_minutes: 60, importance: 90, urgency: 90 });
  const res = runSingleDaySchedule([task], [
    { id: 'm1', title: '上午会', start: b1Start, end: b1End, isAllDay: false },
    { id: 'm2', title: '下午连续会', start: b2Start, end: b2End, isAllDay: false },
  ], {
    targetDate: tomorrow,
    workStartHour: 9,
    workEndHour: 22,
    bufferMinutes: 0,
  });

  // Because dinner is capped at 19:30 and m2 already ends at 19:45, 19:45-20:45 must NOT be blocked by a pushed dinner rest!
  assert.equal(res.scheduledBlocks.length, 1);
  assert.equal(res.scheduledBlocks[0].start.getHours(), 19);
  assert.equal(res.scheduledBlocks[0].start.getMinutes(), 45);
});

test('buildExtendedScheduleBlocks updates trailing block end & duration or creates fallback block', () => {
  const newEnd = new Date('2026-11-23T11:30:00.000Z');
  const existing = JSON.stringify([
    { start: '2026-11-23T09:00:00.000Z', end: '2026-11-23T10:00:00.000Z', duration: 60 },
    { start: '2026-11-23T10:10:00.000Z', end: '2026-11-23T11:00:00.000Z', duration: 50 },
  ]);

  const updatedJson = buildExtendedScheduleBlocks(
    existing,
    '2026-11-23T09:00:00.000Z',
    '2026-11-23T11:00:00.000Z',
    110,
    newEnd,
    30
  );
  assert.ok(updatedJson !== null);
  const updated = JSON.parse(updatedJson);
  assert.equal(updated.length, 2);
  assert.equal(updated[0].end, '2026-11-23T10:00:00.000Z');
  assert.equal(updated[1].end, '2026-11-23T11:30:00.000Z');
  assert.equal(updated[1].duration, 80);

  const fallbackJson = buildExtendedScheduleBlocks(
    null,
    '2026-11-23T10:00:00.000Z',
    '2026-11-23T11:00:00.000Z',
    60,
    newEnd,
    30
  );
  assert.ok(fallbackJson !== null);
  const fallback = JSON.parse(fallbackJson);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].end, '2026-11-23T11:30:00.000Z');
  assert.equal(fallback[0].duration, 90);
});





test('focus sessions balance the task duration instead of defaulting to one hour', () => {
  assert.deepEqual(splitIntoFocusSessions(150), [75, 75]);
  assert.deepEqual(splitIntoFocusSessions(70), [70]);
  assert.equal(splitIntoFocusSessions(181).reduce((a, b) => a + b, 0), 181);
  assert.ok(splitIntoFocusSessions(181).every(minutes => minutes <= 90));
});

test('all-day events and fractional busy boundaries are never scheduled over', () => {
  const day = new Date();
  day.setDate(day.getDate() + 1);
  day.setHours(0, 0, 0, 0);
  const nextDay = new Date(day);
  nextDay.setDate(nextDay.getDate() + 1);
  const allDay = runSingleDaySchedule([makeTask()], [
    { id: 'all', title: '忙碌', start: day, end: nextDay, isAllDay: true },
  ], { targetDate: day });
  assert.equal(allDay.scheduledBlocks.length, 0);

  const busyStart = new Date(day); busyStart.setHours(9, 59, 40, 0);
  const busyEnd = new Date(day); busyEnd.setHours(22, 0, 0, 0);
  const result = runSingleDaySchedule([makeTask({ duration_minutes: 60 })], [
    { id: 'busy', title: '会议', start: busyStart, end: busyEnd, isAllDay: false },
  ], { targetDate: day, workStartHour: 9, workEndHour: 22, bufferMinutes: 0 });
  assert.ok(result.scheduledBlocks.every(block => block.end <= busyStart || block.start >= busyEnd));
});


test('semantic plan keeps coursework in 2h and 3h blocks inside Work Slots', () => {
  const day = new Date(); day.setDate(day.getDate() + 1); day.setHours(0, 0, 0, 0);
  const result = runSingleDaySchedule([makeTask({ duration_minutes: 300, session_plan: '[120,180]' })], [], {
    targetDate: day, workStartHour: 8, workEndHour: 22,
    workWindows: [{ startHour: 9, endHour: 11 }, { startHour: 15, endHour: 18 }], bufferMinutes: 0,
  });
  assert.deepEqual(result.scheduledBlocks.map(b => b.durationMinutes), [120,180]);
  assert.ok(result.scheduledBlocks.every(b => (b.start.getHours() >= 9 && b.end.getHours() <= 11) || (b.start.getHours() >= 15 && b.end.getHours() <= 18)));
});

test('semantic sessions are deferred instead of fragmented into small free windows', () => {
  const day = new Date(); day.setDate(day.getDate() + 1);
  const result = runSingleDaySchedule([makeTask({ duration_minutes: 300, session_plan: '[120,180]' })], [], {
    targetDate: day, workStartHour: 9, workEndHour: 17,
    workWindows: [{ startHour: 9, endHour: 10 }, { startHour: 15, endHour: 16 }],
  });
  assert.equal(result.scheduledBlocks.length, 0);
  assert.equal(result.unscheduledTaskIds[0].remainingMinutes, 300);
});

test('empty or invalid configured Work Slots never broaden to default hours', () => {
  for (const work_slots of ['[]', 'invalid', '']) {
    const windows = parseWorkSlotWindows({ work_slots } as UserSettings);
    assert.equal(windows.workStartHour, windows.workEndHour);
    assert.deepEqual(windows.workWindows, []);
  }
});

test('soft and hard deadlines share pressure and slope while there is ample capacity', () => {
  const epsilon = 1e-6;
  for (const load of [0, 0.1, 0.4, 0.6]) {
    assert.equal(deadlinePressure(load, true), deadlinePressure(load, false));
    assert.ok(Math.abs(
      (deadlinePressure(load + epsilon, true) - deadlinePressure(load + epsilon, false)) / epsilon
    ) < 1e-5);
  }
  assert.ok(deadlinePressure(0.95, true) > deadlinePressure(0.95, false));
  assert.ok(Number.isFinite(deadlinePressure(1, true)));
});

test('a missed daily occurrence raises debt and checking in reduces it the next day', () => {
  const created = new Date(2026, 10, 20);
  const today = new Date(2026, 10, 22);
  const task = makeTask({ created_at: created.toISOString(), completed_dates: '["2026-11-20"]' });
  assert.equal(recurringDebt(task, created), 0);
  assert.equal(recurringDebt(task, today), 1);
  assert.equal(recurringDebt({ ...task, completed_dates: '["2026-11-20","2026-11-22"]' }, new Date(2026, 10, 23)), 0.8);
});

test('long tasks of similar importance alternate without cutting their phases', () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const sessions = JSON.stringify(Array<number>(25).fill(120));
  const tasks = [makeTask({ duration_minutes: 3000, session_plan: sessions }),
    makeTask({ id: 2, importance: 79, duration_minutes: 3000, session_plan: sessions })];
  const allocationDebt = new Map<number, number>();
  const order: number[] = [];
  for (let day = 0; day < 10; day++) {
    const result = runSingleDaySchedule(tasks, [], {
      targetDate: date, workStartHour: 8, workEndHour: 12,
      taskRestMinutes: 0, maxDailyTaskMinutes: 210, allocationDebt,
    });
    for (const block of result.scheduledBlocks) {
      assert.equal(block.durationMinutes, 120);
      order.push(block.taskId);
    }
    for (const pending of result.unscheduledTaskIds) tasks.find(task => task.id === pending.taskId)!.duration_minutes = pending.remainingMinutes;
    date.setDate(date.getDate() + 1);
  }
  assert.deepEqual(order, Array.from({ length: 20 }, (_, i) => i % 2 + 1));
});

test('hard deadlines protect shared capacity and an impossible phase cannot consume it', () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const deadline = new Date(date);
  deadline.setHours(11, 0, 0, 0);
  const hard = { deadline: deadline.toISOString(), deadline_kind: 'hard' as const };
  const result = runSingleDaySchedule([
    makeTask({ ...hard, importance: 55, session_plan: '[180]', duration_minutes: 180 }),
    makeTask({ ...hard, id: 2, session_plan: '[190]', duration_minutes: 190 }),
    makeTask({ id: 3, importance: 100, duration_minutes: 60 }),
  ], [], { targetDate: date, workStartHour: 8, workEndHour: 12, taskRestMinutes: 0 });
  assert.deepEqual(result.scheduledBlocks.map(b => b.taskId), [1, 3]);
  assert.equal(result.scheduledBlocks[0].end.getTime(), deadline.getTime());
  assert.match(result.unscheduledTaskIds.find(t => t.taskId === 2)!.reason, /不可逾期/);
});


test('overdue task is placed before a similar task with a future deadline', () => {
  const day = new Date(); day.setDate(day.getDate() + 1); day.setHours(0, 0, 0, 0);
  const past = new Date(day); past.setDate(past.getDate() - 6);
  const later = new Date(day); later.setDate(later.getDate() + 7);
  const result = runSingleDaySchedule([
    makeTask({ id: 1, duration_minutes: 300, importance: 80, urgency: 45, deadline: later.toISOString(), session_plan: '[120,180]' }),
    makeTask({ id: 2, duration_minutes: 180, importance: 80, urgency: 95, deadline: past.toISOString(), session_plan: '[180]' }),
  ], [], { targetDate: day, workStartHour: 8, workEndHour: 18, taskRestMinutes: 0, maxDailyTaskMinutes: 480 });
  assert.equal(result.scheduledBlocks[0]?.taskId, 2);
});

test('scheduleTaskGroupInHorizon runs concurrent track independently and tracks remaining partial tasks', () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const fullDayStart = new Date(tomorrow);
  fullDayStart.setHours(9, 0, 0, 0);
  const fullDayEnd = new Date(tomorrow);
  fullDayEnd.setHours(18, 0, 0, 0);

  // Day is completely full with an external meeting, so exclusive tasks can't schedule today,
  // while concurrent track (is_concurrent = 1) still schedules inside workWindows!
  const concurrentTask = makeTask({
    id: 101,
    title: '通勤/并行听课',
    duration_minutes: 60,
    importance: 80,
    urgency: 75,
    is_concurrent: 1,
  });

  const allocations = new Map();
  const remaining = new Set<number>([101]);

  scheduleTaskGroupInHorizon(
    [concurrentTask],
    [],
    tomorrow,
    1,
    {
      workStartHour: 9,
      workEndHour: 18,
      workWindows: [{ startHour: 9, endHour: 18 }],
      bufferMinutes: 0,
      advanceDeadlineDays: 1,
      releaseTimeMsToday: fullDayStart.getTime(),
    },
    allocations,
    remaining
  );

  assert.equal(allocations.get(101)?.length, 1);
  assert.equal(remaining.has(101), false);

  // Partial long task across 1-day horizon keeps remaining unallocated ID in `remaining`
  const hugeTask = makeTask({
    id: 102,
    title: '超长 soft 任务',
    duration_minutes: 600,
    importance: 85,
    urgency: 80,
    deadline_kind: 'soft',
  });
  const partialAlloc = new Map();
  const partialRem = new Set<number>([102]);
  scheduleTaskGroupInHorizon(
    [hugeTask],
    [],
    tomorrow,
    1,
    {
      workStartHour: 9,
      workEndHour: 18,
      workWindows: [{ startHour: 9, endHour: 18 }],
      bufferMinutes: 0,
      advanceDeadlineDays: 1,
      releaseTimeMsToday: fullDayStart.getTime(),
    },
    partialAlloc,
    partialRem
  );
  assert.ok((partialAlloc.get(102)?.length || 0) > 0);
  assert.equal(partialRem.has(102), true);
});

test('findDueReminderBlockIndex fires per-block start & end reminders on multi-part tasks', () => {
  const blocks = [
    {
      start: '2026-11-23T09:00:00.000Z',
      end: '2026-11-23T10:00:00.000Z',
      partIndex: 1,
      totalParts: 2,
      startReminderSent: true,
      endReminderSent: true,
      completed: false,
    },
    {
      start: '2026-11-24T14:00:00.000Z',
      end: '2026-11-24T15:00:00.000Z',
      partIndex: 2,
      totalParts: 2,
      startReminderSent: false,
      endReminderSent: false,
      completed: false,
    },
  ];

  // Block 2 start reminder (5 min before 14:00Z = 13:55Z)
  assert.equal(findDueReminderBlockIndex(blocks, new Date('2026-11-24T13:56:00.000Z'), 5, 'start'), 1);
  // Block 2 end reminder (5 min before 15:00Z = 14:55Z)
  assert.equal(findDueReminderBlockIndex(blocks, new Date('2026-11-24T14:56:00.000Z'), 5, 'end'), 1);
  // Outside window returns -1
  assert.equal(findDueReminderBlockIndex(blocks, new Date('2026-11-24T12:00:00.000Z'), 5, 'start'), -1);
});

test('computeScheduleLockUntil and isScheduleBlockTimeLocked handle rolling hours, today, and this_week boundaries', () => {
  // 2026-11-27 14:30+08:00 (Friday)
  const fridayNow = new Date('2026-11-27T06:30:00.000Z');
  assert.equal(computeScheduleLockUntil({ schedule_lock_mode: 'none', schedule_lock_hours: 4 }, fridayNow, 'Asia/Shanghai'), null);

  const lock4h = computeScheduleLockUntil({ schedule_lock_mode: 'hours', schedule_lock_hours: 4 }, fridayNow, 'Asia/Shanghai');
  assert.equal(lock4h?.toISOString(), '2026-11-27T10:30:00.000Z'); // 18:30+08:00

  const lockToday = computeScheduleLockUntil({ schedule_lock_mode: 'today', schedule_lock_hours: 0 }, fridayNow, 'Asia/Shanghai');
  assert.equal(lockToday?.toISOString(), '2026-11-27T15:59:59.999Z'); // 23:59:59.999+08:00

  const lockWeek = computeScheduleLockUntil({ schedule_lock_mode: 'this_week', schedule_lock_hours: 0 }, fridayNow, 'Asia/Shanghai');
  assert.equal(lockWeek?.toISOString(), '2026-11-29T15:59:59.999Z'); // Sunday 2026-11-29 23:59:59.999+08:00

  // Sunday stays on the same Sunday
  const sundayNow = new Date('2026-11-29T02:00:00.000Z');
  const lockSundayWeek = computeScheduleLockUntil({ schedule_lock_mode: 'this_week', schedule_lock_hours: 0 }, sundayNow, 'Asia/Shanghai');
  assert.equal(lockSundayWeek?.toISOString(), '2026-11-29T15:59:59.999Z');

  // Block inside lock window and still ending in future -> locked
  assert.equal(
    isScheduleBlockTimeLocked('2026-11-27T09:00:00.000Z', '2026-11-27T10:00:00.000Z', lock4h, fridayNow),
    true
  );
  // Past expired incomplete block (end <= now) -> NOT locked so it can roll forward
  assert.equal(
    isScheduleBlockTimeLocked('2026-11-27T05:00:00.000Z', '2026-11-27T06:00:00.000Z', lock4h, fridayNow),
    false
  );
  // Block starting at or after lockUntil -> NOT locked
  assert.equal(
    isScheduleBlockTimeLocked('2026-11-27T10:30:00.000Z', '2026-11-27T11:30:00.000Z', lock4h, fridayNow),
    false
  );
});

test('specific_date tasks are scheduled only on (and not before) their target execution date', () => {
  const baseNow = new Date('2026-12-01T00:00:00.000Z'); // 08:00 Asia/Shanghai
  const specTask = makeTask({
    id: 201,
    title: '周四执行汇报',
    time_mode: 'specific_date',
    deadline: '2026-12-03T15:59:59.999Z', // 2026-12-03 23:59:59 Asia/Shanghai
    deadline_kind: 'soft',
    duration_minutes: 60,
    importance: 60,
    urgency: 40,
  });

  assert.equal(getSpecificExecutionDateKey(specTask, 'Asia/Shanghai'), '2026-12-03');

  const allocations = new Map();
  const remaining = new Set<number>([201]);
  scheduleTaskGroupInHorizon(
    [specTask],
    [],
    baseNow,
    5,
    {
      timezone: 'Asia/Shanghai',
      workStartHour: 9,
      workEndHour: 18,
      workWindows: [{ startHour: 9, endHour: 18 }],
      bufferMinutes: 10,
      advanceDeadlineDays: 2,
      releaseTimeMsToday: baseNow.getTime(),
    },
    allocations,
    remaining
  );

  const placed = allocations.get(201) || [];
  assert.equal(placed.length, 1);
  assert.equal(remaining.has(201), false);
  // Placed strictly on 2026-12-03 (never pulled earlier to Dec 1 or Dec 2 despite advanceDeadlineDays=2)
  const placedDateKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(placed[0].start);
  assert.equal(placedDateKey, '2026-12-03');

  // Strict same-day (`hard`) task when target day is completely blocked does not spill to next day
  const hardSpecTask = makeTask({
    id: 202,
    title: '严格周四处理',
    time_mode: 'specific_date',
    deadline: '2026-12-03T15:59:59.999Z',
    deadline_kind: 'hard',
    duration_minutes: 60,
    importance: 75,
    urgency: 60,
  });
  const dec3FullBusy = [
    {
      id: 'busy-dec3',
      title: 'Full Day Meeting',
      start: new Date('2026-12-03T00:00:00.000Z'),
      end: new Date('2026-12-03T14:00:00.000Z'),
      isAllDay: false,
    },
  ];
  const hardAlloc = new Map();
  const hardRem = new Set<number>([202]);
  scheduleTaskGroupInHorizon(
    [hardSpecTask],
    dec3FullBusy,
    baseNow,
    5,
    {
      timezone: 'Asia/Shanghai',
      workStartHour: 9,
      workEndHour: 18,
      workWindows: [{ startHour: 9, endHour: 18 }],
      bufferMinutes: 0,
      advanceDeadlineDays: 1,
      releaseTimeMsToday: baseNow.getTime(),
    },
    hardAlloc,
    hardRem
  );
  assert.equal((hardAlloc.get(202) || []).length, 0);
  assert.equal(hardRem.has(202), true);
});

test('flexible Plan A cool-off & workload-aware admission protects today and keeps later memos in backlog when busy', () => {
  const baseNow = new Date('2026-12-01T00:00:00.000Z'); // 08:00 Asia/Shanghai
  const dateKeyInSh = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);

  // Case 1: Idle 7-day calendar -> `later` respects 3-day cool-off (>= 2026-12-04) instead of filling today (2026-12-01)
  const laterTask = makeTask({
    id: 301,
    title: '整理相册(远期)',
    time_mode: 'flexible',
    urgency_pace: 'later',
    duration_minutes: 60,
    importance: 25,
    urgency: 25,
    created_at: baseNow.toISOString(),
  });
  const urgentFlexTask = makeTask({
    id: 302,
    title: '紧急修补(尽快推进)',
    time_mode: 'flexible',
    urgency_pace: 'urgent',
    duration_minutes: 60,
    importance: 80,
    urgency: 80,
    created_at: baseNow.toISOString(),
  });

  const idleAlloc = new Map();
  const idleRem = new Set<number>([301, 302]);
  scheduleTaskGroupInHorizon(
    [laterTask, urgentFlexTask],
    [],
    baseNow,
    7,
    {
      timezone: 'Asia/Shanghai',
      workStartHour: 9,
      workEndHour: 18,
      workWindows: [{ startHour: 9, endHour: 18 }],
      bufferMinutes: 0,
      advanceDeadlineDays: 1,
      releaseTimeMsToday: baseNow.getTime(),
    },
    idleAlloc,
    idleRem
  );

  assert.equal(dateKeyInSh(idleAlloc.get(302)![0].start), '2026-12-01'); // urgent lands immediately on day 0
  assert.ok(dateKeyInSh(idleAlloc.get(301)![0].start) >= '2026-12-04'); // later skips days 0..2 cool-off!

  // Case 2: Busy week (Days 0..6 have 5h/day fixed work, leaving 3h free > 60m duration, yet occupancy >= 55%)
  // -> `later` MUST stay in backlog pool despite 3h daily open gap; `soon` skips crowded Day 0..1 when near3d >= 65%
  const busyEvents = Array.from({ length: 7 }, (_, i) => {
    const dayStr = `2026-12-0${1 + i}`;
    return {
      id: `busy-day-${i}`,
      title: `核心会议-${i}`,
      // 09:00..15:00 in Asia/Shanghai = 01:00..07:00 UTC (with 12-13 lunch inside = 5h busy of 8h net work = 62.5% busy, >= 45% threshold)
      start: new Date(`${dayStr}T01:00:00.000Z`),
      end: new Date(`${dayStr}T07:00:00.000Z`),
      isAllDay: false,
    };
  });

  const busyLater = makeTask({ ...laterTask, id: 303 });
  const busySoon = makeTask({
    id: 304,
    title: '优化脚本(近日规划)',
    time_mode: 'flexible',
    urgency_pace: 'soon',
    duration_minutes: 60,
    importance: 55,
    urgency: 55,
    created_at: baseNow.toISOString(),
  });

  const busyAlloc = new Map();
  const busyRem = new Set<number>([303, 304]);
  const busyRejects = new Map<number, { code: string; text: string }>();
  scheduleTaskGroupInHorizon(
    [busyLater, busySoon],
    busyEvents,
    baseNow,
    7,
    {
      timezone: 'Asia/Shanghai',
      workStartHour: 9,
      workEndHour: 18,
      workWindows: [{ startHour: 9, endHour: 18 }],
      bufferMinutes: 0,
      advanceDeadlineDays: 1,
      releaseTimeMsToday: baseNow.getTime(),
    },
    busyAlloc,
    busyRem,
    busyRejects
  );

  // Later memo stays strictly off calendar in backlog
  assert.equal((busyAlloc.get(303) || []).length, 0);
  assert.equal(busyRem.has(303), true);
  assert.equal(busyRejects.get(303)?.code, 'deferred_later_backlog');

  // Soon task defers past crowded Days 0..1 (doesn't touch Dec 1 or Dec 2), or yields when occupancy is too high
  const soonPlaced = busyAlloc.get(304) || [];
  if (soonPlaced.length > 0) {
    assert.ok(dateKeyInSh(soonPlaced[0].start) >= '2026-12-03');
  }
});


