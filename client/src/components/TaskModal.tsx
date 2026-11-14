import { useState, useEffect } from 'react';
import type { TaskItem } from '../types/task';
import { calculateQuadrant, formatLocalDate } from '../types/task';
import { QUADRANTS_CONFIG } from '../constants/quadrants';
import { calculateDynamicUrgency } from '../utils/priorityAlgorithm';
import { 
  X, 
  Flame, 
  Zap, 
  Calendar, 
  Clock, 
  Tag as TagIcon, 
  ArrowRight,
  Plus,
  Cpu
} from 'lucide-react';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    title: string;
    description?: string;
    importance: number;
    urgency: number;
    useAutoUrgency?: boolean;
    dueDate?: string | null;
    tags?: string[];
    estimatedMinutes?: number;
  }) => void;
  initialTask?: TaskItem | null;
  defaultImportance?: number;
  defaultUrgency?: number;
  allExistingTags?: string[];
}

export const TaskModal: React.FC<TaskModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialTask,
  defaultImportance = 7,
  allExistingTags = [],
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [importance, setImportance] = useState<number>(defaultImportance);
  const [dueDate, setDueDate] = useState(() => formatLocalDate(new Date()));
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | ''>('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // 初始化填充数据
  useEffect(() => {
    const todayStr = formatLocalDate(new Date());
    if (initialTask) {
      setTitle(initialTask.title);
      setDescription(initialTask.description || '');
      setImportance(initialTask.importance ?? (initialTask.isImportant ? 8 : 2));
      setDueDate(initialTask.dueDate || todayStr);
      setEstimatedMinutes(initialTask.estimatedMinutes || '');
      setTags(initialTask.tags || []);
    } else {
      setTitle('');
      setDescription('');
      setImportance(defaultImportance);
      setDueDate(todayStr);
      setEstimatedMinutes('');
      setTags([]);
    }
  }, [initialTask, defaultImportance, isOpen]);

  // 实时根据截止日期与预计耗时自动计算紧迫度
  const effectiveDueDate = dueDate || formatLocalDate(new Date());
  const algoResult = calculateDynamicUrgency({
    dueDate: effectiveDueDate,
    estimatedMinutes: typeof estimatedMinutes === 'number' ? estimatedMinutes : 30,
  });
  const urgency = algoResult.urgency;

  if (!isOpen) return null;

  // 动态自动计算派生象限
  const computedQuadrantId = calculateQuadrant(importance, urgency);
  const computedQuadrantMeta = QUADRANTS_CONFIG[computedQuadrantId];

  const handleQuickDateOffset = (daysOffset: number) => {
    const target = new Date();
    target.setDate(target.getDate() + daysOffset);
    setDueDate(formatLocalDate(target));
  };

  const handleAddTag = () => {
    const val = tagInput.trim();
    if (val && !tags.includes(val)) {
      setTags([...tags, val]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !effectiveDueDate) return;

    onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      importance,
      urgency,
      useAutoUrgency: true,
      dueDate: effectiveDueDate,
      tags,
      estimatedMinutes: typeof estimatedMinutes === 'number' ? estimatedMinutes : undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div 
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden transition-all animate-in fade-in zoom-in-95 duration-150"
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {initialTask ? '编辑事项' : '新建待办事项'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* 任务名称 */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              事项标题 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：准备下周一项目里程碑交付审查..."
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>

          {/* 截止日期与预计用时 (自动决定紧迫度) */}
          <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-slate-400" /> 截止日期 <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-slate-400" /> 预计耗时 (分)
              </label>
              <input
                type="number"
                min="5"
                step="5"
                value={estimatedMinutes}
                onChange={(e) => setEstimatedMinutes(e.target.value ? Number(e.target.value) : '')}
                placeholder="默认 30 分钟"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            {/* 快捷日期选择 */}
            <div className="col-span-2 flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-slate-400 mr-0.5">快捷设定：</span>
              {[
                { label: '今天', days: 0 },
                { label: '明天', days: 1 },
                { label: '3天后', days: 3 },
                { label: '1周后', days: 7 },
                { label: '2周后', days: 14 },
              ].map((preset) => {
                const target = new Date();
                target.setDate(target.getDate() + preset.days);
                const presetStr = formatLocalDate(target);
                const isSelected = dueDate === presetStr;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handleQuickDateOffset(preset.days)}
                    className={`text-[10px] px-2 py-0.5 rounded-md border transition-colors ${
                      isSelected
                        ? 'bg-indigo-600 text-white border-indigo-600 font-semibold'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-400 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 重要度滑块与自动紧迫度只读展示 */}
          <div className="space-y-3.5 p-4 rounded-xl bg-slate-50 border border-slate-200/80 dark:bg-slate-800/40 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                二维坐标量化评分
              </span>
              <span className="text-[11px] text-slate-400">
                以 5 分为中心阈值轴线
              </span>
            </div>

            {/* 重要度滑块 (Y 轴) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                  <Flame className="h-3.5 w-3.5 text-rose-500" />
                  <span>纵轴：战略重要度 (Importance)</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 font-mono">
                  {importance.toFixed(1)} / 10
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                step="0.5"
                value={importance}
                onChange={(e) => setImportance(parseFloat(e.target.value))}
                className="w-full accent-rose-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>0 (无关紧要)</span>
                <span className="font-semibold text-slate-600 dark:text-slate-300">5 (中线)</span>
                <span>10 (核心成就)</span>
              </div>
            </div>

            {/* 紧迫度只读展示 (X 轴 - 由截止日期自动计算) */}
            <div className="pt-2 border-t border-slate-200/70 dark:border-slate-700/60">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span>横轴：时间紧迫度 (Urgency)</span>
                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 font-medium">
                    <Cpu className="h-2.5 w-2.5" /> 依截止日自动计算
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 font-mono">
                  {urgency.toFixed(1)} / 10
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>测算状态：<strong className="text-indigo-600 dark:text-indigo-400">{algoResult.statusText}</strong></span>
                <span>每次打开应用将随剩余时间自动更新</span>
              </div>
            </div>

            {/* 自动定位实时预览 */}
            <div className={`p-2.5 rounded-xl border flex items-center justify-between ${computedQuadrantMeta.themeColor.headerBg} ${computedQuadrantMeta.themeColor.border}`}>
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${computedQuadrantMeta.themeColor.accentDot}`} />
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <span>自动映射：{computedQuadrantMeta.name}</span>
                  <ArrowRight className="h-3 w-3 text-slate-400" />
                  <span className="text-indigo-600 dark:text-indigo-400">{computedQuadrantMeta.shortAction}</span>
                </div>
              </div>
              <span className="text-[11px] font-mono opacity-70">
                ({urgency.toFixed(1)}, {importance.toFixed(1)})
              </span>
            </div>
          </div>

          {/* 描述与备注 */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              详细描述与待办细节 (可选)
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="输入任务具体要求、上下文背景..."
              className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>

          {/* 标签管理 */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
              <TagIcon className="h-3.5 w-3.5 text-slate-400" /> 标签分类
            </label>
            <div className="flex gap-2 mb-1.5">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="输入标签并回车..."
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 flex items-center gap-1"
              >
                <Plus className="h-3 w-3" /> 添加
              </button>
            </div>

            {/* 历史已有标签快速点击 */}
            {allExistingTags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {allExistingTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      if (!tags.includes(t)) setTags([...tags, t]);
                    }}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 dark:bg-slate-800 dark:text-slate-400"
                  >
                    +{t}
                  </button>
                ))}
              </div>
            )}

            {/* 已选标签列表 */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-900"
                  >
                    #{tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 底部按钮栏 */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-5 py-1.5 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xs transition-all"
            >
              {initialTask ? '保存修改' : '确认落位'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
