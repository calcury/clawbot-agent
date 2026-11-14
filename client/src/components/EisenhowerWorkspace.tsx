import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { TaskItem, QuadrantId } from '../types/task';
import type { CalendarEvent } from '../types/calendar';
import { calculateQuadrant, formatLocalDate } from '../types/task';
import { calculateDynamicUrgency } from '../utils/priorityAlgorithm';
import { api } from '../api/client';
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
  RefreshCw,
  Search,
  Check,
  CheckSquare,
  Clock,
  Sparkles,
  Inbox,
  Flame,
  Star,
  Layers,
  Archive,
  PieChart,
  ArrowUpDown,
  Edit3,
  Trash2,
  Calendar as CalendarIcon,
  CheckCircle2,
} from 'lucide-react';

interface EisenhowerWorkspaceProps {
  activeView: 'matrix' | 'calendar';
  onSelectView: (view: 'matrix' | 'calendar') => void;
}

export const EisenhowerWorkspace: React.FC<EisenhowerWorkspaceProps> = ({
  activeView,
  onSelectView,
}) => {
  // 当前内部视图：四象限看板 (matrix) / 待办清单列表 (list) / 时间轴排程 (calendar)
  const [currentView, setCurrentView] = useState<'matrix' | 'list' | 'calendar'>(
    activeView === 'calendar' ? 'calendar' : 'matrix'
  );

  // 与父级 activeView 同步
  useEffect(() => {
    if (activeView === 'calendar' && currentView !== 'calendar') {
      setCurrentView('calendar');
    } else if (activeView === 'matrix' && currentView === 'calendar') {
      setCurrentView('matrix');
    }
  }, [activeView]);

  const handleSwitchView = (v: 'matrix' | 'list' | 'calendar') => {
    setCurrentView(v);
    if (v === 'calendar') {
      onSelectView('calendar');
    } else {
      onSelectView('matrix');
    }
  };

  // 任务数据与加载状态
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [fixedEvents, setFixedEvents] = useState<CalendarEvent[]>([]);
  const [subscriptionUrl, setSubscriptionUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // 分类筛选与搜索 (模仿旧版 TodoList)
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // 快速添加表单状态 (旧版左侧快捷栏)
  const [quickTitle, setQuickTitle] = useState('');
  const [quickDuration, setQuickDuration] = useState(60);
  const [quickDeadline, setQuickDeadline] = useState('');
  const [quickUrgency, setQuickUrgency] = useState(6);
  const [quickImportance, setQuickImportance] = useState(6);
  const [quickSubmitting, setQuickSubmitting] = useState(false);

  // 模态框状态
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [clickCoords, setClickCoords] = useState<{ importance: number; urgency: number } | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isBackupOpen, setIsBackupOpen] = useState(false);

  // 转换服务端 Task 为标准 TaskItem (0~10分值模型)
  const mapServerTask = useCallback((t: any): TaskItem => {
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
    setLoading(true);
    try {
      const res = await api.get('/tasks');
      const serverTasks = res.data.tasks || [];
      const mapped = serverTasks.map(mapServerTask);
      setTasks(mapped);
    } catch (err) {
      console.error('拉取任务列表失败:', err);
    } finally {
      setLoading(false);
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

  // 旧版分类与四象限统计定义
  const filterCategories = [
    { key: 'all', label: '全部待办', icon: Inbox, color: 'text-blue-600 dark:text-blue-400' },
    { key: 'q1', label: 'Q1 重要且紧急', icon: Flame, color: 'text-rose-600 dark:text-rose-400' },
    { key: 'q2', label: 'Q2 重要不紧急', icon: Star, color: 'text-blue-600 dark:text-blue-400' },
    { key: 'q3', label: 'Q3 紧急不重要', icon: Clock, color: 'text-amber-600 dark:text-amber-400' },
    { key: 'q4', label: 'Q4 不重要不紧急', icon: Layers, color: 'text-gray-500 dark:text-neutral-400' },
    { key: 'completed', label: '已完成事项', icon: Archive, color: 'text-gray-400 dark:text-neutral-500' },
  ];

  // 计算各分类计数
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: tasks.filter((t) => !t.isCompleted).length,
      q1: tasks.filter((t) => !t.isCompleted && t.quadrant === 'q1').length,
      q2: tasks.filter((t) => !t.isCompleted && t.quadrant === 'q2').length,
      q3: tasks.filter((t) => !t.isCompleted && t.quadrant === 'q3').length,
      q4: tasks.filter((t) => !t.isCompleted && t.quadrant === 'q4').length,
      completed: tasks.filter((t) => t.isCompleted).length,
    };
    return counts;
  }, [tasks]);

  // 计算多维效能统计数据 (供复盘弹窗使用)
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

  // 根据左侧分类及搜索框过滤任务列表
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (activeCategory === 'completed') {
        if (!task.isCompleted) return false;
      } else if (activeCategory === 'all') {
        // 在待办看板和列表中默认展示未完成，已完成事项归入已完成分类
        // （但在四象限看板中，若搜索空则保留所有未完成）
      } else if (activeCategory.startsWith('q')) {
        if (task.quadrant !== activeCategory) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTitle = task.title.toLowerCase().includes(q);
        const matchDesc = task.description?.toLowerCase().includes(q);
        if (!matchTitle && !matchDesc) return false;
      }
      return true;
    });
  }, [tasks, activeCategory, searchQuery]);

  // 点击直角坐标平面任意空白处，自动落位创建
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

  // 左侧快速表单提交创建待办
  const handleQuickCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTitle.trim()) return;

    setQuickSubmitting(true);
    try {
      await api.post('/tasks', {
        title: quickTitle.trim(),
        duration_minutes: quickDuration,
        importance: quickImportance,
        urgency: quickUrgency,
        deadline: quickDeadline ? new Date(quickDeadline).toISOString() : null,
        auto_schedule: true,
      });

      setQuickTitle('');
      setQuickDeadline('');
      await fetchTasks();
    } catch (err: any) {
      alert(err.response?.data?.error || '快速创建待办失败');
    } finally {
      setQuickSubmitting(false);
    }
  };

  // 智能向导创建确认
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

  // 快捷切换任务完成状态 (Google Todo 圆形复选框)
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
    if (!window.confirm('确定要删除该待办事项吗？')) return;

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
    <div className="w-full flex-1 min-h-0 flex flex-col space-y-2.5 overflow-hidden">
      {/* ===================== 左右排版主视窗 (模仿旧版 Google Tasks 布局) ===================== */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3.5 items-stretch overflow-hidden">
        {/* 左侧栏: 分类与四象限导航 + 快速新建待办 + 辅助效率工具 */}
        <aside className="w-full lg:w-72 xl:w-80 shrink-0 flex flex-col gap-3 overflow-y-auto pr-1">
          {/* 1. 分类与四象限 (Filter Rail) */}
          <div className="bg-white dark:bg-[#1e1f20] rounded-2xl p-3 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs transition-colors">
            <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 dark:text-neutral-500 px-3 py-1.5">
              分类与四象限
            </div>
            <div className="space-y-0.5 mt-1">
              {filterCategories.map((item) => {
                const Icon = item.icon;
                const isActive = activeCategory === item.key;
                const count = categoryCounts[item.key] || 0;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveCategory(item.key)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                      isActive
                        ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold shadow-2xs'
                        : 'text-gray-600 dark:text-neutral-400 hover:bg-gray-100/80 dark:hover:bg-neutral-800/60 hover:text-gray-900 dark:hover:text-neutral-200'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600 dark:text-blue-400' : item.color}`} />
                      <span className="truncate">{item.label}</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono shrink-0 transition ${
                        isActive
                          ? 'bg-blue-600 text-white font-bold'
                          : 'bg-gray-100 dark:bg-neutral-800 text-gray-500 dark:text-neutral-400'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. 快速新建待办 (桌面端快捷表单) */}
          <div className="hidden lg:block bg-white dark:bg-[#1e1f20] rounded-2xl p-4 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs transition-colors">
            <div className="flex items-center gap-2 pb-2.5 border-b border-gray-100 dark:border-neutral-800 text-xs font-bold text-gray-900 dark:text-gray-100">
              <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>快速新建待办</span>
            </div>

            <form onSubmit={handleQuickCreate} className="space-y-3 mt-3">
              <div>
                <input
                  type="text"
                  value={quickTitle}
                  onChange={(e) => setQuickTitle(e.target.value)}
                  placeholder="待办名称 (如: 准备里程碑审查)"
                  className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 focus:bg-white dark:focus:bg-[#232425] outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 dark:text-neutral-400 mb-1">
                    预计耗时
                  </label>
                  <select
                    value={quickDuration}
                    onChange={(e) => setQuickDuration(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none"
                  >
                    <option value={15}>15 分钟</option>
                    <option value={30}>30 分钟</option>
                    <option value={45}>45 分钟</option>
                    <option value={60}>60 分钟 (1h)</option>
                    <option value={90}>90 分钟 (1.5h)</option>
                    <option value={120}>120 分钟 (2h)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 dark:text-neutral-400 mb-1">
                    截止日期
                  </label>
                  <input
                    type="date"
                    value={quickDeadline}
                    onChange={(e) => setQuickDeadline(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 dark:text-neutral-400 mb-1">
                    战略重要度
                  </label>
                  <select
                    value={quickImportance}
                    onChange={(e) => setQuickImportance(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none"
                  >
                    <option value={2}>2 - 较低关注</option>
                    <option value={5}>5 - 普通事项</option>
                    <option value={8}>8 - 重要核心</option>
                    <option value={10}>10 - 极关键战略</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 dark:text-neutral-400 mb-1">
                    时间紧迫度
                  </label>
                  <select
                    value={quickUrgency}
                    onChange={(e) => setQuickUrgency(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none"
                  >
                    <option value={2}>2 - 宽裕从容</option>
                    <option value={5}>5 - 正常推进</option>
                    <option value={8}>8 - 紧急迫近</option>
                    <option value={10}>10 - 特急火线</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={quickSubmitting}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white text-xs font-semibold rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{quickSubmitting ? '录入排程中...' : '录入并自动规划'}</span>
              </button>
            </form>
          </div>

          {/* 3. 辅助效率工具快捷入口 */}
          <div className="bg-white dark:bg-[#1e1f20] rounded-2xl p-3 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs space-y-1">
            <button
              type="button"
              onClick={() => setIsWizardOpen(true)}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-neutral-300 dark:hover:bg-neutral-800 transition-colors text-left cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>智能决策向导</span>
            </button>
            <button
              type="button"
              onClick={() => setIsStatsOpen(true)}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-neutral-300 dark:hover:bg-neutral-800 transition-colors text-left cursor-pointer"
            >
              <PieChart className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>精力复盘分析</span>
            </button>
            <button
              type="button"
              onClick={() => setIsBackupOpen(true)}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-neutral-300 dark:hover:bg-neutral-800 transition-colors text-left cursor-pointer"
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-gray-500 dark:text-neutral-400" />
              <span>数据备份与导出</span>
            </button>
          </div>
        </aside>

        {/* 右侧主视窗: 顶部操作栏 + 核心视窗 (四象限看板 / 待办清单列表 / 日程时间轴) */}
        <section className="flex-1 min-w-0 w-full flex flex-col gap-2.5 overflow-hidden">
          {/* 顶部操作条 (Google Workspace 风格) */}
          <div className="shrink-0 bg-white dark:bg-[#1e1f20] rounded-2xl p-2.5 sm:p-3 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs flex flex-wrap items-center justify-between gap-2.5 transition-colors">
            {/* 分类标题与数量 */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                {filterCategories.find((c) => c.key === activeCategory)?.label || '任务清单'}
              </span>
              <span className="text-xs text-gray-400 dark:text-neutral-500 font-mono">
                (共 {filteredTasks.length} 项)
              </span>
            </div>

            {/* 核心视窗三模态切换 Tab (四象限看板 / 待办清单 / 日程时间轴) */}
            <div className="flex items-center p-0.5 rounded-full bg-gray-100 dark:bg-neutral-800 text-xs font-medium border border-gray-200/50 dark:border-neutral-700/60">
              <button
                type="button"
                onClick={() => handleSwitchView('matrix')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full transition-all cursor-pointer ${
                  currentView === 'matrix'
                    ? 'bg-white dark:bg-[#28292a] text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-neutral-200'
                }`}
                title="切换到四象限直角坐标看板"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>四象限看板</span>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchView('list')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full transition-all cursor-pointer ${
                  currentView === 'list'
                    ? 'bg-white dark:bg-[#28292a] text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-neutral-200'
                }`}
                title="切换到标准待办清单列表"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                <span>待办列表</span>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchView('calendar')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full transition-all cursor-pointer ${
                  currentView === 'calendar'
                    ? 'bg-white dark:bg-[#28292a] text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-neutral-200'
                }`}
                title="切换到单日时间轴排程视图"
              >
                <CalendarDays className="w-3.5 h-3.5" />
                <span>日程排程</span>
              </button>
            </div>

            {/* 右侧入口: 搜索框 + 刷新 + 新建待办 */}
            <div className="flex items-center gap-2">
              <div className="relative w-36 sm:w-48">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-neutral-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索待办..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700/80 text-gray-900 dark:text-gray-100 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                />
              </div>

              <button
                type="button"
                onClick={() => fetchTasks()}
                className="p-1.5 rounded-full border border-gray-200/80 dark:border-neutral-700/80 bg-white dark:bg-[#1e1f20] hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-600 dark:text-neutral-300 transition cursor-pointer"
                title="刷新任务列表"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} />
              </button>

              <button
                type="button"
                onClick={() => {
                  setEditingTask(null);
                  setClickCoords(null);
                  setIsTaskModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full text-xs font-semibold shadow-xs hover:shadow transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>添加任务</span>
                <kbd className="hidden sm:inline px-1 py-0.2 rounded text-[10px] bg-blue-700 text-blue-100 font-mono">
                  N
                </kbd>
              </button>
            </div>
          </div>

          {/* 主视窗渲染卡片 (零页面外层滚动条，单屏满高) */}
          <div className="flex-1 min-h-0 bg-white dark:bg-[#1e1f20] rounded-2xl border border-gray-200/80 dark:border-neutral-800/80 shadow-xs overflow-hidden transition-colors">
            {/* 1. 四象限直角坐标系看板视图 */}
            {currentView === 'matrix' && (
              <MatrixBoard
                tasks={filteredTasks}
                onToggleComplete={handleToggleComplete}
                onEdit={handleEditTask}
                onDelete={handleDeleteTask}
                onOpenCreateWithCoordinates={handleCreateWithCoords}
              />
            )}

            {/* 2. Google Todo 待办清单列表视图 */}
            {currentView === 'list' && (
              <div className="h-full overflow-y-auto divide-y divide-gray-100 dark:divide-neutral-800/80">
                {loading ? (
                  <div className="p-12 text-center text-gray-400 dark:text-neutral-500 text-xs">
                    正在加载任务列表...
                  </div>
                ) : filteredTasks.length === 0 ? (
                  <div className="p-12 text-center space-y-2">
                    <CheckCircle2 className="w-10 h-10 text-gray-300 dark:text-neutral-600 mx-auto stroke-[1.5]" />
                    <div className="text-gray-700 dark:text-neutral-300 font-medium text-sm">
                      {searchQuery ? '未检索到匹配的待办' : '该分类下暂无事项'}
                    </div>
                    <p className="text-gray-400 dark:text-neutral-500 text-xs max-w-sm mx-auto">
                      微信发送给时间规划助手如：“明天下午3点排个开会”，或点击右上角添加。
                    </p>
                  </div>
                ) : (
                  filteredTasks.map((task) => {
                    const isCompleted = task.isCompleted;
                    const quad = task.quadrant;

                    // 象限样式
                    const quadStyles = {
                      q1: { name: 'Q1 重要且紧急', color: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200' },
                      q2: { name: 'Q2 重要不紧急', color: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200' },
                      q3: { name: 'Q3 紧急不重要', color: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200' },
                      q4: { name: 'Q4 不重要不紧急', color: 'bg-gray-50 text-gray-600 dark:bg-neutral-800/60 dark:text-neutral-400 border-gray-200' },
                    }[quad];

                    return (
                      <div
                        key={task.id}
                        className="p-3 sm:p-3.5 hover:bg-gray-50/70 dark:hover:bg-[#252728] transition-colors flex items-center justify-between gap-3 group"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {/* Google Todo 圆形复选框 */}
                          <button
                            type="button"
                            onClick={() => handleToggleComplete(task.id)}
                            className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all cursor-pointer ${
                              isCompleted
                                ? 'bg-blue-600 dark:bg-blue-500 border-blue-600 dark:border-blue-500 text-white'
                                : 'border-gray-400 dark:border-neutral-500 hover:border-blue-600 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-transparent hover:text-blue-600'
                            }`}
                            title={isCompleted ? '标为未完成' : '标为完成'}
                          >
                            <Check className="w-3 h-3 stroke-[3]" />
                          </button>

                          {/* 标题与描述 */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-xs font-medium leading-snug truncate ${
                                  isCompleted ? 'line-through text-gray-400 dark:text-neutral-500' : 'text-gray-900 dark:text-gray-100'
                                }`}
                              >
                                {task.title}
                              </span>
                              <span
                                className={`text-[10px] px-2 py-0.2 rounded-full border font-semibold shrink-0 ${quadStyles.color}`}
                              >
                                {quadStyles.name}
                              </span>
                            </div>

                            {/* 附属信息栏 */}
                            <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-400 dark:text-neutral-500 flex-wrap">
                              <span className="font-mono text-gray-500 dark:text-neutral-400">
                                分值: ({task.urgency.toFixed(1)}, {task.importance.toFixed(1)})
                              </span>
                              {task.dueDate && (
                                <span className="flex items-center gap-1 text-gray-500 dark:text-neutral-400">
                                  <CalendarIcon className="w-3 h-3" />
                                  <span>{task.dueDate}</span>
                                </span>
                              )}
                              {task.estimatedMinutes && (
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  <span>{task.estimatedMinutes} 分钟</span>
                                </span>
                              )}
                              {task.description && (
                                <span className="truncate max-w-[200px] text-gray-400">
                                  {task.description}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* 悬浮操作按钮 */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            type="button"
                            onClick={() => handleEditTask(task)}
                            className="p-1 rounded-full text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-neutral-800 transition cursor-pointer"
                            title="编辑"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTask(task.id)}
                            className="p-1 rounded-full text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
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
            )}

            {/* 3. 单日时间轴排程视图 */}
            {currentView === 'calendar' && (
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
        </section>
      </div>

      {/* ===================== 全局交互模态框 ===================== */}
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

      <WizardModal
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onConfirmTask={handleWizardConfirm}
      />

      <StatsModal
        isOpen={isStatsOpen}
        onClose={() => setIsStatsOpen(false)}
        stats={stats}
      />

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
