import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  RefreshCw,
  Copy,
  Check,
  CalendarCheck2,
} from 'lucide-react';

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  backgroundColor: string;
  borderColor: string;
  extendedProps?: {
    type: 'external' | 'task';
    taskId?: number;
    urgency?: number;
    importance?: number;
    duration?: number;
    status?: string;
    deadline?: string;
    notes?: string;
  };
}

export const CalendarView: React.FC = () => {
  const { user } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'week' | 'day'>('week');
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const res = await api.get('/calendar/events');
      setEvents(res.data.events);
    } catch (err) {
      console.error('Failed to fetch events:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const getWeekDates = (date: Date) => {
    const start = new Date(date);
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Monday start
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);

    const week = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      week.push(d);
    }
    return week;
  };

  const weekDays = getWeekDates(currentDate);

  const nextPeriod = () => {
    const d = new Date(currentDate);
    if (viewMode === 'week') d.setDate(d.getDate() + 7);
    else d.setDate(d.getDate() + 1);
    setCurrentDate(d);
  };

  const prevPeriod = () => {
    const d = new Date(currentDate);
    if (viewMode === 'week') d.setDate(d.getDate() - 7);
    else d.setDate(d.getDate() - 1);
    setCurrentDate(d);
  };

  const today = () => setCurrentDate(new Date());

  const subUrl = `${window.location.origin}/api/calendar/subscribe/${user?.token_secret}.ics`;
  const webcalUrl = subUrl.replace(/^https?:/, 'webcal:');

  const copySubLink = () => {
    navigator.clipboard.writeText(webcalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getEventsForDay = (day: Date) => {
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    return events.filter((ev) => {
      const evStart = new Date(ev.start);
      const evEnd = new Date(ev.end);
      return evStart < dayEnd && evEnd > dayStart;
    });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5 sm:space-y-6">
      {/* Top Banner (Google Tasks Card) */}
      <div className="bg-blue-50/80 dark:bg-[#1e2a38]/60 border border-blue-200/80 dark:border-blue-900/60 rounded-3xl p-5 sm:p-6 text-gray-900 dark:text-gray-100 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center">
              <CalendarCheck2 className="w-4 h-4" />
            </div>
            <h2 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100">
              专用 TODO 订阅日历
            </h2>
          </div>
          <p className="text-xs text-gray-600 dark:text-neutral-400">
            支持一键导入 Apple 日历、Google Calendar、Outlook 等客户端，动态实时排程更新。
          </p>
        </div>

        <div className="flex items-center gap-2 bg-white/90 dark:bg-[#131314]/90 p-1.5 rounded-full border border-blue-200/60 dark:border-blue-900/60 max-w-full">
          <span className="text-xs font-mono text-gray-600 dark:text-neutral-300 px-3 truncate max-w-[200px] sm:max-w-[280px]">
            {webcalUrl}
          </span>
          <button
            onClick={copySubLink}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full text-xs font-medium shadow-xs transition shrink-0 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? '已复制' : '复制订阅链接'}</span>
          </button>
        </div>
      </div>

      {/* Control Header */}
      <div className="bg-white dark:bg-[#1e1f20] rounded-3xl p-4 sm:p-5 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs flex flex-wrap items-center justify-between gap-3 transition-colors">
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-gray-100 dark:bg-neutral-800 rounded-full p-1 border border-gray-200/60 dark:border-neutral-700/60">
            <button
              onClick={prevPeriod}
              className="p-1.5 hover:bg-white dark:hover:bg-neutral-700 rounded-full text-gray-600 dark:text-neutral-300 transition"
              title="上一周期"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={today}
              className="px-3 py-1 text-xs font-medium text-gray-700 dark:text-neutral-200 hover:bg-white dark:hover:bg-neutral-700 rounded-full transition"
            >
              今天
            </button>
            <button
              onClick={nextPeriod}
              className="p-1.5 hover:bg-white dark:hover:bg-neutral-700 rounded-full text-gray-600 dark:text-neutral-300 transition"
              title="下一周期"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <h3 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100">
            {currentDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}
          </h3>
        </div>

        {/* Legend */}
        <div className="hidden lg:flex items-center gap-4 text-xs text-gray-500 dark:text-neutral-400">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-500"></span>
            <span>外部已有日程</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
            <span>Clawbot 规划待办</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
            <span>特急待办</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <span>已完成待办</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Switcher */}
          <div className="flex bg-gray-100 dark:bg-neutral-800 p-1 rounded-full border border-gray-200/60 dark:border-neutral-700/60 text-xs font-medium">
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1 rounded-full transition ${
                viewMode === 'week'
                  ? 'bg-white dark:bg-neutral-700 text-blue-600 dark:text-blue-400 font-semibold shadow-xs'
                  : 'text-gray-600 dark:text-neutral-400'
              }`}
            >
              周视图
            </button>
            <button
              onClick={() => setViewMode('day')}
              className={`px-3 py-1 rounded-full transition ${
                viewMode === 'day'
                  ? 'bg-white dark:bg-neutral-700 text-blue-600 dark:text-blue-400 font-semibold shadow-xs'
                  : 'text-gray-600 dark:text-neutral-400'
              }`}
            >
              日视图
            </button>
          </div>

          <button
            onClick={fetchEvents}
            disabled={loading}
            className="p-2 text-gray-500 dark:text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-full border border-gray-200 dark:border-neutral-700 transition"
            title="刷新日程"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Schedule Calendar Grid (Google Material 3 Container) */}
      <div className="bg-white dark:bg-[#1e1f20] rounded-3xl border border-gray-200/80 dark:border-neutral-800/80 shadow-xs overflow-hidden transition-colors">
        {/* Days Header */}
        <div className={`grid ${viewMode === 'week' ? 'grid-cols-7' : 'grid-cols-1'} border-b border-gray-200 dark:border-neutral-800 bg-gray-50/70 dark:bg-[#28292a]/50`}>
          {(viewMode === 'week' ? weekDays : [currentDate]).map((d, idx) => {
            const isToday = d.toDateString() === new Date().toDateString();
            return (
              <div
                key={idx}
                className={`p-2.5 sm:p-3 text-center border-r border-gray-200 dark:border-neutral-800 last:border-r-0 ${
                  isToday ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''
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

        {/* Event List by Days */}
        <div
          className={`grid ${
            viewMode === 'week' ? 'grid-cols-1 md:grid-cols-7' : 'grid-cols-1'
          } min-h-[440px] divide-y md:divide-y-0 md:divide-x divide-gray-200 dark:divide-neutral-800`}
        >
          {(viewMode === 'week' ? weekDays : [currentDate]).map((day, dIdx) => {
            const dayEvents = getEventsForDay(day).sort(
              (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
            );

            return (
              <div key={dIdx} className="p-2 space-y-2 bg-gray-50/20 dark:bg-[#1e1f20]/20">
                {dayEvents.length === 0 ? (
                  <div className="h-28 flex flex-col items-center justify-center text-gray-400 dark:text-neutral-600 text-xs">
                    <span>无事件</span>
                  </div>
                ) : (
                  dayEvents.map((ev) => {
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
                    const isTask = ev.extendedProps?.type === 'task';

                    return (
                      <div
                        key={ev.id}
                        onClick={() => setSelectedEvent(ev)}
                        className="p-2.5 rounded-2xl text-white text-xs shadow-xs cursor-pointer hover:opacity-90 hover:scale-[1.01] transition space-y-1"
                        style={{ backgroundColor: ev.backgroundColor }}
                      >
                        <div className="font-medium line-clamp-2 leading-snug">{ev.title}</div>
                        <div className="flex items-center gap-1 opacity-90 text-[10px]">
                          <Clock className="w-3 h-3 shrink-0" />
                          <span>
                            {s} ~ {e}
                          </span>
                        </div>
                        {isTask && (
                          <div className="flex items-center gap-1.5 pt-1 text-[10px] opacity-80 border-t border-white/20">
                            <span>⚡紧急 {ev.extendedProps?.urgency}/5</span>
                            <span>⭐重要 {ev.extendedProps?.importance}/5</span>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Event Detail Modal (Google Tasks Surface Dialog) */}
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
                className="w-7 h-7 rounded-full text-gray-400 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 flex items-center justify-center text-sm font-bold transition"
              >
                ✕
              </button>
            </div>

            <div className="bg-gray-50 dark:bg-[#28292a] rounded-2xl p-4 space-y-2 text-xs text-gray-600 dark:text-neutral-300">
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
