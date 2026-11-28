import React, { useState, useEffect } from 'react';
import type { TaskItem } from '../types/task';
import { calculateQuadrant, formatLocalDate } from '../types/task';
import { QUADRANTS_CONFIG } from '../constants/quadrants';
import {
  parseRecurrenceRule,
  stringifyRecurrenceRule,
  type RecurrenceType,
} from '../utils/recurrence';
import {
  calculateDynamicImportance,
  calculateDynamicUrgency,
  clampScore100,
  IMPACT_SIGNAL_WEIGHTS,
  IMPORTANCE_TIERS_CONFIG,
  inferTierFromScore,
  type ImpactSignal,
  type ImportanceTier,
  type TimeMode,
  type UrgencyPace,
} from '../utils/priorityAlgorithm';
import {
  X,
  Calendar,
  Clock,
  Tag as TagIcon,
  Check,
  Trash2,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  Repeat,
  Target,
  BriefcaseBusiness,
  ListTodo,
  Pin,
  Layers2,
  Infinity as InfinityIcon,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export interface TaskModalSavePayload {
  title: string;
  description?: string;
  importance: number;
  urgency: number;
  importanceTier: ImportanceTier;
  impactSignals: ImpactSignal[];
  timeMode: TimeMode;
  recurrenceRule?: string | null;
  urgencyPace: UrgencyPace;
  importanceManualOverride: number | null;
  useAutoUrgency?: boolean;
  dueDate?: string | null;
  tags?: string[];
  deadlineKind?: 'hard' | 'soft';
  estimatedMinutes?: number;
  isFixed?: boolean;
  isConcurrent?: boolean;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
}

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: TaskModalSavePayload) => void;
  onToggleComplete?: (id: string) => void;
  onDelete?: (id: string) => void;
  initialTask?: TaskItem | null;
  defaultImportance?: number;
  defaultUrgency?: number;
  allExistingTags?: string[];
  dailyBusyMinutesAhead?: number;
}

const TIER_ORDER = [
  { key: 'vital', icon: Target },
  { key: 'support', icon: BriefcaseBusiness },
  { key: 'minor', icon: ListTodo },
] as const;

const IMPACT_KEYS = Object.keys(IMPACT_SIGNAL_WEIGHTS) as ImpactSignal[];

export const TaskModal: React.FC<TaskModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onToggleComplete,
  onDelete,
  initialTask,
  defaultImportance = 60,
  defaultUrgency,
  allExistingTags = [],
  dailyBusyMinutesAhead = 0,
}) => {
  const { t, language } = useTheme();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [importanceTier, setImportanceTier] = useState<ImportanceTier>('support');
  const [impactSignals, setImpactSignals] = useState<ImpactSignal[]>([]);
  const [overrideExpanded, setOverrideExpanded] = useState(false);
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [manualImportance, setManualImportance] = useState<number>(60);

  const [hardDeadline, setHardDeadline] = useState(false);
  const [timeMode, setTimeMode] = useState<TimeMode>('deadline');
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('daily');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [dueDate, setDueDate] = useState(() => formatLocalDate(new Date()));
  const [dueTime, setDueTime] = useState<string>(''); // 可选具体截止时刻
  const [urgencyPace, setUrgencyPace] = useState<UrgencyPace>('soon');

  const [estimatedMinutes, setEstimatedMinutes] = useState<number | ''>('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isFixed, setIsFixed] = useState(false);
  const [isConcurrent, setIsConcurrent] = useState(false);
  const [fixedStartTime, setFixedStartTime] = useState('09:00');
  const [fixedEndTime, setFixedEndTime] = useState('10:00');

  // 初始化填充数据（注意：手动调整面板默认始终折叠）
  useEffect(() => {
    const todayStr = formatLocalDate(new Date());
    setOverrideExpanded(false);

    if (initialTask) {
      setTitle(initialTask.title);
      setDescription(initialTask.description || '');
      setImportanceTier(
        initialTask.importanceTier || inferTierFromScore(initialTask.importance ?? 58)
      );
      setImpactSignals(initialTask.impactSignals || []);

      const hasOverride =
        initialTask.importanceManualOverride !== undefined &&
        initialTask.importanceManualOverride !== null;
      setOverrideEnabled(hasOverride);
      setManualImportance(
        hasOverride ? clampScore100(initialTask.importanceManualOverride!) : clampScore100(initialTask.importance)
      );

      setHardDeadline(initialTask.deadlineKind === 'hard');
      setTimeMode(initialTask.timeMode || (initialTask.dueDate ? 'deadline' : 'flexible'));
      const parsedRule = parseRecurrenceRule(initialTask.recurrenceRule);
      setRecurrenceType(parsedRule.type);
      setRecurrenceDays(parsedRule.daysOfWeek || [1, 2, 3, 4, 5]);
      setUrgencyPace(initialTask.urgencyPace || 'soon');

      const deadline = initialTask.deadlineAt || initialTask.dueDate;
      if (deadline?.includes('T')) {
        const date = new Date(deadline);
        const time = date.toTimeString().slice(0, 5);
        setDueDate(formatLocalDate(date));
        setDueTime(time === '23:59' ? '' : time);
      } else {
        setDueDate(deadline || todayStr);
        setDueTime('');
      }

      setEstimatedMinutes(initialTask.estimatedMinutes || '');
      setTags(initialTask.tags || []);
      setIsFixed(Boolean(initialTask.isFixed));
      setIsConcurrent(Boolean(initialTask.isConcurrent));
      if (initialTask.scheduledStart) {
        const d = new Date(initialTask.scheduledStart);
        if (!Number.isNaN(d.getTime())) {
          setFixedStartTime(
            `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          );
        }
      }
      if (initialTask.scheduledEnd) {
        const d = new Date(initialTask.scheduledEnd);
        if (!Number.isNaN(d.getTime())) {
          setFixedEndTime(
            `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          );
        }
      }
    } else {
      setTitle('');
      setDescription('');
      const initialTier = inferTierFromScore(defaultImportance);
      setImportanceTier(initialTier);
      setImpactSignals([]);
      setOverrideEnabled(false);
      setManualImportance(clampScore100(defaultImportance));

      setHardDeadline(false);
      setTimeMode('deadline');
      setRecurrenceType('daily');
      setRecurrenceDays([1, 2, 3, 4, 5]);
      setUrgencyPace('soon');
      setDueTime('');
      setIsFixed(false);
      setIsConcurrent(false);
      setFixedStartTime('09:00');
      setFixedEndTime('10:00');

      let initialDueDate = todayStr;
      if (typeof defaultUrgency === 'number') {
        if (defaultUrgency < 25) {
          setTimeMode('flexible');
          setUrgencyPace('later');
        } else {
          const target = new Date();
          if (defaultUrgency >= 80) target.setDate(target.getDate() + 0);
          else if (defaultUrgency >= 60) target.setDate(target.getDate() + 1);
          else if (defaultUrgency >= 45) target.setDate(target.getDate() + 3);
          else if (defaultUrgency >= 30) target.setDate(target.getDate() + 7);
          else target.setDate(target.getDate() + 14);
          initialDueDate = formatLocalDate(target);
        }
      }
      setDueDate(initialDueDate);
      setEstimatedMinutes('');
      setTags([]);
    }
  }, [initialTask, defaultImportance, defaultUrgency, isOpen]);

  const effectiveEstimatedMinutes =
    typeof estimatedMinutes === 'number' && estimatedMinutes > 0 ? estimatedMinutes : 30;

  // 1. 全自动计算重要度（仅在用户主动启用手动调整时使用覆盖分值）
  const importanceResult = calculateDynamicImportance({
    tier: importanceTier,
    estimatedMinutes: effectiveEstimatedMinutes,
    impactSignals,
    isFixed,
    manualOverride: overrideEnabled ? manualImportance : null,
  });
  const importance = importanceResult.importance;

  // 2. 结合日期/时间模式 + 耗时 + 日程负荷 + 重要度联动计算紧迫度
  const effectiveDueDateStr =
    timeMode === 'deadline' || timeMode === 'specific_date'
      ? dueTime
        ? `${dueDate || formatLocalDate(new Date())}T${dueTime}:00`
        : dueDate || formatLocalDate(new Date())
      : null;

  const todayDateStr = formatLocalDate(new Date());
  const previewScheduledStart =
    isFixed && (timeMode === 'daily_fixed' || effectiveDueDateStr)
      ? `${timeMode === 'daily_fixed' ? todayDateStr : dueDate || todayDateStr}T${fixedStartTime}:00`
      : initialTask?.scheduledStart || null;
  const previewScheduledEnd =
    isFixed && (timeMode === 'daily_fixed' || effectiveDueDateStr)
      ? `${timeMode === 'daily_fixed' ? todayDateStr : dueDate || todayDateStr}T${fixedEndTime}:00`
      : initialTask?.scheduledEnd || null;

  const isCompletedToday =
    timeMode === 'daily_fixed' &&
    Array.isArray(initialTask?.completedDates) &&
    initialTask!.completedDates!.includes(todayDateStr);

  const urgencyResult = calculateDynamicUrgency({
    timeMode,
    dueDate: effectiveDueDateStr,
    estimatedMinutes: effectiveEstimatedMinutes,
    importance,
    urgencyPace,
    scheduledStart: previewScheduledStart,
    scheduledEnd: previewScheduledEnd,
    isCompletedToday,
    dailyBusyMinutesAhead: dailyBusyMinutesAhead,
  });
  const urgency = urgencyResult.urgency;

  if (!isOpen) return null;

  const computedQuadrantId = calculateQuadrant(importance, urgency);
  const computedQuadrantMeta = QUADRANTS_CONFIG[computedQuadrantId];

  const handleQuickDateOffset = (daysOffset: number) => {
    const target = new Date();
    target.setDate(target.getDate() + daysOffset);
    setDueDate(formatLocalDate(target));
  };

  const toggleSignal = (sig: ImpactSignal) => {
    setImpactSignals((prev) =>
      prev.includes(sig) ? prev.filter((item) => item !== sig) : [...prev, sig]
    );
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
    if (!title.trim()) return;
    if ((timeMode === 'deadline' || timeMode === 'specific_date') && !dueDate) return;

    let scheduledStart: string | null = null;
    let scheduledEnd: string | null = null;
    if (isFixed) {
      const anchorDate = timeMode === 'daily_fixed' ? todayDateStr : dueDate || todayDateStr;
      scheduledStart = `${anchorDate}T${fixedStartTime}:00`;
      scheduledEnd = `${anchorDate}T${fixedEndTime}:00`;
    }

    onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      importance,
      urgency,
      importanceTier,
      impactSignals,
      timeMode,
      recurrenceRule: timeMode === 'daily_fixed'
        ? stringifyRecurrenceRule({ type: recurrenceType, daysOfWeek: recurrenceDays })
        : null,
      urgencyPace,
      importanceManualOverride: overrideEnabled ? clampScore100(manualImportance) : null,
      useAutoUrgency: true,
      dueDate: effectiveDueDateStr,
      deadlineKind: (timeMode === 'deadline' || timeMode === 'specific_date') && hardDeadline ? 'hard' : 'soft',
      tags,
      estimatedMinutes: typeof estimatedMinutes === 'number' ? estimatedMinutes : undefined,
      isFixed,
      isConcurrent,
      scheduledStart,
      scheduledEnd,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-800 shadow-2xl overflow-hidden transition-all animate-in fade-in zoom-in-95 duration-150">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-neutral-800">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {initialTask ? t('task.edit', '编辑待办') : t('task.new', '新建待办')}
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
        <form onSubmit={handleSubmit} className="px-6 pt-5 pb-0 space-y-5 overflow-y-auto min-h-0">
          {/* 任务名称 */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-neutral-300 mb-1.5">
              {t('task.title', '事项标题')} <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('task.title_placeholder', '输入事项名称...')}
              className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2 text-xs text-gray-900 focus:bg-white dark:focus:bg-[#28292a] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100 placeholder:text-gray-400 transition"
            />
          </div>

          {/* 1. 重要度自动算分板块（三阶定级 + 影响因子 + 折叠手动覆盖） */}
          <div className="p-4 rounded-2xl bg-gray-50/80 dark:bg-neutral-800/40 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-800 dark:text-neutral-200">
                {t('task.importance', '重要程度')}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold font-mono bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/60">
                {importance} / 100
              </span>
            </div>

            {/* 三阶认知定级按钮 */}
            <div className="grid grid-cols-3 gap-2">
              {TIER_ORDER.map(({ key, icon: Icon }) => {
                const cfg = IMPORTANCE_TIERS_CONFIG[key];
                const active = importanceTier === key;
                const activeCls = 'border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:border-blue-700 dark:text-blue-200';

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setImportanceTier(key)}
                    className={`flex items-center justify-center gap-2 py-2 px-2 rounded-xl border text-center transition cursor-pointer ${
                      active
                        ? activeCls
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-neutral-700 dark:bg-[#28292a] dark:text-neutral-300'
                    }`}
                    title={t(`tier.${key}.desc`, cfg.description)}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span className="text-[11px] font-medium">{t(`tier.${key}.label`, cfg.label)}</span>
                  </button>
                );
              })}
            </div>

            {/* 影响因子自动加权芯片 */}
            <div className="space-y-1.5">
              <span className="text-[11px] text-gray-500 dark:text-neutral-400 block">
                {t('task.influence_factors', '影响因素（可选）')}
              </span>
              <div className="flex flex-wrap gap-1.5 lg:flex-nowrap">
                {IMPACT_KEYS.map((sigKey) => {
                  const meta = IMPACT_SIGNAL_WEIGHTS[sigKey];
                  const selected = impactSignals.includes(sigKey);
                  return (
                    <button
                      key={sigKey}
                      type="button"
                      onClick={() => toggleSignal(sigKey)}
                      className={`text-[10.5px] px-2.5 py-1 rounded-lg border transition cursor-pointer whitespace-nowrap ${
                        selected
                          ? 'bg-blue-600 text-white border-blue-600 font-medium shadow-2xs'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 dark:bg-[#28292a] dark:text-neutral-300 dark:border-neutral-700'
                      }`}
                    >
                      {t(`signal.${sigKey}`, meta.label)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 默认折叠的手动调整入口 */}
            <div className="pt-1.5 border-t border-gray-200/60 dark:border-neutral-700/60">
              <button
                type="button"
                onClick={() => setOverrideExpanded((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-neutral-200 transition cursor-pointer"
              >
                {overrideExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                <SlidersHorizontal className="h-3 w-3" />
                <span>
                  {t('task.manual_adjust', '手动调整')}{overrideEnabled ? ` (${manualImportance})` : ''}
                </span>
              </button>

              {overrideExpanded && (
                <div className="mt-2.5 p-2.5 rounded-lg bg-white dark:bg-[#232425] border border-gray-200 dark:border-neutral-700 space-y-2">
                  <label className="flex items-center justify-between text-[11px] cursor-pointer select-none">
                    <span className="font-medium text-gray-700 dark:text-neutral-300">
                      {t('task.custom_importance', '自定义重要度')}
                    </span>
                    <input
                      type="checkbox"
                      checked={overrideEnabled}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setOverrideEnabled(checked);
                        if (checked) {
                          setManualImportance(importanceResult.autoImportance);
                        }
                      }}
                      className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                    />
                  </label>
                  <div className="flex items-center gap-2.5">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      disabled={!overrideEnabled}
                      value={overrideEnabled ? manualImportance : importanceResult.autoImportance}
                      onChange={(e) => setManualImportance(Number(e.target.value))}
                      className="flex-1 accent-blue-600 cursor-pointer disabled:opacity-40"
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      disabled={!overrideEnabled}
                      value={overrideEnabled ? manualImportance : importanceResult.autoImportance}
                      onChange={(e) => setManualImportance(clampScore100(Number(e.target.value)))}
                      className="w-16 rounded-lg border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-[#28292a] px-2 py-1 text-xs text-center font-mono disabled:opacity-40"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 2. 时间属性与紧迫度三模式（截止日期 / 每日固定 / 弹性待排） */}
          <div className="p-4 rounded-2xl bg-gray-50/80 dark:bg-neutral-800/40 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-800 dark:text-neutral-200">
                {t('task.time_arrangement', '时间安排')}
              </span>
            </div>

            {/* 四种时间模式切换 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 rounded-xl bg-gray-200/60 dark:bg-neutral-800">
              <button
                type="button"
                onClick={() => setTimeMode('deadline')}
                className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                  timeMode === 'deadline'
                    ? 'bg-white dark:bg-[#28292a] text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-gray-600 dark:text-neutral-400 hover:text-gray-900'
                }`}
              >
                <Calendar className="h-3 w-3" />
                <span>{t('task.type_deadline', '截止日期')}</span>
              </button>
              <button
                type="button"
                onClick={() => setTimeMode('specific_date')}
                className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                  timeMode === 'specific_date'
                    ? 'bg-white dark:bg-[#28292a] text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-gray-600 dark:text-neutral-400 hover:text-gray-900'
                }`}
              >
                <Target className="h-3 w-3" />
                <span>{t('task.type_specific_date', '指定执行日')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTimeMode('daily_fixed');
                }}
                className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                  timeMode === 'daily_fixed'
                    ? 'bg-white dark:bg-[#28292a] text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-gray-600 dark:text-neutral-400 hover:text-gray-900'
                }`}
              >
                <Repeat className="h-3 w-3" />
                <span>{t('task.type_daily', '周期任务')}</span>
              </button>
              <button
                type="button"
                onClick={() => setTimeMode('flexible')}
                className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                  timeMode === 'flexible'
                    ? 'bg-white dark:bg-[#28292a] text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-gray-600 dark:text-neutral-400 hover:text-gray-900'
                }`}
              >
                <InfinityIcon className="h-3 w-3" />
                <span>{t('task.type_flexible', '弹性待排')}</span>
              </button>
            </div>

            {/* 模式 A / 指定执行日：日期快捷选择 + 预计耗时 */}
            {(timeMode === 'deadline' || timeMode === 'specific_date') && (
              <div className="space-y-2.5">
                {timeMode === 'specific_date' && (
                  <p className="text-[11px] text-blue-600 dark:text-blue-400 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/70 dark:border-blue-800/40 rounded-xl px-2.5 py-1.5">
                    {t('task.specific_date_hint', '系统将锁定仅在选定日期当天（不会提前到更早日期）安排该任务。')}
                  </p>
                )}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-gray-400 mr-0.5">{t('task.quick_select', '快捷选择')}</span>
                  {[
                    { label: t('task.today', '今天'), days: 0 },
                    { label: t('task.tomorrow', '明天'), days: 1 },
                    { label: t('task.in_3_days', '3天后'), days: 3 },
                    { label: t('task.in_1_week', '1周后'), days: 7 },
                    { label: t('task.in_2_weeks', '2周后'), days: 14 },
                    { label: t('task.in_1_month', '1月内'), days: 30 },
                  ].map((preset) => {
                    const target = new Date();
                    target.setDate(target.getDate() + preset.days);
                    const presetStr = formatLocalDate(target);
                    const isSelected = dueDate === presetStr;
                    return (
                      <button
                        key={preset.days}
                        type="button"
                        onClick={() => handleQuickDateOffset(preset.days)}
                        className={`text-[11px] px-2 py-0.5 rounded-lg border transition-colors cursor-pointer ${
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

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1">
                      {timeMode === 'specific_date'
                        ? t('task.execution_date', '执行日期')
                        : t('task.deadline_date', '截止日期')}{' '}
                      <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1">
                      {timeMode === 'specific_date'
                        ? t('task.execution_latest_time', '最晚结束（可选）')
                        : t('task.deadline_time', '截止时刻（可选）')}
                    </label>
                    <input
                      type="time"
                      value={dueTime}
                      onChange={(e) => setDueTime(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1 flex items-center gap-1">
                      <Clock className="h-3 w-3 text-gray-400" />
                      <span>{t('task.duration', '耗时(分)')}</span>
                    </label>
                    <input
                      type="number"
                      min="5"
                      step="5"
                      value={estimatedMinutes}
                      onChange={(e) => setEstimatedMinutes(e.target.value ? Number(e.target.value) : '')}
                      placeholder="30"
                      className="w-full rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100"
                    />
                  </div>
                </div>
              </div>
            )}

            {(timeMode === 'deadline' || timeMode === 'specific_date') && (
              <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-neutral-200 cursor-pointer">
                <input type="checkbox" checked={hardDeadline} onChange={e => setHardDeadline(e.target.checked)} />
                {timeMode === 'specific_date'
                  ? t('task.strict_same_day', '仅限当天完成（忙时不顺延到次日）')
                  : t('task.hard_deadline', '不可逾期')}
              </label>
            )}

            {/* 模式 B：周期任务（每日重复 / 每周特定时间） */}
            {timeMode === 'daily_fixed' && (
              <div className="space-y-3">
                <p className="text-[11px] text-gray-600 dark:text-neutral-400 leading-relaxed">
                  {t('task.daily_hint', '按周期重复，可在下方选择每日或每周特定星期，并在高级设置中指定时间。')}
                </p>

                {/* 重复频率选择：每日重复 vs 每周特定时间 */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRecurrenceType('daily')}
                    className={`py-1.5 px-2.5 rounded-xl border text-xs font-medium transition cursor-pointer text-center ${
                      recurrenceType === 'daily'
                        ? 'bg-blue-50 text-blue-700 border-blue-400 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-700 font-semibold'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 dark:bg-[#28292a] dark:text-neutral-400 dark:border-neutral-700'
                    }`}
                  >
                    {t('task.recurrence_type_daily', '每日重复')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecurrenceType('weekly')}
                    className={`py-1.5 px-2.5 rounded-xl border text-xs font-medium transition cursor-pointer text-center ${
                      recurrenceType === 'weekly'
                        ? 'bg-blue-50 text-blue-700 border-blue-400 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-700 font-semibold'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 dark:bg-[#28292a] dark:text-neutral-400 dark:border-neutral-700'
                    }`}
                  >
                    {t('task.recurrence_type_weekly', '每周特定时间')}
                  </button>
                </div>

                {/* 每周特定天数选择器 */}
                {recurrenceType === 'weekly' && (
                  <div className="p-3 rounded-xl bg-white dark:bg-[#232425] border border-gray-200 dark:border-neutral-700 space-y-2.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-gray-700 dark:text-neutral-300">
                        {t('task.recurrence_weekdays_hint', '请选择每周重复的星期：')}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setRecurrenceDays([1, 2, 3, 4, 5])}
                          className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          {t('task.recurrence_preset_weekdays', '工作日')}
                        </button>
                        <span className="text-gray-300 dark:text-neutral-600">·</span>
                        <button
                          type="button"
                          onClick={() => setRecurrenceDays([6, 0])}
                          className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          {t('task.recurrence_preset_weekends', '周末')}
                        </button>
                        <span className="text-gray-300 dark:text-neutral-600">·</span>
                        <button
                          type="button"
                          onClick={() => setRecurrenceDays([1, 2, 3, 4, 5, 6, 0])}
                          className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          {t('task.recurrence_preset_all', '全选')}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-7 gap-1">
                      {[
                        { day: 1, label: t('task.weekday_mon', '周一') },
                        { day: 2, label: t('task.weekday_tue', '周二') },
                        { day: 3, label: t('task.weekday_wed', '周三') },
                        { day: 4, label: t('task.weekday_thu', '周四') },
                        { day: 5, label: t('task.weekday_fri', '周五') },
                        { day: 6, label: t('task.weekday_sat', '周六') },
                        { day: 0, label: t('task.weekday_sun', '周日') },
                      ].map(({ day, label }) => {
                        const isSelected = recurrenceDays.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => {
                              setRecurrenceDays((prev) => {
                                if (prev.includes(day)) {
                                  if (prev.length === 1) return prev; // 至少保留一天
                                  return prev.filter((d) => d !== day);
                                } else {
                                  return [...prev, day];
                                }
                              });
                            }}
                            className={`py-1.5 px-0.5 rounded-lg text-center text-[10.5px] font-medium transition cursor-pointer border ${
                              isSelected
                                ? 'bg-blue-600 text-white border-blue-600 shadow-2xs font-semibold'
                                : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100 dark:bg-[#28292a] dark:text-neutral-400 dark:border-neutral-700'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1 flex items-center gap-1">
                      <Clock className="h-3 w-3 text-gray-400" />
                      <span>{t('task.daily_duration', '单次耗时 (分钟)')}</span>
                    </label>
                    <input
                      type="number"
                      min="5"
                      step="5"
                      value={estimatedMinutes}
                      onChange={(e) => setEstimatedMinutes(e.target.value ? Number(e.target.value) : '')}
                      placeholder="30"
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100"
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    <span className="text-[10.5px] text-gray-500 dark:text-neutral-400">
                      {language === 'en'
                        ? `Today schedule busy ~${Math.round((dailyBusyMinutesAhead / 60) * 10) / 10}h`
                        : `今日已知日程占用约 ${Math.round((dailyBusyMinutesAhead / 60) * 10) / 10}h`}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* 模式 C：弹性无截止日任务 */}
            {timeMode === 'flexible' && (
              <div className="space-y-2.5">
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { key: 'urgent', label: t('task.pace_urgent', '尽快推进') },
                      { key: 'soon', label: t('task.pace_soon', '近日规划') },
                      { key: 'later', label: t('task.pace_later', '远期备忘') },
                    ] as Array<{ key: UrgencyPace; label: string }>
                  ).map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setUrgencyPace(p.key)}
                      className={`py-1.5 px-2 rounded-xl border text-[11px] font-medium transition cursor-pointer ${
                        urgencyPace === p.key
                          ? 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-700 font-semibold'
                          : 'bg-white text-gray-600 border-gray-200 dark:bg-[#28292a] dark:text-neutral-400 dark:border-neutral-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="block text-[10.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1 flex items-center gap-1">
                    <Clock className="h-3 w-3 text-gray-400" />
                    <span>{t('task.duration', '预计耗时 (分钟)')}</span>
                  </label>
                  <input
                    type="number"
                    min="5"
                    step="5"
                    value={estimatedMinutes}
                    onChange={(e) => setEstimatedMinutes(e.target.value ? Number(e.target.value) : '')}
                    placeholder="30"
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100"
                  />
                </div>
              </div>
            )}

            {/* 象限归类状态与紧迫度测算文案 */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-200/50 dark:border-neutral-800 text-xs">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${computedQuadrantMeta.themeColor.accentDot}`} />
                <span className="font-medium text-gray-800 dark:text-neutral-200">
                  {t(`quad.${computedQuadrantId}.name`, computedQuadrantMeta.name)}
                </span>
              </div>
            </div>
          </div>

          {/* 高级排程设置 (固定任务 / 双线程重叠) */}
          <div className="p-4 rounded-2xl bg-gray-50/80 dark:bg-neutral-800/40 space-y-3 text-xs">
            <span className="font-semibold text-gray-700 dark:text-neutral-300 block text-[11px] uppercase tracking-wider">
              {t('task.advanced', '高级设置')}
            </span>

            {/* 固定任务 */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isFixed}
                  onChange={(e) => setIsFixed(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                />
                <Pin className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                <span className="font-medium text-gray-800 dark:text-neutral-200">
                  {t('task.fixed_slot', '固定时间段（不参与自动重排）')}
                </span>
              </label>

              {isFixed && (
                <div className="pl-5.5 grid grid-cols-2 gap-2.5 pt-1">
                  <div>
                    <span className="text-[10px] text-gray-500 dark:text-neutral-400 block mb-1">{t('task.start_time', '开始时间')}</span>
                    <input
                      type="time"
                      value={fixedStartTime}
                      onChange={(e) => setFixedStartTime(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-[#232425] dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-500 dark:text-neutral-400 block mb-1">{t('task.end_time', '结束时间')}</span>
                    <input
                      type="time"
                      value={fixedEndTime}
                      onChange={(e) => setFixedEndTime(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-[#232425] dark:text-gray-100"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 双线程任务 */}
            <div className="pt-1 border-t border-gray-200/50 dark:border-neutral-800">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isConcurrent}
                  onChange={(e) => setIsConcurrent(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                />
                <Layers2 className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                <span className="font-medium text-gray-800 dark:text-neutral-200">
                  {t('task.allow_concurrent', '允许与其他日程并行')}
                </span>
              </label>
            </div>
          </div>

          {/* 备注描述 */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-neutral-300 mb-1.5">
              {t('task.notes', '备注（可选）')}
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('task.notes_placeholder', '添加备注细节...')}
              className="w-full rounded-xl border border-gray-200 bg-gray-50/50 p-2.5 text-xs text-gray-900 focus:bg-white dark:focus:bg-[#28292a] focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100 placeholder:text-gray-400 transition"
            />
          </div>

          {/* 标签管理 */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-neutral-300 mb-1.5 flex items-center gap-1.5">
              <TagIcon className="h-3.5 w-3.5 text-gray-400" />
              <span>{t('task.tags', '标签')}</span>
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
                placeholder={t('task.tags_placeholder', '输入标签并回车...')}
                className="flex-1 rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-1.5 text-xs text-gray-900 focus:bg-white dark:focus:bg-[#28292a] focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100 transition"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="px-3 py-1.5 rounded-xl border border-gray-200 text-xs text-gray-600 hover:bg-gray-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 transition cursor-pointer"
              >
                {t('task.add_tag', '添加')}
              </button>
            </div>

            {allExistingTags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {allExistingTags.map((tTag) => (
                  <button
                    key={tTag}
                    type="button"
                    onClick={() => {
                      if (!tags.includes(tTag)) setTags([...tags, tTag]);
                    }}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-neutral-300 transition cursor-pointer"
                  >
                    +{tTag}
                  </button>
                ))}
              </div>
            )}

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
          <div className="sticky bottom-0 -mx-6 px-6 py-4 flex items-center justify-between gap-2.5 border-t border-gray-100 dark:border-neutral-800 bg-white dark:bg-[#1e1f20]">
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
                      <span>{initialTask.isCompleted ? t('task.mark_uncompleted', '标记为未完成') : t('task.mark_completed', '完成任务')}</span>
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
                      title={t('common.delete', '删除此任务')}
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
                {t('common.cancel', '取消')}
              </button>
              <button
                type="submit"
                className="px-5 py-1.5 rounded-xl text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 shadow-xs transition-all cursor-pointer"
              >
                {initialTask ? t('common.save', '保存') : t('common.create', '创建')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
