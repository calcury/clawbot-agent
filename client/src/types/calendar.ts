import type { QuadrantId } from './task';

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  isAllDay: boolean;
}

export type EnergyZoneType = 'peak' | 'moderate' | 'low' | 'fragment';

export interface TimeSlot {
  start: Date;
  end: Date;
  durationMinutes: number;
  energyZone?: EnergyZoneType;
}

export interface ScheduledTaskBlock {
  id: string;
  taskId: string;
  title: string;
  start: Date;
  end: Date;
  durationMinutes: number;
  partIndex?: number;
  totalParts?: number;
  isSplit: boolean;
  quadrant: QuadrantId;
  importance: number;
  urgency: number;
  isCompleted: boolean;       // 当天排程目标是否已完成
  isFinalCompleted?: boolean; // 任务整体是否已彻底完成
  isLastDay?: boolean;        // 当天是否为该任务的最后一天
  energyZone?: EnergyZoneType;
  strategyLabel?: string;
  breakAfterMinutes?: number; // 该专注小节后预留的微休息时长（分钟）
}

export interface RestBlock {
  id: string;
  type: 'lunch' | 'dinner' | 'break';
  title: string;
  start: Date;
  end: Date;
  durationMinutes: number;
}

export interface DayScheduleResult {
  dateStr: string; // YYYY-MM-DD
  fixedEvents: CalendarEvent[];
  scheduledTasks: ScheduledTaskBlock[];
  restBlocks: RestBlock[];
  freeSlots: TimeSlot[];
  unscheduledTasks: {
    taskId: string;
    title: string;
    remainingMinutes: number;
    reason: string;
  }[];
  stats: {
    totalBusyMinutes: number;
    totalScheduledMinutes: number;
    totalRestMinutes: number;
    totalFreeMinutes: number;
  };
}
