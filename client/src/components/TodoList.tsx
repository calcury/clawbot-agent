import React, { useState, useEffect } from 'react';
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

export const TodoList: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
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
      const res = await api.get('/tasks', {
        params: {
          status: filterStatus,
          search: search || undefined,
        },
      });
      setTasks(res.data.tasks);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, [filterStatus, search]);

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
      // Reopen
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
            已完成
          </span>
        );
      case 'in_progress':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 animate-pulse">
            进行中
          </span>
        );
      case 'scheduled':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300">
            已排程
          </span>
        );
      case 'pending_slot':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
            待安排
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-neutral-400">
            {status}
          </span>
        );
    }
  };

  const tabs = [
    { key: 'all', label: '全部' },
    { key: 'scheduled', label: '已排程' },
    { key: 'in_progress', label: '进行中' },
    { key: 'completed', label: '已完成' },
    { key: 'pending_slot', label: '待排期' },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-5 sm:space-y-6">
      {/* Google Tasks Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 pb-1">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            我的任务
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-neutral-400 mt-0.5">
            由微信 Clawbot 助手自动规划或手动录入的待办日程清单
          </p>
        </div>

        {/* Google Tasks style "+ Add a task" Floating Button */}
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-full text-xs sm:text-sm font-medium shadow-sm transition shrink-0 cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>添加任务</span>
        </button>
      </div>

      {/* Filter Chips & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Horizontal scrollable Google Tasks filter chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none -mx-1 px-1">
          {tabs.map((tab) => {
            const isActive = filterStatus === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setFilterStatus(tab.key)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium shrink-0 transition ${
                  isActive
                    ? 'bg-blue-600 text-white dark:bg-blue-500 shadow-xs'
                    : 'bg-white dark:bg-[#1e1f20] text-gray-600 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 border border-gray-200 dark:border-neutral-700/80'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-60">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-neutral-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索任务..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-700/80 text-gray-900 dark:text-gray-100 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
          />
        </div>
      </div>

      {/* Tasks List (Google Tasks Surface Style) */}
      <div className="bg-white dark:bg-[#1e1f20] rounded-3xl border border-gray-200/80 dark:border-neutral-800/80 shadow-xs divide-y divide-gray-100 dark:divide-neutral-800/80 overflow-hidden transition-colors">
        {loading ? (
          <div className="p-12 text-center text-gray-400 dark:text-neutral-500 text-xs sm:text-sm">
            正在载入任务清单...
          </div>
        ) : tasks.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <CheckCircle2 className="w-10 h-10 text-gray-300 dark:text-neutral-600 mx-auto stroke-[1.5]" />
            <div className="text-gray-700 dark:text-neutral-300 font-medium text-sm">暂无匹配任务</div>
            <p className="text-gray-400 dark:text-neutral-500 text-xs max-w-sm mx-auto">
              可以在微信中直接向 Clawbot 发送：“帮我排个写周报的任务，1小时，周五前交”，或点击右上角手动添加。
            </p>
          </div>
        ) : (
          tasks.map((task) => {
            const isCompleted = task.status === 'completed';
            const hasSchedule = task.scheduled_start && task.scheduled_end;
            const startStr = hasSchedule
              ? new Date(task.scheduled_start!).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })
              : '未安排';
            const endStr = hasSchedule
              ? new Date(task.scheduled_end!).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })
              : '';

            return (
              <div
                key={task.id}
                className="p-4 sm:p-4.5 hover:bg-gray-50/70 dark:hover:bg-[#252728] transition-colors flex items-start gap-3.5 group"
              >
                {/* Google Tasks Circular Checkbox */}
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

                {/* Content */}
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
                    {getStatusBadge(task.status)}
                  </div>

                  {/* Metadata Pills */}
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-neutral-400">
                    <span className="inline-flex items-center gap-1 font-mono bg-gray-100 dark:bg-[#28292a] px-2.5 py-0.5 rounded-full text-gray-700 dark:text-neutral-300">
                      <Clock className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                      {hasSchedule ? `${startStr} ~ ${endStr}` : '等待安排时段'}
                    </span>

                    <span className="bg-gray-100 dark:bg-[#28292a] px-2 py-0.5 rounded-full">
                      {task.duration_minutes} 分钟
                    </span>

                    <span className="bg-gray-100 dark:bg-[#28292a] px-2 py-0.5 rounded-full">
                      加急 {task.urgency}/5
                    </span>

                    {task.deadline && (
                      <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200/60 dark:border-rose-900/60 px-2 py-0.5 rounded-full font-medium">
                        <Calendar className="w-3 h-3" />
                        截止:{' '}
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

                {/* Actions on desktop hover / mobile tap */}
                <div className="flex items-center gap-1 shrink-0 self-center opacity-80 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                  {!isCompleted && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleAction(task.id, 'extend', 30)}
                        title="延长 30 分钟"
                        className="px-2 py-1 bg-gray-100 dark:bg-[#28292a] hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-700 dark:text-neutral-200 text-[11px] font-medium rounded-full transition"
                      >
                        +30m
                      </button>

                      <button
                        type="button"
                        onClick={() => handleReschedule(task.id)}
                        title="重新规划排程"
                        className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-full transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDelete(task.id)}
                    className="p-1.5 text-gray-400 dark:text-neutral-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-full transition"
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

      {/* Create Task Modal (Google Tasks Surface Dialog) */}
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
                className="w-7 h-7 rounded-full text-gray-400 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 flex items-center justify-center text-sm font-bold transition"
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
                  id="auto_schedule"
                  checked={autoSchedule}
                  onChange={(e) => setAutoSchedule(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="auto_schedule" className="text-xs text-gray-600 dark:text-neutral-400 font-medium cursor-pointer">
                  保存后立即自动根据工作时间段排程
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
