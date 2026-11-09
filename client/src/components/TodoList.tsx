import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import {
  CheckSquare,
  Plus,
  Clock,
  RotateCcw,
  CheckCircle,
  Trash2,
  Sparkles,
  Search,
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
      setDuration(60);
      setUrgency(3);
      setImportance(3);
      setDeadline('');
      setNotes('');
      fetchTasks();
    } catch (err: any) {
      alert(err.response?.data?.error || '创建任务失败');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleAction = async (id: number, action: 'complete' | 'extend', extendMinutes = 30) => {
    try {
      await api.post(`/tasks/${id}/action`, { action, extend_minutes: extendMinutes });
      fetchTasks();
    } catch (err: any) {
      alert(err.response?.data?.error || '操作失败');
    }
  };

  const handleReschedule = async (id: number) => {
    try {
      const res = await api.post(`/tasks/${id}/reschedule`);
      alert(res.data.message || '重排成功');
      fetchTasks();
    } catch (err: any) {
      alert(err.response?.data?.error || '重排失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定要删除该待办任务吗？')) return;
    try {
      await api.delete(`/tasks/${id}`);
      fetchTasks();
    } catch (err: any) {
      alert('删除失败');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">已完成</span>;
      case 'in_progress':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700 animate-pulse">进行中</span>;
      case 'scheduled':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-100 text-indigo-700">已排程</span>;
      case 'pending_slot':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700">待安排时间</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">TODO 待办事项管理</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            所有由微信 Clawbot 助手解析或手动录入的任务均在此统一管理与智能排程。
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-md shadow-indigo-600/20 transition shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>添加待办并自动排程</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto">
          {[
            { key: 'all', label: '全部待办' },
            { key: 'scheduled', label: '已排程' },
            { key: 'in_progress', label: '进行中' },
            { key: 'completed', label: '已完成' },
            { key: 'pending_slot', label: '无空位待调整' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilterStatus(tab.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                filterStatus === tab.key
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full md:w-64">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索待办任务名称..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
          />
        </div>
      </div>

      {/* Task List */}
      <div className="space-y-3">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">加载中...</div>
        ) : tasks.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 shadow-xs space-y-3">
            <CheckSquare className="w-10 h-10 text-slate-300 mx-auto" />
            <div className="text-slate-600 font-semibold text-sm">暂无匹配的待办任务</div>
            <p className="text-slate-400 text-xs">
              在微信中向 Clawbot 发送消息（例如："帮我排个写周报的任务，1小时，周五前交"）或点击右上角手动添加。
            </p>
          </div>
        ) : (
          tasks.map((task) => {
            const hasSchedule = task.scheduled_start && task.scheduled_end;
            const startStr = hasSchedule
              ? new Date(task.scheduled_start!).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })
              : '未安排时间';
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
                className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs hover:border-indigo-200 transition flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-2 max-w-xl">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {getStatusBadge(task.status)}
                    <h3 className="text-sm font-bold text-slate-900">{task.title}</h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1 font-medium text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">
                      <Clock className="w-3.5 h-3.5 text-indigo-600" />
                      {hasSchedule ? `${startStr} ~ ${endStr}` : '等待空闲槽位'}
                    </span>

                    <span>⏳ 耗时 {task.duration_minutes} 分钟</span>
                    <span>⚡ 紧急 {task.urgency}/5</span>
                    <span>⭐ 重要 {task.importance}/5</span>

                    {task.deadline && (
                      <span className="text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md font-medium border border-rose-100">
                        DDL: {new Date(task.deadline).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>

                  {task.notes && (
                    <p className="text-xs text-slate-400 italic">备注：{task.notes}</p>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                  {task.status !== 'completed' && (
                    <>
                      <button
                        onClick={() => handleAction(task.id, 'complete')}
                        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-xl border border-emerald-200 transition"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>完成</span>
                      </button>

                      <button
                        onClick={() => handleAction(task.id, 'extend', 30)}
                        title="延长 30 分钟"
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition"
                      >
                        +30m
                      </button>

                      <button
                        onClick={() => handleReschedule(task.id)}
                        title="基于当前最新日历重新计算排程"
                        className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl border border-indigo-200 transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}

                  <button
                    onClick={() => handleDelete(task.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition"
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Create Task Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <span>新建待办任务并智能排程</span>
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  任务名称 *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：撰写项目设计方案"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    预计耗时（分钟）
                  </label>
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    min={5}
                    step={5}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    最迟完成时间 (DDL)
                  </label>
                  <input
                    type="datetime-local"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    紧急程度 (1-5分)
                  </label>
                  <select
                    value={urgency}
                    onChange={(e) => setUrgency(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                  >
                    <option value={1}>1 - 非常低</option>
                    <option value={2}>2 - 较低</option>
                    <option value={3}>3 - 普通 (默认)</option>
                    <option value={4}>4 - 紧急</option>
                    <option value={5}>5 - 特急 (立即安排)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    重要程度 (1-5分)
                  </label>
                  <select
                    value={importance}
                    onChange={(e) => setImportance(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                  >
                    <option value={1}>1 - 极低</option>
                    <option value={2}>2 - 较低</option>
                    <option value={3}>3 - 普通 (默认)</option>
                    <option value={4}>4 - 重要</option>
                    <option value={5}>5 - 核心关键</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  备注说明 (可选)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="可记录补充背景或细节"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                ></textarea>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="auto_schedule"
                  checked={autoSchedule}
                  onChange={(e) => setAutoSchedule(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="auto_schedule" className="text-xs text-slate-700 font-medium cursor-pointer">
                  保存后立即根据工作时间段及外部日历进行动态规划排程
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-md transition disabled:opacity-50"
                >
                  {formSubmitting ? '计算排程中...' : '确认并创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
