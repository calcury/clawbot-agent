import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme, type ThemeMode } from '../context/ThemeContext';
import {
  Calendar as CalendarIcon,
  CheckSquare,
  Settings,
  Users,
  LogOut,
  Sun,
  Moon,
  Monitor,
  Check,
  Terminal,
} from 'lucide-react';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  pendingUsersCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab, pendingUsersCount = 0 }) => {
  const { user, logout } = useAuth();
  const { themeMode, setThemeMode, isDark } = useTheme();
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);

  // Close theme dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setThemeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navItems = [
    { id: 'todos', label: '待办清单', icon: CheckSquare },
    { id: 'calendar', label: '日历日程', icon: CalendarIcon },
    { id: 'settings', label: '设置 & 对接', icon: Settings },
  ];

  if (user?.role === 'admin') {
    navItems.push({ id: 'admin', label: '用户审核', icon: Users });
    navItems.push({ id: 'debug', label: '系统调试', icon: Terminal });
  }

  const themeOptions: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
    { mode: 'system', label: '跟随系统', icon: Monitor },
    { mode: 'light', label: '浅色模式', icon: Sun },
    { mode: 'dark', label: '深色模式', icon: Moon },
  ];

  return (
    <>
      {/* Top Header - Google Workspace Style */}
      <header className="bg-white/95 dark:bg-[#1e1f20]/95 backdrop-blur-md border-b border-gray-200/80 dark:border-neutral-800/80 sticky top-0 z-40 transition-colors">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Left Brand: Google Workspace Tasks Style */}
            <div className="flex items-center gap-3">
              {/* Google Workspace Tasks logo badge */}
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-blue-600 dark:bg-blue-500 flex items-center justify-center text-white shadow-xs">
                  <CheckSquare className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-base font-bold text-gray-900 dark:text-gray-100 tracking-tight font-sans">
                    Clawbot
                  </span>
                  <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                    Tasks
                  </span>
                  <span className="hidden md:inline-block text-[11px] font-medium text-gray-400 dark:text-neutral-500 ml-1">
                    · 微信智能排程
                  </span>
                </div>
              </div>
            </div>

            {/* Desktop Center Navigation - Google Workspace clean pill tabs */}
            <nav className="hidden sm:flex items-center gap-1 bg-gray-100/80 dark:bg-[#28292a] p-1 rounded-full border border-gray-200/50 dark:border-neutral-800">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                const isUsers = item.id === 'admin';

                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`relative flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                      isActive
                        ? 'bg-white dark:bg-[#37393b] text-blue-600 dark:text-blue-400 font-semibold shadow-xs'
                        : 'text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-neutral-200 hover:bg-gray-200/50 dark:hover:bg-neutral-800'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{item.label}</span>
                    {isUsers && pendingUsersCount > 0 && (
                      <span className="ml-1 px-1.5 py-0.2 bg-rose-500 text-white rounded-full text-[10px] font-bold animate-pulse">
                        {pendingUsersCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Right Actions: Appearance & Account */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Theme Toggle Dropdown */}
              <div className="relative" ref={themeMenuRef}>
                <button
                  type="button"
                  onClick={() => setThemeMenuOpen(!themeMenuOpen)}
                  title={`当前外观：${themeMode === 'system' ? '跟随系统' : themeMode === 'light' ? '浅色' : '深色'}`}
                  className="p-2 text-gray-500 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-neutral-100 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-full transition flex items-center justify-center cursor-pointer"
                >
                  {isDark ? <Moon className="w-4 h-4 text-blue-400" /> : <Sun className="w-4 h-4 text-amber-500" />}
                </button>

                {themeMenuOpen && (
                  <div className="absolute right-0 mt-2 w-36 bg-white dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700/80 rounded-2xl shadow-lg p-1.5 z-50 text-xs animate-fadeIn">
                    <div className="px-2.5 py-1 text-[10px] font-semibold text-gray-400 dark:text-neutral-500 uppercase tracking-wider">
                      选择外观
                    </div>
                    {themeOptions.map((opt) => {
                      const Icon = opt.icon;
                      const isSelected = themeMode === opt.mode;

                      return (
                        <button
                          key={opt.mode}
                          onClick={() => {
                            setThemeMode(opt.mode);
                            setThemeMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-left transition cursor-pointer ${
                            isSelected
                              ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-semibold'
                              : 'text-gray-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Icon className="w-3.5 h-3.5" />
                            <span>{opt.label}</span>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* User Account Info Chip */}
              <div className="hidden sm:flex items-center gap-2 bg-gray-50 dark:bg-[#28292a] border border-gray-200/80 dark:border-neutral-700/80 px-3 py-1 rounded-full text-xs">
                <div className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-[10px]">
                  {user?.username?.slice(0, 1).toUpperCase()}
                </div>
                <span className="font-medium text-gray-800 dark:text-gray-200">{user?.username}</span>
                <span className="text-[10px] text-gray-400 dark:text-neutral-500 border-l border-gray-200 dark:border-neutral-700 pl-1.5">
                  {user?.role === 'admin' ? '管理员' : '用户'}
                </span>
              </div>

              {/* Logout Button */}
              <button
                onClick={logout}
                title="退出登录"
                className="p-2 text-gray-400 dark:text-neutral-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-full transition cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Fixed Bottom Navigation Bar */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#1e1f20]/95 backdrop-blur-md border-t border-gray-200/90 dark:border-neutral-800/90 px-3 py-1 flex items-center justify-around shadow-lg transition-colors">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const isUsers = item.id === 'admin';

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-2xl relative transition cursor-pointer ${
                isActive
                  ? 'text-blue-600 dark:text-blue-400 font-semibold'
                  : 'text-gray-500 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-neutral-200'
              }`}
            >
              <div
                className={`p-1.5 rounded-full transition ${
                  isActive ? 'bg-blue-100/80 dark:bg-blue-950/80' : ''
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-[10px] mt-0.5 tracking-tight">{item.label.split(' ')[0]}</span>
              {isUsers && pendingUsersCount > 0 && (
                <span className="absolute top-1 right-2 w-4 h-4 bg-rose-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center animate-pulse">
                  {pendingUsersCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
};
