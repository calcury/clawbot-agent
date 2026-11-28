import { useState } from 'react';
import { calculateQuadrant, formatLocalDate } from '../types/task';
import { QUADRANTS_CONFIG } from '../constants/quadrants';
import {
  calculateDynamicImportance,
  calculateDynamicUrgency,
  IMPACT_SIGNAL_WEIGHTS,
  IMPORTANCE_TIERS_CONFIG,
  type ImpactSignal,
  type ImportanceTier,
  type TimeMode,
  type UrgencyPace,
} from '../utils/priorityAlgorithm';
import {
  Sparkles,
  X,
  ArrowRight,
  CheckCircle2,
  RotateCcw,
  Calendar,
  Clock,
  Cpu,
  Repeat,
  Target,
  Infinity as InfinityIcon,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface WizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  dailyBusyMinutesAhead?: number;
  onConfirmTask: (data: {
    title: string;
    importance: number;
    urgency: number;
    importanceTier: ImportanceTier;
    impactSignals: ImpactSignal[];
    timeMode: TimeMode;
    urgencyPace: UrgencyPace;
    dueDate: string | null;
    estimatedMinutes?: number;
  }) => void;
}

const TIER_CHOICES: Array<{ key: ImportanceTier; icon: string }> = [
  { key: 'vital', icon: '⭐' },
  { key: 'support', icon: '💼' },
  { key: 'minor', icon: '📎' },
];

export const WizardModal: React.FC<WizardModalProps> = ({
  isOpen,
  onClose,
  dailyBusyMinutesAhead = 0,
  onConfirmTask,
}) => {
  const { t } = useTheme();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [importanceTier, setImportanceTier] = useState<ImportanceTier | null>(null);
  const [impactSignals, setImpactSignals] = useState<ImpactSignal[]>([]);
  const [timeMode, setTimeMode] = useState<TimeMode>('deadline');
  const [dueDate, setDueDate] = useState<string>(() => formatLocalDate(new Date()));
  const [urgencyPace, setUrgencyPace] = useState<UrgencyPace>('soon');
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | ''>('');
  const [taskTitle, setTaskTitle] = useState('');

  if (!isOpen) return null;

  const effectiveMinutes = typeof estimatedMinutes === 'number' && estimatedMinutes > 0 ? estimatedMinutes : 30;

  const impResult = calculateDynamicImportance({
    tier: importanceTier ?? 'support',
    estimatedMinutes: effectiveMinutes,
    impactSignals,
  });
  const importance = impResult.importance;

  const effectiveDueDate =
    timeMode === 'deadline' || timeMode === 'specific_date'
      ? dueDate || formatLocalDate(new Date())
      : null;
  const algoResult = calculateDynamicUrgency({
    timeMode,
    dueDate: effectiveDueDate,
    estimatedMinutes: effectiveMinutes,
    importance,
    urgencyPace,
    dailyBusyMinutesAhead,
  });
  const urgency = algoResult.urgency;

  const handleReset = () => {
    setStep(1);
    setImportanceTier(null);
    setImpactSignals([]);
    setTimeMode('deadline');
    setDueDate(formatLocalDate(new Date()));
    setUrgencyPace('soon');
    setEstimatedMinutes('');
    setTaskTitle('');
  };

  const toggleSignal = (sig: ImpactSignal) => {
    setImpactSignals((prev) =>
      prev.includes(sig) ? prev.filter((item) => item !== sig) : [...prev, sig]
    );
  };

  const handleQuickDateOffset = (daysOffset: number) => {
    const target = new Date();
    target.setDate(target.getDate() + daysOffset);
    setDueDate(formatLocalDate(target));
  };

  const targetQuadrantId = calculateQuadrant(importance, urgency);
  const meta = QUADRANTS_CONFIG[targetQuadrantId];

  const handleFinalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim() || !importanceTier) return;
    if ((timeMode === 'deadline' || timeMode === 'specific_date') && !effectiveDueDate) return;

    onConfirmTask({
      title: taskTitle.trim(),
      importance,
      urgency,
      importanceTier,
      impactSignals,
      timeMode,
      urgencyPace,
      dueDate: effectiveDueDate,
      estimatedMinutes: typeof estimatedMinutes === 'number' ? estimatedMinutes : undefined,
    });
    handleReset();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-800 shadow-2xl overflow-hidden transition-all animate-in fade-in zoom-in-95 duration-150">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-neutral-800 bg-blue-50/40 dark:bg-blue-950/20">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-blue-600 text-white shadow-xs">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
                {t('wizard.title', '象限决策向导')}
              </h2>
              <p className="text-[11px] text-gray-500 dark:text-neutral-400">
                {t('wizard.subtitle', '三阶认知定级 + 智能耦合算分（0–100 分制）')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 进度指示 */}
        <div className="px-6 pt-4 flex items-center justify-between gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-neutral-800 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{ width: `${(step / 3) * 100}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
            {t('wizard.step_counter', '步骤')} {step} / 3
          </span>
        </div>

        <div className="p-6">
          {/* Step 1: 三阶战略定级 + 影响因子 */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
                  {t('wizard.step1_title', '第 1 步：三阶认知定级 (纵轴重要度)')}
                </span>
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mt-2">
                  {t('wizard.step1_desc', '这件事在你的目标版图中属于哪一档？')}
                </h3>
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                {TIER_CHOICES.map(({ key, icon }) => {
                  const cfg = IMPORTANCE_TIERS_CONFIG[key];
                  const selected = importanceTier === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setImportanceTier(key)}
                      className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                        selected
                          ? 'border-blue-500 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/30 ring-1 ring-blue-500/30'
                          : 'border-gray-200 hover:border-blue-400 dark:border-neutral-800 dark:hover:border-blue-500'
                      }`}
                    >
                      <span className="text-base mt-0.5">{icon}</span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100">
                            {t(`tier.${key}.label`, cfg.label)}
                          </h4>
                          <span className="text-[11px] font-mono text-gray-500 dark:text-neutral-400">
                            {t('wizard.base_score', '基准')} {cfg.base} / 100
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-0.5">
                          {t(`tier.${key}.desc`, cfg.description)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] text-gray-500 dark:text-neutral-400 block">
                  {t('wizard.signals', '可选附加价值信号（系统将自动加权）：')}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(IMPACT_SIGNAL_WEIGHTS) as ImpactSignal[]).map((sig) => {
                    const metaSig = IMPACT_SIGNAL_WEIGHTS[sig];
                    const active = impactSignals.includes(sig);
                    return (
                      <button
                        key={sig}
                        type="button"
                        onClick={() => toggleSignal(sig)}
                        className={`text-[10.5px] px-2.5 py-1 rounded-lg border transition cursor-pointer ${
                          active
                            ? 'bg-blue-600 text-white border-blue-600 font-medium'
                            : 'bg-white text-gray-600 border-gray-200 dark:bg-[#28292a] dark:text-neutral-300 dark:border-neutral-700'
                        }`}
                      >
                        {active ? '✓ ' : '+ '}
                        {t(`signal.${sig}`, metaSig.label)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[11px] text-gray-500 font-mono">
                  {importanceTier ? `${t('wizard.current_imp', '当前重要度')}：${importance} / 100` : t('wizard.select_tier', '请选择一个档位')}
                </span>
                <button
                  type="button"
                  disabled={!importanceTier}
                  onClick={() => setStep(2)}
                  className="px-4 py-1.5 rounded-full text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <span>{t('wizard.next_step', '下一步')}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: 三模式时间设定与耦合紧迫度 */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-900">
                  {t('wizard.step2_title', '第 2 步：时间属性与紧迫度测算 (横轴紧迫度)')}
                </span>
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mt-2">
                  {t('wizard.step2_desc', '这件事的时间安排方式是？')}
                </h3>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 rounded-xl bg-gray-100 dark:bg-neutral-800">
                <button
                  type="button"
                  onClick={() => setTimeMode('deadline')}
                  className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer ${
                    timeMode === 'deadline'
                      ? 'bg-white dark:bg-[#28292a] text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                      : 'text-gray-600 dark:text-neutral-400'
                  }`}
                >
                  <Calendar className="h-3 w-3" /> {t('task.type_deadline', '截止日期')}
                </button>
                <button
                  type="button"
                  onClick={() => setTimeMode('specific_date')}
                  className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer ${
                    timeMode === 'specific_date'
                      ? 'bg-white dark:bg-[#28292a] text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                      : 'text-gray-600 dark:text-neutral-400'
                  }`}
                >
                  <Target className="h-3 w-3" /> {t('task.type_specific_date', '指定执行日')}
                </button>
                <button
                  type="button"
                  onClick={() => setTimeMode('daily_fixed')}
                  className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer ${
                    timeMode === 'daily_fixed'
                      ? 'bg-white dark:bg-[#28292a] text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                      : 'text-gray-600 dark:text-neutral-400'
                  }`}
                >
                  <Repeat className="h-3 w-3" /> {t('task.type_daily', '周期任务')}
                </button>
                <button
                  type="button"
                  onClick={() => setTimeMode('flexible')}
                  className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer ${
                    timeMode === 'flexible'
                      ? 'bg-white dark:bg-[#28292a] text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                      : 'text-gray-600 dark:text-neutral-400'
                  }`}
                >
                  <InfinityIcon className="h-3 w-3" /> {t('task.type_flexible', '弹性待排')}
                </button>
              </div>

              <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-neutral-800/40 border border-gray-200/80 dark:border-neutral-800 space-y-3">
                {(timeMode === 'deadline' || timeMode === 'specific_date') && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1">
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
                          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1 flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-gray-400" /> {t('task.duration', '预计耗时 (分)')}
                        </label>
                        <input
                          type="number"
                          min="5"
                          step="5"
                          value={estimatedMinutes}
                          onChange={(e) =>
                            setEstimatedMinutes(e.target.value ? Number(e.target.value) : '')
                          }
                          placeholder="30"
                          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] text-gray-400 mr-0.5">{t('wizard.approx_date', '大致日期：')}</span>
                      {[
                        { label: t('task.today', '今天'), days: 0 },
                        { label: t('task.tomorrow', '明天'), days: 1 },
                        { label: t('task.in_3_days', '3天后'), days: 3 },
                        { label: t('task.in_1_week', '1周后'), days: 7 },
                        { label: t('task.in_2_weeks', '2周后'), days: 14 },
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
                            className={`text-[10px] px-2.5 py-0.5 rounded-full border transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400 dark:bg-[#28292a] dark:text-neutral-300 dark:border-neutral-700'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                {timeMode === 'daily_fixed' && (
                  <div className="space-y-2">
                    <p className="text-[11px] text-gray-600 dark:text-neutral-400">
                      {t('wizard.daily_hint', '周期任务将根据当日日程空闲度动态评估紧迫度，完成后当日打卡、并在下一个周期日自动恢复。')}
                    </p>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1">
                        {t('task.daily_duration', '单次耗时 (分钟)')}
                      </label>
                      <input
                        type="number"
                        min="5"
                        step="5"
                        value={estimatedMinutes}
                        onChange={(e) =>
                          setEstimatedMinutes(e.target.value ? Number(e.target.value) : '')
                        }
                        placeholder="30"
                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100"
                      />
                    </div>
                  </div>
                )}

                {timeMode === 'flexible' && (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { key: 'urgent', label: `🔥 ${t('task.pace_urgent', '尽快推进')}` },
                          { key: 'soon', label: `⏱️ ${t('task.pace_soon', '近日规划')}` },
                          { key: 'later', label: `☕ ${t('task.pace_later', '远期备忘')}` },
                        ] as Array<{ key: UrgencyPace; label: string }>
                      ).map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => setUrgencyPace(p.key)}
                          className={`py-1.5 px-2 rounded-xl border text-[11px] font-medium cursor-pointer ${
                            urgencyPace === p.key
                              ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                              : 'bg-white text-gray-600 border-gray-200 dark:bg-[#28292a] dark:text-neutral-300 dark:border-neutral-700'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1">
                        {t('task.duration', '预计耗时 (分钟)')}
                      </label>
                      <input
                        type="number"
                        min="5"
                        step="5"
                        value={estimatedMinutes}
                        onChange={(e) =>
                          setEstimatedMinutes(e.target.value ? Number(e.target.value) : '')
                        }
                        placeholder="30"
                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100"
                      />
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-gray-200/70 dark:border-neutral-700/60 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
                    <Cpu className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    <span>
                      {t('wizard.coupling_calc', '耦合测算：')}<strong>{algoResult.statusText}</strong>
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 font-mono">
                    {urgency} / 100
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-neutral-200 cursor-pointer"
                >
                  {t('wizard.back_step', '← 返回上一步修改定级')}
                </button>
                <button
                  type="button"
                  disabled={timeMode === 'deadline' && !dueDate}
                  onClick={() => setStep(3)}
                  className="px-4 py-1.5 rounded-full text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <span>{t('wizard.next_step', '下一步')}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: 诊断结论与一键收纳 */}
          {step === 3 && (
            <form onSubmit={handleFinalSubmit} className="space-y-4">
              <div className={`p-4 rounded-2xl border ${meta.themeColor.border} ${meta.themeColor.headerBg}`}>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    {t('wizard.step3_title', '向导诊断完成！自动定位落位：')}
                  </h3>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`h-3 w-3 rounded-full ${meta.themeColor.accentDot}`} />
                    <span className="text-base font-extrabold text-gray-900 dark:text-gray-100">
                      {t(`quad.${targetQuadrantId}.name`, meta.name)}
                    </span>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-bold border ${meta.themeColor.badgeBg}`}>
                    {meta.shortAction}
                  </span>
                </div>

                <div className="mt-2 text-xs text-gray-500 dark:text-neutral-400 font-mono">
                  {algoResult.statusText} · {t('task.importance', '重要度')} {importance} / 100 · {t('todo.urgency_3', '紧迫度').slice(0, 3)} {urgency} / 100
                </div>

                <p className="text-xs text-gray-600 dark:text-neutral-300 mt-2">
                  💡 <strong>{t('wizard.action_advice', '行动建议')}</strong>：{t(`quad.${targetQuadrantId}.desc`, meta.description)}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1">
                  {t('wizard.input_task_name', '输入此任务的名称并直接入库')}
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder={t('wizard.task_name_placeholder', '例如：完成第二季度经营数据复盘报告...')}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-xs text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 dark:hover:text-neutral-200 cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> {t('wizard.restart', '重新诊断')}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-1.5 rounded-full text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-neutral-800 cursor-pointer"
                  >
                    {t('common.cancel', '取消')}
                  </button>
                  <button
                    type="submit"
                    disabled={!taskTitle.trim()}
                    className="px-5 py-1.5 rounded-full text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
                  >
                    <span>{t('wizard.save_place', '保存并落位')}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
