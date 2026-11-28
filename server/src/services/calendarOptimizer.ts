import type { Task } from '../models/types.js';
import { normalizeScoreTo100 } from '../utils/priorityAlgorithm.js';
import {
  addDaysToDateKey,
  getAccountLocalDateKey,
  parseAccountDateOrIso,
} from '../utils/timezone.js';

const MINUTE = 60_000;
const BLOCK = 120;
const WIDTH = 32;

export interface Window {
  start: number;
  end: number;
  day: number;
}

export type OptimizerRejectReason =
  | 'hard_deadline_violation'
  | 'insufficient_capacity'
  | 'outside_work_window'
  | 'search_budget_exhausted';

export function deadlineMs(value?: string | null, timezone?: string): number {
  if (!value) return Infinity;
  if (timezone) {
    const parsed = parseAccountDateOrIso(value, timezone);
    return parsed && Number.isFinite(parsed.getTime()) ? parsed.getTime() : Infinity;
  }
  const parsed = new Date(/^\d{4}-\d\d-\d\d$/.test(value) ? value + 'T23:59:59.999' : value).getTime();
  return Number.isFinite(parsed) ? parsed : Infinity;
}

export function deadlinePressure(load: number, hard: boolean): number {
  if (hard && load > 0.95) {
    const z = (load - 0.95) / 0.05;
    return -Math.log(0.05) + z + z * z / 2;
  }
  if (!hard && load > 0.6) return -Math.log(0.4) + (load - 0.6) / 0.4;
  return -Math.log1p(-load);
}

export function recurringDebt(task: Pick<Task, 'created_at' | 'completed_dates'>, today: Date, timezone?: string): number {
  let done: unknown;
  try { done = JSON.parse(task.completed_dates || '[]'); } catch {}
  const dates = new Set(Array.isArray(done) ? done : []);
  const created = new Date(task.created_at);
  if (!Number.isFinite(created.getTime())) return 0;

  if (timezone) {
    const createdKey = getAccountLocalDateKey(created, timezone);
    let cursorKey = getAccountLocalDateKey(today, timezone);
    let debt = 0;
    for (let age = 0; age < 40; age++) {
      cursorKey = addDaysToDateKey(cursorKey, -1);
      if (cursorKey < createdKey) break;
      if (!dates.has(cursorKey)) debt += 0.8 ** age;
    }
    return debt;
  }

  created.setHours(0, 0, 0, 0);
  const date = new Date(today);
  date.setHours(0, 0, 0, 0);
  let debt = 0;
  for (let age = 0; age < 40; age++) {
    date.setDate(date.getDate() - 1);
    if (date < created) break;
    const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    if (!dates.has(key)) debt += 0.8 ** age;
  }
  return debt;
}

function getLocalHour(ms: number, timezone?: string): number {
  const d = new Date(ms);
  if (!timezone) return d.getHours();
  try {
    const h = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(d)
    );
    return Number.isFinite(h) ? h : d.getHours();
  } catch {
    return d.getHours();
  }
}

export interface Placement {
  index: number;
  start: number;
  minutes: number;
  rest: number;
}

interface State {
  cursor: number;
  window: number;
  used: number;
  remaining: number[];
  debt: number[];
  last: number;
  blocks: Placement[];
  cost: number;
  score: number;
  tie: number;
}

export interface SelectCalendarBlocksResult {
  placements: Placement[];
  rejectedReasons: Map<number, OptimizerRejectReason>;
}

export function selectCalendarBlocksDetailed(
  tasks: Task[],
  windows: Window[],
  future: Window[],
  options: {
    cap: number;
    rest: number;
    maxChunk: number;
    minChunk: number;
    allowSplit: boolean;
    advanceDeadlineDays?: number;
    debt?: Map<number, number>;
    timezone?: string;
  }
): SelectCalendarBlocksResult {
  const rejectedReasons = new Map<number, OptimizerRejectReason>();
  if (!tasks.length) return { placements: [], rejectedReasons };
  if (!windows.length) {
    tasks.forEach(t => rejectedReasons.set(t.id, 'outside_work_window'));
    return { placements: [], rejectedReasons };
  }

  const allWindows = [...windows, ...future];
  const day = windows[0].day;
  const { cap, rest, maxChunk, minChunk, allowSplit, timezone } = options;
  const advanceDays = Math.max(0, Number(options.advanceDeadlineDays ?? 0));

  const items = tasks.map(task => {
    const duration = Math.max(1, Math.ceil(task.duration_minutes || 45));
    let plan: number[] = [];
    try {
      const value = JSON.parse(task.session_plan || 'null');
      if (Array.isArray(value) && value.every(n => Number.isInteger(n) && n > 0)) plan = value;
    } catch {}
    const importance = normalizeScoreTo100(task.importance, task.score_scale) / 100;
    const due = deadlineMs(task.deadline, timezone);
    const softTargetDue =
      Number.isFinite(due) && advanceDays > 0 && task.time_mode !== 'specific_date'
        ? Math.max(windows[0].start, due - advanceDays * 86400_000)
        : due;
    const baseExtra = task.urgency_pace === 'urgent' ? 1 : task.urgency_pace === 'later' ? 0 : task.urgency_pace === 'soon' ? 0.5 : 0;
    return {
      duration,
      plan,
      planTotal: plan.reduce((a, b) => a + b, 0),
      importance,
      due,
      softTargetDue,
      hard: task.deadline_kind === 'hard' && Number.isFinite(due),
      extra: task.time_mode === 'specific_date' ? Math.max(baseExtra, 0.85) : baseExtra,
      isLaterFlexible: task.time_mode === 'flexible' && task.urgency_pace === 'later',
      missed: task.time_mode === 'daily_fixed' ? recurringDebt(task, new Date(day), timezone) : 0,
    };
  });

  const phase = (index: number, left: number) => {
    const { plan, planTotal } = items[index];
    if (!allowSplit) return left;
    let done = Math.max(0, planTotal - left);
    for (const minutes of plan) {
      if (done < minutes) return Math.min(left, minutes - done);
      done -= minutes;
    }
    return Math.ceil(left / Math.ceil(left / maxChunk));
  };

  const capacity = (cursor: number, due: number, used: number) => {
    const byDay = new Map<number, number>();
    for (const w of allWindows) {
      const minutes = Math.floor((Math.min(w.end, due) - Math.max(w.start, cursor)) / MINUTE);
      if (minutes > 0) byDay.set(w.day, (byDay.get(w.day) || 0) + minutes);
    }
    let total = 0;
    for (const [key, value] of byDay) total += Math.min(value, Math.max(0, cap - (key === day ? used : 0)));
    return total;
  };

  const pressure = (index: number, remaining: number, cursor: number, used: number) => {
    const { due, softTargetDue, hard } = items[index];
    if (!remaining || !Number.isFinite(due)) return 0;
    const effectiveDue = hard ? due : softTargetDue;
    const available = capacity(cursor, effectiveDue, used);
    const load = remaining / Math.max(available, 1);
    const raw = deadlinePressure(load, hard) + (!hard ? Math.max(0, cursor - due) / (7 * 86400_000) : 0);
    return raw / (1 + raw);
  };

  const hard = items.map((item, i) => item.hard ? i : -1).filter(i => i >= 0).sort((a, b) => items[a].due - items[b].due);

  const checkWitness = (state: State, required: number[]): { ok: boolean; budgetExhausted: boolean } => {
    if (required.every(i => !state.remaining[i])) return { ok: true, budgetExhausted: false };
    let demand = 0;
    for (const i of required) {
      demand += state.remaining[i];
      if (demand > capacity(state.cursor, items[i].due, state.used)) {
        return { ok: false, budgetExhausted: false };
      }
    }
    const left = state.remaining.slice();
    let nodes = 0;
    let budgetExhausted = false;
    const visit = (window: number, cursor: number, used: number): boolean => {
      if (required.every(i => !left[i])) return true;
      if (++nodes > 512) {
        budgetExhausted = true;
        return false;
      }
      if (window >= allWindows.length) return false;
      const w = allWindows[window];
      if (cursor > w.end) {
        const nextW = allWindows[window + 1];
        return !!nextW && visit(window + 1, nextW.start, nextW.day === w.day ? used : 0);
      }
      // Prune early when remaining required work cannot possibly fit before earliest hard due
      let cumLeft = 0;
      for (const i of required) {
        if (!left[i]) continue;
        cumLeft += left[i];
        if (cursor + cumLeft * MINUTE > items[i].due && cumLeft > capacity(cursor, items[i].due, used)) {
          return false;
        }
      }
      for (const i of required) {
        if (!left[i]) continue;
        const minutes = phase(i, left[i]);
        const end = cursor + minutes * MINUTE;
        if (end > Math.min(w.end, items[i].due) || used + minutes > cap) continue;
        left[i] -= minutes;
        const next = end + rest * MINUTE <= w.end ? end + rest * MINUTE : end;
        if (visit(window, next, used + minutes)) return true;
        left[i] += minutes;
      }
      const next = allWindows[window + 1];
      return !!next && visit(window + 1, next.start, next.day === w.day ? used : 0);
    };
    return { ok: visit(state.window, state.cursor, state.used), budgetExhausted };
  };

  const terminal = windows[windows.length - 1].end;
  const initial: State = {
    cursor: windows[0].start,
    window: 0,
    used: 0,
    remaining: items.map(item => item.duration),
    debt: tasks.map(task => options.debt?.get(task.id) || 0),
    last: -1,
    blocks: [],
    cost: 0,
    score: 0,
    tie: 0,
  };

  const initialWitness = checkWitness(initial, hard);
  const initialBudgetExhaustedByIdx = new Map<number, boolean>();
  const required = initialWitness.ok
    ? hard
    : hard.reduce<number[]>((accepted, i) => {
        const next = [...accepted, i];
        const wRes = checkWitness(initial, next);
        if (!wRes.ok) {
          initialBudgetExhaustedByIdx.set(i, wRes.budgetExhausted);
          return accepted;
        }
        return next;
      }, []);
  const rejected = new Set(hard.filter(i => !required.includes(i)));
  for (const idx of rejected) {
    rejectedReasons.set(
      tasks[idx].id,
      initialBudgetExhaustedByIdx.get(idx) ? 'search_budget_exhausted' : 'hard_deadline_violation'
    );
  }

  const fairness = (debt: number[], remaining: number[]) =>
    debt.reduce((sum, d, i) => sum + (remaining[i] ? (d / BLOCK) ** 2 : 0), 0);

  const rank = (s: State) => {
    const progress = items.reduce((sum, item, i) => {
      const before = pressure(i, item.duration, terminal, s.used);
      const after = pressure(i, s.remaining[i], terminal, s.used);
      // Lower fill incentive for `later` flexible memos so they yield cleanly to real work
      const baseFill = item.isLaterFlexible ? 0.25 : 0.6;
      const value = baseFill + 2 * item.importance + 0.25 * item.extra + 0.15 * item.missed;
      return sum + ((s.remaining[i] - item.duration) * value +
        0.5 * (s.remaining[i] * after - item.duration * before)) / BLOCK;
    }, 0);
    return progress + 2 * fairness(s.debt, s.remaining) + s.cost;
  };

  const topsis = (s: State) => {
    const total = items.reduce((sum, item) => sum + item.duration, 0);
    const costs = [
      items.reduce((sum, item, i) => sum + s.remaining[i] * item.importance, 0) / total,
      items.reduce((sum, _, i) => sum + s.remaining[i] * pressure(i, s.remaining[i], terminal, 0), 0) / total,
      Math.min(1, fairness(s.debt, s.remaining) / items.length),
      Math.max(0, Math.min(1, s.cost / (1 + cap / BLOCK))),
    ];
    const good = Math.hypot(...costs);
    const bad = Math.hypot(...costs.map(x => 1 - x));
    return bad / (good + bad);
  };
  const compare = (a: State, b: State) => Math.round(a.score * 1000) - Math.round(b.score * 1000) || b.tie - a.tie;

  let best: State | undefined;
  let beam = [initial];
  while (beam.length) {
    const next: State[] = [];
    for (const s of beam) {
      if (s.window >= windows.length) {
        if (!best || compare(s, best) < 0) best = s;
        continue;
      }
      const w = windows[s.window];
      const push = (candidate: State) => {
        if (!checkWitness(candidate, required).ok) return;
        candidate.score = rank(candidate);
        candidate.tie = topsis(candidate);
        next.push(candidate);
      };
      push({
        ...s,
        window: s.window + 1,
        cursor: allWindows[s.window + 1]?.start ?? terminal,
        used: allWindows[s.window + 1]?.day === day ? s.used : 0,
      });
      const eligible = items.map((item, i) => {
        if (rejected.has(i) || !s.remaining[i] || (item.hard && s.cursor >= item.due)) return 0;
        const urgency = Math.min(1, 0.25 * item.extra + 0.75 * pressure(i, s.remaining[i], s.cursor, s.used) + 0.15 * item.missed);
        return (0.2 + item.importance ** 2) * (1 + 0.5 * urgency);
      });
      for (const [i, weight] of eligible.entries()) {
        if (!weight) continue;
        const item = items[i];
        const desired = phase(i, s.remaining[i]);
        const fits = Math.floor((Math.min(w.end, item.hard ? item.due : Infinity) - s.cursor) / MINUTE);
        const minutes = Math.min(desired, cap - s.used, fits);
        if (minutes <= 0 || (minutes < desired && (!allowSplit || item.hard || item.plan.length || minutes < minChunk))) continue;
        const end = s.cursor + minutes * MINUTE;
        const pause = end + rest * MINUTE <= w.end ? rest : 0;
        const remaining = s.remaining.slice();
        remaining[i] -= minutes;
        const sum = eligible.reduce((a, b) => a + b, 0);
        const debt = s.debt.map((d, j) => d + minutes * eligible[j] / sum - (i === j ? minutes : 0));
        // Mild fragment penalty scales gently so filling valid >= minChunk gaps still strictly beats leaving them empty
        const cut = minutes < desired ? (0.08 + 0.16 * (1 - minutes / desired) ** 2) * (minutes / BLOCK) : 0;
        const overdueWaiting = items.reduce((sumW, other, j) => {
          if (j === i || !s.remaining[j] || other.hard || !Number.isFinite(other.due)) return sumW;
          const overdueDays = Math.max(0, (s.cursor - other.due) / 86400_000);
          return sumW + (overdueDays > 0 ? 0.6 * other.importance * (1 + Math.min(overdueDays / 7, 1)) : 0);
        }, 0) * minutes / BLOCK;
        const switching = s.last >= 0 && s.last !== i ? 0.05 : 0;
        const night = getLocalHour(s.cursor, timezone) < 6 ? 0.15 : 0;
        // Only grant onTime bonus when this block finishes the soft-deadline task before its due timestamp
        const onTime = !item.hard && remaining[i] === 0 && end <= item.due && Number.isFinite(item.due) ? 0.2 : 0;
        const delay = Math.max(0, s.cursor - initial.cursor) / Math.max(MINUTE, terminal - initial.cursor);
        push({
          ...s,
          cursor: end + pause * MINUTE,
          used: s.used + minutes,
          remaining,
          debt,
          last: i,
          blocks: [...s.blocks, { index: i, start: s.cursor, minutes, rest: pause }],
          // Single-count fairness solely in rank() rather than double-counting in step cost
          cost: s.cost + cut + switching + overdueWaiting + (night - onTime + 0.08 * delay * item.importance) * minutes / BLOCK,
        });
      }
    }
    next.sort(compare);
    beam = next.slice(0, WIDTH);
  }
  if (best && options.debt) tasks.forEach((task, i) => options.debt!.set(task.id, best!.debt[i]));

  // Mark remaining unplaced tasks
  if (best) {
    tasks.forEach((task, i) => {
      if (best!.remaining[i] > 0 && !rejectedReasons.has(task.id)) {
        rejectedReasons.set(
          task.id,
          items[i].hard ? 'hard_deadline_violation' : 'insufficient_capacity'
        );
      }
    });
  }

  return { placements: best?.blocks || [], rejectedReasons };
}

export function selectCalendarBlocks(
  tasks: Task[],
  windows: Window[],
  future: Window[],
  options: {
    cap: number;
    rest: number;
    maxChunk: number;
    minChunk: number;
    allowSplit: boolean;
    advanceDeadlineDays?: number;
    debt?: Map<number, number>;
  }
): Placement[] {
  return selectCalendarBlocksDetailed(tasks, windows, future, options).placements;
}
