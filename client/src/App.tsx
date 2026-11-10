import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthPage } from './pages/AuthPage';
import { Navbar } from './components/Navbar';
import { CalendarView } from './components/CalendarView';
import { TodoList } from './components/TodoList';
import { SettingsView } from './components/SettingsView';
import { AdminUsersView } from './components/AdminUsersView';
import { api } from './api/client';

const DashboardContent: React.FC = () => {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('todos'); // default to Google Tasks Todo list!
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
      <div className="min-h-screen bg-[#f8fafd] dark:bg-[#131314] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-3 border-blue-600 dark:border-blue-400 border-t-transparent"></div>
          <span className="text-gray-500 dark:text-neutral-400 text-xs font-medium">Clawbot Tasks 加载中...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div className="min-h-screen bg-[#f8fafd] dark:bg-[#131314] flex flex-col text-gray-900 dark:text-gray-100 transition-colors">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        pendingUsersCount={pendingCount}
      />

      {/* Main Container with spacious width and responsive padding */}
      <main className="flex-1 w-full max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-5 pb-20 sm:pb-6">
        {activeTab === 'todos' && <TodoList />}
        {activeTab === 'calendar' && <CalendarView />}
        {activeTab === 'settings' && <SettingsView />}
        {activeTab === 'admin' && user.role === 'admin' && (
          <AdminUsersView onRefreshCount={fetchPendingCount} />
        )}
      </main>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <DashboardContent />
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
