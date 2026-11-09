import { Response } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

export function listUsers(req: AuthenticatedRequest, res: Response): void {
  const users = db.prepare(`
    SELECT
      u.id,
      u.username,
      u.role,
      u.status,
      u.created_at,
      u.updated_at,
      (SELECT count(*) FROM tasks WHERE user_id = u.id) as task_count,
      (SELECT count(*) FROM calendar_subscriptions WHERE user_id = u.id) as subscription_count
    FROM users u
    ORDER BY u.created_at DESC
  `).all();

  res.json({ users });
}

export function approveUser(req: AuthenticatedRequest, res: Response): void {
  const { id } = req.params;

  const target = db.prepare('SELECT id, username, status FROM users WHERE id = ?').get(id) as any;
  if (!target) {
    res.status(404).json({ error: '用户不存在' });
    return;
  }

  db.prepare(`
    UPDATE users
    SET status = 'approved', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);

  res.json({ message: `用户「${target.username}」已成功审核放行！` });
}

export function rejectUser(req: AuthenticatedRequest, res: Response): void {
  const { id } = req.params;

  const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id) as any;
  if (!target) {
    res.status(404).json({ error: '用户不存在' });
    return;
  }

  if (target.id === req.user?.id) {
    res.status(400).json({ error: '不能拒绝自己的账号' });
    return;
  }

  db.prepare(`
    UPDATE users
    SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);

  res.json({ message: `已拒绝用户「${target.username}」的访问权限。` });
}

export function setUserRole(req: AuthenticatedRequest, res: Response): void {
  const { id } = req.params;
  const { role } = req.body;

  if (role !== 'admin' && role !== 'user') {
    res.status(400).json({ error: '无效角色' });
    return;
  }

  if (Number(id) === req.user?.id && role !== 'admin') {
    res.status(400).json({ error: '不能取消自己的管理员身份' });
    return;
  }

  db.prepare(`
    UPDATE users
    SET role = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(role, id);

  res.json({ message: '用户角色已更新' });
}

export function deleteUser(req: AuthenticatedRequest, res: Response): void {
  const { id } = req.params;

  if (Number(id) === req.user?.id) {
    res.status(400).json({ error: '不能删除自己的账号' });
    return;
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ message: '用户已删除' });
}
