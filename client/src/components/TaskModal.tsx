import React, { useState, useEffect } from 'react';
import type { TaskItem } from '../types/task';
import { calculateQuadrant, formatLocalDate } from '../types/task';
import { QUADRANTS_CONFIG } from '../constants/quadrants';
import { calculateDynamicUrgency } from '../utils/priorityAlgorithm';
import { 
  X, 
  Calendar, 
  Clock, 
  Tag as TagIcon, 
  Check,
  Trash2
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
  onToggleComplete?: (id: string) => void;
  onDelete?: (id: string) => void;
  initialTask?: TaskItem | null;
  defaultImportance?: number;
  defaultUrgency?: number;
  allExistingTags?: string[];
}

export const TaskModal: React.FC<TaskModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onToggleComplete,
  onDelete,
  initialTask,
  defaultImportance = 7,
  defaultUrgency,
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
      // 如果是通过四象限坐标看板点击空白处打开，按点击位置智能映射初始截止日期
      let initialDueDate = todayStr;
      if (typeof defaultUrgency === 'number') {
        const target = new Date();
        if (defaultUrgency >= 8) {
          target.setDate(target.getDate() + 0);
        } else if (defaultUrgency >= 6) {
          target.setDate(target.getDate() + 1);
        } else if (defaultUrgency >= 4) {
          target.setDate(target.getDate() + 3);
        } else if (defaultUrgency >= 2) {
          target.setDate(target.getDate() + 7);
        } else {
          target.setDate(target.getDate() + 14);
        }
        initialDueDate = formatLocalDate(target);
      }
      setDueDate(initialDueDate);
      setEstimatedMinutes('');
      setTags([]);
    }
  }, [initialTask, defaultImportance, defaultUrgency, isOpen]);

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
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-800 shadow-2xl overflow-hidden transition-all animate-in fade-in zoom-in-95 duration-150"
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-neutral-800">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {initialTask ? '编辑待办' : '新建待办'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* 任务名称 */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-neutral-300 mb-1.5">
              事项标题 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入事项名称..."
              className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2 text-xs text-gray-900 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100 placeholder:text-gray-400 transition"
            />
          </div>

          {/* 截止日期与预计用时 */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-neutral-300 mb-1.5 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-gray-400" />
                  <span>截止日期</span>
                  <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2 text-xs text-gray-900 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-neutral-300 mb-1.5 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-gray-400" />
                  <span>预计耗时</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="5"
                    step="5"
                    value={estimatedMinutes}
                    onChange={(e) => setEstimatedMinutes(e.target.value ? Number(e.target.value) : '')}
                    placeholder="30"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2 text-xs text-gray-900 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100 transition pr-10"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">分钟</span>
                </div>
              </div>
            </div>

            {/* 快捷日期预设 */}
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className="text-[11px] text-gray-400 mr-0.5">快捷：</span>
              {[
                { label: '今天', days: 0 },
                { label: '明天', days: 1 },
                { label: '3天后', days: 3 },
                { label: '1周后', days: 7 },
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
                    className={`text-[11px] px-2.5 py-0.5 rounded-lg border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800 font-medium'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 dark:bg-[#28292a] dark:text-neutral-400 dark:border-neutral-700'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 重要度与象限状态卡片 (极简设计，无杂乱说明文字与分值坐标) */}
          <div className="p-3.5 rounded-xl bg-gray-50/70 dark:bg-neutral-800/30 border border-gray-200/70 dark:border-neutral-800 space-y-3">
            {/* 重要度滑块 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-gray-700 dark:text-neutral-300">
                  重要程度
                </span>
                <span className="text-xs font-medium text-gray-500 dark:text-neutral-400">
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
                className="w-full accent-blue-600 cursor-pointer"
              />
            </div>

            {/* 象限归类状态 */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-200/50 dark:border-neutral-800 text-xs">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${computedQuadrantMeta.themeColor.accentDot}`} />
                <span className="font-medium text-gray-800 dark:text-neutral-200">
                  {computedQuadrantMeta.name}
                </span>
              </div>
              <span className="text-[11px] text-gray-400 dark:text-neutral-500">
                {algoResult.statusText}
              </span>
            </div>
          </div>

          {/* 备注描述 */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-neutral-300 mb-1.5">
              备注描述 (可选)
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="添加备注细节..."
              className="w-full rounded-xl border border-gray-200 bg-gray-50/50 p-2.5 text-xs text-gray-900 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100 placeholder:text-gray-400 transition"
            />
          </div>

          {/* 标签管理 */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-neutral-300 mb-1.5 flex items-center gap-1.5">
              <TagIcon className="h-3.5 w-3.5 text-gray-400" />
              <span>标签</span>
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
                className="flex-1 rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-1.5 text-xs text-gray-900 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100 transition"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="px-3 py-1.5 rounded-xl border border-gray-200 text-xs text-gray-600 hover:bg-gray-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 transition cursor-pointer"
              >
                添加
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
                    className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-neutral-300 transition cursor-pointer"
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
                    className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700 dark:bg-neutral-800 dark:text-neutral-300"
                  >
                    #{tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-neutral-100"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 底部操作按钮 */}
          <div className="flex items-center justify-between gap-2.5 pt-3 border-t border-gray-100 dark:border-neutral-800">
            <div>
              {initialTask && (
                <div className="flex items-center gap-2">
                  {onToggleComplete && (
                    <button
                      type="button"
                      onClick={() => {
                        onToggleComplete(initialTask.id);
                        onClose();
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                        initialTask.isCompleted
                          ? 'bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-neutral-800 dark:text-neutral-300'
                          : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>{initialTask.isCompleted ? '标记为未完成' : '完成任务'}</span>
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      onClick={() => {
                        onDelete(initialTask.id);
                        onClose();
                      }}
                      className="p-1.5 rounded-xl text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                      title="删除此任务"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-xl text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-5 py-1.5 rounded-xl text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 shadow-xs transition-all cursor-pointer"
              >
                {initialTask ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
