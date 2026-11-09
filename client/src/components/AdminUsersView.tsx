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
    } catch (err: any) {
      alert(err.response?.data?.error || '操作失败');
    }
  };

  const handleReject = async (id: number) => {
    try {
      const res = await api.put(`/admin/users/${id}/reject`);
      alert(res.data.message);
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.error || '操作失败');
    }
  };

  const handleToggleRole = async (id: number, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    if (!window.confirm(`确定将该用户的角色切换为「${newRole}」吗？`)) return;
    try {
      const res = await api.put(`/admin/users/${id}/role`, { role: newRole });
      alert(res.data.message);
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.error || '修改角色失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定要删除该用户的所有数据吗？此操作不可逆！')) return;
    try {
      await api.delete(`/admin/users/${id}`);
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.error || '删除失败');
    }
  };

  const filteredUsers = users.filter((u) => {
    if (filter === 'all') return true;
    return u.status === filter;
  });

  const pendingCount = users.filter((u) => u.status === 'pending').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <span>用户注册审核与权限管理</span>
            {pendingCount > 0 && (
              <span className="bg-rose-500 text-white text-xs px-2.5 py-0.5 rounded-full font-semibold">
                {pendingCount} 个待审核
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            新用户注册后默认处于待审核状态，需管理员在此审核放行后方可登录系统。
          </p>
        </div>

        {/* Filter buttons */}
        <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200 text-xs font-semibold">
          {[
            { key: 'all', label: '全部用户' },
            { key: 'pending', label: `待审核 (${pendingCount})` },
            { key: 'approved', label: '已放行' },
            { key: 'rejected', label: '已拒绝' },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key as any)}
              className={`px-3 py-1.5 rounded-lg transition ${
                filter === item.key
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Users table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3.5">ID / 用户名</th>
                <th className="px-5 py-3.5">身份角色</th>
                <th className="px-5 py-3.5">账号状态</th>
                <th className="px-5 py-3.5">待办 / 日历统计</th>
                <th className="px-5 py-3.5">注册时间</th>
                <th className="px-5 py-3.5 text-right">审核与操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                    暂无符合条件的用户记录
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isSelf = u.id === currentUser?.id;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/60 transition">
                      <td className="px-5 py-4">
                        <div className="font-bold text-slate-900 flex items-center gap-2">
                          <span>{u.username}</span>
                          {isSelf && (
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                              当前账号
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">UID: {u.id}</div>
                      </td>

                      <td className="px-5 py-4">
                        <button
                          onClick={() => !isSelf && handleToggleRole(u.id, u.role)}
                          disabled={isSelf}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                            u.role === 'admin'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {u.role === 'admin' ? <ShieldCheck className="w-3.5 h-3.5" /> : null}
                          <span>{u.role === 'admin' ? '系统管理员' : '普通用户'}</span>
                        </button>
                      </td>

                      <td className="px-5 py-4">
                        {u.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700">
                            <Clock className="w-3 h-3" />
                            待审核
                          </span>
                        )}
                        {u.status === 'approved' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">
                            <Check className="w-3 h-3" />
                            已放行
                          </span>
                        )}
                        {u.status === 'rejected' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-700">
                            <AlertCircle className="w-3 h-3" />
                            已拒绝
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-4 text-slate-600">
                        <span>{u.task_count} 条待办</span>
                        <span className="text-slate-300 mx-1.5">|</span>
                        <span>{u.subscription_count} 个订阅</span>
                      </td>

                      <td className="px-5 py-4 text-slate-400 font-mono text-[11px]">
                        {new Date(u.created_at).toLocaleString('zh-CN')}
                      </td>

                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {u.status === 'pending' && (
                            <>
                              <button
                                onClick={() => handleApprove(u.id)}
                                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg shadow-xs transition"
                              >
                                放行
                              </button>
                              <button
                                onClick={() => handleReject(u.id)}
                                className="px-3 py-1 bg-rose-50 text-rose-600 hover:bg-rose-100 font-semibold rounded-lg border border-rose-200 transition"
                              >
                                拒绝
                              </button>
                            </>
                          )}

                          {u.status === 'rejected' && (
                            <button
                              onClick={() => handleApprove(u.id)}
                              className="px-3 py-1 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 font-semibold rounded-lg border border-indigo-200 transition"
                            >
                              重新放行
                            </button>
                          )}

                          {u.status === 'approved' && !isSelf && (
                            <button
                              onClick={() => handleReject(u.id)}
                              className="px-2.5 py-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                            >
                              禁用
                            </button>
                          )}

                          {!isSelf && (
                            <button
                              onClick={() => handleDelete(u.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition"
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
      </div>
    </div>
  );
};
