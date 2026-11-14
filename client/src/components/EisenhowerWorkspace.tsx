import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { TaskItem, TaskFilterOptions, QuadrantId } from '../types/task';
import type { CalendarEvent } from '../types/calendar';
import { calculateQuadrant, formatLocalDate } from '../types/task';
import { calculateDynamicUrgency } from '../utils/priorityAlgorithm';
import { useTheme } from '../context/ThemeContext';
import { api } from '../api/client';
import { Sidebar } from './EisenhowerSidebar';
import { MatrixBoard } from './MatrixBoard';
import { DayScheduleView } from './DayScheduleView';
import { TaskModal } from './TaskModal';
import { WizardModal } from './WizardModal';
import { StatsModal } from './StatsModal';
import { BackupModal } from './BackupModal';
import {
  LayoutGrid,
  CalendarDays,
  Plus,
} from 'lucide-react';

interface EisenhowerWorkspaceProps {
  activeView: 'matrix' | 'calendar';
  onSelectView: (view: 'matrix' | 'calendar') => void;
}

export const EisenhowerWorkspace: React.FC<EisenhowerWorkspaceProps> = ({
  activeView,
  onSelectView,
}) => {
  const { isDark, setThemeMode } = useTheme();

  // 任务数据与加载状态
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [fixedEvents, setFixedEvents] = useState<CalendarEvent[]>([]);
  const [subscriptionUrl, setSubscriptionUrl] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // 侧边栏折叠状态
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return window.innerWidth < 1024;
  });

  // 筛选与搜索
  const [filterOptions, setFilterOptions] = useState<TaskFilterOptions>({
    searchQuery: '',
    tag: null,
    status: 'all',
  });

  // 模态框状态
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [clickCoords, setClickCoords] = useState<{ importance: number; urgency: number } | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isBackupOpen, setIsBackupOpen] = useState(false);

  // 转换服务端 Task 为标准 TaskItem (0~10分值模型)
  const mapServerTask = useCallback((t: any): TaskItem => {
    // 兼容服务端 0~10 或 1~5 分值
    let importance = typeof t.importance === 'number' ? t.importance : 5;
    if (importance <= 5 && !t.importance_scaled_10) {
      importance = importance * 2;
    }
    let fallbackUrgency = typeof t.urgency === 'number' ? t.urgency : 5;
    if (fallbackUrgency <= 5 && !t.urgency_scaled_10) {
      fallbackUrgency = fallbackUrgency * 2;
    }

    const effectiveDueDate = t.deadline
      ? t.deadline.slice(0, 10)
      : formatLocalDate(new Date(t.created_at || Date.now()));

    const algo = calculateDynamicUrgency({
      dueDate: effectiveDueDate,
      estimatedMinutes: t.duration_minutes || 60,
      fallbackUrgency,
      currentTime: new Date(),
    });

    const isCompleted = t.status === 'completed';
    const todayStr = formatLocalDate(new Date());

    return {
      id: String(t.id),
      title: t.title,
      description: t.notes || '',
      importance,
      urgency: algo.urgency,
      useAutoUrgency: true,
      isImportant: importance >= 5,
      isUrgent: algo.urgency >= 5,
      quadrant: calculateQuadrant(importance, algo.urgency),
      isCompleted,
      completedDates: isCompleted ? [todayStr] : [],
      dueDate: effectiveDueDate,
      tags: Array.isArray(t.tags) ? t.tags : (t.tags ? String(t.tags).split(',').map((s: string) => s.trim()).filter(Boolean) : []),
      estimatedMinutes: t.duration_minutes || 60,
      createdAt: t.created_at || new Date().toISOString(),
      completedAt: isCompleted ? (t.updated_at || new Date().toISOString()) : null,
      algorithmStatusText: algo.statusText,
    };
  }, []);

  // 拉取任务列表
  const fetchTasks = useCallback(async () => {
    try {
      const res = await api.get('/tasks');
      const serverTasks = res.data.tasks || [];
      const mapped = serverTasks.map(mapServerTask);
      setTasks(mapped);
    } catch (err) {
      console.error('拉取任务列表失败:', err);
    }
  }, [mapServerTask]);

  // 拉取外部日历事件与订阅配置
  const fetchCalendarData = useCallback(async () => {
    try {
      const [eventsRes, subsRes] = await Promise.all([
        api.get('/calendar/events'),
        api.get('/calendar/subscriptions'),
      ]);

      const rawEvents = eventsRes.data.events || [];
      const parsedEvents: CalendarEvent[] = rawEvents.map((e: any) => ({
        id: String(e.id),
        title: e.title,
        start: new Date(e.start),
        end: new Date(e.end),
        description: e.extendedProps?.notes || '',
        location: e.extendedProps?.location || '',
        isAllDay: !!e.allDay,
      }));
      setFixedEvents(parsedEvents);

      const subs = subsRes.data.subscriptions || [];
      if (subs.length > 0 && subs[0].url) {
        setSubscriptionUrl(subs[0].url);
      }
    } catch (err) {
      console.error('拉取日历数据失败:', err);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchCalendarData();
  }, [fetchTasks, fetchCalendarData]);

  // 全局键盘快捷键 N / n 新建事项
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }
      if (isTaskModalOpen || isWizardOpen || isStatsOpen || isBackupOpen) {
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setEditingTask(null);
        setClickCoords(null);
        setIsTaskModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTaskModalOpen, isWizardOpen, isStatsOpen, isBackupOpen]);

  // 提取所有唯一标签
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    tasks.forEach((t) => t.tags?.forEach((tag) => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  }, [tasks]);

  // 计算多维效能统计数据
  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.isCompleted).length;
    const pending = total - completed;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    const breakdown: Record<
      QuadrantId,
      { total: number; completed: number; pending: number; percent: number }
    > = {
      q1: { total: 0, completed: 0, pending: 0, percent: 0 },
      q2: { total: 0, completed: 0, pending: 0, percent: 0 },
      q3: { total: 0, completed: 0, pending: 0, percent: 0 },
      q4: { total: 0, completed: 0, pending: 0, percent: 0 },
    };

    tasks.forEach((t) => {
      const q = t.quadrant;
      if (breakdown[q]) {
        breakdown[q].total += 1;
        if (t.isCompleted) {
          breakdown[q].completed += 1;
        } else {
          breakdown[q].pending += 1;
        }
      }
    });

    if (total > 0) {
      (['q1', 'q2', 'q3', 'q4'] as const).forEach((qid) => {
        breakdown[qid].percent = Math.round((breakdown[qid].total / total) * 100);
      });
    }

    return { total, completed, pending, completionRate, breakdown };
  }, [tasks]);

  // 过滤后的任务列表（用于看板与排程渲染）
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (filterOptions.status === 'pending' && task.isCompleted) return false;
      if (filterOptions.status === 'completed' && !task.isCompleted) return false;
      if (filterOptions.tag && (!task.tags || !task.tags.includes(filterOptions.tag))) return false;
      if (filterOptions.searchQuery) {
        const q = filterOptions.searchQuery.toLowerCase();
        const matchTitle = task.title.toLowerCase().includes(q);
        const matchDesc = task.description?.toLowerCase().includes(q);
        if (!matchTitle && !matchDesc) return false;
      }
      return true;
    });
  }, [tasks, filterOptions]);

  // 核心交互：点击四象限直角坐标平面任意空白处，自动落位创建
  const handleCreateWithCoords = useCallback((importance: number, urgency: number) => {
    setClickCoords({ importance, urgency });
    setEditingTask(null);
    setIsTaskModalOpen(true);
  }, []);

  // 保存任务 (新建 / 编辑)
  const handleSaveTask = async (data: {
    title: string;
    description?: string;
    importance: number;
    urgency: number;
    useAutoUrgency?: boolean;
    dueDate?: string | null;
    tags?: string[];
    estimatedMinutes?: number;
  }) => {
    try {
      const payload = {
        title: data.title,
        duration_minutes: data.estimatedMinutes || 60,
        importance: data.importance,
        urgency: data.urgency,
        deadline: data.dueDate ? new Date(data.dueDate).toISOString() : null,
        notes: data.description || '',
        auto_schedule: true,
      };

      if (editingTask) {
        await api.put(`/tasks/${editingTask.id}`, payload);
      } else {
        await api.post('/tasks', payload);
      }

      await fetchTasks();
      setIsTaskModalOpen(false);
      setEditingTask(null);
      setClickCoords(null);
    } catch (err: any) {
      alert(err.response?.data?.error || '保存任务失败，请重试');
    }
  };

  // 智能向导创建任务
  const handleWizardConfirm = (data: {
    title: string;
    importance: number;
    urgency: number;
    dueDate: string;
    estimatedMinutes?: number;
  }) => {
    handleSaveTask({
      title: data.title,
      importance: data.importance,
      urgency: data.urgency,
      dueDate: data.dueDate,
      estimatedMinutes: data.estimatedMinutes,
    });
    setIsWizardOpen(false);
  };

  // 快捷切换任务完成状态 (四象限看板)
  const handleToggleComplete = async (taskId: string) => {
    const target = tasks.find((t) => t.id === taskId);
    if (!target) return;

    const willComplete = !target.isCompleted;

    // 乐观更新 UI
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              isCompleted: willComplete,
              completedDates: willComplete ? [formatLocalDate(new Date())] : [],
              completedAt: willComplete ? new Date().toISOString() : null,
            }
          : t
      )
    );

    try {
      await api.post(`/tasks/${taskId}/action`, {
        action: willComplete ? 'complete' : 'reopen',
      });
    } catch (err) {
      console.error('切换完成状态失败:', err);
      fetchTasks();
    }
  };

  // 日历单日排程勾选当天目标完成
  const handleToggleCalendarTaskComplete = async (taskId: string, dateStr: string) => {
    const target = tasks.find((t) => t.id === taskId);
    if (!target) return;

    const isDoneOnTargetDate = target.completedDates?.includes(dateStr) || target.isCompleted;
    const isLastDay = target.dueDate ? dateStr >= target.dueDate : true;

    setTasks((prev) =>
      prev.map((item) => {
        if (item.id !== taskId) return item;
        const prevDates = Array.isArray(item.completedDates) ? item.completedDates : [];
        if (!isDoneOnTargetDate) {
          const nextDates = [...prevDates, dateStr];
          const shouldFinalComplete = isLastDay;
          return {
            ...item,
            isCompleted: shouldFinalComplete,
            completedDates: nextDates,
            completedAt: shouldFinalComplete ? new Date().toISOString() : null,
          };
        } else {
          const nextDates = prevDates.filter((d) => d !== dateStr);
          return {
            ...item,
            isCompleted: false,
            completedDates: nextDates,
            completedAt: null,
          };
        }
      })
    );

    try {
      if (!isDoneOnTargetDate && isLastDay) {
        await api.post(`/tasks/${taskId}/action`, { action: 'complete' });
      } else if (isDoneOnTargetDate && target.isCompleted) {
        await api.post(`/tasks/${taskId}/action`, { action: 'reopen' });
      }
    } catch (err) {
      console.error('更新日历排程完成状态失败:', err);
      fetchTasks();
    }
  };

  // 删除任务
  const handleDeleteTask = async (taskId: string) => {
    if (!window.confirm('确定要彻底删除该待办事项吗？')) return;

    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    try {
      await api.delete(`/tasks/${taskId}`);
    } catch (err) {
      console.error('删除任务失败:', err);
      fetchTasks();
    }
  };

  // 打开编辑任务
  const handleEditTask = (task: TaskItem) => {
    setEditingTask(task);
    setClickCoords(null);
    setIsTaskModalOpen(true);
  };

  // 同步外部日历并重新智能规划排程
  const handleSyncCalendar = async () => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      await api.post('/calendar/sync-and-replan');
      await Promise.all([fetchTasks(), fetchCalendarData()]);
    } catch (err: any) {
      setSyncError(err.response?.data?.error || '日历同步失败，请检查订阅地址或网络');
    } finally {
      setIsSyncing(false);
    }
  };

  // 更新订阅地址
  const handleUpdateSubscriptionUrl = async (newUrl: string) => {
    try {
      await api.post('/calendar/subscriptions', {
        name: '我的外部课程/日程订阅',
        url: newUrl,
      });
      setSubscriptionUrl(newUrl);
      await handleSyncCalendar();
    } catch (err: any) {
      alert(err.response?.data?.error || '保存订阅地址失败');
    }
  };

  // 数据导入
  const handleImportTasks = async (importedList: TaskItem[]) => {
    for (const t of importedList) {
      try {
        await api.post('/tasks', {
          title: t.title,
          duration_minutes: t.estimatedMinutes || 60,
          importance: t.importance,
          urgency: t.urgency,
          deadline: t.dueDate ? new Date(t.dueDate).toISOString() : null,
          notes: t.description || '',
          auto_schedule: true,
        });
      } catch (_) {}
    }
    await fetchTasks();
    setIsBackupOpen(false);
  };

  // 清空所有任务
  const handleClearAll = async () => {
    if (!window.confirm('确定要清空全部事项吗？此操作无法撤销！')) return;
    for (const t of tasks) {
      try {
        await api.delete(`/tasks/${t.id}`);
      } catch (_) {}
    }
    setTasks([]);
    setIsBackupOpen(false);
  };

  return (
    <div className="flex-1 w-full h-full min-h-0 flex bg-slate-50/50 dark:bg-slate-950/40 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs">
      {/* ===================== 左侧折叠侧边栏 (Eisenhower Sidebar) ===================== */}
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        activeView={activeView}
        onSelectView={onSelectView}
        filterOptions={filterOptions}
        onFilterChange={(f) => setFilterOptions((prev) => ({ ...prev, ...f }))}
        allTags={allTags}
        stats={stats}
        isDark={isDark}
        onToggleTheme={() => setThemeMode(isDark ? 'light' : 'dark')}
        onOpenNewTask={() => {
          setEditingTask(null);
          setClickCoords(null);
          setIsTaskModalOpen(true);
        }}
        onOpenWizard={() => setIsWizardOpen(true)}
        onOpenStats={() => setIsStatsOpen(true)}
        onOpenBackup={() => setIsBackupOpen(true)}
      />

      {/* ===================== 右侧核心主视窗 ===================== */}
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden bg-white dark:bg-[#191a1b]">
        {/* 顶部交互操作与状态条 */}
        <header className="px-4 py-2.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0 bg-white/90 dark:bg-[#191a1b]/90 backdrop-blur-xs">
          {/* 左侧视图标题与状态 */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-900 dark:text-slate-100 tracking-tight whitespace-nowrap">
                {activeView === 'matrix' ? '四象限直角坐标全景看板' : '单日排程与精力节律时间轴'}
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 font-medium">
                {activeView === 'matrix' ? '点击空白处按坐标添加 · 快捷键 N' : '番茄黄金精力区 · LLF松弛度自动排程'}
              </span>
            </div>
          </div>

          {/* 右侧视图快速切换与操作入口 */}
          <div className="flex items-center gap-2 shrink-0">
            {/* 状态筛选胶囊 */}
            <div className="hidden md:flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px]">
              {(['all', 'pending', 'completed'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setFilterOptions((prev) => ({ ...prev, status: st }))}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    filterOptions.status === st
                      ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {st === 'all' ? '全部' : st === 'pending' ? '待办' : '已完成'}
                </button>
              ))}
            </div>

            {/* 视图双模态快捷切换 */}
            <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium">
              <button
                type="button"
                onClick={() => onSelectView('matrix')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
                  activeView === 'matrix'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="切换到四象限直角坐标系看板"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">四象限看板</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectView('calendar')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
                  activeView === 'calendar'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="切换到单日时间轴排程视图"
              >
                <CalendarDays className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">日历日程</span>
              </button>
            </div>

            {/* 新建事项主按钮 */}
            <button
              type="button"
              onClick={() => {
                setEditingTask(null);
                setClickCoords(null);
                setIsTaskModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs hover:shadow transition-all"
            >
              <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
              <span>新建待办</span>
              <kbd className="hidden sm:inline px-1 py-0.2 rounded text-[10px] bg-indigo-700/70 text-indigo-100 font-mono">
                N
              </kbd>
            </button>
          </div>
        </header>

        {/* 主视窗内容渲染区 (完全自适应父容器高度，零滚动条) */}
        <div className="flex-1 min-h-0 w-full p-2.5 sm:p-3 overflow-hidden">
          {activeView === 'matrix' ? (
            <MatrixBoard
              tasks={filteredTasks}
              onToggleComplete={handleToggleComplete}
              onEdit={handleEditTask}
              onDelete={handleDeleteTask}
              onOpenCreateWithCoordinates={handleCreateWithCoords}
            />
          ) : (
            <DayScheduleView
              tasks={tasks}
              fixedEvents={fixedEvents}
              subscriptionUrl={subscriptionUrl}
              onUpdateSubscriptionUrl={handleUpdateSubscriptionUrl}
              onSyncCalendar={handleSyncCalendar}
              isSyncing={isSyncing}
              syncError={syncError}
              onToggleCompleteTask={handleToggleCalendarTaskComplete}
              onEditTask={handleEditTask}
            />
          )}
        </div>
      </div>

      {/* ===================== 全局交互模态框 ===================== */}
      {/* 待办新建 / 编辑弹窗 (支持从坐标系点击预填充) */}
      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={() => {
          setIsTaskModalOpen(false);
          setEditingTask(null);
          setClickCoords(null);
        }}
        onSave={handleSaveTask}
        initialTask={editingTask}
        defaultImportance={clickCoords?.importance ?? 7}
        defaultUrgency={clickCoords?.urgency}
        allExistingTags={allTags}
      />

      {/* 智能归类向导 */}
      <WizardModal
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onConfirmTask={handleWizardConfirm}
      />

      {/* 精力复盘效能分析 */}
      <StatsModal
        isOpen={isStatsOpen}
        onClose={() => setIsStatsOpen(false)}
        stats={stats}
      />

      {/* 数据备份与导出 */}
      <BackupModal
        isOpen={isBackupOpen}
        onClose={() => setIsBackupOpen(false)}
        tasks={tasks}
        onImport={handleImportTasks}
        onClearAll={handleClearAll}
      />
    </div>
  );
};
