import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  RefreshCw,
  Copy,
  Check,
  Calendar as CalendarIcon,
  Plus,
  Trash2,
  ExternalLink,
  Filter,
} from 'lucide-react';

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  backgroundColor: string;
  borderColor: string;
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

interface CalendarSub {
  id: number;
  name: string;
  url: string;
  event_count: number;
  sync_status: 'ok' | 'error';
  last_sync_at: string | null;
}

export const CalendarView: React.FC = () => {
  const { user } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [subscriptions, setSubscriptions] = useState<CalendarSub[]>([]);
  const [loading, setLoading] = useState(true);

  // Active calendars filter: 'clawbot' + subscription IDs
  const [visibleCalendars, setVisibleCalendars] = useState<Record<string, boolean>>({
    clawbot: true,
  });

  // Current viewed date
  const [currentDate, setCurrentDate] = useState(new Date());
  // Mini calendar display month
  const [miniCalMonth, setMiniCalMonth] = useState(new Date());

  // Outlook views: 'week' | 'workweek' | 'day' | 'month'
  const [viewMode, setViewMode] = useState<'week' | 'workweek' | 'day' | 'month'>('week');
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [copied, setCopied] = useState(false);

  // Mobile sidebar drawer
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Quick Add Subscription modal
  const [showAddSubModal, setShowAddSubModal] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [newSubUrl, setNewSubUrl] = useState('');
  const [addingSub, setAddingSub] = useState(false);

  const fetchCalendarData = async () => {
    setLoading(true);
    try {
      const res = await api.get('/calendar/events');
      setEvents(res.data.events || []);

      const subs: CalendarSub[] = res.data.subscriptions || [];
      setSubscriptions(subs);

      // Initialize all subscriptions as visible
      setVisibleCalendars((prev: Record<string, boolean>) => {
        const next: Record<string, boolean> = { ...prev, clawbot: prev.clawbot !== false };
        subs.forEach((s) => {
          if (next[`sub-${s.id}`] === undefined) {
            next[`sub-${s.id}`] = true;
          }
        });
        return next;
      });
    } catch (err) {
      console.error('Failed to fetch calendar data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalendarData();
  }, []);

  // Filter events based on active calendar checkboxes
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      const isTask = ev.extendedProps?.type === 'task';
      if (isTask) {
        return visibleCalendars['clawbot'] !== false;
      }
      const subId = ev.extendedProps?.subscriptionId || ev.subscriptionId;
      if (subId) {
        return visibleCalendars[`sub-${subId}`] !== false;
      }
      return true;
    });
  }, [events, visibleCalendars]);

  // Toggle calendar visibility
  const toggleCalendar = (key: string) => {
    setVisibleCalendars((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Dedicated iCal export link
  const subUrl = `${window.location.origin}/api/calendar/subscribe/${user?.token_secret}.ics`;
  const webcalUrl = subUrl.replace(/^https?:/, 'webcal:');

  const copySubLink = () => {
    navigator.clipboard.writeText(webcalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Add new subscription
  const handleAddSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubName.trim() || !newSubUrl.trim()) return;

    setAddingSub(true);
    try {
      await api.post('/calendar/subscriptions', {
        name: newSubName.trim(),
        url: newSubUrl.trim(),
      });
      setNewSubName('');
      setNewSubUrl('');
      setShowAddSubModal(false);
      fetchCalendarData();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      alert('添加订阅失败: ' + (error.response?.data?.error || error.message));
    } finally {
      setAddingSub(false);
    }
  };

  // Delete subscription
  const handleDeleteSub = async (id: number) => {
    if (!window.confirm('确定移除此日历订阅吗？已缓存的事件也将被移除。')) return;
    try {
      await api.delete(`/calendar/subscriptions/${id}`);
      fetchCalendarData();
    } catch {
      alert('删除失败');
    }
  };

  // Week Days computation
  const getWeekDays = (date: Date, workWeekOnly = false) => {
    const start = new Date(date);
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Monday start
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);

    const count = workWeekOnly ? 5 : 7;
    const days: Date[] = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  };

  const weekDays = useMemo(() => {
    if (viewMode === 'workweek') return getWeekDays(currentDate, true);
    if (viewMode === 'week') return getWeekDays(currentDate, false);
    return [currentDate];
  }, [currentDate, viewMode]);

  // Mini calendar days generator
  const miniCalDays = useMemo(() => {
    const year = miniCalMonth.getFullYear();
    const month = miniCalMonth.getMonth();

    const firstDayOfMonth = new Date(year, month, 1);
    const startDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days: { date: Date; isCurrentMonth: boolean }[] = [];

    // Prev month padding
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, prevMonthDays - i),
        isCurrentMonth: false,
      });
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        date: new Date(year, month, i),
        isCurrentMonth: true,
      });
    }

    // Next month padding to fill 35 or 42 cells
    const remaining = (7 - (days.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false,
      });
    }

    return days;
  }, [miniCalMonth]);

  // Period navigation
  const prevPeriod = () => {
    const d = new Date(currentDate);
    if (viewMode === 'month') d.setMonth(d.getMonth() - 1);
    else if (viewMode === 'week' || viewMode === 'workweek') d.setDate(d.getDate() - 7);
    else d.setDate(d.getDate() - 1);
    setCurrentDate(d);
    setMiniCalMonth(d);
  };

  const nextPeriod = () => {
    const d = new Date(currentDate);
    if (viewMode === 'month') d.setMonth(d.getMonth() + 1);
    else if (viewMode === 'week' || viewMode === 'workweek') d.setDate(d.getDate() + 7);
    else d.setDate(d.getDate() + 1);
    setCurrentDate(d);
    setMiniCalMonth(d);
  };

  const goToToday = () => {
    const now = new Date();
    setCurrentDate(now);
    setMiniCalMonth(now);
  };

  // Get events for a single day
  const getEventsForDay = (day: Date) => {
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    return filteredEvents.filter((ev) => {
      const evStart = new Date(ev.start);
      const evEnd = new Date(ev.end);
      return evStart < dayEnd && evEnd > dayStart;
    });
  };

  // Calendar palette for external subscriptions
  const subColors = ['#0284c7', '#7c3aed', '#059669', '#ea580c', '#db2777', '#ca8a04'];

  return (
    <div className="w-full space-y-4">
      {/* Outlook 2-Column Responsive Layout (左右排版, 宽广且一页显示) */}
      <div className="flex flex-col lg:flex-row items-stretch gap-4 h-auto lg:h-[calc(100vh-6.5rem)] lg:min-h-[640px]">
        {/* Left Sidebar (Outlook Style Calendars & Datepicker) */}
        <aside
          className={`w-full lg:w-72 xl:w-80 shrink-0 bg-white dark:bg-[#1e1f20] border border-gray-200/80 dark:border-neutral-800/80 rounded-3xl p-4 sm:p-5 flex flex-col justify-between shadow-xs transition-colors ${
            mobileSidebarOpen ? 'block' : 'hidden lg:flex'
          }`}
        >
          <div className="space-y-5 overflow-y-auto pr-1">
            {/* Outlook Mini Monthly Calendar */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-900 dark:text-gray-100 font-sans">
                  {miniCalMonth.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date(miniCalMonth);
                      d.setMonth(d.getMonth() - 1);
                      setMiniCalMonth(d);
                    }}
                    className="p-1 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-full transition cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date(miniCalMonth);
                      d.setMonth(d.getMonth() + 1);
                      setMiniCalMonth(d);
                    }}
                    className="p-1 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-full transition cursor-pointer"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Mini Calendar Grid */}
              <div className="grid grid-cols-7 text-center text-[10px] font-medium text-gray-400 dark:text-neutral-500 pb-1">
                <span>一</span>
                <span>二</span>
                <span>三</span>
                <span>四</span>
                <span>五</span>
                <span>六</span>
                <span>日</span>
              </div>
              <div className="grid grid-cols-7 text-center gap-y-1 text-xs">
                {miniCalDays.map((item, idx) => {
                  const isSelected = item.date.toDateString() === currentDate.toDateString();
                  const isToday = item.date.toDateString() === new Date().toDateString();

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setCurrentDate(item.date);
                      }}
                      className={`h-7 w-7 mx-auto rounded-full flex items-center justify-center text-xs transition cursor-pointer ${
                        isSelected
                          ? 'bg-blue-600 text-white font-bold shadow-xs'
                          : isToday
                          ? 'border border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400 font-semibold'
                          : item.isCurrentMonth
                          ? 'text-gray-800 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-800'
                          : 'text-gray-300 dark:text-neutral-600'
                      }`}
                    >
                      {item.date.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Outlook Multi-Calendar Checklist Section */}
            <div className="space-y-3 pt-3 border-t border-gray-100 dark:border-neutral-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-900 dark:text-gray-100">
                  日历视图筛选
                </span>
                <button
                  type="button"
                  onClick={() => setShowAddSubModal(true)}
                  className="p-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-full transition cursor-pointer"
                  title="导入新日历"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Calendars Checklist */}
              <div className="space-y-1.5 text-xs">
                {/* 1. Clawbot Dedicated Calendar */}
                <div
                  onClick={() => toggleCalendar('clawbot')}
                  className="flex items-center justify-between p-2 rounded-xl hover:bg-gray-50 dark:hover:bg-[#28292a] transition cursor-pointer group"
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={visibleCalendars['clawbot'] !== false}
                      onChange={() => {}}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      Clawbot 规划待办
                    </span>
                  </div>
                  <span className="text-[10px] bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full font-medium">
                    专用
                  </span>
                </div>

                {/* 2. Subscribed Calendars */}
                {subscriptions.length === 0 ? (
                  <div className="text-[11px] text-gray-400 dark:text-neutral-500 p-2">
                    尚未导入外部日历
                  </div>
                ) : (
                  subscriptions.map((sub, i) => {
                    const color = subColors[i % subColors.length];
                    const isVisible = visibleCalendars[`sub-${sub.id}`] !== false;

                    return (
                      <div
                        key={sub.id}
                        className="flex items-center justify-between p-2 rounded-xl hover:bg-gray-50 dark:hover:bg-[#28292a] transition group"
                      >
                        <div
                          onClick={() => toggleCalendar(`sub-${sub.id}`)}
                          className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={isVisible}
                            onChange={() => {}}
                            className="w-4 h-4 rounded cursor-pointer"
                            style={{ accentColor: color }}
                          />
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="font-medium text-gray-800 dark:text-neutral-200 truncate">
                            {sub.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] text-gray-400 dark:text-neutral-500 font-mono">
                            {sub.event_count}条
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteSub(sub.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-600 transition cursor-pointer"
                            title="删除订阅"
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

          {/* Bottom Outlook Subscription Link */}
          <div className="pt-3 border-t border-gray-100 dark:border-neutral-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-neutral-400">TODO 导出订阅</span>
              <button
                type="button"
                onClick={copySubLink}
                className="text-blue-600 dark:text-blue-400 hover:underline font-semibold flex items-center gap-1 text-[11px] cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? '已复制' : '复制订阅链接'}</span>
              </button>
            </div>
            <a
              href={webcalUrl}
              className="w-full py-2 bg-gray-100 dark:bg-[#28292a] hover:bg-blue-50 dark:hover:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>一键加入本地日历</span>
            </a>
          </div>
        </aside>

        {/* Right Main Calendar Body (Outlook Ribbon & Viewport Grid) */}
        <main className="flex-1 bg-white dark:bg-[#1e1f20] border border-gray-200/80 dark:border-neutral-800/80 rounded-3xl p-4 sm:p-5 flex flex-col shadow-xs overflow-hidden transition-colors">
          {/* Outlook Ribbon Top Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-gray-100 dark:border-neutral-800 shrink-0">
            {/* Left Nav */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Mobile Sidebar toggle button */}
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
                className="lg:hidden p-2 text-gray-600 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-full border border-gray-200 dark:border-neutral-700 transition"
                title="切换日历筛选"
              >
                <Filter className="w-4 h-4" />
              </button>

              <div className="flex items-center bg-gray-100 dark:bg-neutral-800 rounded-full p-1 border border-gray-200/60 dark:border-neutral-700/60">
                <button
                  type="button"
                  onClick={prevPeriod}
                  className="p-1.5 hover:bg-white dark:hover:bg-neutral-700 rounded-full text-gray-600 dark:text-neutral-300 transition cursor-pointer"
                  title="上一周期"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={goToToday}
                  className="px-3 py-1 text-xs font-semibold text-gray-800 dark:text-neutral-200 hover:bg-white dark:hover:bg-neutral-700 rounded-full transition cursor-pointer"
                >
                  今天
                </button>
                <button
                  type="button"
                  onClick={nextPeriod}
                  className="p-1.5 hover:bg-white dark:hover:bg-neutral-700 rounded-full text-gray-600 dark:text-neutral-300 transition cursor-pointer"
                  title="下一周期"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <h2 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100 font-sans truncate">
                {viewMode === 'month'
                  ? currentDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
                  : `${weekDays[0].toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} - ${weekDays[
                      weekDays.length - 1
                    ].toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' })}`}
              </h2>
            </div>

            {/* Right Outlook View Mode Switcher */}
            <div className="flex items-center gap-2">
              <div className="flex bg-gray-100 dark:bg-neutral-800 p-1 rounded-full border border-gray-200/60 dark:border-neutral-700/60 text-xs font-medium">
                {[
                  { mode: 'workweek', label: '工作周' },
                  { mode: 'week', label: '周' },
                  { mode: 'month', label: '月' },
                  { mode: 'day', label: '日' },
                ].map((item) => (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => setViewMode(item.mode as any)}
                    className={`px-3 py-1 rounded-full transition cursor-pointer ${
                      viewMode === item.mode
                        ? 'bg-white dark:bg-neutral-700 text-blue-600 dark:text-blue-400 font-semibold shadow-xs'
                        : 'text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-neutral-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={fetchCalendarData}
                disabled={loading}
                className="p-2 text-gray-500 dark:text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-full border border-gray-200 dark:border-neutral-700 transition cursor-pointer"
                title="刷新所有日历"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
              </button>
            </div>
          </div>

          {/* Calendar Viewport Grid (Independent smooth scrolling inside viewport) */}
          <div className="flex-1 overflow-y-auto mt-3 rounded-2xl border border-gray-200/80 dark:border-neutral-800/80 flex flex-col">
            {/* View 1: Week / WorkWeek / Day View */}
            {viewMode !== 'month' && (
              <div className="flex-1 flex flex-col">
                {/* Column Headers */}
                <div
                  className={`grid ${
                    viewMode === 'workweek'
                      ? 'grid-cols-5'
                      : viewMode === 'week'
                      ? 'grid-cols-7'
                      : 'grid-cols-1'
                  } border-b border-gray-200 dark:border-neutral-800 bg-gray-50/80 dark:bg-[#28292a]/50 shrink-0`}
                >
                  {weekDays.map((d, idx) => {
                    const isToday = d.toDateString() === new Date().toDateString();
                    return (
                      <div
                        key={idx}
                        className={`p-2.5 sm:p-3 text-center border-r border-gray-200/80 dark:border-neutral-800 last:border-r-0 ${
                          isToday ? 'bg-blue-50/50 dark:bg-blue-950/30' : ''
                        }`}
                      >
                        <div className="text-[11px] text-gray-500 dark:text-neutral-400 font-medium">
                          {d.toLocaleDateString('zh-CN', { weekday: 'short' })}
                        </div>
                        <div
                          className={`text-xs sm:text-sm font-semibold mt-0.5 inline-block w-7 h-7 rounded-full leading-7 ${
                            isToday ? 'bg-blue-600 text-white font-bold' : 'text-gray-900 dark:text-gray-100'
                          }`}
                        >
                          {d.getDate()}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Day Columns Events Grid */}
                <div
                  className={`flex-1 grid ${
                    viewMode === 'workweek'
                      ? 'grid-cols-1 sm:grid-cols-5'
                      : viewMode === 'week'
                      ? 'grid-cols-1 sm:grid-cols-7'
                      : 'grid-cols-1'
                  } divide-y sm:divide-y-0 sm:divide-x divide-gray-200/80 dark:divide-neutral-800 bg-white dark:bg-[#1e1f20] min-h-[360px]`}
                >
                  {weekDays.map((day, dIdx) => {
                    const dayEvents = getEventsForDay(day).sort(
                      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
                    );

                    return (
                      <div key={dIdx} className="p-2 space-y-2 bg-gray-50/10 dark:bg-[#1e1f20]/10 min-h-[140px]">
                        {dayEvents.length === 0 ? (
                          <div className="h-24 flex items-center justify-center text-gray-400 dark:text-neutral-600 text-[11px]">
                            无日程
                          </div>
                        ) : (
                          dayEvents.map((ev) => {
                            const isTask = ev.extendedProps?.type === 'task';
                            const s = new Date(ev.start).toLocaleTimeString('zh-CN', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            });
                            const e = new Date(ev.end).toLocaleTimeString('zh-CN', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            });

                            return (
                              <div
                                key={ev.id}
                                onClick={() => setSelectedEvent(ev)}
                                className="p-2 rounded-xl text-xs border border-transparent hover:border-gray-300 dark:hover:border-neutral-600 shadow-2xs cursor-pointer transition hover:scale-[1.01] space-y-1 relative overflow-hidden"
                                style={{
                                  backgroundColor: isTask
                                    ? ev.backgroundColor === '#10b981'
                                      ? '#ecfdf5'
                                      : '#eff6ff'
                                    : '#f0f9ff',
                                  color: isTask
                                    ? ev.backgroundColor === '#10b981'
                                      ? '#065f46'
                                      : '#1e40af'
                                    : '#0369a1',
                                  borderLeft: `4px solid ${ev.backgroundColor}`,
                                }}
                              >
                                <div className="font-semibold line-clamp-2 leading-tight">
                                  {ev.title}
                                </div>
                                <div className="flex items-center gap-1 opacity-85 text-[10px] font-mono">
                                  <Clock className="w-3 h-3 shrink-0" />
                                  <span>
                                    {s} ~ {e}
                                  </span>
                                </div>
                                <div className="text-[10px] opacity-75 truncate">
                                  {isTask ? 'Clawbot 规划' : ev.subscriptionName || '外部日程'}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* View 2: Month View (Outlook 7-column month grid) */}
            {viewMode === 'month' && (
              <div className="flex-1 flex flex-col">
                <div className="grid grid-cols-7 border-b border-gray-200 dark:border-neutral-800 bg-gray-50/80 dark:bg-[#28292a]/50 text-center py-2 text-xs font-semibold text-gray-500 dark:text-neutral-400 shrink-0">
                  <span>周一</span>
                  <span>周二</span>
                  <span>周三</span>
                  <span>周四</span>
                  <span>周五</span>
                  <span>周六</span>
                  <span>周日</span>
                </div>
                <div className="flex-1 grid grid-cols-7 divide-x divide-y divide-gray-200/80 dark:divide-neutral-800 bg-white dark:bg-[#1e1f20]">
                  {miniCalDays.map((item, idx) => {
                    const dayEvents = getEventsForDay(item.date);
                    const isToday = item.date.toDateString() === new Date().toDateString();

                    return (
                      <div
                        key={idx}
                        className={`p-1.5 sm:p-2 min-h-[90px] space-y-1 ${
                          item.isCurrentMonth
                            ? 'bg-transparent'
                            : 'bg-gray-50/50 dark:bg-neutral-900/30 text-gray-400'
                        }`}
                      >
                        <div className="text-right">
                          <span
                            className={`inline-block text-xs font-semibold w-5 h-5 rounded-full text-center leading-5 ${
                              isToday
                                ? 'bg-blue-600 text-white font-bold'
                                : 'text-gray-700 dark:text-neutral-300'
                            }`}
                          >
                            {item.date.getDate()}
                          </span>
                        </div>

                        <div className="space-y-1">
                          {dayEvents.slice(0, 3).map((ev) => (
                            <div
                              key={ev.id}
                              onClick={() => setSelectedEvent(ev)}
                              title={ev.title}
                              className="px-1.5 py-0.5 rounded text-[10px] truncate cursor-pointer hover:opacity-85 font-medium"
                              style={{
                                backgroundColor: ev.backgroundColor,
                                color: '#ffffff',
                              }}
                            >
                              {ev.title}
                            </div>
                          ))}
                          {dayEvents.length > 3 && (
                            <div className="text-[10px] text-gray-400 pl-1">
                              +{dayEvents.length - 3} 更多
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Quick Add Calendar Modal */}
      {showAddSubModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1e1f20] rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-gray-200 dark:border-neutral-800 animate-fadeIn">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-neutral-800">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <span>导入外部日历 (订阅链接)</span>
              </h3>
              <button
                onClick={() => setShowAddSubModal(false)}
                className="w-7 h-7 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-800 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddSubscription} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-gray-700 dark:text-neutral-300 mb-1">
                  日历名称 *
                </label>
                <input
                  type="text"
                  value={newSubName}
                  onChange={(e) => setNewSubName(e.target.value)}
                  placeholder="例如：公司会议 / 个人日程"
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none text-sm"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 dark:text-neutral-300 mb-1">
                  订阅链接 (webcal:// 或 https://...ics) *
                </label>
                <input
                  type="text"
                  value={newSubUrl}
                  onChange={(e) => setNewSubUrl(e.target.value)}
                  placeholder="webcal://..."
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl font-mono text-gray-900 dark:text-gray-100 outline-none text-xs"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddSubModal(false)}
                  className="px-4 py-2 bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-neutral-300 rounded-full font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={addingSub}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-medium transition disabled:opacity-50"
                >
                  {addingSub ? '正在同步...' : '添加并同步'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Event Detail Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1e1f20] rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-gray-200 dark:border-neutral-800 animate-fadeIn transition-colors">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <span
                  className="inline-block text-[10px] font-semibold uppercase px-2.5 py-0.5 rounded-full text-white"
                  style={{ backgroundColor: selectedEvent.backgroundColor }}
                >
                  {selectedEvent.extendedProps?.type === 'external' ? '外部日历日程' : 'Clawbot 规划待办'}
                </span>
                <h4 className="text-base font-bold text-gray-900 dark:text-gray-100">{selectedEvent.title}</h4>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="w-7 h-7 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-800 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="bg-gray-50 dark:bg-[#28292a] rounded-2xl p-4 space-y-2 text-xs text-gray-600 dark:text-neutral-300">
              <div className="flex justify-between">
                <span className="text-gray-400 dark:text-neutral-500">所属日历：</span>
                <span className="font-semibold text-gray-800 dark:text-gray-200">
                  {selectedEvent.subscriptionName || (selectedEvent.extendedProps?.type === 'task' ? 'Clawbot 待办' : '外部日历')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400 dark:text-neutral-500">开始时间：</span>
                <span className="font-semibold text-gray-800 dark:text-gray-200">
                  {new Date(selectedEvent.start).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400 dark:text-neutral-500">结束时间：</span>
                <span className="font-semibold text-gray-800 dark:text-gray-200">
                  {new Date(selectedEvent.end).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
                </span>
              </div>
              {selectedEvent.extendedProps?.type === 'task' && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-400 dark:text-neutral-500">预估耗时：</span>
                    <span className="font-semibold text-gray-800 dark:text-gray-200">
                      {selectedEvent.extendedProps.duration} 分钟
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400 dark:text-neutral-500">紧急 / 重要度：</span>
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      紧急 {selectedEvent.extendedProps.urgency}/5 · 重要 {selectedEvent.extendedProps.importance}/5
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400 dark:text-neutral-500">任务状态：</span>
                    <span className="font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                      {selectedEvent.extendedProps.status}
                    </span>
                  </div>
                  {selectedEvent.extendedProps.deadline && (
                    <div className="flex justify-between">
                      <span className="text-gray-400 dark:text-neutral-500">截止 DDL：</span>
                      <span className="font-semibold text-rose-600 dark:text-rose-400">
                        {new Date(selectedEvent.extendedProps.deadline).toLocaleString('zh-CN')}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            <button
              onClick={() => setSelectedEvent(null)}
              className="w-full py-2.5 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-700 dark:text-neutral-200 rounded-full text-xs font-medium transition cursor-pointer"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
