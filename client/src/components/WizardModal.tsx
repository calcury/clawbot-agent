import { useState } from 'react';
import { calculateQuadrant, formatLocalDate } from '../types/task';
import { QUADRANTS_CONFIG } from '../constants/quadrants';
import { calculateDynamicUrgency } from '../utils/priorityAlgorithm';
import { Sparkles, X, ArrowRight, CheckCircle2, RotateCcw, Calendar, Clock, Cpu } from 'lucide-react';

interface WizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmTask: (data: {
    title: string;
    importance: number;
    urgency: number;
    dueDate: string;
    estimatedMinutes?: number;
  }) => void;
}

export const WizardModal: React.FC<WizardModalProps> = ({
  isOpen,
  onClose,
  onConfirmTask,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [importance, setImportance] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState<string>(() => formatLocalDate(new Date()));
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | ''>('');
  const [taskTitle, setTaskTitle] = useState('');

  if (!isOpen) return null;

  const effectiveDueDate = dueDate || formatLocalDate(new Date());
  const algoResult = calculateDynamicUrgency({
    dueDate: effectiveDueDate,
    estimatedMinutes: typeof estimatedMinutes === 'number' ? estimatedMinutes : 30,
  });
  const urgency = algoResult.urgency;

  const handleReset = () => {
    setStep(1);
    setImportance(null);
    setDueDate(formatLocalDate(new Date()));
    setEstimatedMinutes('');
    setTaskTitle('');
  };

  const handleSelectImportant = (val: boolean) => {
    setImportance(val ? 8.5 : 2.5);
    setStep(2);
  };

  const handleQuickDateOffset = (daysOffset: number) => {
    const target = new Date();
    target.setDate(target.getDate() + daysOffset);
    setDueDate(formatLocalDate(target));
  };

  const targetQuadrantId = importance !== null ? calculateQuadrant(importance, urgency) : 'q1';
  const meta = QUADRANTS_CONFIG[targetQuadrantId];

  const handleFinalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim() || importance === null || !effectiveDueDate) return;
    onConfirmTask({
      title: taskTitle.trim(),
      importance,
      urgency,
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
                象限决策向导
              </h2>
              <p className="text-[11px] text-gray-500 dark:text-neutral-400">
                两步精准识别任务属性，科学计算坐标落位
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
            步骤 {step} / 3
          </span>
        </div>

        <div className="p-6">
          {/* Step 1: 重要度问询 */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
                  第 1 步：价值与战略衡量 (纵轴 Y)
                </span>
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mt-2">
                  这件事是否直接影响你的核心目标或产生重大长期收益？
                </h3>
                <p className="text-xs text-gray-500 dark:text-neutral-400 mt-1">
                  反思：如果不做，是否会带来不可承受的战略后果或阻碍核心成就？
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleSelectImportant(true)}
                  className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 text-left hover:border-blue-500 hover:bg-blue-50/40 dark:border-neutral-800 dark:hover:border-blue-500 dark:hover:bg-blue-950/20 transition-all group cursor-pointer"
                >
                  <div className="h-5 w-5 rounded-full border border-gray-300 group-hover:border-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                    <div className="h-2.5 w-2.5 rounded-full group-hover:bg-blue-600 transition-colors" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100">
                      是，这是重大关键事项（高重要度 · 8.5分）
                    </h4>
                    <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-0.5">
                      关乎核心 KPI、个人健康、核心战略、关键项目成败。
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectImportant(false)}
                  className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 text-left hover:border-blue-500 hover:bg-blue-50/40 dark:border-neutral-800 dark:hover:border-blue-500 dark:hover:bg-blue-950/20 transition-all group cursor-pointer"
                >
                  <div className="h-5 w-5 rounded-full border border-gray-300 group-hover:border-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                    <div className="h-2.5 w-2.5 rounded-full group-hover:bg-blue-600 transition-colors" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100">
                      否，属于日常辅助或外部琐事（低重要度 · 2.5分）
                    </h4>
                    <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-0.5">
                      例行公事、他人的附带请求、无核心产出的消遣杂物。
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Step 2: 设定截止日期自动计算紧迫度 */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-900">
                  第 2 步：设定截止日期 (自动计算横轴紧迫度)
                </span>
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mt-2">
                  这件事的截止日期是什么时候？
                </h3>
                <p className="text-xs text-gray-500 dark:text-neutral-400 mt-1">
                  系统将根据距离截止日期的剩余时间与预计耗时，自动为你计算并实时更新紧迫度。
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-gray-50 dark:bg-neutral-800/40 border border-gray-200/80 dark:border-neutral-800">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1 flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5 text-gray-400" /> 截止日期 <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1 flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-gray-400" /> 预计耗时 (分)
                  </label>
                  <input
                    type="number"
                    min="5"
                    step="5"
                    value={estimatedMinutes}
                    onChange={(e) => setEstimatedMinutes(e.target.value ? Number(e.target.value) : '')}
                    placeholder="默认 30 分钟"
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100"
                  />
                </div>

                {/* 快捷日期预设 */}
                <div className="col-span-2 flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[11px] text-gray-400 mr-0.5">快捷选择：</span>
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

                {/* 自动测算紧迫度只读展示 */}
                <div className="col-span-2 pt-2 border-t border-gray-200/70 dark:border-neutral-700/60 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
                    <Cpu className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    <span>自动测算紧迫度：<strong>{algoResult.statusText}</strong></span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 font-mono">
                    {urgency.toFixed(1)} / 10
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-neutral-200 cursor-pointer"
                >
                  ← 返回上一步修改重要性
                </button>
                <button
                  type="button"
                  disabled={!dueDate}
                  onClick={() => setStep(3)}
                  className="px-4 py-1.5 rounded-full text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <span>下一步</span>
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
                    向导诊断完成！自动定位落位：
                  </h3>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`h-3 w-3 rounded-full ${meta.themeColor.accentDot}`} />
                    <span className="text-base font-extrabold text-gray-900 dark:text-gray-100">
                      {meta.name}
                    </span>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-bold border ${meta.themeColor.badgeBg}`}>
                    {meta.shortAction}
                  </span>
                </div>

                <div className="mt-2 text-xs text-gray-500 dark:text-neutral-400 font-mono">
                  截止日：{effectiveDueDate}（{algoResult.statusText}） · 坐标：紧迫度 {urgency.toFixed(1)}，重要度 {importance?.toFixed(1)}
                </div>

                <p className="text-xs text-gray-600 dark:text-neutral-300 mt-2">
                  💡 <strong>行动建议</strong>：{meta.description}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-1">
                  输入此任务的名称并直接入库
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="例如：完成第二季度经营数据复盘报告..."
                  className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-xs text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-neutral-700 dark:bg-[#28292a] dark:text-gray-100"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 dark:hover:text-neutral-200 cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> 重新诊断
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-1.5 rounded-full text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-neutral-800 cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={!taskTitle.trim()}
                    className="px-5 py-1.5 rounded-full text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
                  >
                    <span>保存并落位</span>
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
