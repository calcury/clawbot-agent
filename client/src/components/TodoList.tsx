import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api/client';
import {
  Plus,
  Clock,
  RotateCcw,
  Check,
  Trash2,
  Sparkles,
  Search,
  CheckCircle2,
  Calendar,
  AlertCircle,
  Inbox,
  Flame,
  Star,
  Layers,
  Archive,
  RefreshCw,
} from 'lucide-react';

interface Task {
  id: number;
  title: string;
  duration_minutes: number;
  urgency: number;
  importance: number;
  deadline: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  status: 'pending_slot' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'delayed';
  notes: string | null;
  created_at: string;
}

// Eisenhower Quadrant helper
function getQuadrant(importance: number, urgency: number): {
  id: string;
  name: string;
  badge: string;
  color: string;
  bg: string;
  border: string;
} {
  const important = importance >= 3;
  const urgent = urgency >= 3;
  if (important && urgent) {
    return {
      id: 'q1',
      name: 'Q1 紧急且重要',
      badge: '重要紧急',
      color: 'text-rose-700 dark:text-rose-300',
      bg: 'bg-rose-50 dark:bg-rose-950/40',
      border: 'border-rose-200/80 dark:border-rose-900/60',
    };
  }
  if (important && !urgent) {
    return {
      id: 'q2',
      name: 'Q2 重要不紧急',
      badge: '规划深耕',
      color: 'text-blue-700 dark:text-blue-300',
      bg: 'bg-blue-50 dark:bg-blue-950/40',
      border: 'border-blue-200/80 dark:border-blue-900/60',
    };
  }
  if (!important && urgent) {
    return {
      id: 'q3',
      name: 'Q3 紧急不重要',
      badge: '批量委派',
      color: 'text-amber-700 dark:text-amber-300',
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      border: 'border-amber-200/80 dark:border-amber-900/60',
    };
  }
  return {
    id: 'q4',
    name: 'Q4 不重要不紧急',
    badge: '琐事备忘',
    color: 'text-gray-600 dark:text-neutral-400',
    bg: 'bg-gray-50 dark:bg-neutral-800/60',
    border: 'border-gray-200/80 dark:border-neutral-700/60',
  };
}

export const TodoList: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [showModal, setShowModal] = useState<boolean>(false);

  // Form states
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(60);
  const [urgency, setUrgency] = useState(3);
  const [importance, setImportance] = useState(3);
  const [deadline, setDeadline] = useState('');
  const [notes, setNotes] = useState('');
  const [autoSchedule, setAutoSchedule] = useState(true);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await api.get('/tasks');
      setTasks(res.data.tasks || []);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setFormSubmitting(true);
    try {
      await api.post('/tasks', {
        title,
        duration_minutes: duration,
        urgency,
        importance,
        deadline: deadline ? new Date(deadline).toISOString() : null,
        notes,
        auto_schedule: autoSchedule,
      });
      setShowModal(false);
      setTitle('');
      setNotes('');
      setDeadline('');
      fetchTasks();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      alert(error.response?.data?.error || '创建任务失败');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleAction = async (id: number, action: 'complete' | 'extend', extendMinutes?: number) => {
    try {
      await api.post(`/tasks/${id}/action`, {
        action,
        extend_minutes: extendMinutes,
      });
      fetchTasks();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      alert(error.response?.data?.error || '操作失败');
    }
  };

  const handleToggleComplete = (task: Task) => {
    if (task.status === 'completed') {
      handleReschedule(task.id);
    } else {
      handleAction(task.id, 'complete');
    }
  };

  const handleReschedule = async (id: number) => {
    try {
      const res = await api.post(`/tasks/${id}/reschedule`);
      alert(res.data.message || '重排成功');
      fetchTasks();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      alert(error.response?.data?.error || '重排失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定要删除该待办任务吗？')) return;
    try {
      await api.delete(`/tasks/${id}`);
      fetchTasks();
    } catch {
      alert('删除失败');
    }
  };

  // Filter tasks in memory for instant responsiveness
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      // Search keyword filter
      if (search.trim()) {
        const query = search.toLowerCase();
        const matchTitle = t.title.toLowerCase().includes(query);
        const matchNotes = t.notes?.toLowerCase().includes(query);
        if (!matchTitle && !matchNotes) return false;
      }

      // Category / Status / Quadrant filter
      if (activeFilter === 'all') return true;
      if (activeFilter === 'scheduled') return t.status === 'scheduled';
      if (activeFilter === 'in_progress') return t.status === 'in_progress';
      if (activeFilter === 'pending_slot') return t.status === 'pending_slot';
      if (activeFilter === 'completed') return t.status === 'completed';
      if (activeFilter === 'q1') return t.importance >= 3 && t.urgency >= 3;
      if (activeFilter === 'q2') return t.importance >= 3 && t.urgency < 3;
      if (activeFilter === 'q3') return t.importance < 3 && t.urgency >= 3;
      if (activeFilter === 'q4') return t.importance < 3 && t.urgency < 3;
      return true;
    });
  }, [tasks, search, activeFilter]);

  // Counts by filter
  const counts = useMemo(() => {
    const res: Record<string, number> = {
      all: tasks.length,
      scheduled: 0,
      in_progress: 0,
      pending_slot: 0,
      completed: 0,
      q1: 0,
      q2: 0,
      q3: 0,
      q4: 0,
    };
    tasks.forEach((t) => {
      if (res[t.status] !== undefined) res[t.status]++;
      const isImp = t.importance >= 3;
      const isUrg = t.urgency >= 3;
      if (isImp && isUrg) res.q1++;
      else if (isImp && !isUrg) res.q2++;
      else if (!isImp && isUrg) res.q3++;
      else res.q4++;
    });
    return res;
  }, [tasks]);

  const filterCategories = [
    { key: 'all', label: '全部待办', icon: Inbox, color: 'text-blue-600 dark:text-blue-400' },
    { key: 'q1', label: 'Q1 重要且紧急', icon: Flame, color: 'text-rose-600 dark:text-rose-400' },
    { key: 'q2', label: 'Q2 重要不紧急', icon: Star, color: 'text-blue-600 dark:text-blue-400' },
    { key: 'q3', label: 'Q3 紧急不重要', icon: Clock, color: 'text-amber-600 dark:text-amber-400' },
    { key: 'q4', label: 'Q4 不重要不紧急', icon: Layers, color: 'text-gray-500 dark:text-neutral-400' },
    { key: 'scheduled', label: '已排程日程', icon: Calendar, color: 'text-sky-600 dark:text-sky-400' },
    { key: 'in_progress', label: '进行中任务', icon: Sparkles, color: 'text-emerald-600 dark:text-emerald-400' },
    { key: 'pending_slot', label: '待排期事项', icon: AlertCircle, color: 'text-amber-600 dark:text-amber-400' },
    { key: 'completed', label: '已完成事项', icon: Archive, color: 'text-gray-400 dark:text-neutral-500' },
  ];

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col space-y-2.5 overflow-hidden">
      {/* Top Actions */}
      <div className="shrink-0 flex items-center justify-end gap-2">
        <button
          onClick={() => fetchTasks()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-[#1e1f20] hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-600 dark:text-neutral-300 border border-gray-200/80 dark:border-neutral-700/80 rounded-full text-xs font-medium transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} />
          <span>刷新</span>
        </button>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-full text-xs font-medium shadow-xs transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>添加任务</span>
        </button>
      </div>

      {/* 左右排版: Left Sidebar (Categories + Quick Add) / Right Main (Task List) */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 items-stretch overflow-hidden">
        {/* Left Column: Filter Rail + Quick Task Add */}
        <aside className="w-full lg:w-72 xl:w-80 shrink-0 flex flex-col gap-3 overflow-y-auto pr-1">
          {/* 1. Category Filter Rail */}
          <div className="bg-white dark:bg-[#1e1f20] rounded-2xl p-3 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs transition-colors">
            <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 dark:text-neutral-500 px-3 py-1.5">
              分类与四象限
            </div>
            <div className="space-y-0.5 mt-1">
              {filterCategories.map((item) => {
                const Icon = item.icon;
                const isActive = activeFilter === item.key;
                const count = counts[item.key] || 0;
                return (
                  <button
                    key={item.key}
                    onClick={() => setActiveFilter(item.key)}
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

          {/* 2. Quick Inline Task Creator (Desktop) */}
          <div className="hidden lg:block bg-white dark:bg-[#1e1f20] rounded-2xl p-4 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs transition-colors">
            <div className="flex items-center gap-2 pb-2.5 border-b border-gray-100 dark:border-neutral-800 text-xs font-bold text-gray-900 dark:text-gray-100">
              <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>快速新建待办</span>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-3 mt-3">
              <div>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="待办名称 (如: 准备下周开会材料)"
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
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none"
                  >
                    <option value={15}>15 分钟</option>
                    <option value={30}>30 分钟</option>
                    <option value={45}>45 分钟</option>
                    <option value={60}>60 分钟 (1h)</option>
                    <option value={90}>90 分钟 (1.5h)</option>
                    <option value={120}>120 分钟 (2h)</option>
                    <option value={180}>180 分钟 (3h)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 dark:text-neutral-400 mb-1">
                    截止时间 (DDL)
                  </label>
                  <input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 dark:text-neutral-400 mb-1">
                    加急度 (1-5)
                  </label>
                  <select
                    value={urgency}
                    onChange={(e) => setUrgency(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none"
                  >
                    <option value={1}>1 - 极低</option>
                    <option value={2}>2 - 较低</option>
                    <option value={3}>3 - 普通</option>
                    <option value={4}>4 - 紧急</option>
                    <option value={5}>5 - 特急</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 dark:text-neutral-400 mb-1">
                    重要度 (1-5)
                  </label>
                  <select
                    value={importance}
                    onChange={(e) => setImportance(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none"
                  >
                    <option value={1}>1 - 极低</option>
                    <option value={2}>2 - 较低</option>
                    <option value={3}>3 - 普通</option>
                    <option value={4}>4 - 重要</option>
                    <option value={5}>5 - 核心关键</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={formSubmitting}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white text-xs font-medium rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{formSubmitting ? '规划排程中...' : '录入并自动规划'}</span>
              </button>
            </form>
          </div>
        </aside>

        {/* Right Column: Search + Task List */}
        <section className="flex-1 min-w-0 w-full flex flex-col gap-3 overflow-hidden">
          {/* Search bar & Active Filter Bar */}
          <div className="shrink-0 bg-white dark:bg-[#1e1f20] rounded-2xl p-3 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 transition-colors">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                {filterCategories.find((c) => c.key === activeFilter)?.label || '任务清单'}
              </span>
              <span className="text-xs text-gray-400 dark:text-neutral-500">
                (共 {filteredTasks.length} 项)
              </span>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-neutral-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索标题或备注..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700/80 text-gray-900 dark:text-gray-100 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
              />
            </div>
          </div>

          {/* Tasks List */}
          <div className="flex-1 min-h-0 bg-white dark:bg-[#1e1f20] rounded-2xl border border-gray-200/80 dark:border-neutral-800/80 shadow-xs divide-y divide-gray-100 dark:divide-neutral-800/80 overflow-y-auto transition-colors">
            {loading ? (
              <div className="p-12 text-center text-gray-400 dark:text-neutral-500 text-xs sm:text-sm">
                正在加载任务列表...
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <CheckCircle2 className="w-10 h-10 text-gray-300 dark:text-neutral-600 mx-auto stroke-[1.5]" />
                <div className="text-gray-700 dark:text-neutral-300 font-medium text-sm">
                  {search ? '未检索到匹配的待办' : '该分类下暂无任务'}
                </div>
                <p className="text-gray-400 dark:text-neutral-500 text-xs max-w-sm mx-auto">
                  微信发送给助手如：“明天下午3点排个开会”，或通过左侧快速添加。
                </p>
              </div>
            ) : (
              filteredTasks.map((task) => {
                const isCompleted = task.status === 'completed';
                const hasSchedule = task.scheduled_start && task.scheduled_end;
                const quad = getQuadrant(task.importance, task.urgency);

                const startStr = hasSchedule
                  ? new Date(task.scheduled_start!).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })
                  : '待排期';
                const endStr = hasSchedule
                  ? new Date(task.scheduled_end!).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })
                  : '';

                const isOverdue =
                  task.deadline &&
                  new Date(task.deadline).getTime() < Date.now() &&
                  !isCompleted;

                return (
                  <div
                    key={task.id}
                    className="p-3.5 sm:p-4 hover:bg-gray-50/70 dark:hover:bg-[#252728] transition-colors flex items-start gap-3.5 group"
                  >
                    {/* Circular Checkbox */}
                    <button
                      type="button"
                      onClick={() => handleToggleComplete(task)}
                      className={`mt-0.5 w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all cursor-pointer ${
                        isCompleted
                          ? 'bg-blue-600 dark:bg-blue-500 border-blue-600 dark:border-blue-500 text-white'
                          : 'border-gray-400 dark:border-neutral-500 hover:border-blue-600 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-transparent hover:text-blue-600 dark:hover:text-blue-400'
                      }`}
                      title={isCompleted ? '标记为未完成' : '标记为已完成'}
                    >
                      <Check className="w-3 h-3 stroke-[3]" />
                    </button>

                    {/* Task Content */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-sm font-medium transition ${
                            isCompleted
                              ? 'line-through text-gray-400 dark:text-neutral-500'
                              : 'text-gray-900 dark:text-gray-100'
                          }`}
                        >
                          {task.title}
                        </span>

                        {/* Quadrant badge */}
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${quad.bg} ${quad.color} ${quad.border}`}
                        >
                          {quad.badge}
                        </span>

                        {/* Status badge */}
                        {task.status === 'in_progress' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 animate-pulse">
                            进行中
                          </span>
                        )}
                        {task.status === 'pending_slot' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                            待规划时段
                          </span>
                        )}
                      </div>

                      {/* Metadata Chips */}
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-neutral-400">
                        <span className="inline-flex items-center gap-1 font-mono bg-gray-100 dark:bg-[#28292a] px-2.5 py-0.5 rounded-full text-gray-700 dark:text-neutral-300">
                          <Clock className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                          {hasSchedule ? `${startStr} ~ ${endStr}` : '等待安排时段'}
                        </span>

                        <span className="bg-gray-100 dark:bg-[#28292a] px-2 py-0.5 rounded-full">
                          {task.duration_minutes} 分钟
                        </span>

                        {task.deadline && (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${
                              isOverdue
                                ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-900/60 animate-pulse'
                                : 'text-gray-600 dark:text-neutral-400 bg-gray-100 dark:bg-[#28292a]'
                            }`}
                          >
                            <Calendar className="w-3 h-3" />
                            {isOverdue ? '已逾期: ' : '截止: '}
                            {new Date(task.deadline).toLocaleDateString('zh-CN', {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}

                        {task.notes && (
                          <span className="text-gray-400 dark:text-neutral-500 truncate max-w-xs">
                            备注: {task.notes}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0 self-center opacity-80 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                      {!isCompleted && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleAction(task.id, 'extend', 30)}
                            title="延长 30 分钟"
                            className="px-2 py-1 bg-gray-100 dark:bg-[#28292a] hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-700 dark:text-neutral-200 text-[11px] font-medium rounded-full transition cursor-pointer"
                          >
                            +30m
                          </button>

                          <button
                            type="button"
                            onClick={() => handleReschedule(task.id)}
                            title="重新规划排程"
                            className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-full transition cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => handleDelete(task.id)}
                        className="p-1.5 text-gray-400 dark:text-neutral-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-full transition cursor-pointer"
                        title="删除任务"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Mobile Modal for Add Task */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1e1f20] rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-gray-200 dark:border-neutral-800 animate-fadeIn transition-colors">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-neutral-800">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>新建待办任务</span>
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="w-7 h-7 rounded-full text-gray-400 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 flex items-center justify-center text-sm font-bold transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1.5">
                  任务名称 *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：准备项目方案报告"
                  className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 focus:bg-white dark:focus:bg-[#232425] outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1.5">
                    预计耗时（分钟）
                  </label>
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    min={5}
                    step={5}
                    className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1.5">
                    截止时间 (DDL)
                  </label>
                  <input
                    type="datetime-local"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1.5">
                    紧急程度
                  </label>
                  <select
                    value={urgency}
                    onChange={(e) => setUrgency(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none"
                  >
                    <option value={1}>1 - 极低</option>
                    <option value={2}>2 - 较低</option>
                    <option value={3}>3 - 普通</option>
                    <option value={4}>4 - 紧急</option>
                    <option value={5}>5 - 特急 (优先排期)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1.5">
                    重要程度
                  </label>
                  <select
                    value={importance}
                    onChange={(e) => setImportance(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none"
                  >
                    <option value={1}>1 - 极低</option>
                    <option value={2}>2 - 较低</option>
                    <option value={3}>3 - 普通</option>
                    <option value={4}>4 - 重要</option>
                    <option value={5}>5 - 核心关键</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1.5">
                  备注说明 (可选)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="补充细节信息..."
                  className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none"
                ></textarea>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="auto_schedule_modal"
                  checked={autoSchedule}
                  onChange={(e) => setAutoSchedule(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="auto_schedule_modal" className="text-xs text-gray-600 dark:text-neutral-400 font-medium cursor-pointer">
                  保存后立即根据工作时间段自动规划排程
                </label>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-gray-100 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-700 dark:text-neutral-300 text-xs font-medium rounded-full transition cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-full shadow-sm transition disabled:opacity-50 cursor-pointer"
                >
                  {formSubmitting ? '排程中...' : '确认添加'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
