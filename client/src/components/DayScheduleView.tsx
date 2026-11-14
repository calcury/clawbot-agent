import React, { useState, useMemo, useEffect } from 'react';
import { formatLocalDate } from '../types/task';
import type { TaskItem } from '../types/task';
import type { CalendarEvent } from '../types/calendar';
import { generateDaySchedule, computeTimelineLayout } from '../utils/calendarScheduler';
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar, 
  Clock, 
  RefreshCw, 
  Link2, 
  Check, 
  Sliders, 
  MapPin,
  Lock,
  CalendarCheck2,
  AlertTriangle,
  Coffee
} from 'lucide-react';

interface DayScheduleViewProps {
  tasks: TaskItem[];
  fixedEvents: CalendarEvent[];
  subscriptionUrl: string;
  onUpdateSubscriptionUrl: (url: string) => Promise<void>;
  onSyncCalendar: () => Promise<void>;
  isSyncing: boolean;
  syncError: string | null;
  onToggleCompleteTask: (taskId: string, dateStr: string) => void;
  onEditTask: (task: TaskItem) => void;
}

export const DayScheduleView: React.FC<DayScheduleViewProps> = ({
  tasks,
  fixedEvents,
  subscriptionUrl,
  onUpdateSubscriptionUrl,
  onSyncCalendar,
  isSyncing,
  syncError,
  onToggleCompleteTask,
  onEditTask,
}) => {
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  });

  const [isUrlModalOpen, setIsUrlModalOpen] = useState(false);
  const [urlInput, setUrlInput] = useState(subscriptionUrl);
  const [allowSplit, setAllowSplit] = useState(true);

  // 动态检测当天日程最早与最晚时间，自适应视图时段（默认 08:00 ~ 22:00，存在更早课程或更晚实验时智能延伸）
  const { effectiveStartHour, effectiveEndHour } = useMemo(() => {
    let startH = 8.0;
    let endH = 22.0;

    const dayStart = new Date(selectedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(selectedDate);
    dayEnd.setHours(23, 59, 59, 999);

    const dayEvents = fixedEvents.filter(
      (e) => !e.isAllDay && e.start < dayEnd && e.end > dayStart
    );

    for (const ev of dayEvents) {
      const sH = ev.start.getHours() + ev.start.getMinutes() / 60;
      const eH = ev.end.getHours() + ev.end.getMinutes() / 60;
      if (sH < startH) {
        startH = Math.max(6.0, Math.floor(sH));
      }
      if (eH > endH) {
        endH = Math.min(24.0, Math.ceil(eH));
      }
    }

    return { effectiveStartHour: startH, effectiveEndHour: endH };
  }, [selectedDate, fixedEvents]);

  const totalWorkHours = effectiveEndHour - effectiveStartHour;

  // 日期跳转控制
  const handlePrevDay = () => {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() - 1);
      return next;
    });
  };

  const handleNextDay = () => {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + 1);
      return next;
    });
  };

  const [nowTime, setNowTime] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const handleToday = () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    setSelectedDate(now);
  };

  // 生成当天自动排程（结合当前时间基线约束与多日滚动顺延）
  const schedulePlan = useMemo(() => {
    return generateDaySchedule(tasks, fixedEvents, {
      targetDate: selectedDate,
      workStartHour: effectiveStartHour,
      workEndHour: effectiveEndHour,
      allowSplit,
    });
  }, [tasks, fixedEvents, selectedDate, effectiveStartHour, effectiveEndHour, allowSplit, nowTime]);

  // 扫描线 + 区间图着色分栏算法：统一计算固定日程、休息区与排程任务的水平分栏坐标，杜绝任何重叠遮挡
  const timelineLayoutMap = useMemo(() => {
    const allVisualItems = [
      ...schedulePlan.fixedEvents.map((e) => ({ id: `fixed-${e.id}`, start: e.start, end: e.end })),
      ...schedulePlan.restBlocks.map((r) => ({ id: `rest-${r.id}`, start: r.start, end: r.end })),
      ...schedulePlan.scheduledTasks.map((b) => ({ id: `task-${b.id}`, start: b.start, end: b.end })),
    ];
    return computeTimelineLayout(allVisualItems, 18);
  }, [schedulePlan]);

  // 格式化日期标题
  const formattedDate = useMemo(() => {
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const y = selectedDate.getFullYear();
    const m = selectedDate.getMonth() + 1;
    const d = selectedDate.getDate();
    const w = weekdays[selectedDate.getDay()];
    return `${y}年${m}月${d}日 ${w}`;
  }, [selectedDate]);

  // 严格像素级时钟比例尺（每小时 88px），保证短任务块也有充裕的文字呼吸空间
  const HOUR_HEIGHT = 88;
  const totalHeight = useMemo(() => totalWorkHours * HOUR_HEIGHT, [totalWorkHours]);

  const isViewingToday = schedulePlan.dateStr === formatLocalDate(nowTime);
  const currentTimeHourVal =
    nowTime.getHours() + nowTime.getMinutes() / 60 + nowTime.getSeconds() / 3600;
  const showCurrentTimeLine =
    isViewingToday &&
    currentTimeHourVal >= effectiveStartHour &&
    currentTimeHourVal <= effectiveEndHour;
  const currentTimeTopPx = (currentTimeHourVal - effectiveStartHour) * HOUR_HEIGHT;

  // 精确计算指定时间相对于时段起点与终点的 Top 像素与高度像素 (严格 1:1 对齐，杜绝错位与重叠)
  const getTimePosition = (start: Date, end: Date) => {
    const startHourVal = start.getHours() + start.getMinutes() / 60 + start.getSeconds() / 3600;
    const endHourVal = end.getHours() + end.getMinutes() / 60 + end.getSeconds() / 3600;

    const clampedStart = Math.max(effectiveStartHour, Math.min(effectiveEndHour, startHourVal));
    const clampedEnd = Math.max(effectiveStartHour, Math.min(effectiveEndHour, endHourVal));

    const startMinutes = (clampedStart - effectiveStartHour) * 60;
    const endMinutes = (clampedEnd - effectiveStartHour) * 60;
    const durationMinutes = Math.max(1, endMinutes - startMinutes);

    const topPx = (startMinutes / 60) * HOUR_HEIGHT;
    // 最小视觉高度 22px，留出 2px 下边距，保证紧邻事件绝不重叠贴合覆盖
    const heightPx = Math.max(22, (durationMinutes / 60) * HOUR_HEIGHT - 2);

    return { topPx, heightPx, durationMinutes: Math.round(durationMinutes) };
  };

  const formatClockTime = (date: Date) => {
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  };

  // 保存订阅链接
  const handleSaveUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateSubscriptionUrl(urlInput.trim());
    setIsUrlModalOpen(false);
  };

  // 生成整点刻度
  const hoursRuler = useMemo(() => {
    const list: number[] = [];
    for (let h = Math.floor(effectiveStartHour); h <= Math.ceil(effectiveEndHour); h++) {
      list.push(h);
    }
    return list;
  }, [effectiveStartHour, effectiveEndHour]);

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-[#1e1f20] rounded-2xl border border-gray-200/80 dark:border-neutral-800/80 shadow-xs overflow-hidden">
      {/* 顶部工具栏与日期导航 */}
      <div className="px-5 py-3.5 border-b border-gray-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3 bg-gray-50/50 dark:bg-[#1e1f20]/50">
        {/* 日期选择器 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrevDay}
            className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-100 dark:border-neutral-700 dark:bg-[#28292a] dark:hover:bg-neutral-700 text-gray-600 dark:text-neutral-300 transition-colors"
            title="前一天"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleToday}
            className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-100 dark:border-neutral-700 dark:bg-[#28292a] dark:hover:bg-neutral-700 text-xs font-semibold text-gray-700 dark:text-neutral-300 transition-colors"
          >
            今天
          </button>
          <button
            type="button"
            onClick={handleNextDay}
            className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-100 dark:border-neutral-700 dark:bg-[#28292a] dark:hover:bg-neutral-700 text-gray-600 dark:text-neutral-300 transition-colors"
            title="后一天"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <div className="ml-2 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="font-bold text-sm text-gray-900 dark:text-gray-100">
              {formattedDate}
            </span>
          </div>
        </div>

        {/* 订阅状态与排程统计 */}
        <div className="flex items-center gap-2">
          {/* 日历订阅源状态按钮 */}
          <button
            type="button"
            onClick={() => {
              setUrlInput(subscriptionUrl);
              setIsUrlModalOpen(true);
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
              subscriptionUrl
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
            }`}
          >
            <Link2 className="h-3.5 w-3.5" />
            <span>{subscriptionUrl ? '已绑定日历订阅' : '添加日历订阅链接'}</span>
          </button>

          {/* 手动刷新同步 */}
          {subscriptionUrl && (
            <button
              type="button"
              onClick={onSyncCalendar}
              disabled={isSyncing}
              className="p-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-100 dark:border-neutral-700 dark:bg-[#28292a] dark:hover:bg-neutral-700 text-gray-600 dark:text-neutral-300 disabled:opacity-40 transition-colors"
              title="拉取最新日历事件"
            >
              <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin text-blue-600' : ''}`} />
            </button>
          )}

          {/* 拆分配置开关 */}
          <button
            type="button"
            onClick={() => setAllowSplit(!allowSplit)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
              allowSplit
                ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/40 dark:border-blue-900 dark:text-blue-300'
                : 'bg-gray-100 border-gray-200 text-gray-600 dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-400'
            }`}
            title="当任务耗时大于空闲段时，是否允许自动切分成多段"
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>长任务拆分: {allowSplit ? '开启' : '关闭'}</span>
          </button>
        </div>
      </div>

      {/* 错误提示横幅 (若有) */}
      {syncError && (
        <div className="px-5 py-2 bg-rose-50 border-b border-rose-200 text-rose-700 dark:bg-rose-950/60 dark:border-rose-900 dark:text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>日历同步提示: {syncError}</span>
          </div>
          <button
            type="button"
            onClick={() => setIsUrlModalOpen(true)}
            className="underline font-semibold hover:text-rose-800 ml-4"
          >
            检查链接
          </button>
        </div>
      )}

      {/* 统计指标浮动条 */}
      <div className="px-5 py-2 border-b border-slate-100 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/80 flex flex-wrap items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-500" />
            <span>既定日程: {Math.round((schedulePlan.stats.totalBusyMinutes / 60) * 10) / 10}h</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span>Break Time: {Math.round((schedulePlan.stats.totalRestMinutes / 60) * 10) / 10}h</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-indigo-500" />
            <span>已排专注: {Math.round((schedulePlan.stats.totalScheduledMinutes / 60) * 10) / 10}h / 5.5h 上限</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-sky-500" />
            <span>弹性留白: {Math.round((schedulePlan.stats.totalFreeMinutes / 60) * 10) / 10}h</span>
          </span>
        </div>

        <div className="text-[11px] text-slate-400">
          智能排程：黄金深度区优先 Q1/Q2 · 碎片/午后填补 Q3 · 60m 节律切分
        </div>
      </div>

      {/* 主视图区域：时间轴日视图 */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* 单一协同滚动容器：保证左侧时间标尺与右侧事件画布绝对严格对齐、杜绝滚动脱节 */}
        <div className="flex-1 min-h-0 overflow-y-auto relative bg-slate-50/20 dark:bg-slate-950/20">
          <div 
            className="relative flex min-w-[650px]"
            style={{ height: `${totalHeight}px` }}
          >
            {/* 左侧整点标尺 */}
            <div className="w-16 shrink-0 border-r border-slate-200 dark:border-slate-800 select-none bg-slate-50/50 dark:bg-slate-900/50 relative">
              {hoursRuler.map((hour) => {
                const topPx = (hour - effectiveStartHour) * HOUR_HEIGHT;
                return (
                  <div
                    key={hour}
                    style={{ top: `${topPx}px` }}
                    className="absolute right-2 -translate-y-1/2 text-[11px] font-mono text-slate-400 dark:text-slate-500 pointer-events-none"
                  >
                    {hour.toString().padStart(2, '0')}:00
                  </div>
                );
              })}
            </div>

            {/* 右侧时间轴网格画布 */}
            <div className="flex-1 relative">
              {/* 整点水平参考虚线（与左侧标尺文本 100% 居中平齐） */}
              {hoursRuler.map((hour) => {
                const topPx = (hour - effectiveStartHour) * HOUR_HEIGHT;
                return (
                  <div
                    key={hour}
                    style={{ top: `${topPx}px` }}
                    className="absolute left-0 right-0 border-b border-dashed border-slate-200/60 dark:border-slate-800/60 pointer-events-none"
                  />
                );
              })}

              {/* 实时当前时间指示红线 (仅在查看今天且处于工作时段内展示) */}
              {showCurrentTimeLine && (
                <div
                  style={{ top: `${currentTimeTopPx}px` }}
                  className="absolute left-0 right-0 z-30 flex items-center pointer-events-none -translate-y-1/2"
                >
                  <div className="h-2.5 w-2.5 rounded-full bg-rose-500 -ml-1.25 ring-2 ring-white dark:ring-slate-900 shadow-xs" />
                  <div className="flex-1 border-t-2 border-rose-500/80" />
                  <span className="ml-1.5 mr-2 px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-mono font-bold shadow-xs">
                    当前 {formatClockTime(nowTime)}
                  </span>
                </div>
              )}

              {/* 1. 外部订阅日历固定事件 (不可动区间，支持扫描线分栏排版) */}
              {schedulePlan.fixedEvents.map((ev) => {
                const { topPx, heightPx } = getTimePosition(ev.start, ev.end);
                const layout = timelineLayoutMap.get(`fixed-${ev.id}`);
                const leftPct = layout ? layout.leftPercent : 1.5;
                const widthPct = layout ? layout.widthPercent : 97;
                const isSingleLine = heightPx < 40;

                return (
                  <div
                    key={ev.id}
                    style={{
                      top: `${topPx}px`,
                      height: `${heightPx}px`,
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                    }}
                    className={`absolute z-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-200/85 dark:bg-slate-800/90 text-slate-800 dark:text-slate-200 shadow-2xs overflow-hidden backdrop-blur-2xs transition-all ${
                      isSingleLine ? 'px-2.5 py-0.5 text-[11px] flex items-center justify-between' : 'px-3 py-2 text-xs'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5 w-full">
                      <div className="flex items-center gap-1.5 font-bold truncate">
                        <Lock className="h-3 w-3 text-slate-500 shrink-0" />
                        <span className="truncate">{ev.title}</span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 shrink-0">
                        {formatClockTime(ev.start)} - {formatClockTime(ev.end)}
                      </span>
                    </div>

                    {!isSingleLine && ev.location && (
                      <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500 truncate">
                        <MapPin className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">{ev.location}</span>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 2. 生理节律午晚餐休息区（已剥离 10m 细碎卡片，仅保留舒适的午休/晚休段） */}
              {schedulePlan.restBlocks.map((rest) => {
                const { topPx, heightPx } = getTimePosition(rest.start, rest.end);
                const layout = timelineLayoutMap.get(`rest-${rest.id}`);
                const leftPct = layout ? layout.leftPercent : 1.5;
                const widthPct = layout ? layout.widthPercent : 97;
                const isSingleLine = heightPx < 36;

                return (
                  <div
                    key={rest.id}
                    style={{
                      top: `${topPx}px`,
                      height: `${heightPx}px`,
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                    }}
                    className={`absolute z-10 rounded-xl border border-dashed border-slate-300/90 dark:border-slate-700 bg-slate-100/75 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 overflow-hidden backdrop-blur-2xs flex items-center justify-between transition-all hover:bg-slate-100 dark:hover:bg-slate-800/80 ${
                      isSingleLine ? 'px-2.5 py-0.5 text-[11px]' : 'px-3 py-2 text-xs'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate font-medium text-slate-600 dark:text-slate-300">
                      <Coffee className="h-3.5 w-3.5 text-amber-600/80 dark:text-amber-400/80 shrink-0" />
                      <span className="truncate">{rest.title}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 text-[10px] font-mono text-slate-400 dark:text-slate-500">
                      <span>{formatClockTime(rest.start)} - {formatClockTime(rest.end)}</span>
                      <span>({rest.durationMinutes}m)</span>
                    </div>
                  </div>
                );
              })}

              {/* 3. 算法自动填入的四象限任务块（支持分栏布局、三档高度自适应与内联微休息徽标） */}
              {schedulePlan.scheduledTasks.map((block) => {
                const { topPx, heightPx } = getTimePosition(block.start, block.end);
                const originalTask = tasks.find((t) => t.id === block.taskId);
                const layout = timelineLayoutMap.get(`task-${block.id}`);
                const leftPct = layout ? layout.leftPercent : 1.5;
                const widthPct = layout ? layout.widthPercent : 97;

                // 三档视觉高度自适应：避免短时任务块两行文字被截断
                const isSingleLine = heightPx < 42;
                const isMediumHeight = heightPx >= 42 && heightPx < 58;

                // 象限视觉主题
                const qStyles = {
                  q1: 'bg-rose-500/15 border-rose-400 text-rose-900 dark:bg-rose-950/50 dark:border-rose-700 dark:text-rose-200',
                  q2: 'bg-blue-500/15 border-blue-400 text-blue-900 dark:bg-blue-950/50 dark:border-blue-700 dark:text-blue-200',
                  q3: 'bg-amber-500/15 border-amber-400 text-amber-900 dark:bg-amber-950/50 dark:border-amber-700 dark:text-amber-200',
                  q4: 'bg-slate-500/15 border-slate-400 text-slate-900 dark:bg-slate-900/50 dark:border-slate-700 dark:text-slate-200',
                }[block.quadrant];

                return (
                  <div
                    key={block.id}
                    style={{
                      top: `${topPx}px`,
                      height: `${heightPx}px`,
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                    }}
                    className={`absolute z-20 rounded-xl border shadow-xs transition-all duration-150 hover:z-30 hover:shadow-md overflow-hidden ${qStyles} ${
                      isSingleLine
                        ? 'px-2.5 py-0.5 text-[11px] flex items-center justify-between'
                        : isMediumHeight
                        ? 'px-2.5 py-1 text-xs flex flex-col justify-center'
                        : 'px-3 py-2 text-xs'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5 w-full">
                      <div className="flex items-center gap-1.5 truncate">
                        {/* 完成状态勾选 */}
                        <button
                          type="button"
                          onClick={() => onToggleCompleteTask(block.taskId, schedulePlan.dateStr)}
                          title={
                            block.isCompleted
                              ? block.isFinalCompleted
                                ? '任务已彻底完成（点击取消）'
                                : '当天目标已完成（点击取消）'
                              : block.isLastDay
                              ? '今天是任务最后一天：勾选将直接标记任务彻底完成'
                              : '勾选仅标记当天目标完成'
                          }
                          className={`h-4 w-4 rounded flex items-center justify-center border shrink-0 transition-colors ${
                            block.isCompleted
                              ? 'bg-emerald-500 border-emerald-500 text-white'
                              : 'border-slate-400 bg-white/70 dark:bg-slate-800'
                          }`}
                        >
                          {block.isCompleted && <Check className="h-3 w-3 stroke-[2.5]" />}
                        </button>

                        <span
                          onClick={() => originalTask && onEditTask(originalTask)}
                          className={`font-bold truncate cursor-pointer hover:underline ${
                            block.isCompleted ? 'line-through opacity-60' : ''
                          }`}
                          title={block.title}
                        >
                          {block.title}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 text-[10px] font-mono">
                        {isSingleLine && block.isCompleted && (
                          <span className="px-1 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-sans font-semibold">
                            {block.isFinalCompleted ? '已彻底完成' : '今日完成'}
                          </span>
                        )}
                        <span>{formatClockTime(block.start)} - {formatClockTime(block.end)}</span>
                        <span className="opacity-75">({block.durationMinutes}m)</span>
                      </div>
                    </div>

                    {/* 状态徽标与象限指引 */}
                    {!isSingleLine && (
                      <div className={`${isMediumHeight ? 'mt-0.5' : 'mt-1'} flex items-center gap-1.5 text-[10px] opacity-85 flex-wrap truncate`}>
                        <span className="font-semibold uppercase tracking-wider">
                          {block.quadrant.toUpperCase()}
                        </span>
                        {block.isCompleted ? (
                          <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 font-semibold">
                            {block.isFinalCompleted ? '✓ 任务已彻底完成' : '✓ 当天目标已完成'}
                          </span>
                        ) : (
                          block.isLastDay && (
                            <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-800 dark:text-rose-200 font-semibold">
                              最后一天
                            </span>
                          )
                        )}
                        {block.strategyLabel && (
                          <span className="px-1.5 py-0.2 rounded bg-black/10 dark:bg-white/10 font-medium">
                            {block.strategyLabel}
                          </span>
                        )}
                        {block.isSplit && (
                          <span className="px-1 rounded bg-black/10 dark:bg-white/10 font-mono">
                            第 {block.partIndex}/{block.totalParts} 节
                          </span>
                        )}
                        {block.breakAfterMinutes && (
                          <span className="px-1.5 py-0.2 rounded bg-black/5 dark:bg-white/5 text-slate-600 dark:text-slate-300 font-medium">
                            +{block.breakAfterMinutes}m 缓冲休息
                          </span>
                        )}
                        <span>分值: ({block.urgency.toFixed(1)}, {block.importance.toFixed(1)})</span>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 空状态引导 */}
              {schedulePlan.fixedEvents.length === 0 && schedulePlan.scheduledTasks.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 text-slate-400 pointer-events-none">
                  <CalendarCheck2 className="h-10 w-10 mb-2 stroke-[1.5] text-slate-300 dark:text-slate-600" />
                  <p className="text-xs font-semibold">当天工作时段无会议日程与待办排程</p>
                  <p className="text-[11px] mt-1 text-slate-400 max-w-sm">
                    在侧边栏新建四象限事项，或点击上方绑定日历订阅链接，算法将自动为你编排全天行程！
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 右侧抽屉：未排入事项提醒 (若存在) */}
        {schedulePlan.unscheduledTasks.length > 0 && (
          <div className="w-64 border-l border-slate-200 dark:border-slate-800 p-4 overflow-y-auto hidden lg:block bg-slate-50/30 dark:bg-slate-900/30">
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-amber-500" />
              <span>未排入今日日程 ({schedulePlan.unscheduledTasks.length})</span>
            </h3>
            <p className="text-[10px] text-slate-400 mb-3">
              基于精力负荷保护（5.5h 上限）、防切碎规则与 Q4 自动过滤策略暂缓排入：
            </p>
            <div className="space-y-2">
              {schedulePlan.unscheduledTasks.map((item) => (
                <div
                  key={item.taskId}
                  className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs shadow-2xs"
                >
                  <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {item.title}
                  </div>
                  <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                    {item.reason}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 订阅链接配置弹窗 */}
      {isUrlModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-800 shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Link2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>设置日历订阅链接 (WebCal / ICS)</span>
            </h3>

            <p className="text-xs text-gray-500 dark:text-neutral-400 leading-relaxed">
              输入你的外部日历（Google Calendar、Outlook、Apple 日历、飞书/钉钉等）的公共或私有 <code>.ics</code> / <code>webcal://</code> 订阅链接。
            </p>

            <form onSubmit={handleSaveUrl} className="space-y-3">
              <textarea
                rows={3}
                required
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="例如：webcal://p69-caldav.icloud.com/.../basic.ics 或 https://calendar.google.com/..."
                className="w-full rounded-xl border border-gray-300 dark:border-neutral-700 bg-white dark:bg-[#28292a] p-2.5 text-xs text-gray-900 dark:text-gray-100 font-mono focus:border-blue-500 focus:outline-none"
              />

              <div className="flex items-center justify-between pt-2">
                {subscriptionUrl && (
                  <button
                    type="button"
                    onClick={async () => {
                      await onUpdateSubscriptionUrl('');
                      setUrlInput('');
                      setIsUrlModalOpen(false);
                    }}
                    className="text-xs text-rose-600 hover:underline cursor-pointer"
                  >
                    解除当前订阅
                  </button>
                )}
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setIsUrlModalOpen(false)}
                    className="px-4 py-1.5 rounded-full text-xs font-semibold text-gray-600 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-neutral-800 cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-1.5 rounded-full text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-xs cursor-pointer"
                  >
                    保存并立即拉取
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
