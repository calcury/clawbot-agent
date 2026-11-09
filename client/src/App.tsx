import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthPage } from './pages/AuthPage';
import { Navbar } from './components/Navbar';
import { CalendarView } from './components/CalendarView';
import { TodoList } from './components/TodoList';
import { SettingsView } from './components/SettingsView';
import { ChatSimulator } from './components/ChatSimulator';
import { AdminUsersView } from './components/AdminUsersView';
import { api } from './api/client';

const DashboardContent: React.FC = () => {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('calendar');
  const [pendingCount, setPendingCount] = useState(0);

  const fetchPendingCount = async () => {
    if (user?.role === 'admin') {
      try {
        const res = await api.get('/admin/users');
        const count = res.data.users.filter((u: any) => u.status === 'pending').length;
        setPendingCount(count);
      } catch {}
    }
  };

  useEffect(() => {
    fetchPendingCount();
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-3 border-indigo-500 border-t-transparent"></div>
          <span className="text-slate-400 text-xs font-medium">系统加载中...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-800">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        pendingUsersCount={pendingCount}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'calendar' && <CalendarView />}
        {activeTab === 'todos' && <TodoList />}
        {activeTab === 'settings' && <SettingsView />}
        {activeTab === 'chat' && <ChatSimulator />}
        {activeTab === 'admin' && user.role === 'admin' && (
          <AdminUsersView onRefreshCount={fetchPendingCount} />
        )}
      </main>

      <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Clawbot Agent · 微信时间规划助手 (管理控制台运行于端口 5178)
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <DashboardContent />
    </AuthProvider>
  );
};

export default App;
