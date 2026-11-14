import type { QuadrantId } from '../types/task';
import { QUADRANTS_CONFIG } from '../constants/quadrants';
import { X, PieChart, TrendingUp } from 'lucide-react';

interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: {
    total: number;
    completed: number;
    pending: number;
    completionRate: number;
    breakdown: Record<QuadrantId, { total: number; completed: number; pending: number; percent: number }>;
  };
}

export const StatsModal: React.FC<StatsModalProps> = ({
  isOpen,
  onClose,
  stats,
}) => {
  if (!isOpen) return null;

  const q2Percent = stats.breakdown.q2.percent;
  const q1Percent = stats.breakdown.q1.percent;
  const q3Percent = stats.breakdown.q3.percent;
  const q4Percent = stats.breakdown.q4.percent;

  // 效能诊断建议
  const getEfficiencyAdvice = () => {
    if (stats.total === 0) {
      return {
        title: '尚未录入事项',
        content: '录入更多待办事项后，系统将自动分析你的四象限精力投入结构。',
        type: 'info',
      };
    }
    if (q1Percent > 35) {
      return {
        title: '⚠️ 处于“救火状态”风险',
        content: `重要且紧急事项占比已达 ${q1Percent}%（建议控制在 20%~25%）。这说明突发危机较多，容易导致身心疲惫。建议多投入时间到【Q2 重要不紧急】进行前置规划与防患。`,
        type: 'warning',
      };
    }
    if (q2Percent >= 50) {
      return {
        title: '🌟 极佳的黄金效能状态！',
        content: `【Q2 重要不紧急】占比达到 ${q2Percent}%（高产人士理想占比为 60%+）。你正在将核心精力投向长期目标、成长规划与预防性工作，请继续保持！`,
        type: 'success',
      };
    }
    if (q3Percent > 30) {
      return {
        title: '⚠️ 被外部琐事打扰过多',
        content: `【Q3 紧急不重要】占比高达 ${q3Percent}%。很多紧急的事情并不代表重要，建议尝试授权委派、设定专注时段或礼貌拒绝。`,
        type: 'warning',
      };
    }
    if (q4Percent > 20) {
      return {
        title: '⚠️ 存在时间黑洞隐患',
        content: `【Q4 不重要不紧急】占比 ${q4Percent}%。建议坚决剔除逃避性事务与低价值消耗，把精力腾挪给更有意义的事。`,
        type: 'warning',
      };
    }
    return {
      title: '📈 精力结构相对均衡',
      content: `当前重点放在推进 Q1 交付与扩大 Q2 规划。持续优化时间分配，逐步提升 Q2 长期事项比例。`,
      type: 'info',
    };
  };

  const advice = getEfficiencyAdvice();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden transition-all animate-in fade-in zoom-in-95 duration-150">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
              <PieChart className="h-5 w-5" />
            </span>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              四象限精力与效能复盘
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 内容主体 */}
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* 数据总览卡片 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 dark:bg-slate-800/40 dark:border-slate-800 text-center">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">事项总计</div>
              <div className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-1">
                {stats.total}
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-amber-50/50 border border-amber-200/60 dark:bg-amber-950/20 dark:border-amber-900/40 text-center">
              <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">进行待办</div>
              <div className="text-2xl font-black text-amber-700 dark:text-amber-300 mt-1">
                {stats.pending}
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-emerald-50/50 border border-emerald-200/60 dark:bg-emerald-950/20 dark:border-emerald-900/40 text-center">
              <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">已完成</div>
              <div className="text-2xl font-black text-emerald-700 dark:text-emerald-300 mt-1">
                {stats.completed}
              </div>
            </div>
          </div>

          {/* 四象限分布进度条 */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                各象限精力投入占比
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                完成率：{stats.completionRate}%
              </span>
            </div>

            {(['q1', 'q2', 'q3', 'q4'] as QuadrantId[]).map((qid) => {
              const meta = QUADRANTS_CONFIG[qid];
              const qStats = stats.breakdown[qid];
              return (
                <div key={qid} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 font-medium">
                      <span className={`h-2.5 w-2.5 rounded-full ${meta.themeColor.accentDot}`} />
                      <span className="text-slate-800 dark:text-slate-200">{meta.name}</span>
                      <span className="text-[11px] text-slate-400">({meta.shortAction})</span>
                    </div>
                    <div className="font-semibold text-slate-700 dark:text-slate-300">
                      {qStats.total} 项 · {qStats.percent}%
                    </div>
                  </div>

                  <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                    <div
                      className={`h-full ${meta.themeColor.accentDot} transition-all duration-500`}
                      style={{ width: `${qStats.percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 效能诊断建议 */}
          <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-200/80 dark:bg-indigo-950/30 dark:border-indigo-900/50 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900 dark:text-indigo-300">
              <TrendingUp className="h-4 w-4" />
              <span>{advice.title}</span>
            </div>
            <p className="text-xs text-indigo-800/90 dark:text-indigo-300/90 leading-relaxed">
              {advice.content}
            </p>
          </div>
        </div>

        {/* 底部 */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
