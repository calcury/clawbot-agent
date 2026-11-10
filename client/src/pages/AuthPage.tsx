import React, { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Lock, User as UserIcon, CheckCircle2, AlertCircle, ArrowRight, Sun, Moon, CheckSquare } from 'lucide-react';

export const AuthPage: React.FC = () => {
  const { login } = useAuth();
  const { isDark, setThemeMode, themeMode } = useTheme();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!username || !password) {
      setError('请填写完整的账号与密码');
      return;
    }

    if (isRegister && password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);

    try {
      if (isRegister) {
        const res = await api.post('/auth/register', { username, password });
        setSuccessMsg(res.data.message || '注册申请已提交！需管理员在后台审核放行后方可登录。');
        setIsRegister(false);
        setPassword('');
        setConfirmPassword('');
      } else {
        const res = await api.post('/auth/login', { username, password });
        login(res.data.token, res.data.user);
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || '请求发生错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafd] dark:bg-[#131314] flex flex-col items-center justify-center p-4 relative transition-colors">
      {/* Top Right Theme Toggle */}
      <div className="absolute top-5 right-5">
        <button
          type="button"
          onClick={() => setThemeMode(isDark ? 'light' : 'dark')}
          className="p-2.5 text-gray-500 dark:text-neutral-400 hover:bg-gray-200/60 dark:hover:bg-neutral-800 rounded-full transition cursor-pointer"
          title={`当前：${themeMode === 'system' ? '跟随系统' : isDark ? '深色' : '浅色'}，点击切换`}
        >
          {isDark ? <Moon className="w-5 h-5 text-blue-400" /> : <Sun className="w-5 h-5 text-amber-500" />}
        </button>
      </div>

      {/* Google M3 Surface Card */}
      <div className="max-w-md w-full bg-white dark:bg-[#1e1f20] rounded-3xl shadow-sm border border-gray-200/80 dark:border-neutral-800/80 p-8 sm:p-10 transition-colors">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 dark:bg-blue-500 text-white mb-4 shadow-sm shadow-blue-500/30">
            <CheckSquare className="w-7 h-7 stroke-[2.5]" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 font-sans">
            Clawbot Tasks
          </h1>
          <p className="text-gray-500 dark:text-neutral-400 text-xs sm:text-sm mt-1">
            微信智能时间规划与动态排程管理控制台
          </p>
        </div>

        {error && (
          <div className="mb-5 p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-2xl flex items-start gap-2.5 text-rose-700 dark:text-rose-300 text-xs sm:text-sm animate-fadeIn">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-5 p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-2xl flex items-start gap-2.5 text-emerald-700 dark:text-emerald-300 text-xs sm:text-sm animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1.5">
              用户名
            </label>
            <div className="relative">
              <UserIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-neutral-500" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 text-gray-900 dark:text-gray-100 rounded-2xl focus:bg-white dark:focus:bg-[#232425] outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-medium transition"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1.5">
              密码
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-neutral-500" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 text-gray-900 dark:text-gray-100 rounded-2xl focus:bg-white dark:focus:bg-[#232425] outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-medium transition"
                required
              />
            </div>
          </div>

          {isRegister && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1.5">
                确认密码
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-neutral-500" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="请再次输入密码"
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 text-gray-900 dark:text-gray-100 rounded-2xl focus:bg-white dark:focus:bg-[#232425] outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-medium transition"
                  required
                />
              </div>
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-2 bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded-xl border border-amber-200 dark:border-amber-900/60">
                ⚠️ 提示：新用户注册后需管理员在后台审核放行后方可登录。
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white rounded-full font-medium text-sm shadow-sm flex items-center justify-center gap-2 transition disabled:opacity-50 cursor-pointer"
          >
            {loading ? (
              <span className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></span>
            ) : (
              <>
                <span>{isRegister ? '提交注册申请' : '登 录'}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-gray-100 dark:border-neutral-800 flex items-center justify-between text-xs sm:text-sm">
          <span className="text-gray-500 dark:text-neutral-400">
            {isRegister ? '已有账号？' : '尚未拥有账号？'}
          </span>
          <button
            type="button"
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
              setSuccessMsg(null);
            }}
            className="text-blue-600 dark:text-blue-400 hover:underline font-semibold transition cursor-pointer"
          >
            {isRegister ? '返回登录' : '注册新账号'}
          </button>
        </div>
      </div>
    </div>
  );
};
