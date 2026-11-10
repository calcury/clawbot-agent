import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  ShieldCheck,
  Trash2,
  Clock,
  Check,
  AlertCircle,
} from 'lucide-react';

interface ManagedUser {
  id: number;
  username: string;
  role: 'user' | 'admin';
  status: 'pending' | 'approved' | 'rejected';
  task_count: number;
  subscription_count: number;
  created_at: string;
}

export const AdminUsersView: React.FC<{ onRefreshCount?: () => void }> = ({ onRefreshCount }) => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/users');
      setUsers(res.data.users);
      if (onRefreshCount) onRefreshCount();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleApprove = async (id: number) => {
    try {
      const res = await api.put(`/admin/users/${id}/approve`);
      alert(res.data.message);
      fetchUsers();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      alert(error.response?.data?.error || '操作失败');
    }
  };

  const handleReject = async (id: number) => {
    try {
      const res = await api.put(`/admin/users/${id}/reject`);
      alert(res.data.message);
      fetchUsers();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      alert(error.response?.data?.error || '操作失败');
    }
  };

  const handleToggleRole = async (id: number, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    if (!window.confirm(`确定将该用户的角色切换为「${newRole}」吗？`)) return;
    try {
      const res = await api.put(`/admin/users/${id}/role`, { role: newRole });
      alert(res.data.message);
      fetchUsers();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      alert(error.response?.data?.error || '修改角色失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定要删除该用户的所有数据吗？此操作不可逆！')) return;
    try {
      await api.delete(`/admin/users/${id}`);
      fetchUsers();
    } catch {
      alert('删除失败');
    }
  };

  const filteredUsers = users.filter((u) => {
    if (filter === 'all') return true;
    return u.status === filter;
  });

  const pendingCount = users.filter((u) => u.status === 'pending').length;

  return (
    <div className="w-full max-w-5xl mx-auto flex-1 min-h-0 flex flex-col space-y-4 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <span>用户审核与权限管理</span>
            {pendingCount > 0 && (
              <span className="bg-rose-500 text-white text-xs px-2.5 py-0.5 rounded-full font-semibold animate-pulse">
                {pendingCount} 待审核
              </span>
            )}
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-neutral-400 mt-0.5">
            新用户注册后默认待审核，需在此放行后方可登录系统
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {[
            { key: 'all', label: '全部' },
            { key: 'pending', label: `待审核 (${pendingCount})` },
            { key: 'approved', label: '已放行' },
            { key: 'rejected', label: '已拒绝' },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key as any)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium shrink-0 transition cursor-pointer ${
                filter === item.key
                  ? 'bg-blue-600 text-white dark:bg-blue-500 shadow-xs'
                  : 'bg-white dark:bg-[#1e1f20] text-gray-600 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 border border-gray-200 dark:border-neutral-700/80'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Users Container */}
      <div className="flex-1 min-h-0 bg-white dark:bg-[#1e1f20] rounded-3xl border border-gray-200/80 dark:border-neutral-800/80 shadow-xs overflow-y-auto transition-colors">
        {/* Desktop Table View */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50/80 dark:bg-[#28292a]/60 border-b border-gray-200/80 dark:border-neutral-800 text-gray-500 dark:text-neutral-400 font-medium">
              <tr>
                <th className="px-5 py-3.5">用户名</th>
                <th className="px-5 py-3.5">角色</th>
                <th className="px-5 py-3.5">状态</th>
                <th className="px-5 py-3.5">待办 / 日历</th>
                <th className="px-5 py-3.5">注册时间</th>
                <th className="px-5 py-3.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-neutral-800">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-gray-400 dark:text-neutral-500">
                    暂无符合条件的用户
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isSelf = u.id === currentUser?.id;
                  return (
                    <tr key={u.id} className="hover:bg-gray-50/60 dark:hover:bg-[#252728] transition">
                      <td className="px-5 py-4">
                        <div className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                          <span>{u.username}</span>
                          {isSelf && (
                            <span className="text-[10px] bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full font-medium">
                              当前账号
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-400 dark:text-neutral-500 font-mono">UID: {u.id}</div>
                      </td>

                      <td className="px-5 py-4">
                        <button
                          onClick={() => !isSelf && handleToggleRole(u.id, u.role)}
                          disabled={isSelf}
                          className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-medium transition ${
                            u.role === 'admin'
                              ? 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60'
                              : 'bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-neutral-300'
                          }`}
                        >
                          {u.role === 'admin' && <ShieldCheck className="w-3.5 h-3.5" />}
                          <span>{u.role === 'admin' ? '管理员' : '普通用户'}</span>
                        </button>
                      </td>

                      <td className="px-5 py-4">
                        {u.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                            <Clock className="w-3 h-3" />
                            待审核
                          </span>
                        )}
                        {u.status === 'approved' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                            <Check className="w-3 h-3" />
                            已放行
                          </span>
                        )}
                        {u.status === 'rejected' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
                            <AlertCircle className="w-3 h-3" />
                            已拒绝
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-4 text-gray-600 dark:text-neutral-400">
                        <span>{u.task_count} 条待办</span>
                        <span className="text-gray-300 dark:text-neutral-600 mx-1.5">/</span>
                        <span>{u.subscription_count} 订阅</span>
                      </td>

                      <td className="px-5 py-4 text-gray-400 dark:text-neutral-500 font-mono text-[11px]">
                        {new Date(u.created_at).toLocaleDateString('zh-CN')}
                      </td>

                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {u.status === 'pending' && (
                            <>
                              <button
                                onClick={() => handleApprove(u.id)}
                                className="px-3.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-full shadow-xs transition cursor-pointer"
                              >
                                放行
                              </button>
                              <button
                                onClick={() => handleReject(u.id)}
                                className="px-3.5 py-1 bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 hover:bg-rose-100 font-medium rounded-full border border-rose-200 dark:border-rose-900 transition cursor-pointer"
                              >
                                拒绝
                              </button>
                            </>
                          )}

                          {u.status === 'rejected' && (
                            <button
                              onClick={() => handleApprove(u.id)}
                              className="px-3 py-1 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-medium rounded-full border border-blue-200 dark:border-blue-900 transition cursor-pointer"
                            >
                              重新放行
                            </button>
                          )}

                          {u.status === 'approved' && !isSelf && (
                            <button
                              onClick={() => handleReject(u.id)}
                              className="px-3 py-1 text-gray-400 dark:text-neutral-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-full transition cursor-pointer"
                            >
                              禁用
                            </button>
                          )}

                          {!isSelf && (
                            <button
                              onClick={() => handleDelete(u.id)}
                              className="p-1.5 text-gray-400 dark:text-neutral-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-full transition cursor-pointer"
                              title="彻底删除用户"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards View */}
        <div className="sm:hidden divide-y divide-gray-100 dark:divide-neutral-800">
          {filteredUsers.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-xs">暂无用户</div>
          ) : (
            filteredUsers.map((u) => {
              const isSelf = u.id === currentUser?.id;
              return (
                <div key={u.id} className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-gray-100 text-sm flex items-center gap-1.5">
                        <span>{u.username}</span>
                        {isSelf && (
                          <span className="text-[10px] bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 px-1.5 py-0.2 rounded-full">
                            自己
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-gray-400 font-mono">UID: {u.id}</span>
                    </div>

                    {u.status === 'pending' && (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                        待审核
                      </span>
                    )}
                    {u.status === 'approved' && (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                        已放行
                      </span>
                    )}
                    {u.status === 'rejected' && (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
                        已拒绝
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs text-gray-500 dark:text-neutral-400">
                    <span>{u.role === 'admin' ? '系统管理员' : '普通用户'}</span>
                    <span>{u.task_count} 任务 · {u.subscription_count} 订阅</span>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-gray-100 dark:border-neutral-800/80">
                    {u.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleApprove(u.id)}
                          className="px-4 py-1.5 bg-emerald-600 text-white rounded-full text-xs font-medium"
                        >
                          放行
                        </button>
                        <button
                          onClick={() => handleReject(u.id)}
                          className="px-4 py-1.5 bg-rose-50 dark:bg-rose-950/50 text-rose-600 rounded-full text-xs font-medium border border-rose-200"
                        >
                          拒绝
                        </button>
                      </>
                    )}
                    {!isSelf && (
                      <button
                        onClick={() => handleDelete(u.id)}
                        className="p-1.5 text-gray-400 hover:text-rose-600 rounded-full"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
