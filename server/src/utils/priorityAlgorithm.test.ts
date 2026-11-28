import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDynamicImportance,
  calculateDynamicUrgency,
  calculateQuadrant100,
  inferTierFromScore,
  normalizeScoreTo100,
  PRIORITY_THRESHOLD,
} from './priorityAlgorithm.js';

describe('calculateDynamicImportance (100分制自动算分)', () => {
  it('按三阶基准输出分值并保持软边界不跨档', () => {
    const vital = calculateDynamicImportance({ tier: 'vital', estimatedMinutes: 30 });
    const support = calculateDynamicImportance({ tier: 'support', estimatedMinutes: 30 });
    const minor = calculateDynamicImportance({ tier: 'minor', estimatedMinutes: 30 });

    assert.equal(vital.importance, 82);
    assert.equal(support.importance, 58);
    assert.equal(minor.importance, 25);

    // 即使琐碎杂务叠加长耗时、固定时段与满额影响因子，仍被钳位在 minor 上限 44（不越过 50 重要线）
    const maxedMinor = calculateDynamicImportance({
      tier: 'minor',
      estimatedMinutes: 300,
      impactSignals: ['blocks_others', 'irreversible_cost', 'long_term_compound', 'daily_keystone'],
      isFixed: true,
    });
    assert.equal(maxedMinor.importance, 44);
    assert.ok(maxedMinor.importance < PRIORITY_THRESHOLD);
  });

  it('根据耗时、影响因子与固定约束细化同档位分值差异', () => {
    const lightVital = calculateDynamicImportance({
      tier: 'vital',
      estimatedMinutes: 15,
    });
    const heavyVital = calculateDynamicImportance({
      tier: 'vital',
      estimatedMinutes: 240,
      impactSignals: ['blocks_others', 'irreversible_cost'],
      isFixed: true,
    });

    assert.equal(lightVital.importance, 79); // 82 - 3
    assert.equal(heavyVital.importance, 100); // 82 + 8 + 13 + 4 = 107 -> clamped 100
    assert.ok(heavyVital.importance > lightVital.importance);
  });

  it('支持显式手动微调覆盖并保留算法测算参考值', () => {
    const overridden = calculateDynamicImportance({
      tier: 'support',
      estimatedMinutes: 60,
      manualOverride: 91,
    });
    assert.equal(overridden.importance, 91);
    assert.equal(overridden.autoImportance, 60);
    assert.equal(overridden.isManualOverride, true);
  });
});

describe('calculateDynamicUrgency (多模式 + 日程感知 + 重要度耦合)', () => {
  const now = new Date(2026, 10, 19, 10, 0, 0); // 2026-11-19 10:00

  it('deadline 模式同时考量日期/耗时与重要度前置缓冲，且远期高重要任务不被误推入 Q1', () => {
    // 2天后到期、耗时 2 小时：高重要度任务紧迫度应显著高于低重要度任务
    const due2Days = '2026-11-21T18:00:00';
    const highImp = calculateDynamicUrgency({
      timeMode: 'deadline',
      dueDate: due2Days,
      estimatedMinutes: 120,
      importance: 95,
      currentTime: now,
    });
    const lowImp = calculateDynamicUrgency({
      timeMode: 'deadline',
      dueDate: due2Days,
      estimatedMinutes: 120,
      importance: 20,
      currentTime: now,
    });
    assert.ok(highImp.urgency > lowImp.urgency);

    // 20天后到期的重大任务，仍应处于不紧急区 (< 50 -> Q2)
    const farVital = calculateDynamicUrgency({
      timeMode: 'deadline',
      dueDate: '2026-12-09',
      estimatedMinutes: 120,
      importance: 95,
      currentTime: now,
    });
    assert.ok(farVital.urgency < PRIORITY_THRESHOLD);
    assert.equal(calculateQuadrant100(95, farVital.urgency), 'q2');
  });

  it('daily_fixed 未排定区间时，随当天日程忙碌度自适应调整紧迫度', () => {
    const lightDay = calculateDynamicUrgency({
      timeMode: 'daily_fixed',
      dueDate: null,
      estimatedMinutes: 60,
      importance: 70,
      dailyBusyMinutesAhead: 60, // 10:00~22:00 有 12h，仅占 1h，余 11h
      currentTime: now,
    });
    const packedDay = calculateDynamicUrgency({
      timeMode: 'daily_fixed',
      dueDate: null,
      estimatedMinutes: 60,
      importance: 70,
      dailyBusyMinutesAhead: 630, // 占 10.5h，仅余 1.5h
      currentTime: now,
    });

    assert.ok(packedDay.urgency > lightDay.urgency);
    assert.ok(packedDay.urgency >= 80);
    assert.ok(lightDay.urgency >= 48 && lightDay.urgency < 65);
  });

  it('daily_fixed 已排定区间时，根据窗口距离与今日打卡状态变化', () => {
    // 10:20~11:00 即将开始 (20分钟后)
    const approaching = calculateDynamicUrgency({
      timeMode: 'daily_fixed',
      dueDate: null,
      estimatedMinutes: 40,
      importance: 75,
      scheduledStart: '2026-11-19T10:20:00',
      scheduledEnd: '2026-11-19T11:00:00',
      isCompletedToday: false,
      currentTime: now,
    });
    assert.ok(approaching.urgency >= 85);

    // 正在区间内 (09:30~10:30)
    const inSlot = calculateDynamicUrgency({
      timeMode: 'daily_fixed',
      dueDate: null,
      estimatedMinutes: 60,
      importance: 75,
      scheduledStart: '2026-11-19T09:30:00',
      scheduledEnd: '2026-11-19T10:30:00',
      isCompletedToday: false,
      currentTime: now,
    });
    assert.ok(inSlot.urgency >= 92);

    // 今日已打卡完成
    const completedToday = calculateDynamicUrgency({
      timeMode: 'daily_fixed',
      dueDate: null,
      estimatedMinutes: 60,
      importance: 75,
      scheduledStart: '2026-11-19T09:30:00',
      scheduledEnd: '2026-11-19T10:30:00',
      isCompletedToday: true,
      currentTime: now,
    });
    assert.equal(completedToday.urgency, 15);
  });

  it('flexible 模式支持三档期望节奏并受重要度微调', () => {
    const urgentFlex = calculateDynamicUrgency({
      timeMode: 'flexible',
      dueDate: null,
      urgencyPace: 'urgent',
      importance: 80,
      currentTime: now,
    });
    const laterFlex = calculateDynamicUrgency({
      timeMode: 'flexible',
      dueDate: null,
      urgencyPace: 'later',
      importance: 25,
      currentTime: now,
    });
    assert.ok(urgentFlex.urgency >= 80);
    assert.ok(laterFlex.urgency <= 30);

    // 近期负荷高 vs 清闲时：soon 与 later 紧迫度应随近况下调/上浮
    const soonBusy = calculateDynamicUrgency({
      timeMode: 'flexible',
      dueDate: null,
      urgencyPace: 'soon',
      importance: 50,
      nearTermLoadRatio: 0.9,
      currentTime: now,
    });
    const soonIdle = calculateDynamicUrgency({
      timeMode: 'flexible',
      dueDate: null,
      urgencyPace: 'soon',
      importance: 50,
      nearTermLoadRatio: 0.1,
      currentTime: now,
    });
    assert.ok(soonBusy.urgency < soonIdle.urgency);
    assert.match(soonBusy.statusText, /近期较忙/);

    const laterBusy = calculateDynamicUrgency({
      timeMode: 'flexible',
      dueDate: null,
      urgencyPace: 'later',
      importance: 30,
      nearTermLoadRatio: 0.85,
      currentTime: now,
    });
    assert.ok(laterBusy.urgency < laterFlex.urgency);
    assert.match(laterBusy.statusText, /备忘池/);

    // 滞留老化 (Aging) 温和提升紧迫度但不直接变紧急危机
    const agedLater = calculateDynamicUrgency({
      timeMode: 'flexible',
      dueDate: null,
      urgencyPace: 'later',
      importance: 30,
      nearTermLoadRatio: 0.2,
      createdAt: new Date(now.getTime() - 20 * 86_400_000),
      currentTime: now,
    });
    assert.ok(agedLater.urgency > laterFlex.urgency);
    assert.ok(agedLater.urgency < PRIORITY_THRESHOLD);
  });
});

describe('normalizeScoreTo100 与历史量纲兼容性', () => {
  it('正确转换 5 分制 / 10 分制，且对 100 分制数值绝不重复放大', () => {
    assert.equal(normalizeScoreTo100(3, 5), 60);
    assert.equal(normalizeScoreTo100(2.5, 10), 25);
    assert.equal(normalizeScoreTo100(25, 100), 25);
    assert.equal(normalizeScoreTo100(5, 100), 5);
    assert.equal(inferTierFromScore(82), 'vital');
    assert.equal(inferTierFromScore(58), 'support');
    assert.equal(inferTierFromScore(25), 'minor');
  });
});
