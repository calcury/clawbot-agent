import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../config/database.js';
import { JWT_SECRET } from '../config/env.js';
import { User } from '../models/types.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

export function register(req: Request, res: Response): void {
  const { username, password } = req.body;

  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: '请提供有效的账号和密码' });
    return;
  }

  if (username.length < 3 || password.length < 6) {
    res.status(400).json({ error: '账号至少 3 位，密码至少 6 位' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    res.status(409).json({ error: '该账号已存在，请更换其他账号' });
    return;
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);
  const tokenSecret = crypto.randomBytes(24).toString('hex');
  const webhookToken = crypto.randomBytes(16).toString('hex');

  const result = db.prepare(`
    INSERT INTO users (username, password_hash, role, status, token_secret)
    VALUES (?, ?, 'user', 'pending', ?)
  `).run(username, passwordHash, tokenSecret);

  const userId = result.lastInsertRowid;

  // Initialize user settings
  db.prepare(`
    INSERT INTO user_settings (user_id, clawbot_webhook_token)
    VALUES (?, ?)
  `).run(userId, webhookToken);

  res.status(201).json({
    message: '注册成功，请等待管理员审核放行后方可登录！',
    status: 'pending',
  });
}

export function login(req: Request, res: Response): void {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: '请输入账号和密码' });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
  if (!user || !user.password_hash) {
    res.status(401).json({ error: '账号或密码错误' });
    return;
  }

  const match = bcrypt.compareSync(password, user.password_hash);
  if (!match) {
    res.status(401).json({ error: '账号或密码错误' });
    return;
  }

  if (user.status === 'pending') {
    res.status(403).json({ error: '账号正在审核中，请联系管理员审核放行后再登录' });
    return;
  }

  if (user.status === 'rejected') {
    res.status(403).json({ error: '账号已被管理员拒绝访问，如有疑问请联系管理员' });
    return;
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.json({
    message: '登录成功',
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      status: user.status,
      token_secret: user.token_secret,
    },
  });
}

export function getMe(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: '未登录' });
    return;
  }

  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      status: req.user.status,
      token_secret: req.user.token_secret,
      created_at: req.user.created_at,
    },
  });
}
