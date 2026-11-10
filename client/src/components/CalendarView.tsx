import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Calendar as CalendarIcon,
  Trash2,
  Copy,
  Check,
  Clock,
  AlertTriangle,
} from 'lucide-react';

// Grid Constants matching calcury/eisenhower-matrix
const CALENDAR_START_HOUR = 7;
const CALENDAR_END_HOUR = 24;
const REST_END_HOUR = 7;
const GRID_HOURS = CALENDAR_END_HOUR - CALENDAR_START_HOUR + REST_END_HOUR; // 24 hours
const GRID_MINUTES = GRID_HOURS * 60;
const REST_START_MINUTES = (CALENDAR_END_HOUR - CALENDAR_START_HOUR) * 60;
const HOUR_HEIGHT = 42; // standard row height

const DAY_HOURS = Array.from(
  { length: CALENDAR_END_HOUR - CALENDAR_START_HOUR },
  (_, index) => CALENDAR_START_HOUR + index
);
const REST_HOURS = Array.from({ length: REST_END_HOUR }, (_, index) => index + 1);

const CALENDAR_PALETTE = [
  '#4EA8FF',
  '#B388FF',
  '#3DDC97',
  '#FFC857',
  '#FF7A90',
  '#9AA4B2',
  '#FF9F43',
];

interface CalendarSubscription {
  id: number;
  name: string;
  url: string;
  event_count: number;
  sync_status: 'ok' | 'error';
  last_sync_at: string | null;
}

interface CalendarEventItem {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  backgroundColor?: string;
  borderColor?: string;
  subscriptionId?: number;
  subscriptionName?: string;
  extendedProps?: {
    type: 'external' | 'task';
    taskId?: number;
    urgency?: number;
    importance?: number;
    duration?: number;
    status?: string;
    deadline?: string;
    notes?: string;
    subscriptionId?: number;
    subscriptionName?: string;
  };
}

interface TaskItem {
  id: number;
  title: string;
  duration_minutes: number;
  urgency: number;
  importance: number;
  deadline: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  status: string;
  notes: string | null;
}

type TimedSegment =
  | {
      kind: 'event';
      id: string;
      title: string;
      start: string;
      end: string;
      allDay: boolean;
      color: string;
      event: CalendarEventItem;
    }
  | {
      kind: 'task';
      id: string;
      title: string;
      start: string;
      end: string;
      allDay: boolean;
      color: string;
      qClass: string;
      qName: string;
      task: TaskItem;
    };

interface PositionedItem<T> {
  item: T;
  column: number;
  columns: number;
  conflict: boolean;
}

function startOfWeek(date: Date): Date {
  const next = new Date(date);
  const day = next.getDay();
  // Monday as first day of week (ISO-8601)
  const diff = next.getDate() - day + (day === 0 ? -6 : 1);
  next.setDate(diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateKeyFromIso(iso: string): string {
  return localDateKey(new Date(iso));
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function weekLabel(start: Date): string {
  const end = addDays(start, 6);
  const startStr = `${start.getMonth() + 1}月${start.getDate()}日`;
  const endStr = `${end.getMonth() + 1}月${end.getDate()}日, ${end.getFullYear()}`;
  return `${startStr} – ${endStr}`;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return (
    new Date(aStart).getTime() < new Date(bEnd).getTime() &&
    new Date(aEnd).getTime() > new Date(bStart).getTime()
  );
}

function segmentRange(
  start: string,
  end: string,
  dayStart: string,
  dayEnd: string
): { start: string; end: string } | null {
  if (!overlaps(start, end, dayStart, dayEnd)) return null;
  return {
    start: new Date(Math.max(new Date(start).getTime(), new Date(dayStart).getTime())).toISOString(),
    end: new Date(Math.min(new Date(end).getTime(), new Date(dayEnd).getTime())).toISOString(),
  };
}

// Greedy layout assigning columns for overlapping day items (matching eisenhower-matrix)
function layoutDayItems<T extends { start: string; end: string }>(items: T[]): PositionedItem<T>[] {
  const sorted = [...items].sort(
    (a, b) =>
      new Date(a.start).getTime() - new Date(b.start).getTime() ||
      new Date(a.end).getTime() - new Date(b.end).getTime()
  );

  const result: PositionedItem<T>[] = [];
  let cluster: T[] = [];
  let clusterEnd = 0;

  const flush = () => {
    if (cluster.length === 0) return;
    const columnEnds: number[] = [];
    const placed: Array<{ item: T; column: number }> = [];

    for (const item of cluster) {
      const start = new Date(item.start).getTime();
      const end = new Date(item.end).getTime();
      let column = columnEnds.findIndex((value) => value <= start);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(end);
      } else {
        columnEnds[column] = end;
      }
      placed.push({ item, column });
    }

    const columns = Math.max(1, columnEnds.length);
    const conflict = cluster.length > 1;
    for (const entry of placed) {
      result.push({ ...entry, columns, conflict });
    }
    cluster = [];
    clusterEnd = 0;
  };

  for (const item of sorted) {
    const start = new Date(item.start).getTime();
    const end = new Date(item.end).getTime();
    if (cluster.length > 0 && start >= clusterEnd) {
      flush();
    }
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();

  return result;
}

function getTaskQuadrant(importance: number, urgency: number) {
  const imp = importance >= 3;
  const urg = urgency >= 3;
  if (imp && urg) return { key: 'q1', name: 'Q1 重要且紧急', color: '#EF4444' };
  if (imp && !urg) return { key: 'q2', name: 'Q2 重要不紧急', color: '#3B82F6' };
  if (!imp && urg) return { key: 'q3', name: 'Q3 紧急不重要', color: '#F59E0B' };
  return { key: 'q4', name: 'Q4 不重要不紧急', color: '#9CA3AF' };
}

export const CalendarView: React.FC = () => {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [subscriptions, setSubscriptions] = useState<CalendarSubscription[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialogs & Modals
  const [showCalendarsModal, setShowCalendarsModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<TimedSegment | null>(null);
  const [selectedDueTask, setSelectedDueTask] = useState<TaskItem | null>(null);

  // Add subscription form
  const [newSubName, setNewSubName] = useState('');
  const [newSubUrl, setNewSubUrl] = useState('');
  const [submittingSub, setSubmittingSub] = useState(false);
  const [copiedIcal, setCopiedIcal] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const token = user?.token_secret || user?.calendar_token;
  const icalExportUrl = token
    ? `${window.location.origin}/api/calendar/subscribe/${token}.ics`
    : '';

  const fetchData = async () => {
    setLoading(true);
    try {
      const [eventsRes, tasksRes] = await Promise.all([
        api.get('/calendar/events'),
        api.get('/tasks'),
      ]);
      setEvents(eventsRes.data.events || []);
      setSubscriptions(eventsRes.data.subscriptions || []);
      setTasks(tasksRes.data.tasks || []);
    } catch (err) {
      console.error('Failed to load calendar data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Map subscriptions to colors
  const subColorMap = useMemo(() => {
    const map = new Map<number, string>();
    subscriptions.forEach((s, idx) => {
      map.set(s.id, CALENDAR_PALETTE[idx % CALENDAR_PALETTE.length]);
    });
    return map;
  }, [subscriptions]);

  // Today key
  const todayKey = localDateKey(new Date());
  const weekStartKey = localDateKey(weekStart);

  // 7 Days Data
  const dayData = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(weekStart, index);
      const key = localDateKey(date);

      // Window: 07:00 of this date to 07:00 of next date
      const windowStart = new Date(date);
      windowStart.setHours(CALENDAR_START_HOUR, 0, 0, 0);

      const windowEnd = new Date(addDays(date, 1));
      windowEnd.setHours(CALENDAR_START_HOUR, 0, 0, 0);

      const windowStartIso = windowStart.toISOString();
      const windowEndIso = windowEnd.toISOString();

      const allDayItems: TimedSegment[] = [];
      const timedItems: TimedSegment[] = [];

      // 1. External Events
      events
        .filter((ev) => ev.extendedProps?.type === 'external')
        .forEach((ev) => {
          const color =
            (ev.subscriptionId && subColorMap.get(ev.subscriptionId)) || '#0284C7';
          if (ev.allDay) {
            const startsOn = dateKeyFromIso(ev.start);
            const endsOn = dateKeyFromIso(ev.end);
            if (key >= startsOn && key <= endsOn) {
              allDayItems.push({
                kind: 'event',
                id: ev.id,
                title: ev.title,
                start: ev.start,
                end: ev.end,
                allDay: true,
                color,
                event: ev,
              });
            }
            return;
          }

          const range = segmentRange(ev.start, ev.end, windowStartIso, windowEndIso);
          if (range) {
            timedItems.push({
              kind: 'event',
              id: ev.id,
              title: ev.title,
              start: range.start,
              end: range.end,
              allDay: false,
              color,
              event: ev,
            });
          }
        });

      // 2. Scheduled Tasks
      tasks
        .filter((t) => t.scheduled_start && t.scheduled_end && t.status !== 'completed')
        .forEach((t) => {
          const range = segmentRange(
            t.scheduled_start!,
            t.scheduled_end!,
            windowStartIso,
            windowEndIso
          );
          if (range) {
            const quad = getTaskQuadrant(t.importance, t.urgency);
            timedItems.push({
              kind: 'task',
              id: `task-${t.id}`,
              title: t.title,
              start: range.start,
              end: range.end,
              allDay: false,
              color: quad.color,
              qClass: quad.key,
              qName: quad.name,
              task: t,
            });
          }
        });

      // 3. Due tasks for this day
      const dueTasks = tasks
        .filter(
          (t) =>
            t.deadline &&
            dateKeyFromIso(t.deadline) === key &&
            t.status !== 'completed'
        )
        .sort((a, b) => b.urgency - a.urgency || b.importance - a.importance);

      return {
        date,
        key,
        windowStartMs: windowStart.getTime(),
        allDay: allDayItems,
        timed: layoutDayItems(timedItems),
        due: dueTasks,
      };
    });
  }, [weekStart, events, tasks, subColorMap]);

  // Overdue tasks (deadline before this weekStart)
  const overdueTasks = useMemo(() => {
    return tasks
      .filter(
        (t) =>
          t.deadline &&
          dateKeyFromIso(t.deadline) < weekStartKey &&
          t.status !== 'completed'
      )
      .sort((a, b) => b.urgency - a.urgency || b.importance - a.importance);
  }, [tasks, weekStartKey]);

  // Due groups this week with at least 1 task
  const dueGroups = useMemo(() => {
    return dayData.filter((d) => d.due.length > 0);
  }, [dayData]);

  // Add external subscription handler
  const handleAddSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubName.trim() || !newSubUrl.trim()) return;
    setSubmittingSub(true);
    try {
      await api.post('/calendar/subscriptions', {
        name: newSubName.trim(),
        url: newSubUrl.trim(),
      });
      setNewSubName('');
      setNewSubUrl('');
      fetchData();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      alert(error.response?.data?.error || '添加订阅失败');
    } finally {
      setSubmittingSub(false);
    }
  };

  const handleDeleteSubscription = async (id: number) => {
    if (!confirm('确定删除该外部日历吗？关联事件将一并移除。')) return;
    try {
      await api.delete(`/calendar/subscriptions/${id}`);
      fetchData();
    } catch {
      alert('删除失败');
    }
  };

  const handleSyncSubscription = async (id: number) => {
    try {
      await api.post(`/calendar/subscriptions/${id}/sync`);
      fetchData();
    } catch {
      alert('同步失败');
    }
  };

  const [replanLoading, setReplanLoading] = useState(false);

  const handleSyncAndReplanAll = async () => {
    setReplanLoading(true);
    try {
      await api.post('/calendar/sync-and-replan');
      fetchData();
    } catch (e: any) {
      alert(`排程失败: ${e.response?.data?.error || e.message}`);
    } finally {
      setReplanLoading(false);
    }
  };

  const copyIcal = () => {
    navigator.clipboard.writeText(icalExportUrl);
    setCopiedIcal(true);
    setTimeout(() => setCopiedIcal(false), 2000);
  };

  const gridHeight = (GRID_MINUTES / 60) * HOUR_HEIGHT;
  const restTop = (REST_START_MINUTES / 60) * HOUR_HEIGHT;
  const restHeight = ((GRID_MINUTES - REST_START_MINUTES) / 60) * HOUR_HEIGHT;

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col space-y-3 overflow-hidden">
      {/* Top Toolbar matching calcury/eisenhower-matrix */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 px-1">
        {/* Navigation Group */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-white dark:bg-[#1e1f20] border border-gray-200/80 dark:border-neutral-700/80 rounded-full shadow-2xs overflow-hidden">
            <button
              onClick={() => setWeekStart((prev) => addDays(prev, -7))}
              aria-label="Previous week"
              className="p-1.5 px-2 hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-600 dark:text-neutral-300 transition cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setWeekStart(startOfWeek(new Date()))}
              className="px-3 py-1 text-xs font-semibold text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-800 border-x border-gray-200/80 dark:border-neutral-700/80 transition cursor-pointer"
            >
              今天
            </button>
            <button
              onClick={() => setWeekStart((prev) => addDays(prev, 7))}
              aria-label="Next week"
              className="p-1.5 px-2 hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-600 dark:text-neutral-300 transition cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <span className="text-xs sm:text-sm font-bold text-gray-900 dark:text-gray-100 font-mono">
            {weekLabel(weekStart)}
          </span>
        </div>

        {/* Actions Group */}
        <div className="flex items-center gap-2">
          {loading && (
            <span className="text-xs text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>同步中...</span>
            </span>
          )}

          <button
            onClick={handleSyncAndReplanAll}
            disabled={replanLoading}
            title="拉取最新外部日程并按任务紧急度自适应重新排程"
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200/90 dark:border-blue-800 rounded-full text-xs font-semibold shadow-2xs transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${replanLoading ? 'animate-spin' : ''}`} />
            <span>{replanLoading ? '排程计算中...' : '同步并自适应重排'}</span>
          </button>

          <button
            onClick={() => setShowCalendarsModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-white dark:bg-[#1e1f20] hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-700 dark:text-neutral-200 border border-gray-200/80 dark:border-neutral-700/80 rounded-full text-xs font-semibold shadow-2xs transition cursor-pointer"
          >
            <CalendarIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>日历源管理</span>
            {subscriptions.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-mono">
                {subscriptions.length}
              </span>
            )}
          </button>

          <button
            onClick={() => fetchData()}
            className="p-2 bg-white dark:bg-[#1e1f20] hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-600 dark:text-neutral-300 border border-gray-200/80 dark:border-neutral-700/80 rounded-full shadow-2xs transition cursor-pointer"
            title="刷新日程"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Body: 左右排版: Left Due Column + Right Cal Grid */}
      <div className="flex-1 flex flex-col lg:flex-row gap-3.5 min-h-0 overflow-hidden">
        {/* Left Column: Due Column (截止待办) matching calcury/eisenhower-matrix */}
        <aside className="w-full lg:w-56 xl:w-64 shrink-0 flex flex-col bg-white dark:bg-[#1e1f20] border border-gray-200/80 dark:border-neutral-800/80 rounded-2xl shadow-xs overflow-hidden transition-colors">
          <div className="px-3.5 py-2.5 border-b border-gray-100 dark:border-neutral-800 flex items-baseline justify-between bg-gray-50/50 dark:bg-[#252627]/50">
            <h3 className="text-xs font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
              <span>截止待办</span>
              <span className="text-[10px] text-gray-400 font-normal">Due</span>
            </h3>
            <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-neutral-500 font-semibold font-mono">
              本周安排
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 space-y-3 scrollbar-thin">
            {/* Overdue Section */}
            {overdueTasks.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 px-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  <span>逾期未完成 ({overdueTasks.length})</span>
                </div>
                {overdueTasks.map((t) => {
                  const quad = getTaskQuadrant(t.importance, t.urgency);
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelectedDueTask(t)}
                      className="w-full text-left p-2 rounded-xl bg-rose-50/60 dark:bg-rose-950/30 hover:bg-rose-100/70 dark:hover:bg-rose-900/40 border border-rose-200/60 dark:border-rose-900/60 transition cursor-pointer group"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: quad.color }}
                        />
                        <span className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate group-hover:text-rose-600 dark:group-hover:text-rose-400">
                          {t.title}
                        </span>
                      </div>
                      <div className="text-[10px] text-rose-600 dark:text-rose-400 mt-0.5 font-mono">
                        {t.deadline ? new Date(t.deadline).toLocaleDateString() : '逾期'} · {t.duration_minutes}m
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Daily Due Sections */}
            {dueGroups.length > 0 &&
              dueGroups.map((group) => {
                const dayLabel = `${group.date.getMonth() + 1}月${group.date.getDate()}日`;
                const weekDayName = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
                  group.date.getDay()
                ];
                const isToday = group.key === todayKey;

                return (
                  <div key={group.key} className="space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-neutral-400 px-1 flex items-center justify-between">
                      <span className={isToday ? 'text-blue-600 dark:text-blue-400 font-bold' : ''}>
                        {weekDayName} · {dayLabel}
                      </span>
                      <span className="font-mono text-[9px] text-gray-400">
                        {group.due.length} 项
                      </span>
                    </div>

                    {group.due.map((t) => {
                      const quad = getTaskQuadrant(t.importance, t.urgency);
                      return (
                        <button
                          key={t.id}
                          onClick={() => setSelectedDueTask(t)}
                          className="w-full text-left p-2 rounded-xl bg-gray-50 dark:bg-[#28292a] hover:bg-blue-50/70 dark:hover:bg-blue-950/40 border border-gray-200/80 dark:border-neutral-700/80 transition cursor-pointer group"
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: quad.color }}
                            />
                            <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
                              {t.title}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-neutral-500 mt-1 font-mono">
                            <span>{t.duration_minutes} 分钟</span>
                            <span>{quad.name.slice(0, 2)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}

            {overdueTasks.length === 0 && dueGroups.length === 0 && (
              <div className="p-6 text-center text-gray-400 dark:text-neutral-500 text-xs">
                本周暂无截止待办
              </div>
            )}
          </div>
        </aside>

        {/* Right Main: Calendar Time Grid matching calcury/eisenhower-matrix */}
        <div
          ref={scrollRef}
          className="flex-1 bg-white dark:bg-[#1e1f20] border border-gray-200/80 dark:border-neutral-800/80 rounded-2xl shadow-xs overflow-y-auto overflow-x-auto relative transition-colors"
        >
          <div
            className="grid min-w-[760px] bg-white dark:bg-[#1e1f20]"
            style={{
              gridTemplateColumns: '54px repeat(7, minmax(0, 1fr))',
            }}
          >
            {/* Row 1: Sticky Day Headers */}
            <div className="sticky top-0 z-30 h-11 bg-white dark:bg-[#1e1f20] border-b border-gray-200 dark:border-neutral-800" />
            {dayData.map((d) => {
              const isToday = d.key === todayKey;
              const weekDayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
              return (
                <div
                  key={`head-${d.key}`}
                  className={`sticky top-0 z-30 h-11 flex flex-col items-center justify-center border-l border-b border-gray-200 dark:border-neutral-800 transition-colors ${
                    isToday
                      ? 'bg-blue-50 dark:bg-[#1e2738]'
                      : 'bg-white dark:bg-[#1e1f20]'
                  }`}
                >
                  <span
                    className={`text-[10px] uppercase font-bold tracking-wider ${
                      isToday
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-gray-400 dark:text-neutral-400'
                    }`}
                  >
                    {weekDayNames[d.date.getDay()]}
                  </span>
                  <span
                    className={`text-sm font-extrabold leading-none font-mono ${
                      isToday
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    {d.date.getDate()}
                  </span>
                </div>
              );
            })}

            {/* Row 2: Sticky All-Day Row */}
            <div className="sticky top-[44px] z-20 min-h-[28px] bg-gray-50 dark:bg-[#252627] border-b border-gray-200 dark:border-neutral-800 flex items-center justify-end px-2 text-[9px] uppercase font-bold text-gray-400 font-mono tracking-wider">
              全天
            </div>
            {dayData.map((d) => (
              <div
                key={`allday-${d.key}`}
                className="sticky top-[44px] z-20 min-h-[28px] bg-gray-50 dark:bg-[#252627] border-l border-b border-gray-200 dark:border-neutral-800 p-1 flex flex-col gap-1"
              >
                {d.allDay.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItem(item)}
                    className="w-full text-left text-[10px] font-medium px-2 py-0.5 rounded truncate text-white shadow-2xs transition cursor-pointer"
                    style={{ backgroundColor: item.color }}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            ))}

            {/* Row 3: Time Axis (07:00 to 24:00 + Rest Hours 01:00-07:00) */}
            <div
              className="relative border-r border-gray-200 dark:border-neutral-800 select-none bg-white dark:bg-[#1e1f20]"
              style={{ height: gridHeight }}
            >
              {DAY_HOURS.map((hour) => (
                <span
                  key={hour}
                  className="absolute right-2 text-[10px] font-mono text-gray-400 dark:text-neutral-500 -translate-y-2"
                  style={{ top: (hour - CALENDAR_START_HOUR) * HOUR_HEIGHT }}
                >
                  {formatHour(hour)}
                </span>
              ))}

              {/* 24:00 Split Hour */}
              <span
                className="absolute right-2 text-[10px] font-mono font-bold text-gray-700 dark:text-neutral-300 -translate-y-2"
                style={{ top: restTop }}
              >
                24:00
              </span>

              {/* Rest Hours */}
              {REST_HOURS.map((hour) => (
                <span
                  key={`rest-${hour}`}
                  className="absolute right-2 text-[9px] font-mono text-gray-400/60 dark:text-neutral-600 -translate-y-2"
                  style={{
                    top: (CALENDAR_END_HOUR - CALENDAR_START_HOUR + hour) * HOUR_HEIGHT,
                  }}
                >
                  {formatHour(hour)}
                </span>
              ))}

              {/* Rest Band Texture */}
              <div
                className="absolute left-0 right-0 pointer-events-none border-t border-dashed border-gray-300 dark:border-neutral-700 opacity-60"
                style={{
                  top: restTop,
                  height: restHeight,
                  backgroundImage: isDark
                    ? 'repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(255,255,255,0.04) 6px, rgba(255,255,255,0.04) 12px)'
                    : 'repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(150,150,150,0.08) 6px, rgba(150,150,150,0.08) 12px)',
                }}
              />
            </div>

            {/* Row 3: 7 Day Columns with Event and Task Blocks */}
            {dayData.map((d) => (
              <div
                key={`col-${d.key}`}
                className="relative border-l border-gray-200 dark:border-neutral-800 bg-white dark:bg-[#1e1f20]"
                style={{ height: gridHeight }}
              >
                {/* Hourly faint divider lines */}
                {Array.from({ length: GRID_HOURS }, (_, i) => (
                  <div
                    key={`line-${i}`}
                    className="absolute left-0 right-0 border-b border-gray-100 dark:border-neutral-800/60 pointer-events-none"
                    style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                  />
                ))}

                {/* Nighttime Rest Zone */}
                <div
                  className="absolute left-0 right-0 pointer-events-none border-t border-dashed border-gray-300 dark:border-neutral-700/80"
                  style={{
                    top: restTop,
                    height: restHeight,
                    backgroundImage: isDark
                      ? 'repeating-linear-gradient(-45deg, transparent, transparent 7px, rgba(255,255,255,0.04) 7px, rgba(255,255,255,0.04) 14px)'
                      : 'repeating-linear-gradient(-45deg, transparent, transparent 7px, rgba(150,150,150,0.07) 7px, rgba(150,150,150,0.07) 14px)',
                  }}
                />

                {/* Timed Segments */}
                {d.timed.map((pos) => {
                  const seg = pos.item;
                  const minutesIntoGrid = Math.max(
                    0,
                    (new Date(seg.start).getTime() - d.windowStartMs) / 60000
                  );
                  const durationMinutes = Math.max(
                    15,
                    (new Date(seg.end).getTime() - new Date(seg.start).getTime()) / 60000
                  );

                  const top = (minutesIntoGrid / 60) * HOUR_HEIGHT;
                  const height = Math.max(18, (durationMinutes / 60) * HOUR_HEIGHT);
                  const widthPct = 100 / pos.columns;
                  const leftPct = pos.column * widthPct;

                  const isTask = seg.kind === 'task';

                  return (
                    <button
                      key={seg.id}
                      onClick={() => setSelectedItem(seg)}
                      title={`${seg.title} (${formatTime(seg.start)} - ${formatTime(seg.end)})`}
                      className={`absolute rounded-md p-1.5 text-left transition-all z-10 hover:z-20 shadow-xs cursor-pointer overflow-hidden ${
                        pos.conflict ? 'ring-1 ring-rose-500' : ''
                      }`}
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        left: `${leftPct}%`,
                        width: `calc(${widthPct}% - 3px)`,
                        borderLeft: `3.5px solid ${seg.color}`,
                        backgroundColor: isDark
                          ? `color-mix(in srgb, ${seg.color} 24%, #232426)`
                          : `color-mix(in srgb, ${seg.color} 15%, #ffffff)`,
                      }}
                    >
                      <div className="flex items-center gap-1 font-mono text-[9px] text-gray-500 dark:text-neutral-400 font-semibold truncate leading-none">
                        <span>{formatTime(seg.start)}</span>
                        <span>-</span>
                        <span>{formatTime(seg.end)}</span>
                      </div>
                      <div className="text-[11px] font-bold text-gray-900 dark:text-gray-100 truncate leading-snug mt-0.5">
                        {seg.title}
                      </div>
                      {height >= 46 && (
                        <div className="text-[9px] text-gray-500 dark:text-neutral-400 truncate mt-0.5 font-medium">
                          {isTask ? seg.qName : seg.event.subscriptionName || '外部日程'}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CalendarsDialog Modal matching calcury/eisenhower-matrix */}
      {showCalendarsModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1e1f20] rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 border border-gray-200 dark:border-neutral-800 animate-fadeIn transition-colors">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-neutral-800">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>日历订阅与同步源</span>
              </h3>
              <button
                onClick={() => setShowCalendarsModal(false)}
                className="w-7 h-7 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-800 flex items-center justify-center text-sm font-bold transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Personal Export Link */}
            <div className="p-3 bg-gray-50 dark:bg-[#28292a] rounded-xl border border-gray-200/80 dark:border-neutral-700/80 space-y-1.5 text-xs">
              <label className="block font-semibold text-gray-700 dark:text-neutral-300 text-[11px]">
                Clawbot 专属待办日历 (导出到 Apple / Google / Outlook)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={icalExportUrl}
                  className="w-full px-3 py-1.5 bg-white dark:bg-[#232425] border border-gray-200 dark:border-neutral-700 rounded-lg font-mono text-[11px] text-gray-700 dark:text-neutral-300 select-all"
                />
                <button
                  type="button"
                  onClick={copyIcal}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg shrink-0 flex items-center gap-1 transition cursor-pointer"
                >
                  {copiedIcal ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedIcal ? '已复制' : '复制'}</span>
                </button>
              </div>
            </div>

            {/* Add external sub */}
            <form onSubmit={handleAddSubscription} className="space-y-2 pt-1 text-xs">
              <span className="font-bold text-gray-800 dark:text-gray-200 text-xs">
                + 导入外部 iCal 订阅
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={newSubName}
                  onChange={(e) => setNewSubName(e.target.value)}
                  placeholder="日历名称 (例如: 公司会议)"
                  className="px-3 py-2 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl outline-none"
                  required
                />
                <input
                  type="text"
                  value={newSubUrl}
                  onChange={(e) => setNewSubUrl(e.target.value)}
                  placeholder="webcal://... 或 https://...ics"
                  className="px-3 py-2 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl font-mono outline-none"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={submittingSub}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition cursor-pointer text-xs"
              >
                {submittingSub ? '正在添加并同步...' : '添加日历源'}
              </button>
            </form>

            {/* Subscriptions List */}
            <div className="space-y-2 max-h-56 overflow-y-auto text-xs pt-2">
              <span className="font-semibold text-gray-500 dark:text-neutral-400 text-[11px] block">
                已导入日历 ({subscriptions.length})
              </span>
              {subscriptions.length === 0 ? (
                <div className="text-center py-4 text-gray-400 text-xs border border-dashed border-gray-200 dark:border-neutral-800 rounded-xl">
                  暂未添加外部日历源
                </div>
              ) : (
                subscriptions.map((s, idx) => {
                  const color = CALENDAR_PALETTE[idx % CALENDAR_PALETTE.length];
                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-[#28292a] rounded-xl border border-gray-200/80 dark:border-neutral-700/80"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <div className="truncate">
                          <div className="font-bold text-gray-900 dark:text-gray-100 text-xs">
                            {s.name}
                          </div>
                          <div className="text-[10px] text-gray-400 truncate font-mono">
                            {s.event_count} 个事件 · {s.sync_status === 'ok' ? '已同步' : '同步异常'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleSyncSubscription(s.id)}
                          className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 rounded-lg transition"
                          title="立即同步"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteSubscription(s.id)}
                          className="p-1.5 text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950 rounded-lg transition"
                          title="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal for Selected Event/Task */}
      {(selectedItem || selectedDueTask) && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1e1f20] rounded-3xl max-w-sm w-full p-5 shadow-2xl space-y-3.5 border border-gray-200 dark:border-neutral-800 animate-fadeIn">
            <div className="flex items-start justify-between gap-3 pb-2 border-b border-gray-100 dark:border-neutral-800">
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {selectedItem?.title || selectedDueTask?.title}
                </h3>
                <span className="text-[10px] text-gray-400 dark:text-neutral-500">
                  {selectedItem?.kind === 'event'
                    ? selectedItem.event.subscriptionName || '外部导入日程'
                    : 'Clawbot 规划待办'}
                </span>
              </div>
              <button
                onClick={() => {
                  setSelectedItem(null);
                  setSelectedDueTask(null);
                }}
                className="w-6 h-6 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-800 flex items-center justify-center font-bold text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {selectedItem && (
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2 text-gray-600 dark:text-neutral-300">
                  <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span className="font-mono">
                    {formatTime(selectedItem.start)} - {formatTime(selectedItem.end)}
                  </span>
                </div>

                {selectedItem.kind === 'task' && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                        {selectedItem.qName}
                      </span>
                      <span className="text-gray-500 text-[11px]">
                        耗时 {selectedItem.task.duration_minutes} 分钟
                      </span>
                    </div>
                    {selectedItem.task.deadline && (
                      <div className="text-[11px] text-gray-500 font-mono">
                        截止: {new Date(selectedItem.task.deadline).toLocaleString()}
                      </div>
                    )}
                    {selectedItem.task.notes && (
                      <p className="text-[11px] text-gray-500 bg-gray-50 dark:bg-[#28292a] p-2 rounded-lg">
                        {selectedItem.task.notes}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {selectedDueTask && (
              <div className="space-y-2 text-xs">
                <div className="text-rose-600 dark:text-rose-400 font-semibold font-mono">
                  截止时间: {selectedDueTask.deadline ? new Date(selectedDueTask.deadline).toLocaleString() : '未设'}
                </div>
                <div className="text-gray-500">
                  预计耗时: {selectedDueTask.duration_minutes} 分钟
                </div>
                <div className="text-gray-500">
                  紧急: {selectedDueTask.urgency}/5 · 重要: {selectedDueTask.importance}/5
                </div>
                {selectedDueTask.notes && (
                  <p className="text-[11px] text-gray-500 bg-gray-50 dark:bg-[#28292a] p-2 rounded-lg">
                    {selectedDueTask.notes}
                  </p>
                )}
              </div>
            )}

            <button
              onClick={() => {
                setSelectedItem(null);
                setSelectedDueTask(null);
              }}
              className="w-full py-1.5 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-700 dark:text-neutral-200 text-xs font-semibold rounded-xl transition cursor-pointer"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
