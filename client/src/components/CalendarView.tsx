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

  // Compute Week Days
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

  // Filter events for a specific day
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
    <div className="space-y-6">
      {/* Top Banner: Dedicated iCal Subscription */}
      <div className="bg-gradient-to-r from-indigo-900 to-indigo-800 rounded-2xl p-5 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-indigo-500/30 rounded-lg">
              <CalendarCheck2 className="w-5 h-5 text-indigo-300" />
            </span>
            <h2 className="text-base font-bold">专用 TODO 订阅日历 (实时同步)</h2>
          </div>
          <p className="text-xs text-indigo-200">
            支持一键导入 Apple 日历、Google Calendar、Outlook 等客户端，自动随规划动态更新。
          </p>
        </div>

        <div className="flex items-center gap-2 bg-indigo-950/60 p-1.5 rounded-xl border border-indigo-700/50">
          <span className="text-xs font-mono text-indigo-200 px-2 truncate max-w-[280px]">
            {webcalUrl}
          </span>
          <button
            onClick={copySubLink}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow transition shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? '已复制' : '复制订阅链接'}</span>
          </button>
        </div>
      </div>

      {/* Control Header */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-100 rounded-xl p-1 border border-slate-200">
            <button
              onClick={prevPeriod}
              className="p-1.5 hover:bg-white rounded-lg text-slate-600 transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={today}
              className="px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-white rounded-lg transition"
            >
              今天
            </button>
            <button
              onClick={nextPeriod}
              className="p-1.5 hover:bg-white rounded-lg text-slate-600 transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <h3 className="text-base font-bold text-slate-800">
            {currentDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}
          </h3>
        </div>

        {/* Legend */}
        <div className="hidden lg:flex items-center gap-4 text-xs font-medium text-slate-500">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-slate-500"></span>
            <span>外部已有日程</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-blue-500"></span>
            <span>Clawbot 规划待办</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-rose-500"></span>
            <span>高紧急待办</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
            <span>已完成待办</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-medium">
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1 rounded-lg transition ${
                viewMode === 'week' ? 'bg-white text-indigo-700 font-bold shadow-xs' : 'text-slate-600'
              }`}
            >
              周视图
            </button>
            <button
              onClick={() => setViewMode('day')}
              className={`px-3 py-1 rounded-lg transition ${
                viewMode === 'day' ? 'bg-white text-indigo-700 font-bold shadow-xs' : 'text-slate-600'
              }`}
            >
              日视图
            </button>
          </div>

          <button
            onClick={fetchEvents}
            disabled={loading}
            className="p-2 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl border border-slate-200 transition"
            title="刷新日程"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Schedule Calendar Grid */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Days Header */}
        <div className={`grid ${viewMode === 'week' ? 'grid-cols-7' : 'grid-cols-1'} border-b border-slate-200 bg-slate-50/70`}>
          {(viewMode === 'week' ? weekDays : [currentDate]).map((d, idx) => {
            const isToday = d.toDateString() === new Date().toDateString();
            return (
              <div
                key={idx}
                className={`p-3 text-center border-r border-slate-200 last:border-r-0 ${
                  isToday ? 'bg-indigo-50/50' : ''
                }`}
              >
                <div className="text-xs text-slate-500">
                  {d.toLocaleDateString('zh-CN', { weekday: 'short' })}
                </div>
                <div
                  className={`text-sm font-bold mt-0.5 inline-block w-7 h-7 rounded-full leading-7 ${
                    isToday ? 'bg-indigo-600 text-white' : 'text-slate-800'
                  }`}
                >
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Event List by Days */}
        <div className={`grid ${viewMode === 'week' ? 'grid-cols-1 md:grid-cols-7' : 'grid-cols-1'} min-h-[500px] divide-y md:divide-y-0 md:divide-x divide-slate-200`}>
          {(viewMode === 'week' ? weekDays : [currentDate]).map((day, dIdx) => {
            const dayEvents = getEventsForDay(day).sort(
              (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
            );

            return (
              <div key={dIdx} className="p-2 space-y-2 bg-slate-50/20">
                {dayEvents.length === 0 ? (
                  <div className="h-32 flex flex-col items-center justify-center text-slate-400 text-xs">
                    <span>无事件安排</span>
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
                        className="p-2.5 rounded-xl text-white text-xs shadow-xs cursor-pointer hover:opacity-90 hover:scale-[1.01] transition space-y-1"
                        style={{ backgroundColor: ev.backgroundColor }}
                      >
                        <div className="font-semibold line-clamp-2">{ev.title}</div>
                        <div className="flex items-center gap-1 opacity-90 text-[11px]">
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

      {/* Event Detail Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <span
                  className="inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded-full text-white"
                  style={{ backgroundColor: selectedEvent.backgroundColor }}
                >
                  {selectedEvent.extendedProps?.type === 'external' ? '外部日历日程' : 'Clawbot 规划待办'}
                </span>
                <h4 className="text-base font-bold text-slate-900">{selectedEvent.title}</h4>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-50 rounded-xl p-3 space-y-2 text-xs text-slate-600">
              <div className="flex justify-between">
                <span className="text-slate-400">开始时间：</span>
                <span className="font-semibold text-slate-800">
                  {new Date(selectedEvent.start).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">结束时间：</span>
                <span className="font-semibold text-slate-800">
                  {new Date(selectedEvent.end).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
                </span>
              </div>
              {selectedEvent.extendedProps?.type === 'task' && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-400">预估耗时：</span>
                    <span className="font-semibold text-slate-800">
                      {selectedEvent.extendedProps.duration} 分钟
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">紧急程度 / 重要程度：</span>
                    <span className="font-semibold text-indigo-600">
                      紧急 {selectedEvent.extendedProps.urgency}/5 · 重要 {selectedEvent.extendedProps.importance}/5
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">任务状态：</span>
                    <span className="font-semibold uppercase text-emerald-600">
                      {selectedEvent.extendedProps.status}
                    </span>
                  </div>
                  {selectedEvent.extendedProps.deadline && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">截止 DDL：</span>
                      <span className="font-semibold text-rose-600">
                        {new Date(selectedEvent.extendedProps.deadline).toLocaleString('zh-CN')}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            <button
              onClick={() => setSelectedEvent(null)}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
