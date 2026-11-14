import React, { useRef } from 'react';
import { formatLocalDate } from '../types/task';
import type { TaskItem } from '../types/task';
import { 
  Check, 
  Trash2, 
  Edit3, 
  Calendar, 
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
  const todayStr = formatLocalDate(new Date());

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

  // 根据任务评分计算其在坐标系平面中的百分比位置
  const calculatePosition = (task: TaskItem) => {
    const urgency = typeof task.urgency === 'number' ? task.urgency : (task.isUrgent ? 8 : 2);
    const importance = typeof task.importance === 'number' ? task.importance : (task.isImportant ? 8 : 2);

    // X 轴：左侧为 10，右侧为 0 (留出 6% ~ 94% 边缘缓冲，避免卡片溢出可视区)
    const uPct = (10 - urgency) / 10;
    const leftPercent = 6 + uPct * 88;

    // Y 轴：上方为 10，下方为 0
    const iPct = (10 - importance) / 10;
    const topPercent = 6 + iPct * 88;

    return { leftPercent, topPercent, urgency, importance };
  };

  return (
    <div
      ref={containerRef}
      onClick={handlePlaneClick}
      className="relative w-full h-full rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs overflow-hidden cursor-crosshair select-none"
    >
      {/* ===================== 四象限背景网格与轻量底色 ===================== */}
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 pointer-events-none">
        {/* 象限 I (左上): 重要且紧急 */}
        <div className="relative border-r border-b border-dashed border-slate-200 dark:border-slate-800/80 bg-rose-50/20 dark:bg-rose-950/5 p-4 flex flex-col justify-start">
          <div className="flex items-center gap-1.5 opacity-60">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            <span className="text-xs font-bold text-rose-800 dark:text-rose-300 tracking-wider">
              象限 I · 重要且紧急
            </span>
            <span className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">
              (DO FIRST · 立即做)
            </span>
          </div>
        </div>

        {/* 象限 II (右上): 重要不紧急 */}
        <div className="relative border-b border-dashed border-slate-200 dark:border-slate-800/80 bg-blue-50/20 dark:bg-blue-950/5 p-4 flex flex-col justify-start items-end">
          <div className="flex items-center gap-1.5 opacity-60">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span className="text-xs font-bold text-blue-800 dark:text-blue-300 tracking-wider">
              象限 II · 重要不紧急
            </span>
            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
              (SCHEDULE · 计划专注)
            </span>
          </div>
        </div>

        {/* 象限 III (左下): 紧急不重要 */}
        <div className="relative border-r border-dashed border-slate-200 dark:border-slate-800/80 bg-amber-50/20 dark:bg-amber-950/5 p-4 flex flex-col justify-end">
          <div className="flex items-center gap-1.5 opacity-60">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-xs font-bold text-amber-800 dark:text-amber-300 tracking-wider">
              象限 III · 紧急不重要
            </span>
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
              (DELEGATE · 授权做)
            </span>
          </div>
        </div>

        {/* 象限 IV (右下): 不重要不紧急 */}
        <div className="relative bg-slate-50/20 dark:bg-slate-900/10 p-4 flex flex-col justify-end items-end">
          <div className="flex items-center gap-1.5 opacity-60">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 tracking-wider">
              象限 IV · 不重要不紧急
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
              (ELIMINATE · 尽量不做)
            </span>
          </div>
        </div>
      </div>

      {/* ===================== 十字交叉坐标轴 (Center Axes) ===================== */}
      {/* 纵轴 (Y 轴): 重要程度 (Importance) */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-300 dark:bg-slate-700 pointer-events-none z-10 -translate-x-1/2">
        {/* 上箭头与标签 */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5">
          <div className="w-0 h-0 border-x-4 border-x-transparent border-b-6 border-b-slate-500 dark:border-b-slate-400" />
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/90 dark:bg-slate-800/90 text-rose-700 dark:text-rose-300 border border-slate-200 dark:border-slate-700 shadow-2xs whitespace-nowrap">
            重要 (Importance: 10)
          </span>
        </div>

        {/* 下箭头与标签 */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/90 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-2xs whitespace-nowrap">
            不重要 (Importance: 0)
          </span>
          <div className="w-0 h-0 border-x-4 border-x-transparent border-t-6 border-t-slate-500 dark:border-t-slate-400" />
        </div>
      </div>

      {/* 横轴 (X 轴): 紧迫程度 (Urgency) */}
      <div className="absolute top-1/2 left-0 right-0 h-px bg-slate-300 dark:bg-slate-700 pointer-events-none z-10 -translate-y-1/2">
        {/* 左箭头与标签 */}
        <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <div className="w-0 h-0 border-y-4 border-y-transparent border-r-6 border-r-slate-500 dark:border-r-slate-400" />
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/90 dark:bg-slate-800/90 text-amber-700 dark:text-amber-300 border border-slate-200 dark:border-slate-700 shadow-2xs whitespace-nowrap">
            紧急 (Urgency: 10)
          </span>
        </div>

        {/* 右箭头与标签 */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/90 dark:bg-slate-800/90 text-blue-700 dark:text-blue-300 border border-slate-200 dark:border-slate-700 shadow-2xs whitespace-nowrap">
            不紧急 (Urgency: 0)
          </span>
          <div className="w-0 h-0 border-y-4 border-y-transparent border-l-6 border-l-slate-500 dark:border-l-slate-400" />
        </div>
      </div>

      {/* 中心原点 (Intersection Threshold 5.0, 5.0) */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 flex items-center justify-center">
        <div className="h-3 w-3 rounded-full bg-indigo-600 ring-4 ring-white dark:ring-slate-900 shadow-xs" />
        <span className="absolute -bottom-4 text-[9px] font-mono text-slate-400 dark:text-slate-500 font-semibold">
          (5, 5)
        </span>
      </div>

      {/* ===================== 坐标系任务落位节点 (Task Coordinate Nodes) ===================== */}
      {tasks.map((task) => {
        const { leftPercent, topPercent, urgency, importance } = calculatePosition(task);

        return (
          <div
            key={task.id}
            style={{
              left: `${leftPercent}%`,
              top: `${topPercent}%`,
              transform: 'translate(-50%, -50%)',
            }}
            className="task-coordinate-node absolute z-20 group transition-all duration-300 hover:z-30 cursor-default"
          >
            {/* 坐标定位指示圆点 */}
            <div className="relative flex items-center justify-center">
              <div
                className={`h-3 w-3 rounded-full border-2 border-white dark:border-slate-900 shadow-sm transition-all duration-150 group-hover:scale-125 ${
                  task.isCompleted
                    ? 'bg-slate-400'
                    : importance >= 5
                    ? urgency >= 5
                      ? 'bg-rose-500' // Q1
                      : 'bg-blue-500' // Q2
                    : urgency >= 5
                    ? 'bg-amber-500' // Q3
                    : 'bg-slate-400' // Q4
                }`}
              />
            </div>

            {/* 任务微卡片胶囊 */}
            <div
              className={`mt-1.5 flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs shadow-md transition-all duration-200 group-hover:scale-105 group-hover:shadow-lg max-w-[200px] sm:max-w-[240px] ${
                task.isCompleted
                  ? 'bg-slate-50/90 border-slate-200 text-slate-400 opacity-60 dark:bg-slate-900/90 dark:border-slate-800'
                  : 'bg-white/95 border-slate-200 text-slate-800 dark:bg-slate-900/95 dark:border-slate-700 dark:text-slate-100'
              }`}
            >
              {/* 完成状态勾选按钮 */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleComplete(task.id);
                }}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  task.isCompleted
                    ? 'bg-emerald-500 border-emerald-500 text-white'
                    : 'border-slate-300 hover:border-indigo-500 dark:border-slate-600'
                }`}
                title={task.isCompleted ? '标为未完成' : '标为完成'}
              >
                {task.isCompleted && <Check className="h-3 w-3 stroke-[2.5]" />}
              </button>

              {/* 任务标题与分值 */}
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate font-medium text-xs leading-tight ${
                    task.isCompleted ? 'line-through text-slate-400' : ''
                  }`}
                  title={task.title}
                >
                  {task.title}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                  <span className="font-mono font-semibold">
                    ({urgency.toFixed(1)}, {importance.toFixed(1)})
                  </span>
                  {task.dueDate && (
                    <span
                      className={`inline-flex items-center gap-0.5 truncate max-w-[120px] ${
                        task.algorithmStatusText ? 'text-indigo-600 dark:text-indigo-400 font-medium' : ''
                      }`}
                      title={task.algorithmStatusText ? `算法实时测算：${task.algorithmStatusText}` : `截止日: ${task.dueDate}`}
                    >
                      <Calendar className="h-2.5 w-2.5 shrink-0" />
                      <span>{task.algorithmStatusText || task.dueDate.slice(5)}</span>
                    </span>
                  )}
                  {!task.isCompleted && task.completedDates?.includes(todayStr) && (
                    <span className="px-1 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 font-semibold shrink-0">
                      今日完成
                    </span>
                  )}
                </div>
              </div>

              {/* 悬浮操作菜单 */}
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(task);
                  }}
                  className="rounded p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
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
                  className="rounded p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                  title="删除"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* ===================== 空看板引导提示 ===================== */}
      {tasks.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
          <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-white/80 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 shadow-xs backdrop-blur-xs text-xs text-slate-500 dark:text-slate-400 animate-in fade-in zoom-in-95 duration-200">
            <MousePointerClick className="h-4 w-4 text-indigo-500" />
            <span>点击坐标平面任意位置即可根据坐标落位添加事项，或按键盘 <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-mono text-[10px]">N</kbd> 键新建</span>
          </div>
        </div>
      )}
    </div>
  );
};
