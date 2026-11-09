import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/env.js';
import { db } from '../config/database.js';
import { User } from '../models/types.js';

export interface AuthenticatedRequest extends Request {
  user?: User;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: '未提供身份凭证，请登录' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { id: number; username: string };
    const user = db.prepare('SELECT id, username, role, status, token_secret, created_at, updated_at FROM users WHERE id = ?').get(payload.id) as User | undefined;

    if (!user) {
      res.status(401).json({ error: '用户不存在' });
      return;
    }

    if (user.status !== 'approved') {
      res.status(403).json({ error: '账号状态异常或等待管理员审核通过' });
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: '登录状态已失效，请重新登录' });
    return;
  }
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: '权限不足，仅管理员可访问' });
      return;
    }
    next();
  });
}
