import { PlanningProgress, type PlanningState } from './PlanningProgress';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { TaskItem, QuadrantId } from '../types/task';
import { calculateQuadrant, formatLocalDate } from '../types/task';
import { isDateMatchingRecurrence } from '../utils/recurrence';
import {
  calculateDynamicImportance,
  calculateDynamicUrgency,
  inferTierFromScore,
  normalizeScoreTo100,
  PRIORITY_THRESHOLD,
  type ImpactSignal,
  type ImportanceTier,
  type TimeMode,
  type UrgencyPace,
} from '../utils/priorityAlgorithm';
import { api } from '../api/client';
import { useTheme } from '../context/ThemeContext';
import { MatrixBoard } from './MatrixBoard';
import { TaskModal, type TaskModalSavePayload } from './TaskModal';
import { LazyBoundary, lazyNamed } from '../utils/lazyNamed';

const WizardModal = lazyNamed(() => import('./WizardModal'), 'WizardModal');
const StatsModal = lazyNamed(() => import('./StatsModal'), 'StatsModal');
const BackupModal = lazyNamed(() => import('./BackupModal'), 'BackupModal');
import {
  Plus,
  RefreshCw,
  Search,
  Check,
  Clock,
  Inbox,
  Flame,
  Star,
  Layers,
  Archive,
  Edit3,
  Trash2,
  Calendar as CalendarIcon,
  CheckCircle2,
  Menu,
  ChevronDown,
  ChevronRight,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';

interface EisenhowerWorkspaceProps {
  currentView?: 'matrix' | 'list';
  onSwitchView?: (view: 'matrix' | 'list') => void;
  activeCategory?: string;
  setActiveCategory?: (cat: string) => void;
  onCountsUpdate?: (counts: Record<string, number>) => void;
  onOpenMobileMenu?: () => void;
  isCreateModalOpen?: boolean;
  setIsCreateModalOpen?: (open: boolean) => void;
  isWizardOpen?: boolean;
  setIsWizardOpen?: (open: boolean) => void;
  isStatsOpen?: boolean;
  setIsStatsOpen?: (open: boolean) => void;
  isBackupOpen?: boolean;
  setIsBackupOpen?: (open: boolean) => void;
}

function serializeDeadlineIso(rawDueDate?: string | null): string | null {
  if (!rawDueDate) return null;
  const trimmed = rawDueDate.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59).toISOString();
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export const EisenhowerWorkspace: React.FC<EisenhowerWorkspaceProps> = ({
  currentView: propsCurrentView = 'matrix',
  onSwitchView: _onSwitchView,
  activeCategory: propsActiveCategory,
  setActiveCategory: propsSetActiveCategory,
  onCountsUpdate,
  onOpenMobileMenu,
  isCreateModalOpen: propsIsCreateModalOpen,
  setIsCreateModalOpen: propsSetIsCreateModalOpen,
  isWizardOpen: propsIsWizardOpen,
  setIsWizardOpen: propsSetIsWizardOpen,
  isStatsOpen: propsIsStatsOpen,
  setIsStatsOpen: propsSetIsStatsOpen,
  isBackupOpen: propsIsBackupOpen,
  setIsBackupOpen: propsSetIsBackupOpen,
}) => {
  const { t, language, themeMode, setThemeMode } = useTheme();

  const cycleTheme = () => {
    if (themeMode === 'light') {
      setThemeMode('dark');
    } else if (themeMode === 'dark') {
      setThemeMode('system');
    } else {
      setThemeMode('light');
    }
  };

  // 当前内部视图：四象限看板 (matrix) / 待办清单列表 (list)
  const [internalCurrentView, setInternalCurrentView] = useState<'matrix' | 'list'>(propsCurrentView);
  const viewMode = propsCurrentView || internalCurrentView;

  // 与父级 propsCurrentView 同步
  useEffect(() => {
    if (propsCurrentView && propsCurrentView !== internalCurrentView) {
      setInternalCurrentView(propsCurrentView);
    }
  }, [propsCurrentView, internalCurrentView]);

  // 分类筛选控制
  const [internalActiveCategory, setInternalActiveCategory] = useState<string>('all');
  const currentCategory = propsActiveCategory || internalActiveCategory;

  const handleSelectCategory = (cat: string) => {
    if (propsSetActiveCategory) {
      propsSetActiveCategory(cat);
    } else {
      setInternalActiveCategory(cat);
    }
  };
  void handleSelectCategory;

  // 任务数据与今日外部日程占用状态
  const [rawServerTasks, setRawServerTasks] = useState<any[]>([]);
  const [externalBusyIntervals, setExternalBusyIntervals] = useState<Array<{ start: string; end: string }>>([]);
  const [currentTime, setCurrentTime] = useState<Date>(() => new Date());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // 模态框状态
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [clickCoords, setClickCoords] = useState<{ importance: number; urgency: number } | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isBackupOpen, setIsBackupOpen] = useState(false);

  // Google Tasks 风格快速添加与已完成折叠状态
  const [quickTaskTitle, setQuickTaskTitle] = useState('');
  const [quickTaskSubmitting, setQuickTaskSubmitting] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);

  // 响应父级侧边栏触发模态框
  useEffect(() => {
    if (propsIsCreateModalOpen) {
      setEditingTask(null);
      setClickCoords(null);
      setIsTaskModalOpen(true);
      propsSetIsCreateModalOpen?.(false);
    }
  }, [propsIsCreateModalOpen, propsSetIsCreateModalOpen]);

  useEffect(() => {
    if (propsIsWizardOpen) {
      setIsWizardOpen(true);
      propsSetIsWizardOpen?.(false);
    }
  }, [propsIsWizardOpen, propsSetIsWizardOpen]);

  useEffect(() => {
    if (propsIsStatsOpen) {
      setIsStatsOpen(true);
      propsSetIsStatsOpen?.(false);
    }
  }, [propsIsStatsOpen, propsSetIsStatsOpen]);

  useEffect(() => {
    if (propsIsBackupOpen) {
      setIsBackupOpen(true);
      propsSetIsBackupOpen?.(false);
    }
  }, [propsIsBackupOpen, propsSetIsBackupOpen]);

  // 每 60 秒自动刷新时钟基准，以实时驱动截止期紧迫度与每日固定日程窗口变化
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    const onVis = () => {
      if (document.visibilityState === 'visible') setCurrentTime(new Date());
    };
    window.addEventListener('focus', onVis);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onVis);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // 计算今日从当前时刻到 22:00 的总忙碌占用分钟数（外部日历 + 今日已排程任务）
  const todayBusyMinutesAhead = useMemo(() => {
    const dayEnd = new Date(currentTime);
    dayEnd.setHours(22, 0, 0, 0);
    if (dayEnd.getTime() <= currentTime.getTime()) return 0;

    const intervals: Array<{ start: number; end: number }> = [];
    for (const ev of externalBusyIntervals) {
      const s = Math.max(currentTime.getTime(), new Date(ev.start).getTime());
      const e = Math.min(dayEnd.getTime(), new Date(ev.end).getTime());
      if (e > s) intervals.push({ start: s, end: e });
    }
    for (const t of rawServerTasks) {
      if (t.status === 'completed' || t.status === 'cancelled' || t.is_concurrent) continue;
      let blocks: Array<{ start: string; end: string; completed?: boolean }> = [];
      if (t.schedule_blocks) {
        try {
          const parsed = typeof t.schedule_blocks === 'string' ? JSON.parse(t.schedule_blocks) : t.schedule_blocks;
          if (Array.isArray(parsed)) blocks = parsed;
        } catch {}
      }
      if (blocks.length === 0 && t.scheduled_start && t.scheduled_end) {
        blocks = [{ start: t.scheduled_start, end: t.scheduled_end }];
      }
      for (const b of blocks) {
        if (b.completed) continue;
        const s = Math.max(currentTime.getTime(), new Date(b.start).getTime());
        const e = Math.min(dayEnd.getTime(), new Date(b.end).getTime());
        if (e > s) intervals.push({ start: s, end: e });
      }
    }

    intervals.sort((a, b) => a.start - b.start);
    let busyMs = 0;
    let curStart = -1;
    let curEnd = -1;
    for (const iv of intervals) {
      if (curStart === -1) {
        curStart = iv.start;
        curEnd = iv.end;
      } else if (iv.start <= curEnd) {
        curEnd = Math.max(curEnd, iv.end);
      } else {
        busyMs += curEnd - curStart;
        curStart = iv.start;
        curEnd = iv.end;
      }
    }
    if (curStart !== -1) busyMs += curEnd - curStart;
    return Math.round(busyMs / 60000);
  }, [externalBusyIntervals, rawServerTasks, currentTime]);

  // 转换服务端 Task 为标准 TaskItem (0~100分值模型)
  const mapServerTask = useCallback(
    (t: any): TaskItem => {
      const parseArr = <T,>(val: unknown): T[] => {
        if (Array.isArray(val)) return val as T[];
        if (typeof val === 'string' && val.trim()) {
          try {
            const p = JSON.parse(val);
            return Array.isArray(p) ? (p as T[]) : [];
          } catch {
            return [];
          }
        }
        return [];
      };

      const impactSignals = parseArr<ImpactSignal>(t.impact_signals);
      const completedDates = parseArr<string>(t.completed_dates);
      const todayStr = formatLocalDate(currentTime);

      const rawImp100 = normalizeScoreTo100(t.importance, t.score_scale);
      const importanceTier: ImportanceTier =
        t.importance_tier === 'vital' ||
        t.importance_tier === 'support' ||
        t.importance_tier === 'minor'
          ? t.importance_tier
          : inferTierFromScore(rawImp100);

      const manualOverride =
        t.importance_manual_override !== undefined && t.importance_manual_override !== null
          ? normalizeScoreTo100(t.importance_manual_override, t.score_scale ?? 100)
          : null;

      const importance = t.importance_tier
        ? calculateDynamicImportance({
            tier: importanceTier,
            estimatedMinutes: t.duration_minutes || 60,
            impactSignals,
            isFixed: Boolean(t.is_fixed),
            manualOverride,
          }).importance
        : rawImp100;

      const timeMode: TimeMode =
        t.time_mode === 'daily_fixed' ||
        t.time_mode === 'flexible' ||
        t.time_mode === 'specific_date' ||
        t.time_mode === 'deadline'
          ? t.time_mode
          : t.deadline
          ? 'deadline'
          : 'flexible';

      const urgencyPace: UrgencyPace =
        t.urgency_pace === 'urgent' || t.urgency_pace === 'later' || t.urgency_pace === 'soon'
          ? t.urgency_pace
          : 'soon';

      const effectiveDueDate =
        timeMode === 'deadline' || timeMode === 'specific_date'
          ? t.deadline
            ? t.deadline
            : formatLocalDate(new Date(t.created_at || Date.now()))
          : null;

      const isMatchingToday = timeMode === 'daily_fixed'
        ? isDateMatchingRecurrence(currentTime, t.recurrence_rule)
        : true;

      const isCompletedToday =
        timeMode === 'daily_fixed'
          ? completedDates.includes(todayStr) || t.status === 'completed' || !isMatchingToday
          : t.status === 'completed';

      const fallbackUrgency = normalizeScoreTo100(t.urgency, t.score_scale);

      const algo = calculateDynamicUrgency({
        timeMode,
        dueDate: effectiveDueDate,
        estimatedMinutes: t.duration_minutes || 60,
        importance,
        urgencyPace,
        scheduledStart: t.scheduled_start,
        scheduledEnd: t.scheduled_end,
        isCompletedToday,
        dailyBusyMinutesAhead: todayBusyMinutesAhead,
        nearTermLoadRatio: Math.min(1, Math.max(0, todayBusyMinutesAhead / 360)),
        createdAt: t.created_at,
        fallbackUrgency,
        currentTime,
      });

      const urgency = timeMode === 'daily_fixed' && !isCompletedToday
        ? Math.min(100, algo.urgency + Math.round(15 * (t.recurring_debt || 0))) : algo.urgency;

      return {
        id: String(t.id),
        title: t.title,
        description: t.notes || '',
        importance,
        urgency,
        importanceTier,
        impactSignals,
        timeMode,
        recurrenceRule: t.recurrence_rule || null,
        urgencyPace,
        importanceManualOverride: manualOverride,
        scoreScale: 100,
        useAutoUrgency: true,
        isImportant: importance >= PRIORITY_THRESHOLD,
        isUrgent: urgency >= PRIORITY_THRESHOLD,
        quadrant: calculateQuadrant(importance, urgency),
        isCompleted: isCompletedToday,
        completedDates: isCompletedToday
          ? Array.from(new Set([...completedDates, todayStr]))
          : completedDates,
        deadlineAt: t.deadline || null,
        deadlineKind: t.deadline_kind === 'hard' ? 'hard' : 'soft',
        dueDate: effectiveDueDate
          ? /^\d{4}-\d{2}-\d{2}$/.test(effectiveDueDate)
            ? effectiveDueDate
            : formatLocalDate(new Date(effectiveDueDate))
          : null,
        tags: parseArr<string>(t.tags).length > 0
          ? parseArr<string>(t.tags)
          : Array.isArray(t.tags)
          ? t.tags
          : typeof t.tags === 'string' && !t.tags.trim().startsWith('[')
          ? t.tags
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean)
          : [],
        estimatedMinutes: t.duration_minutes || 60,
        isFixed: Boolean(t.is_fixed),
        isConcurrent: Boolean(t.is_concurrent),
        scheduledStart: t.scheduled_start,
        scheduledEnd: t.scheduled_end,
        createdAt: t.created_at || new Date().toISOString(),
        completedAt: isCompletedToday ? t.updated_at || new Date().toISOString() : null,
        algorithmStatusText: algo.statusText,
      };
    },
    [currentTime, todayBusyMinutesAhead]
  );

  const tasks = useMemo(() => rawServerTasks.map(mapServerTask), [rawServerTasks, mapServerTask]);

  // 拉取任务列表与今日外部日历占用
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const [tasksRes, calRes] = await Promise.allSettled([
        api.get('/tasks'),
        api.get('/calendar/events', {
          params: { start: todayStart.toISOString(), end: todayEnd.toISOString() },
        }),
      ]);

      if (tasksRes.status === 'fulfilled') {
        setRawServerTasks(tasksRes.value.data.tasks || []);
      }
      if (calRes.status === 'fulfilled') {
        const events = calRes.value.data?.events || [];
        setExternalBusyIntervals(
          events
            .filter((ev: any) => !ev.allDay && ev.extendedProps?.type === 'external')
            .map((ev: any) => ({ start: ev.start, end: ev.end }))
        );
      }
    } catch (err) {
      console.error('拉取任务列表失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

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

  // 分类与四象限定义
  const filterCategories = [
    { key: 'all', label: t('nav.all_tasks'), icon: Inbox, color: 'text-blue-600 dark:text-blue-400' },
    { key: 'q1', label: t('quad.do_first'), icon: Flame, color: 'text-rose-600 dark:text-rose-400' },
    { key: 'q2', label: t('quad.schedule'), icon: Star, color: 'text-blue-600 dark:text-blue-400' },
    { key: 'q3', label: t('quad.delegate'), icon: Clock, color: 'text-amber-600 dark:text-amber-400' },
    { key: 'q4', label: t('quad.eliminate'), icon: Layers, color: 'text-gray-500 dark:text-neutral-400' },
    { key: 'completed', label: t('nav.completed_tasks'), icon: Archive, color: 'text-gray-400 dark:text-neutral-500' },
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

  // 同步统计数据至父级侧边栏
  useEffect(() => {
    onCountsUpdate?.(categoryCounts);
  }, [categoryCounts, onCountsUpdate]);

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

  // 根据分类及搜索框过滤任务列表
  const { uncompletedTasks, completedTasks, filteredTasks } = useMemo(() => {
    const matching = tasks.filter((task) => {
      if (currentCategory === 'completed') {
        if (!task.isCompleted) return false;
      } else if (currentCategory.startsWith('q')) {
        if (task.quadrant !== currentCategory) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTitle = task.title.toLowerCase().includes(q);
        const matchDesc = task.description?.toLowerCase().includes(q);
        if (!matchTitle && !matchDesc) return false;
      }
      return true;
    });

    const uncompleted = matching.filter((t) => !t.isCompleted);
    const completed = matching.filter((t) => t.isCompleted);

    return {
      uncompletedTasks: uncompleted,
      completedTasks: completed,
      filteredTasks: viewMode === 'matrix' ? uncompleted : matching,
    };
  }, [tasks, currentCategory, searchQuery, viewMode]);

  // 点击直角坐标平面任意空白处，自动落位创建
  const handleCreateWithCoords = useCallback((importance: number, urgency: number) => {
    setClickCoords({ importance, urgency });
    setEditingTask(null);
    setIsTaskModalOpen(true);
  }, []);

  // 保存任务 (新建 / 编辑)
  const [planning, setPlanning] = useState<PlanningState | null>(null);

  const handleSaveTask = async (data: Partial<TaskModalSavePayload> & {
    title: string;
    importance: number;
    urgency: number;
  }): Promise<boolean> => {
    setPlanning({ title: editingTask ? '正在更新日程' : '正在规划全部日程', status: 'working' });
    try {
      const payload = {
        title: data.title,
        duration_minutes: data.estimatedMinutes,
        importance: data.importance,
        urgency: data.urgency,
        importance_tier: data.importanceTier || inferTierFromScore(data.importance),
        impact_signals: data.impactSignals || [],
        time_mode: data.timeMode || (data.dueDate ? 'deadline' : 'flexible'),
        recurrence_rule: data.recurrenceRule || null,
        urgency_pace: data.urgencyPace || 'soon',
        importance_manual_override:
          data.importanceManualOverride !== undefined ? data.importanceManualOverride : null,
        score_scale: 100,
        deadline: serializeDeadlineIso(data.dueDate),
        deadline_kind: data.deadlineKind || 'soft',
        tags: data.tags || [],
        scheduled_start: data.scheduledStart || null,
        scheduled_end: data.scheduledEnd || null,
        is_fixed: data.isFixed ? 1 : 0,
        is_concurrent: data.isConcurrent ? 1 : 0,
        notes: data.description || '',
        auto_schedule: !data.isFixed,
      };

      const response = editingTask
        ? await api.put(`/tasks/${editingTask.id}`, payload)
        : await api.post('/tasks', payload);
      setPlanning({ title: language === 'zh' ? '日程已更新' : 'Schedule updated', status: 'success', detail: response.data.replan?.summary || response.data.message });
      await fetchTasks();
      setIsTaskModalOpen(false);
      setEditingTask(null);
      setClickCoords(null);
      return true;
    } catch (err: any) {
      setPlanning({ title: '保存失败', status: 'error', detail: err.response?.data?.error || '请重试' });
      return false;
    }
  };

  // Google Tasks 风格快速回车新建任务 (0~100 分制)
  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTaskTitle.trim() || quickTaskSubmitting) return;
    setQuickTaskSubmitting(true);
    try {
      let tier: ImportanceTier = 'support';
      let imp = 58;
      let urg = 60;
      let dueDate: string | null = formatLocalDate(new Date());
      let timeMode: TimeMode = 'deadline';
      let urgencyPace: UrgencyPace = 'soon';

      if (currentCategory === 'q1') {
        tier = 'vital';
        imp = 82;
        urg = 85;
      } else if (currentCategory === 'q2') {
        tier = 'vital';
        imp = 82;
        urg = 35;
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 10);
        dueDate = formatLocalDate(nextWeek);
      } else if (currentCategory === 'q3') {
        tier = 'minor';
        imp = 25;
        urg = 85;
      } else if (currentCategory === 'q4') {
        tier = 'minor';
        imp = 25;
        urg = 25;
        dueDate = null;
        timeMode = 'flexible';
        urgencyPace = 'later';
      }

      const ok = await handleSaveTask({
        title: quickTaskTitle.trim(),
        importance: imp,
        urgency: urg,
        importanceTier: tier,
        impactSignals: [],
        timeMode,
        urgencyPace,
        dueDate,
        estimatedMinutes: 30,
      });
      if (ok) setQuickTaskTitle('');
    } finally {
      setQuickTaskSubmitting(false);
    }
  };

  // 智能向导创建确认
  const handleWizardConfirm = (data: {
    title: string;
    importance: number;
    urgency: number;
    importanceTier: ImportanceTier;
    impactSignals: ImpactSignal[];
    timeMode: TimeMode;
    urgencyPace: UrgencyPace;
    dueDate: string | null;
    estimatedMinutes?: number;
  }) => {
    handleSaveTask({
      title: data.title,
      importance: data.importance,
      urgency: data.urgency,
      importanceTier: data.importanceTier,
      impactSignals: data.impactSignals,
      timeMode: data.timeMode,
      urgencyPace: data.urgencyPace,
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
    const todayStr = formatLocalDate(new Date());

    // 乐观更新 UI
    setRawServerTasks((prev) =>
      prev.map((t) => {
        if (String(t.id) !== taskId) return t;
        let completedDates: string[] = [];
        try {
          completedDates = Array.isArray(t.completed_dates)
            ? t.completed_dates
            : t.completed_dates
            ? JSON.parse(t.completed_dates)
            : [];
        } catch {}
        const nextDates = willComplete
          ? Array.from(new Set([...completedDates, todayStr]))
          : completedDates.filter((d) => d !== todayStr);
        if (t.time_mode === 'daily_fixed') {
          return {
            ...t,
            completed_dates: JSON.stringify(nextDates),
            urgency: willComplete ? 15 : t.urgency,
          };
        }
        return {
          ...t,
          status: willComplete ? 'completed' : 'scheduled',
          completed_dates: JSON.stringify(nextDates),
        };
      })
    );

    try {
      await api.post(`/tasks/${taskId}/action`, {
        action: willComplete ? 'complete' : 'reopen',
      });
      await fetchTasks();
    } catch (err) {
      console.error('切换完成状态失败:', err);
      fetchTasks();
    }
  };

  // 删除任务并刷新受影响重排结果 (C08)
  const handleDeleteTask = async (taskId: string) => {
    if (!window.confirm(t('workspace.delete_confirm', '确定要删除该待办事项吗？'))) return;

    setRawServerTasks((prev) => prev.filter((t) => String(t.id) !== taskId));
    try {
      await api.delete(`/tasks/${taskId}`);
      await fetchTasks();
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

  // 批量版本化数据导入 (C07)
  const handleImportTasks = async (importedList: unknown, mode: 'merge' | 'replace' = 'merge') => {
    const res = await api.post('/tasks/backup/import', { data: importedList, mode });
    await fetchTasks();
    setIsBackupOpen(false);
    return res.data;
  };

  // 原子清空所有任务 (C07)
  const handleClearAll = async () => {
    if (!window.confirm('确定要清空全部事项吗？此操作无法撤销！')) return;
    await api.delete('/tasks/all');
    await fetchTasks();
    setIsBackupOpen(false);
  };

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-white dark:bg-[#1e1f20]">
      {planning && <PlanningProgress state={planning} onClose={() => setPlanning(null)} />}
      {/* 顶部极简操作工具栏 (统一按照日历日程高度与规格) */}
      <header className="h-14 px-3 sm:px-5 border-b border-gray-200/80 dark:border-neutral-800 flex items-center justify-between gap-3 shrink-0 bg-white dark:bg-[#1e1f20] transition-colors">
        {/* 左侧: 移动端侧栏汉堡菜单 + 标题与分类 */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {onOpenMobileMenu && (
            <button
              type="button"
              onClick={onOpenMobileMenu}
              className="md:hidden p-2 rounded-full text-gray-600 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800 transition cursor-pointer"
              title={t('nav.open_sidebar', '打开侧边导航')}
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <div className="flex items-center gap-2 truncate ml-1 sm:ml-2">
            <h2 className="text-lg sm:text-xl font-normal text-gray-800 dark:text-gray-100 tracking-tight truncate">
              {viewMode === 'matrix' ? t('nav.matrix') : t('nav.list')}
            </h2>
            <span className="text-xs text-gray-400 dark:text-neutral-500 font-mono hidden sm:inline">
              · {filterCategories.find((c) => c.key === currentCategory)?.label || t('nav.all_tasks')} ({filteredTasks.length})
            </span>
          </div>
        </div>

        {/* 右侧: 搜索框 + 刷新 + 明暗/系统主题切换 (严格对齐日历日程按钮与文字规格) */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* 搜索框 (圆角胶囊风格，高度、内边距与字体大小严格对齐日历) */}
          <div className="relative w-24 min-[400px]:w-32 sm:w-52">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-neutral-500 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('workspace.search_placeholder')}
              className="w-full pl-9 pr-3.5 py-1.5 text-xs bg-white dark:bg-[#28292a] border border-gray-300 dark:border-neutral-700 hover:bg-gray-50 dark:hover:bg-neutral-800 text-gray-900 dark:text-gray-100 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors placeholder:text-gray-400 dark:placeholder:text-neutral-500"
            />
          </div>

          {/* 刷新按钮 (与日历日程按钮规格一致: p-2 rounded-full, w-4 h-4 图标) */}
          <button
            type="button"
            onClick={() => fetchTasks()}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-600 dark:text-neutral-300 transition-colors cursor-pointer"
            title={t('workspace.refresh_tasks')}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* 主题模式切换 (与日历日程按钮规格一致: p-2 rounded-full, w-4 h-4 图标) */}
          <button
            type="button"
            onClick={cycleTheme}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-600 dark:text-neutral-300 transition-colors cursor-pointer"
            title={
              themeMode === 'light'
                ? (language === 'zh' ? '当前：浅色模式 (点击切换为暗色)' : 'Current: Light Mode (Click for Dark)')
                : themeMode === 'dark'
                ? (language === 'zh' ? '当前：深色模式 (点击切换为跟随系统)' : 'Current: Dark Mode (Click for System)')
                : (language === 'zh' ? '当前：跟随系统 (点击切换为浅色)' : 'Current: System (Click for Light)')
            }
          >
            {themeMode === 'light' && <Sun className="w-4 h-4 text-amber-500" />}
            {themeMode === 'dark' && <Moon className="w-4 h-4 text-blue-400" />}
            {themeMode === 'system' && <Monitor className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* 核心无缝画布 (全高贴边无外层卡片) */}
      <div className="flex-1 min-h-0 w-full overflow-hidden p-2 sm:p-3">
        {/* 1. 四象限直角坐标系看板视图 */}
        {viewMode === 'matrix' && (
          <MatrixBoard
            tasks={filteredTasks}
            onToggleComplete={handleToggleComplete}
            onEdit={handleEditTask}
            onDelete={handleDeleteTask}
            onOpenCreateWithCoordinates={handleCreateWithCoords}
          />
        )}

        {/* 2. Google Tasks 待办清单列表视图 (模仿 Google Calendar - Tasks) */}
        {viewMode === 'list' && (
          <div className="h-full overflow-y-auto px-4 py-4 sm:px-8 sm:py-6 max-w-4xl mx-auto w-full scrollbar-thin select-none">
            {/* Google Tasks 风格快速新建任务栏 */}
            <form onSubmit={handleQuickAdd} className="mb-4">
              <div className="flex items-center gap-3 px-4 py-3 bg-[#f0f4f9] dark:bg-[#282a2d] hover:bg-[#e9eef6] dark:hover:bg-[#303337] focus-within:bg-white dark:focus-within:bg-[#202124] focus-within:shadow-md focus-within:ring-2 focus-within:ring-blue-500/20 rounded-2xl border border-transparent focus-within:border-gray-200 dark:focus-within:border-neutral-700 transition-all">
                <Plus className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 stroke-[2.5]" />
                <input
                  type="text"
                  value={quickTaskTitle}
                  onChange={(e) => setQuickTaskTitle(e.target.value)}
                  placeholder={t('workspace.quick_add_placeholder', '添加待办事项 (输入后按 Enter 保存)...')}
                  className="flex-1 bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-neutral-400 outline-none"
                />
                {quickTaskTitle.trim() && (
                  <button
                    type="submit"
                    disabled={quickTaskSubmitting}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
                  >
                    {t('common.save', '保存')}
                  </button>
                )}
              </div>
            </form>

            {loading ? (
              <div className="p-12 text-center text-gray-400 dark:text-neutral-500 text-xs">
                {t('common.loading')}
              </div>
            ) : (currentCategory === 'completed' ? completedTasks : uncompletedTasks).length === 0 && (currentCategory === 'completed' || completedTasks.length === 0) ? (
              <div className="p-12 text-center space-y-3">
                <div className="w-14 h-14 mx-auto rounded-full bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <CheckCircle2 className="w-8 h-8 stroke-[1.8]" />
                </div>
                <div className="text-gray-800 dark:text-neutral-200 font-semibold text-base">
                  {searchQuery ? t('workspace.no_search_results') : (currentCategory === 'completed' ? (language === 'zh' ? '暂无已完成事项' : 'No completed tasks yet') : (language === 'zh' ? '所有待办已完成' : 'All tasks completed!'))}
                </div>
                <p className="text-gray-400 dark:text-neutral-500 text-xs max-w-sm mx-auto">
                  {t('workspace.empty_hint', '享受高效整理的美好时光，或点击上方输入框快速添加新事项。')}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {/* 活跃待办列表 */}
                {(currentCategory === 'completed' ? completedTasks : uncompletedTasks).map((task) => {
                  const isCompleted = task.isCompleted;
                  const quad = task.quadrant;

                  const quadStyles = {
                    q1: { name: t('quad.do_first'), color: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800' },
                    q2: { name: t('quad.schedule'), color: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800' },
                    q3: { name: t('quad.delegate'), color: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800' },
                    q4: { name: t('quad.eliminate'), color: 'bg-gray-50 text-gray-600 dark:bg-neutral-800/60 dark:text-neutral-400 border-gray-200 dark:border-neutral-700' },
                  }[quad];

                  return (
                    <div
                      key={task.id}
                      className="py-3 px-3.5 rounded-xl hover:bg-[#f8fafd] dark:hover:bg-[#282a2d] transition-all flex items-start gap-3.5 group border-b border-gray-100/80 dark:border-neutral-800/60 last:border-b-0"
                    >
                      {/* Google Tasks 圆形复选框 */}
                      <button
                        type="button"
                        onClick={() => handleToggleComplete(task.id)}
                        className={`w-5 h-5 mt-0.5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all cursor-pointer ${
                          isCompleted
                            ? 'bg-blue-600 dark:bg-blue-500 border-blue-600 dark:border-blue-500 text-white'
                            : 'border-gray-400 dark:border-neutral-500 hover:border-blue-600 dark:hover:border-blue-400 group-hover:border-blue-500 text-transparent hover:text-blue-600'
                        }`}
                        title={isCompleted ? t('workspace.mark_uncompleted') : t('workspace.mark_completed')}
                      >
                        <Check className="w-3 h-3 stroke-[3]" />
                      </button>

                      {/* 标题与详情 */}
                      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => handleEditTask(task)}>
                        <div
                          className={`text-sm font-medium leading-snug truncate ${
                            isCompleted ? 'line-through text-gray-400 dark:text-neutral-500' : 'text-gray-900 dark:text-gray-100'
                          }`}
                        >
                          {task.title}
                        </div>

                        {task.description && (
                          <div className="text-xs text-gray-500 dark:text-neutral-400 mt-1 line-clamp-2">
                            {task.description}
                          </div>
                        )}

                        {/* Google Tasks 风格 Chips */}
                        <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
                          {task.dueDate && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-normal border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-gray-700 dark:text-neutral-300 hover:border-blue-500 hover:text-blue-600 transition">
                              <CalendarIcon className="w-3 h-3 text-gray-500 dark:text-neutral-400" />
                              <span>{task.dueDate}</span>
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${quadStyles.color}`}
                          >
                            {quadStyles.name}
                          </span>
                          {task.estimatedMinutes && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-neutral-400 font-mono">
                              <Clock className="w-3 h-3" />
                              <span>{task.estimatedMinutes} {t('general.minutes')}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 悬浮操作按钮 */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          type="button"
                          onClick={() => handleEditTask(task)}
                          className="p-1.5 rounded-full text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-neutral-800 transition cursor-pointer"
                          title={t('common.edit')}
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTask(task.id)}
                          className="p-1.5 rounded-full text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                          title={t('common.delete')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Google Tasks 已完成事项折叠面板 */}
                {completedTasks.length > 0 && currentCategory !== 'completed' && (
                  <div className="mt-8 pt-4 border-t border-gray-200/80 dark:border-neutral-800">
                    <button
                      type="button"
                      onClick={() => setCompletedExpanded(!completedExpanded)}
                      className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-neutral-400 hover:text-gray-800 dark:hover:text-neutral-200 transition py-1 cursor-pointer select-none"
                    >
                      {completedExpanded ? (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-500" />
                      )}
                      <span>{t('workspace.completed_section', '已完成')} ({completedTasks.length})</span>
                    </button>

                    {completedExpanded && (
                      <div className="mt-2 space-y-1">
                        {completedTasks.map((task) => (
                          <div
                            key={task.id}
                            className="py-2.5 px-3.5 rounded-xl hover:bg-[#f8fafd] dark:hover:bg-[#282a2d] transition-all flex items-start gap-3.5 group opacity-75 hover:opacity-100 border-b border-gray-100/60 dark:border-neutral-800/40 last:border-b-0"
                          >
                            <button
                              type="button"
                              onClick={() => handleToggleComplete(task.id)}
                              className="w-5 h-5 mt-0.5 rounded-full bg-blue-600 dark:bg-blue-500 border-2 border-blue-600 dark:border-blue-500 text-white flex items-center justify-center shrink-0 transition-all cursor-pointer"
                              title={t('workspace.mark_uncompleted')}
                            >
                              <Check className="w-3 h-3 stroke-[3]" />
                            </button>

                            <div className="min-w-0 flex-1 cursor-pointer" onClick={() => handleEditTask(task)}>
                              <div className="text-sm font-normal line-through text-gray-400 dark:text-neutral-500 leading-snug">
                                {task.title}
                              </div>
                              {task.description && (
                                <div className="text-xs text-gray-400 dark:text-neutral-500 mt-0.5 line-clamp-1">
                                  {task.description}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              <button
                                type="button"
                                onClick={() => handleDeleteTask(task.id)}
                                className="p-1 rounded-full text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                                title={t('common.delete')}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
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
        onToggleComplete={handleToggleComplete}
        onDelete={handleDeleteTask}
        initialTask={editingTask}
        defaultImportance={clickCoords?.importance ?? 58}
        defaultUrgency={clickCoords?.urgency}
        allExistingTags={allTags}
        dailyBusyMinutesAhead={todayBusyMinutesAhead}
      />

      {isWizardOpen && (
        <LazyBoundary fallback={null}>
          <WizardModal
            isOpen={isWizardOpen}
            onClose={() => setIsWizardOpen(false)}
            dailyBusyMinutesAhead={todayBusyMinutesAhead}
            onConfirmTask={handleWizardConfirm}
          />
        </LazyBoundary>
      )}

      {isStatsOpen && (
        <LazyBoundary fallback={null}>
          <StatsModal
            isOpen={isStatsOpen}
            onClose={() => setIsStatsOpen(false)}
            stats={stats}
          />
        </LazyBoundary>
      )}

      {isBackupOpen && (
        <LazyBoundary fallback={null}>
          <BackupModal
            isOpen={isBackupOpen}
            onClose={() => setIsBackupOpen(false)}
            tasks={tasks}
            onImport={handleImportTasks}
            onClearAll={handleClearAll}
          />
        </LazyBoundary>
      )}
    </div>
  );
};
