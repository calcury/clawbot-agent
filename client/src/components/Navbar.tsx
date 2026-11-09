import React from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Calendar as CalendarIcon,
  CheckSquare,
  Settings,
  MessageSquare,
  Users,
  LogOut,
  Bot,
} from 'lucide-react';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  pendingUsersCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab, pendingUsersCount = 0 }) => {
  const { user, logout } = useAuth();

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left Brand */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <span className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                Clawbot Agent
                <span className="text-[11px] font-semibold uppercase bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-200">
                  5178 控制台
                </span>
              </span>
            </div>
          </div>

          {/* Center Tabs */}
          <nav className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('calendar')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'calendar'
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <CalendarIcon className="w-4 h-4" />
              <span>日历日程</span>
            </button>

            <button
              onClick={() => setActiveTab('todos')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'todos'
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <CheckSquare className="w-4 h-4" />
              <span>待办清单</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'settings'
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>设置 & 对接</span>
            </button>

            <button
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'chat'
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>对话模拟</span>
            </button>

            {user?.role === 'admin' && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition ${
                  activeTab === 'admin'
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>用户审核</span>
                {pendingUsersCount > 0 && (
                  <span className="w-5 h-5 bg-rose-500 text-white rounded-full text-[11px] font-bold flex items-center justify-center animate-pulse">
                    {pendingUsersCount}
                  </span>
                )}
              </button>
            )}
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-bold text-slate-800">{user?.username}</div>
              <div className="text-[11px] text-slate-400 capitalize">
                {user?.role === 'admin' ? '系统管理员' : '已放行用户'}
              </div>
            </div>

            <button
              onClick={logout}
              title="退出登录"
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
