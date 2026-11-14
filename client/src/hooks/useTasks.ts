import { useMemo, useState, useEffect } from 'react';
import { calculateQuadrant, formatLocalDate, isTaskLastDay } from '../types/task';
import type { TaskItem, QuadrantId, TaskFilterOptions } from '../types/task';
import { useLocalStorage } from './useLocalStorage';
import { calculateDynamicUrgency } from '../utils/priorityAlgorithm';

const STORAGE_KEY = 'eisenhower_matrix_user_tasks';

export function useTasks() {
  const [tasks, setTasks] = useLocalStorage<TaskItem[]>(STORAGE_KEY, []);

  // 定时刷新动态紧迫度（每 60 秒自动更新一次时间衰减，且在每次打开/切回窗口时立即自动更新紧急度）
  const [currentTime, setCurrentTime] = useState(() => new Date());

  // 每次打开应用或切回页面时，自动根据截止日期重新计算并同步更新所有任务的紧急度
  useEffect(() => {
    const recalculateAllTasksUrgency = () => {
      const now = new Date();
      setCurrentTime(now);
      setTasks((prev) => {
        if (!prev || prev.length === 0) return prev;
        let hasChanged = false;
        const nextTasks = prev.map((task) => {
          const effectiveDueDate = task.dueDate || formatLocalDate(new Date(task.createdAt || Date.now()));
          const result = calculateDynamicUrgency({
            dueDate: effectiveDueDate,
            estimatedMinutes: task.estimatedMinutes,
            fallbackUrgency: task.urgency,
            currentTime: now,
          });
          const nextUrgency = result.urgency;
          const nextIsImportant = task.importance >= 5;
          const nextIsUrgent = nextUrgency >= 5;
          const nextQuadrant = calculateQuadrant(task.importance, nextUrgency);

          if (
            task.urgency !== nextUrgency ||
            task.isImportant !== nextIsImportant ||
            task.isUrgent !== nextIsUrgent ||
            task.quadrant !== nextQuadrant ||
            task.useAutoUrgency !== true ||
            task.dueDate !== effectiveDueDate ||
            task.algorithmStatusText !== result.statusText
          ) {
            hasChanged = true;
            return {
              ...task,
              dueDate: effectiveDueDate,
              urgency: nextUrgency,
              useAutoUrgency: true,
              isImportant: nextIsImportant,
              isUrgent: nextIsUrgent,
              quadrant: nextQuadrant,
              algorithmStatusText: result.statusText,
            };
          }
          return task;
        });
        return hasChanged ? nextTasks : prev;
      });
    };

    // 初次打开时立即执行一次更新
    recalculateAllTasksUrgency();

    const timer = setInterval(() => {
      recalculateAllTasksUrgency();
    }, 60000);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        recalculateAllTasksUrgency();
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [setTasks]);

  const [filterOptions, setFilterOptions] = useState<TaskFilterOptions>({
    searchQuery: '',
    tag: null,
    status: 'all',
  });

  // 动态解析任务：始终通过“截止期迫近与松弛度算法”自动计算紧迫度与所属象限
  const resolvedTasks = useMemo(() => {
    return tasks.map((task) => {
      const effectiveDueDate = task.dueDate || formatLocalDate(new Date(task.createdAt || Date.now()));
      const result = calculateDynamicUrgency({
        dueDate: effectiveDueDate,
        estimatedMinutes: task.estimatedMinutes,
        fallbackUrgency: task.urgency,
        currentTime,
      });
      const effectiveUrgency = result.urgency;
      const algorithmStatusText = result.statusText;

      const isImportant = task.importance >= 5;
      const isUrgent = effectiveUrgency >= 5;
      const quadrant = calculateQuadrant(task.importance, effectiveUrgency);

      return {
        ...task,
        dueDate: effectiveDueDate,
        urgency: effectiveUrgency,
        useAutoUrgency: true,
        isImportant,
        isUrgent,
        quadrant,
        algorithmStatusText,
      };
    });
  }, [tasks, currentTime]);

  // 添加新任务（紧迫度完全由截止日期自动计算）
  const addTask = (data: {
    title: string;
    description?: string;
    importance: number;
    urgency?: number;
    useAutoUrgency?: boolean;
    dueDate?: string | null;
    tags?: string[];
    estimatedMinutes?: number;
  }) => {
    const importance = Math.max(0, Math.min(10, Number(data.importance) || 5));
    const effectiveDueDate = data.dueDate || formatLocalDate(new Date());

    const result = calculateDynamicUrgency({
      dueDate: effectiveDueDate,
      estimatedMinutes: data.estimatedMinutes,
      currentTime: new Date(),
    });
    const urgency = result.urgency;

    const isImportant = importance >= 5;
    const isUrgent = urgency >= 5;
    const quadrant = calculateQuadrant(importance, urgency);

    const newTask: TaskItem = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: data.title.trim(),
      description: data.description?.trim() || undefined,
      importance,
      urgency,
      useAutoUrgency: true,
      isImportant,
      isUrgent,
      quadrant,
      isCompleted: false,
      completedDates: [],
      dueDate: effectiveDueDate,
      tags: data.tags?.map((t) => t.trim()).filter(Boolean) || [],
      estimatedMinutes: data.estimatedMinutes,
      createdAt: new Date().toISOString(),
      completedAt: null,
      algorithmStatusText: result.statusText,
    };

    setTasks((prev) => [newTask, ...prev]);
    return newTask;
  };

  // 更新任务（紧迫度完全根据截止日期与预计耗时自动重算）
  const updateTask = (id: string, updates: Partial<Omit<TaskItem, 'id' | 'createdAt'>>) => {
    setTasks((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        const nextImportance = updates.importance !== undefined 
          ? Math.max(0, Math.min(10, Number(updates.importance))) 
          : item.importance;

        const nextDueDate = (updates.dueDate !== undefined ? updates.dueDate : item.dueDate) || formatLocalDate(new Date());
        const nextEstimatedMinutes = updates.estimatedMinutes !== undefined ? updates.estimatedMinutes : item.estimatedMinutes;

        const result = calculateDynamicUrgency({
          dueDate: nextDueDate,
          estimatedMinutes: nextEstimatedMinutes,
          currentTime: new Date(),
        });
        const nextUrgency = result.urgency;

        const nextIsImportant = nextImportance >= 5;
        const nextIsUrgent = nextUrgency >= 5;
        const nextQuadrant = calculateQuadrant(nextImportance, nextUrgency);

        return {
          ...item,
          ...updates,
          dueDate: nextDueDate,
          importance: nextImportance,
          urgency: nextUrgency,
          useAutoUrgency: true,
          isImportant: nextIsImportant,
          isUrgent: nextIsUrgent,
          quadrant: nextQuadrant,
          algorithmStatusText: result.statusText,
        };
      })
    );
  };

  // 快捷切换完成状态（在四象限看板中直接切换任务彻底完成状态）
  const toggleComplete = (id: string) => {
    const todayStr = formatLocalDate(new Date());
    setTasks((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const nextCompleted = !item.isCompleted;
        const prevDates = Array.isArray(item.completedDates) ? item.completedDates : [];
        let nextDates = prevDates;
        if (nextCompleted) {
          if (!prevDates.includes(todayStr)) {
            nextDates = [...prevDates, todayStr];
          }
        } else {
          // 取消彻底完成时，同步移除今天及截止日的已完成标记，避免日历仍显示勾选
          nextDates = prevDates.filter((d) => d !== todayStr && d !== item.dueDate);
        }
        return {
          ...item,
          isCompleted: nextCompleted,
          completedDates: nextDates,
          completedAt: nextCompleted ? new Date().toISOString() : null,
        };
      })
    );
  };

  // 日历视图勾选完成：默认仅标记当天 (targetDateStr) 目标完成；
  // 除非那一天是任务的最后一天（即设置了 dueDate 且 targetDateStr >= dueDate），才直接标记任务彻底完成
  const toggleCalendarTaskComplete = (id: string, targetDateStr: string) => {
    setTasks((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const prevDates = Array.isArray(item.completedDates) ? item.completedDates : [];
        const isDoneOnTargetDate = prevDates.includes(targetDateStr) || item.isCompleted;
        const isLastDay = isTaskLastDay(item, targetDateStr);

        if (!isDoneOnTargetDate) {
          // 勾选当天完成
          const nextDates = prevDates.includes(targetDateStr)
            ? prevDates
            : [...prevDates, targetDateStr];

          if (isLastDay) {
            // 那一天是任务的最后一天：直接标记任务彻底完成
            return {
              ...item,
              isCompleted: true,
              completedDates: nextDates,
              completedAt: new Date().toISOString(),
            };
          } else {
            // 不是最后一天：仅认为任务在当天完成，整体仍保持未彻底完成
            return {
              ...item,
              isCompleted: false,
              completedDates: nextDates,
              completedAt: null,
            };
          }
        } else {
          // 取消当天的完成勾选
          const nextDates = prevDates.filter((d) => d !== targetDateStr);
          return {
            ...item,
            isCompleted: false,
            completedDates: nextDates,
            completedAt: null,
          };
        }
      })
    );
  };

  // 删除任务
  const deleteTask = (id: string) => {
    setTasks((prev) => prev.filter((item) => item.id !== id));
  };

  // 清理已完成任务
  const clearCompleted = (quadrantId?: QuadrantId) => {
    setTasks((prev) =>
      prev.filter((item) => {
        if (!item.isCompleted) return true;
        if (quadrantId && item.quadrant !== quadrantId) return true;
        return false;
      })
    );
  };

  // 导入任务列表
  const importTasks = (newTasks: any[]) => {
    const now = new Date();
    const sanitized: TaskItem[] = newTasks.map((t) => {
      const importance = typeof t.importance === 'number' 
        ? Math.max(0, Math.min(10, t.importance)) 
        : (t.isImportant ? 8 : 2);
      const effectiveDueDate = t.dueDate || formatLocalDate(now);
      const result = calculateDynamicUrgency({
        dueDate: effectiveDueDate,
        estimatedMinutes: t.estimatedMinutes,
        currentTime: now,
      });
      const urgency = result.urgency;
      
      return {
        id: t.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: String(t.title || '未命名任务'),
        description: t.description || undefined,
        importance,
        urgency,
        useAutoUrgency: true,
        isImportant: importance >= 5,
        isUrgent: urgency >= 5,
        quadrant: calculateQuadrant(importance, urgency),
        isCompleted: !!t.isCompleted,
        completedDates: Array.isArray(t.completedDates) ? t.completedDates : [],
        dueDate: effectiveDueDate,
        tags: Array.isArray(t.tags) ? t.tags : [],
        estimatedMinutes: t.estimatedMinutes,
        createdAt: t.createdAt || now.toISOString(),
        completedAt: t.completedAt || null,
        algorithmStatusText: result.statusText,
      };
    });
    setTasks(sanitized);
  };

  // 清空所有任务
  const clearAllTasks = () => {
    setTasks([]);
  };

  // 提取所有唯一标签
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    tasks.forEach((t) => t.tags?.forEach((tag) => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  }, [tasks]);

  // 根据当前搜索与筛选条件过滤任务
  const filteredTasks = useMemo(() => {
    const query = filterOptions.searchQuery.trim().toLowerCase();

    return resolvedTasks.filter((task) => {
      if (query) {
        const titleMatch = task.title.toLowerCase().includes(query);
        const descMatch = task.description?.toLowerCase().includes(query) ?? false;
        const tagMatch = task.tags?.some((t) => t.toLowerCase().includes(query)) ?? false;
        if (!titleMatch && !descMatch && !tagMatch) return false;
      }

      if (filterOptions.tag && !task.tags?.includes(filterOptions.tag)) {
        return false;
      }

      if (filterOptions.status === 'pending' && task.isCompleted) return false;
      if (filterOptions.status === 'completed' && !task.isCompleted) return false;

      return true;
    });
  }, [resolvedTasks, filterOptions]);

  // 日历专用任务列表：保留符合搜索与标签筛选的任务，同时确保在某天打卡完成的任务不会在日历中被“仅看未完成”过滤器提前剔除
  const calendarTasks = useMemo(() => {
    const query = filterOptions.searchQuery.trim().toLowerCase();

    return resolvedTasks.filter((task) => {
      if (query) {
        const titleMatch = task.title.toLowerCase().includes(query);
        const descMatch = task.description?.toLowerCase().includes(query) ?? false;
        const tagMatch = task.tags?.some((t) => t.toLowerCase().includes(query)) ?? false;
        if (!titleMatch && !descMatch && !tagMatch) return false;
      }

      if (filterOptions.tag && !task.tags?.includes(filterOptions.tag)) {
        return false;
      }

      return true;
    });
  }, [resolvedTasks, filterOptions.searchQuery, filterOptions.tag]);

  // 将过滤后的任务按象限分组
  const tasksByQuadrant = useMemo(() => {
    const grouped: Record<QuadrantId, TaskItem[]> = {
      q1: [],
      q2: [],
      q3: [],
      q4: [],
    };

    const sorted = [...filteredTasks].sort((a, b) => {
      if (a.isCompleted !== b.isCompleted) {
        return a.isCompleted ? 1 : -1;
      }
      const scoreA = a.importance * 1.5 + a.urgency;
      const scoreB = b.importance * 1.5 + b.urgency;
      return scoreB - scoreA;
    });

    for (const task of sorted) {
      grouped[task.quadrant].push(task);
    }

    return grouped;
  }, [filteredTasks]);

  // 统计指标
  const stats = useMemo(() => {
    const total = resolvedTasks.length;
    const completed = resolvedTasks.filter((t) => t.isCompleted).length;
    const pending = total - completed;

    const breakdown: Record<QuadrantId, { total: number; completed: number; pending: number; percent: number }> = {
      q1: { total: 0, completed: 0, pending: 0, percent: 0 },
      q2: { total: 0, completed: 0, pending: 0, percent: 0 },
      q3: { total: 0, completed: 0, pending: 0, percent: 0 },
      q4: { total: 0, completed: 0, pending: 0, percent: 0 },
    };

    resolvedTasks.forEach((t) => {
      breakdown[t.quadrant].total += 1;
      if (t.isCompleted) breakdown[t.quadrant].completed += 1;
      else breakdown[t.quadrant].pending += 1;
    });

    if (total > 0) {
      (['q1', 'q2', 'q3', 'q4'] as QuadrantId[]).forEach((q) => {
        breakdown[q].percent = Math.round((breakdown[q].total / total) * 100);
      });
    }

    return {
      total,
      completed,
      pending,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      breakdown,
    };
  }, [resolvedTasks]);

  return {
    tasks,
    filteredTasks,
    calendarTasks,
    tasksByQuadrant,
    allTags,
    filterOptions,
    setFilterOptions,
    stats,
    addTask,
    updateTask,
    deleteTask,
    toggleComplete,
    toggleCalendarTaskComplete,
    clearCompleted,
    clearAllTasks,
    importTasks,
  };
}
