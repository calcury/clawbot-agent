import React, { useRef } from 'react';
import type { TaskItem } from '../types/task';
import { 
  Calendar, 
  Clock, 
  MousePointerClick
} from 'lucide-react';

interface MatrixBoardProps {
  tasks: TaskItem[];
  onToggleComplete?: (id: string) => void;
  onEdit: (task: TaskItem) => void;
  onDelete?: (id: string) => void;
  onOpenCreateWithCoordinates: (importance: number, urgency: number) => void;
}

export const MatrixBoard: React.FC<MatrixBoardProps> = ({
  tasks,
  onEdit,
  onOpenCreateWithCoordinates,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // 处理在坐标系任意空白区域点击，快速落位创建
  const handlePlaneClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 只有点击背景本身才触发，点击已有任务卡片不触发
    if ((e.target as HTMLElement).closest('.task-coordinate-node')) {
      return;
    }
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const xRatio = Math.max(0, Math.min(1, clickX / rect.width));
    const yRatio = Math.max(0, Math.min(1, clickY / rect.height));

    // 坐标系映射规则：
    // X 轴：左侧紧迫度 10，右侧紧迫度 0
    const rawUrgency = 10 - xRatio * 10;
    // Y 轴：上方重要度 10，下方重要度 0
    const rawImportance = 10 - yRatio * 10;

    const urgency = Math.round(rawUrgency * 2) / 2;
    const importance = Math.round(rawImportance * 2) / 2;

    onOpenCreateWithCoordinates(importance, urgency);
  };

  // 根据任务评分计算其在坐标系平面中的百分比位置，并计算防溢出动态反向锚定
  const calculatePosition = (task: TaskItem) => {
    const rawUrgency = typeof task.urgency === 'number' ? task.urgency : (task.isUrgent ? 8 : 2);
    const rawImportance = typeof task.importance === 'number' ? task.importance : (task.isImportant ? 8 : 2);

    const clampedUrgency = Math.max(0, Math.min(10, rawUrgency));
    const clampedImportance = Math.max(0, Math.min(10, rawImportance));

    // X 轴：左侧为 10 (紧急)，右侧为 0 (不紧急)
    // 留出 8% ~ 92% 缓冲，保证圆点和卡片完全处于边界内
    const uPct = (10 - clampedUrgency) / 10;
    const leftPercent = 8 + uPct * 84;

    // Y 轴：上方为 10 (重要)，下方为 0 (不重要)
    // 留出 8% ~ 92% 缓冲
    const iPct = (10 - clampedImportance) / 10;
    const topPercent = 8 + iPct * 84;

    // 智能动态防溢出对齐锚定：
    // 横向：若在左侧 (< 30%)，卡片向右侧伸展；若在右侧 (> 70%)，卡片向左侧伸展；居中则对称居中
    const alignX: 'left' | 'right' | 'center' =
      leftPercent < 30 ? 'left' : leftPercent > 70 ? 'right' : 'center';

    // 纵向：若靠近底部 (> 70%)，卡片向上方伸展；否则向下方伸展
    const alignY: 'top' | 'bottom' = topPercent > 70 ? 'bottom' : 'top';

    return {
      leftPercent,
      topPercent,
      alignX,
      alignY,
      urgency: clampedUrgency,
      importance: clampedImportance,
    };
  };

  return (
    <div
      ref={containerRef}
      onClick={handlePlaneClick}
      className="relative w-full h-full rounded-2xl border border-gray-200/80 dark:border-neutral-800/80 bg-white dark:bg-[#1e1f20] shadow-xs overflow-hidden cursor-crosshair select-none transition-colors"
    >
      {/* ===================== 四象限背景网格与轻量底色 (Google Todo 配色) ===================== */}
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 pointer-events-none">
        {/* 象限 I (左上): Do First */}
        <div className="relative border-r border-b border-dashed border-gray-200 dark:border-neutral-800/80 bg-rose-50/25 dark:bg-rose-950/10 p-3 sm:p-4 flex flex-col justify-start">
          <div className="flex items-center gap-1.5 opacity-80">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            <span className="text-xs font-bold text-rose-700 dark:text-rose-300 tracking-wider">
              Do First
            </span>
          </div>
        </div>

        {/* 象限 II (右上): Schedule */}
        <div className="relative border-b border-dashed border-gray-200 dark:border-neutral-800/80 bg-blue-50/25 dark:bg-blue-950/10 p-3 sm:p-4 flex flex-col justify-start items-end">
          <div className="flex items-center gap-1.5 opacity-80">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span className="text-xs font-bold text-blue-700 dark:text-blue-300 tracking-wider">
              Schedule
            </span>
          </div>
        </div>

        {/* 象限 III (左下): Delegate */}
        <div className="relative border-r border-dashed border-gray-200 dark:border-neutral-800/80 bg-amber-50/25 dark:bg-amber-950/10 p-3 sm:p-4 flex flex-col justify-end">
          <div className="flex items-center gap-1.5 opacity-80">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-xs font-bold text-amber-700 dark:text-amber-300 tracking-wider">
              Delegate
            </span>
          </div>
        </div>

        {/* 象限 IV (右下): Eliminate */}
        <div className="relative bg-gray-50/30 dark:bg-neutral-900/15 p-3 sm:p-4 flex flex-col justify-end items-end">
          <div className="flex items-center gap-1.5 opacity-70">
            <span className="h-2 w-2 rounded-full bg-gray-400 dark:bg-neutral-500" />
            <span className="text-xs font-bold text-gray-700 dark:text-neutral-300 tracking-wider">
              Eliminate
            </span>
          </div>
        </div>
      </div>

      {/* ===================== 十字交叉坐标轴 (Center Axes) ===================== */}
      {/* 纵轴 (Y 轴): 重要程度 (Important / Not Important) */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-300 dark:bg-neutral-700 pointer-events-none z-10 -translate-x-1/2">
        {/* 上箭头与标签 */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5">
          <div className="w-0 h-0 border-x-4 border-x-transparent border-b-6 border-b-gray-500 dark:border-b-neutral-400" />
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/95 dark:bg-[#1e1f20]/95 text-rose-700 dark:text-rose-300 border border-gray-200 dark:border-neutral-700 shadow-2xs whitespace-nowrap">
            Important
          </span>
        </div>

        {/* 下箭头与标签 */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/95 dark:bg-[#1e1f20]/95 text-gray-600 dark:text-neutral-400 border border-gray-200 dark:border-neutral-700 shadow-2xs whitespace-nowrap">
            Not Important
          </span>
          <div className="w-0 h-0 border-x-4 border-x-transparent border-t-6 border-t-gray-500 dark:border-t-neutral-400" />
        </div>
      </div>

      {/* 横轴 (X 轴): 紧迫程度 (Urgent / Not Urgent) */}
      <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-300 dark:bg-neutral-700 pointer-events-none z-10 -translate-y-1/2">
        {/* 左箭头与标签 */}
        <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <div className="w-0 h-0 border-y-4 border-y-transparent border-r-6 border-r-gray-500 dark:border-r-neutral-400" />
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/95 dark:bg-[#1e1f20]/95 text-amber-700 dark:text-amber-300 border border-gray-200 dark:border-neutral-700 shadow-2xs whitespace-nowrap">
            Urgent
          </span>
        </div>

        {/* 右箭头与标签 */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/95 dark:bg-[#1e1f20]/95 text-blue-700 dark:text-blue-300 border border-gray-200 dark:border-neutral-700 shadow-2xs whitespace-nowrap">
            Not Urgent
          </span>
          <div className="w-0 h-0 border-y-4 border-y-transparent border-l-6 border-l-gray-500 dark:border-l-neutral-400" />
        </div>
      </div>

      {/* 中心原点 - Google Blue */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 flex items-center justify-center">
        <div className="h-2.5 w-2.5 rounded-full bg-blue-600 dark:bg-blue-500 ring-4 ring-white dark:ring-[#1e1f20] shadow-xs" />
      </div>

      {/* ===================== 坐标系任务落位节点 (Task Coordinate Nodes · 模仿 oxoxox 经典排版) ===================== */}
      {/* 过滤掉已完成任务：已完成任务不显示在四象限看板中 */}
      {(() => {
        const activeTasks = tasks.filter((t) => !t.isCompleted);
        return (
          <>
            {activeTasks.map((task) => {
              const { leftPercent, topPercent, alignX, alignY, urgency, importance } = calculatePosition(task);
              const isImportant = importance >= 5;
              const isUrgent = urgency >= 5;
              const quadrantLabel = isImportant ? (isUrgent ? 'Q1' : 'Q2') : (isUrgent ? 'Q3' : 'Q4');

              const qBadgeStyle =
                quadrantLabel === 'Q1'
                  ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-900'
                  : quadrantLabel === 'Q2'
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-900'
                  : quadrantLabel === 'Q3'
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-900'
                  : 'bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-neutral-300 border-gray-200 dark:border-neutral-700';

              const dotColor =
                quadrantLabel === 'Q1'
                  ? 'bg-rose-500'
                  : quadrantLabel === 'Q2'
                  ? 'bg-blue-600 dark:bg-blue-500'
                  : quadrantLabel === 'Q3'
                  ? 'bg-amber-500'
                  : 'bg-gray-400 dark:bg-neutral-500';

              return (
                <div
                  key={task.id}
                  style={{
                    left: `${leftPercent}%`,
                    top: `${topPercent}%`,
                  }}
                  className="task-coordinate-node absolute z-20 group cursor-pointer -translate-x-1/2 -translate-y-1/2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(task);
                  }}
                >
                  {/* 坐标定位指示圆点 */}
                  <div className="relative flex items-center justify-center">
                    <div
                      className={`w-3 h-3 rounded-full border-2 border-white dark:border-[#1e1f20] shadow-xs transition-transform duration-150 group-hover:scale-125 ${dotColor}`}
                    />
                  </div>

                  {/* 任务微卡片 (模仿 oxoxox 经典两行排版 · 纯净无坐标与完成按钮 · 点击打开编辑菜单) */}
                  <div
                    className={`absolute z-30 transition-all duration-150 group-hover:scale-105 pointer-events-auto ${
                      alignY === 'bottom' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
                    } ${
                      alignX === 'left'
                        ? 'left-0'
                        : alignX === 'right'
                        ? 'right-0'
                        : 'left-1/2 -translate-x-1/2'
                    }`}
                  >
                    <div
                      className="rounded-xl border border-gray-200/90 dark:border-neutral-700 bg-white/95 dark:bg-[#28292a]/95 backdrop-blur-xs p-2 text-xs shadow-xs hover:border-blue-500/60 dark:hover:border-blue-400/60 hover:shadow-md transition-all w-max min-w-[130px] max-w-[190px] sm:max-w-[220px]"
                      title="点击打开编辑菜单（可完成任务或修改详情）"
                    >
                      {/* 第一行：象限徽标 + 任务标题 (不显示坐标分值，不显示完成按钮) */}
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`px-1.5 py-0.2 rounded text-[9px] font-bold border shrink-0 ${qBadgeStyle}`}
                        >
                          {quadrantLabel}
                        </span>
                        <span
                          className="truncate font-medium text-[11px] leading-tight text-gray-900 dark:text-gray-100 flex-1"
                          title={task.title}
                        >
                          {task.title}
                        </span>
                      </div>

                      {/* 第二行：截止日期 / 预计耗时 / 标签 (oxoxox 经典属性排列) */}
                      {(task.dueDate || task.estimatedMinutes || (task.tags && task.tags.length > 0)) && (
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-500 dark:text-neutral-400 min-w-0">
                          {task.dueDate && (
                            <span
                              className={`flex items-center gap-0.5 truncate shrink-0 ${
                                task.algorithmStatusText ? 'text-blue-600 dark:text-blue-400 font-medium' : ''
                              }`}
                              title={task.algorithmStatusText ? `算法实时测算：${task.algorithmStatusText}` : `截止日: ${task.dueDate}`}
                            >
                              <Calendar className="h-2.5 w-2.5 shrink-0" />
                              <span>{task.algorithmStatusText || task.dueDate.slice(5)}</span>
                            </span>
                          )}

                          {task.estimatedMinutes ? (
                            <span className="flex items-center gap-0.5 shrink-0 font-mono">
                              <Clock className="h-2.5 w-2.5 shrink-0 text-gray-400 dark:text-neutral-500" />
                              <span>{task.estimatedMinutes}m</span>
                            </span>
                          ) : null}

                          {task.tags && task.tags.length > 0 && (
                            <span className="truncate text-gray-400 dark:text-neutral-500 text-[9px]">
                              #{task.tags[0]}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* ===================== 空看板引导提示 ===================== */}
            {activeTasks.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/90 dark:bg-[#28292a]/90 border border-gray-200 dark:border-neutral-700 shadow-xs backdrop-blur-xs text-xs text-gray-600 dark:text-neutral-300">
                  <MousePointerClick className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span>点击坐标平面任意位置即可按坐标自动落位添加待办，或按快捷键 <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-neutral-700 text-gray-700 dark:text-neutral-300 font-mono text-[10px]">N</kbd></span>
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
};
