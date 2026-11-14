import React, { useRef } from 'react';
import type { TaskItem } from '../types/task';
import { 
  Check, 
  Trash2, 
  Edit3, 
  MousePointerClick
} from 'lucide-react';

interface MatrixBoardProps {
  tasks: TaskItem[];
  onToggleComplete: (id: string) => void;
  onEdit: (task: TaskItem) => void;
  onDelete: (id: string) => void;
  onOpenCreateWithCoordinates: (importance: number, urgency: number) => void;
}

export const MatrixBoard: React.FC<MatrixBoardProps> = ({
  tasks,
  onToggleComplete,
  onEdit,
  onDelete,
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
        {/* 象限 I (左上): 重要且紧急 */}
        <div className="relative border-r border-b border-dashed border-gray-200 dark:border-neutral-800/80 bg-rose-50/25 dark:bg-rose-950/10 p-3 sm:p-4 flex flex-col justify-start">
          <div className="flex items-center gap-1.5 opacity-80">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            <span className="text-xs font-bold text-rose-700 dark:text-rose-300 tracking-wider">
              象限 I · 重要且紧急
            </span>
            <span className="text-[10px] text-rose-600 dark:text-rose-400 font-medium hidden sm:inline">
              (DO FIRST · 立即执行)
            </span>
          </div>
        </div>

        {/* 象限 II (右上): 重要不紧急 */}
        <div className="relative border-b border-dashed border-gray-200 dark:border-neutral-800/80 bg-blue-50/25 dark:bg-blue-950/10 p-3 sm:p-4 flex flex-col justify-start items-end">
          <div className="flex items-center gap-1.5 opacity-80">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span className="text-xs font-bold text-blue-700 dark:text-blue-300 tracking-wider">
              象限 II · 重要不紧急
            </span>
            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium hidden sm:inline">
              (SCHEDULE · 规划深耕)
            </span>
          </div>
        </div>

        {/* 象限 III (左下): 紧急不重要 */}
        <div className="relative border-r border-dashed border-gray-200 dark:border-neutral-800/80 bg-amber-50/25 dark:bg-amber-950/10 p-3 sm:p-4 flex flex-col justify-end">
          <div className="flex items-center gap-1.5 opacity-80">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-xs font-bold text-amber-700 dark:text-amber-300 tracking-wider">
              象限 III · 紧急不重要
            </span>
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium hidden sm:inline">
              (DELEGATE · 批量委派)
            </span>
          </div>
        </div>

        {/* 象限 IV (右下): 不重要不紧急 */}
        <div className="relative bg-gray-50/30 dark:bg-neutral-900/15 p-3 sm:p-4 flex flex-col justify-end items-end">
          <div className="flex items-center gap-1.5 opacity-70">
            <span className="h-2 w-2 rounded-full bg-gray-400 dark:bg-neutral-500" />
            <span className="text-xs font-bold text-gray-700 dark:text-neutral-300 tracking-wider">
              象限 IV · 不重要不紧急
            </span>
            <span className="text-[10px] text-gray-500 dark:text-neutral-400 font-medium hidden sm:inline">
              (ELIMINATE · 琐事备忘)
            </span>
          </div>
        </div>
      </div>

      {/* ===================== 十字交叉坐标轴 (Center Axes) ===================== */}
      {/* 纵轴 (Y 轴): 重要程度 (Importance) */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-300 dark:bg-neutral-700 pointer-events-none z-10 -translate-x-1/2">
        {/* 上箭头与标签 */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5">
          <div className="w-0 h-0 border-x-4 border-x-transparent border-b-6 border-b-gray-500 dark:border-b-neutral-400" />
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/95 dark:bg-[#1e1f20]/95 text-rose-700 dark:text-rose-300 border border-gray-200 dark:border-neutral-700 shadow-2xs whitespace-nowrap">
            重要 (Importance: 10)
          </span>
        </div>

        {/* 下箭头与标签 */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/95 dark:bg-[#1e1f20]/95 text-gray-600 dark:text-neutral-400 border border-gray-200 dark:border-neutral-700 shadow-2xs whitespace-nowrap">
            不重要 (Importance: 0)
          </span>
          <div className="w-0 h-0 border-x-4 border-x-transparent border-t-6 border-t-gray-500 dark:border-t-neutral-400" />
        </div>
      </div>

      {/* 横轴 (X 轴): 紧迫程度 (Urgency) */}
      <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-300 dark:bg-neutral-700 pointer-events-none z-10 -translate-y-1/2">
        {/* 左箭头与标签 */}
        <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <div className="w-0 h-0 border-y-4 border-y-transparent border-r-6 border-r-gray-500 dark:border-r-neutral-400" />
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/95 dark:bg-[#1e1f20]/95 text-amber-700 dark:text-amber-300 border border-gray-200 dark:border-neutral-700 shadow-2xs whitespace-nowrap">
            紧急 (Urgency: 10)
          </span>
        </div>

        {/* 右箭头与标签 */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/95 dark:bg-[#1e1f20]/95 text-blue-700 dark:text-blue-300 border border-gray-200 dark:border-neutral-700 shadow-2xs whitespace-nowrap">
            不紧急 (Urgency: 0)
          </span>
          <div className="w-0 h-0 border-y-4 border-y-transparent border-l-6 border-l-gray-500 dark:border-l-neutral-400" />
        </div>
      </div>

      {/* 中心原点 (Intersection Threshold 5.0, 5.0) - Google Blue */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 flex items-center justify-center">
        <div className="h-3 w-3 rounded-full bg-blue-600 dark:bg-blue-500 ring-4 ring-white dark:ring-[#1e1f20] shadow-xs" />
        <span className="absolute -bottom-4 text-[9px] font-mono text-gray-400 dark:text-neutral-500 font-semibold">
          (5, 5)
        </span>
      </div>

      {/* ===================== 坐标系任务落位节点 (Task Coordinate Nodes) ===================== */}
      {tasks.map((task) => {
        const { leftPercent, topPercent, alignX, alignY, urgency, importance } = calculatePosition(task);

        return (
          <div
            key={task.id}
            style={{
              left: `${leftPercent}%`,
              top: `${topPercent}%`,
            }}
            className="task-coordinate-node absolute z-20 group cursor-default -translate-x-1/2 -translate-y-1/2"
          >
            {/* 坐标定位指示圆点 */}
            <div className="relative flex items-center justify-center">
              <div
                className={`w-3 h-3 rounded-full border-2 border-white dark:border-[#1e1f20] shadow-xs transition-transform duration-150 group-hover:scale-125 ${
                  task.isCompleted
                    ? 'bg-gray-400 dark:bg-neutral-500'
                    : importance >= 5
                    ? urgency >= 5
                      ? 'bg-rose-500' // Q1
                      : 'bg-blue-600 dark:bg-blue-500' // Q2
                    : urgency >= 5
                    ? 'bg-amber-500' // Q3
                    : 'bg-gray-400 dark:bg-neutral-500' // Q4
                }`}
              />
            </div>

            {/* 任务微胶囊 (Google Todo 风格 · 智能反向防溢出锚定) */}
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
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs shadow-xs transition-all w-max max-w-[170px] sm:max-w-[210px] ${
                  task.isCompleted
                    ? 'bg-gray-50/95 border-gray-200 text-gray-400 opacity-60 dark:bg-[#1e1f20]/95 dark:border-neutral-800'
                    : 'bg-white/95 border-gray-200/90 text-gray-900 dark:bg-[#28292a]/95 dark:border-neutral-700 dark:text-gray-100 hover:border-blue-500/60 dark:hover:border-blue-400/60 hover:shadow-xs'
                }`}
              >
                {/* Google Todo 圆形复选框 */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleComplete(task.id);
                  }}
                  className={`w-4 h-4 rounded-full border shrink-0 flex items-center justify-center transition-all cursor-pointer ${
                    task.isCompleted
                      ? 'bg-blue-600 dark:bg-blue-500 border-blue-600 dark:border-blue-500 text-white'
                      : 'border-gray-400 dark:border-neutral-500 hover:border-blue-600 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-transparent hover:text-blue-600 dark:hover:text-blue-400'
                  }`}
                  title={task.isCompleted ? '标为未完成' : '标为完成'}
                >
                  <Check className="w-2.5 h-2.5 stroke-[3]" />
                </button>

                {/* 任务标题与分值 */}
                <div className="min-w-0 flex-1 flex items-center gap-1 truncate">
                  <span
                    className={`truncate font-medium text-[11px] leading-tight ${
                      task.isCompleted ? 'line-through text-gray-400 dark:text-neutral-500' : ''
                    }`}
                    title={task.title}
                  >
                    {task.title}
                  </span>
                  <span className="text-[10px] font-mono text-gray-400 dark:text-neutral-500 shrink-0">
                    ({urgency.toFixed(1)}, {importance.toFixed(1)})
                  </span>
                </div>

                {/* 悬浮操作图标 */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(task);
                    }}
                    className="rounded-full p-1 text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-neutral-700 transition cursor-pointer"
                    title="编辑"
                  >
                    <Edit3 className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(task.id);
                    }}
                    className="rounded-full p-1 text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                    title="删除"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* ===================== 空看板引导提示 ===================== */}
      {tasks.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/90 dark:bg-[#28292a]/90 border border-gray-200 dark:border-neutral-700 shadow-xs backdrop-blur-xs text-xs text-gray-600 dark:text-neutral-300">
            <MousePointerClick className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span>点击坐标平面任意位置即可按坐标自动落位添加待办，或按快捷键 <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-neutral-700 text-gray-700 dark:text-neutral-300 font-mono text-[10px]">N</kbd></span>
          </div>
        </div>
      )}
    </div>
  );
};
