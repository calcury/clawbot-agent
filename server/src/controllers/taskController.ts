import { Response } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { Task } from '../models/types.js';
import { scheduleTask } from '../services/scheduler.js';

export function listTasks(req: AuthenticatedRequest, res: Response): void {
  const userId = req.user!.id;
  const { status, search } = req.query;

  let query = 'SELECT * FROM tasks WHERE user_id = ?';
  const params: any[] = [userId];

  if (status && typeof status === 'string' && status !== 'all') {
    query += ' AND status = ?';
    params.push(status);
  }

  if (search && typeof search === 'string') {
    query += ' AND title LIKE ?';
    params.push(`%${search}%`);
  }

  query += " ORDER BY CASE status WHEN 'in_progress' THEN 1 WHEN 'scheduled' THEN 2 WHEN 'pending_slot' THEN 3 ELSE 4 END, scheduled_start ASC, created_at DESC";

  const tasks = db.prepare(query).all(...params) as Task[];
  res.json({ tasks });
}

export function createTask(req: AuthenticatedRequest, res: Response): void {
  const userId = req.user!.id;
  const {
    title,
    duration_minutes = 60,
    urgency = 3,
    importance = 3,
    deadline,
    auto_schedule = true,
    notes,
  } = req.body;

  if (!title) {
    res.status(400).json({ error: '请输入任务标题' });
    return;
  }

  let scheduledStart: string | null = null;
  let scheduledEnd: string | null = null;
  let status = 'pending_slot';
  let scheduleMsg = '';

  if (auto_schedule) {
    const plan = scheduleTask(userId, {
      title,
      duration_minutes: Number(duration_minutes),
      urgency: Number(urgency),
      importance: Number(importance),
      deadline: deadline || null,
    });

    if (plan.success && plan.scheduled_start && plan.scheduled_end) {
      scheduledStart = plan.scheduled_start;
      scheduledEnd = plan.scheduled_end;
      status = 'scheduled';
      scheduleMsg = '任务已成功自动排程！';
    } else {
      scheduleMsg = plan.message || '未找到合适时间槽，待手动调整。';
    }
  }

  const result = db.prepare(`
    INSERT INTO tasks (
      user_id, title, duration_minutes, urgency, importance,
      deadline, scheduled_start, scheduled_end, status, notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    title,
    Number(duration_minutes),
    Number(urgency),
    Number(importance),
    deadline || null,
    scheduledStart,
    scheduledEnd,
    status,
    notes || null
  );

  const newTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);

  res.status(201).json({
    message: scheduleMsg || '任务已创建',
    task: newTask,
  });
}

export function updateTask(req: AuthenticatedRequest, res: Response): void {
  const userId = req.user!.id;
  const { id } = req.params;
  const {
    title,
    duration_minutes,
    urgency,
    importance,
    deadline,
    scheduled_start,
    scheduled_end,
    status,
    notes,
  } = req.body;

  const existing = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, userId);
  if (!existing) {
    res.status(404).json({ error: '任务不存在' });
    return;
  }

  db.prepare(`
    UPDATE tasks
    SET
      title = COALESCE(?, title),
      duration_minutes = COALESCE(?, duration_minutes),
      urgency = COALESCE(?, urgency),
      importance = COALESCE(?, importance),
      deadline = ?,
      scheduled_start = ?,
      scheduled_end = ?,
      status = COALESCE(?, status),
      notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(
    title,
    duration_minutes,
    urgency,
    importance,
    deadline !== undefined ? deadline : (existing as any).deadline,
    scheduled_start !== undefined ? scheduled_start : (existing as any).scheduled_start,
    scheduled_end !== undefined ? scheduled_end : (existing as any).scheduled_end,
    status,
    notes !== undefined ? notes : (existing as any).notes,
    id,
    userId
  );

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  res.json({ message: '任务更新成功', task: updated });
}

export function deleteTask(req: AuthenticatedRequest, res: Response): void {
  const userId = req.user!.id;
  const { id } = req.params;

  db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(id, userId);
  res.json({ message: '任务已删除' });
}

export function rescheduleTask(req: AuthenticatedRequest, res: Response): void {
  const userId = req.user!.id;
  const { id } = req.params;

  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, userId) as Task | undefined;
  if (!task) {
    res.status(404).json({ error: '任务不存在' });
    return;
  }

  const plan = scheduleTask(userId, {
    id: task.id,
    title: task.title,
    duration_minutes: task.duration_minutes,
    urgency: task.urgency,
    importance: task.importance,
    deadline: task.deadline,
  });

  if (!plan.success || !plan.scheduled_start || !plan.scheduled_end) {
    res.status(400).json({ error: plan.message || '重排未找到合适的时间槽' });
    return;
  }

  db.prepare(`
    UPDATE tasks
    SET
      scheduled_start = ?,
      scheduled_end = ?,
      status = 'scheduled',
      start_reminder_sent = 0,
      end_reminder_sent = 0,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(plan.scheduled_start, plan.scheduled_end, id);

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  res.json({ message: '任务已重新规划到最新合适时间槽！', task: updated });
}

export function quickActionTask(req: AuthenticatedRequest, res: Response): void {
  const userId = req.user!.id;
  const { id } = req.params;
  const { action, extend_minutes = 30 } = req.body;

  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, userId) as Task | undefined;
  if (!task) {
    res.status(404).json({ error: '任务不存在' });
    return;
  }

  if (action === 'complete') {
    db.prepare(`
      UPDATE tasks
      SET status = 'completed', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);
    res.json({ message: `任务「${task.title}」已标记完成！` });
    return;
  }

  if (action === 'extend') {
    if (!task.scheduled_end) {
      res.status(400).json({ error: '该任务未安排时间，无法延长' });
      return;
    }
    const currentEnd = new Date(task.scheduled_end);
    const newEnd = new Date(currentEnd.getTime() + Number(extend_minutes) * 60 * 1000);
    const newDuration = task.duration_minutes + Number(extend_minutes);

    db.prepare(`
      UPDATE tasks
      SET
        scheduled_end = ?,
        duration_minutes = ?,
        end_reminder_sent = 0,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newEnd.toISOString(), newDuration, id);

    res.json({ message: `任务「${task.title}」已延长 ${extend_minutes} 分钟` });
    return;
  }

  res.status(400).json({ error: '未知动作' });
}
