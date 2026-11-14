import React from 'react';
import type { TaskFilterOptions } from '../types/task';
import { 
  Plus, 
  Sparkles, 
  PieChart, 
  ArrowUpDown,
  Search, 
  X, 
  Sun, 
  Moon, 
  Tag as TagIcon,
  CheckCircle2,
  Circle,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  LayoutGrid,
  CalendarDays
} from 'lucide-react';

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  activeView: 'matrix' | 'calendar';
  onSelectView: (view: 'matrix' | 'calendar') => void;
  filterOptions: TaskFilterOptions;
  onFilterChange: (filters: Partial<TaskFilterOptions>) => void;
  allTags: string[];
  stats: {
    total: number;
    completed: number;
    pending: number;
    completionRate: number;
  };
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenNewTask: () => void;
  onOpenWizard: () => void;
  onOpenStats: () => void;
  onOpenBackup: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isCollapsed,
  onToggleCollapse,
  activeView,
  onSelectView,
  filterOptions,
  onFilterChange,
  allTags,
  stats,
  isDark,
  onToggleTheme,
  onOpenNewTask,
  onOpenWizard,
  onOpenStats,
  onOpenBackup,
}) => {
  if (isCollapsed) {
    return (
      <aside className="hidden md:flex flex-col items-center py-4 px-2 w-16 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 justify-between shrink-0 transition-all">
        <div className="flex flex-col items-center gap-4 w-full">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="展开侧边栏"
          >
            <PanelLeftOpen className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={onOpenNewTask}
            className="p-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 shadow-md transition-colors"
            title="新建任务 (按 N)"
          >
            <Plus className="h-5 w-5" />
          </button>

          <div className="w-8 h-px bg-slate-200 dark:bg-slate-800 my-0.5" />

          {/* 视图切换按钮 */}
          <button
            type="button"
            onClick={() => onSelectView('matrix')}
            className={`p-2 rounded-xl transition-colors ${
              activeView === 'matrix'
                ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400'
                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="四象限坐标看板"
          >
            <LayoutGrid className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => onSelectView('calendar')}
            className={`p-2 rounded-xl transition-colors ${
              activeView === 'calendar'
                ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400'
                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="日历日程排程"
          >
            <CalendarDays className="h-5 w-5" />
          </button>

          <div className="w-8 h-px bg-slate-200 dark:bg-slate-800 my-0.5" />

          <button
            type="button"
            onClick={onOpenWizard}
            className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
            title="智能归类向导"
          >
            <Sparkles className="h-5 w-5 text-indigo-500" />
          </button>

          <button
            type="button"
            onClick={onOpenStats}
            className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
            title="效能复盘统计"
          >
            <PieChart className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={onOpenBackup}
            className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
            title="数据备份与导出"
          >
            <ArrowUpDown className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title={isDark ? '切换浅色模式' : '切换深色模式'}
          >
            {isDark ? <Sun className="h-5 w-5 text-amber-400" /> : <Moon className="h-5 w-5" />}
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-64 md:w-72 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between shrink-0 h-full overflow-hidden transition-all">
      {/* 侧边栏头部 */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold text-xs shadow-xs">
            EM
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              四象限矩阵
            </h1>
            <p className="text-[11px] text-slate-400">Eisenhower Matrix</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
          title="收起侧边栏"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {/* 滚动区域 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 新建任务主按钮 */}
        <button
          type="button"
          onClick={onOpenNewTask}
          className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs hover:shadow transition-all"
        >
          <Plus className="h-4 w-4" />
          <span>新建事项</span>
          <kbd className="ml-auto px-1.5 py-0.5 rounded text-[10px] bg-indigo-700/60 text-indigo-200 font-mono">
            N
          </kbd>
        </button>

        {/* 核心主视图切换 Tab */}
        <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60">
          <button
            type="button"
            onClick={() => onSelectView('matrix')}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeView === 'matrix'
                ? 'bg-white text-indigo-600 shadow-2xs dark:bg-slate-900 dark:text-indigo-400'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>象限坐标</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectView('calendar')}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeView === 'calendar'
                ? 'bg-white text-indigo-600 shadow-2xs dark:bg-slate-900 dark:text-indigo-400'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            <span>日程排程</span>
          </button>
        </div>

        {/* 快速搜索 */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={filterOptions.searchQuery}
            onChange={(e) => onFilterChange({ searchQuery: e.target.value })}
            placeholder="搜索任务或标签..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-7 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900"
          />
          {filterOptions.searchQuery && (
            <button
              type="button"
              onClick={() => onFilterChange({ searchQuery: '' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* 任务状态筛选 */}
        <div className="space-y-1">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-1.5">
            视图筛选
          </div>
          <button
            type="button"
            onClick={() => onFilterChange({ status: 'all' })}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
              filterOptions.status === 'all'
                ? 'bg-indigo-50 text-indigo-700 font-bold dark:bg-indigo-950/50 dark:text-indigo-300'
                : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <div className="flex items-center gap-2">
              <Layers className="h-3.5 w-3.5" />
              <span>全部事项</span>
            </div>
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              {stats.total}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onFilterChange({ status: 'pending' })}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
              filterOptions.status === 'pending'
                ? 'bg-indigo-50 text-indigo-700 font-bold dark:bg-indigo-950/50 dark:text-indigo-300'
                : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <div className="flex items-center gap-2">
              <Circle className="h-3.5 w-3.5 text-amber-500" />
              <span>进行待办</span>
            </div>
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              {stats.pending}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onFilterChange({ status: 'completed' })}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
              filterOptions.status === 'completed'
                ? 'bg-indigo-50 text-indigo-700 font-bold dark:bg-indigo-950/50 dark:text-indigo-300'
                : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              <span>已完成</span>
            </div>
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              {stats.completed}
            </span>
          </button>
        </div>

        {/* 标签过滤（若存在标签） */}
        {allTags.length > 0 && (
          <div className="space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between px-2 mb-1.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                标签过滤
              </span>
              {filterOptions.tag && (
                <button
                  type="button"
                  onClick={() => onFilterChange({ tag: null })}
                  className="text-[10px] text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  清除
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1 px-1">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() =>
                    onFilterChange({ tag: filterOptions.tag === tag ? null : tag })
                  }
                  className={`text-[11px] px-2 py-0.5 rounded-md transition-colors flex items-center gap-1 ${
                    filterOptions.tag === tag
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  <TagIcon className="h-2.5 w-2.5 opacity-60" />
                  <span>{tag}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 辅助工具列表 */}
        <div className="space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-1.5">
            效率工具
          </div>

          <button
            type="button"
            onClick={onOpenWizard}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors text-left"
          >
            <Sparkles className="h-4 w-4 text-indigo-500" />
            <span>智能归类向导</span>
          </button>

          <button
            type="button"
            onClick={onOpenStats}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors text-left"
          >
            <PieChart className="h-4 w-4 text-slate-500" />
            <span>精力复盘分析</span>
          </button>

          <button
            type="button"
            onClick={onOpenBackup}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors text-left"
          >
            <ArrowUpDown className="h-4 w-4 text-slate-500" />
            <span>数据备份与导出</span>
          </button>
        </div>
      </div>

      {/* 侧边栏底部 */}
      <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleTheme}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
            title="切换主题"
          >
            {isDark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-500" />}
            <span>{isDark ? '浅色' : '深色'}</span>
          </button>
        </div>

        <span className="text-[11px] text-slate-400 font-mono">
          {stats.completed}/{stats.total} 完成
        </span>
      </div>
    </aside>
  );
};
