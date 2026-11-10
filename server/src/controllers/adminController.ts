import { Response } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { getRecentLogs, clearLogs, addDebugLog } from '../services/debugLogger.js';
import {
  processWeChatMessage,
  sendWeixinTextMessage,
  weixinTransitManager,
} from '../services/weixinGateway.js';
import { UserSettings } from '../models/types.js';

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

  addDebugLog('Auth', 'info', `管理员审核放行了用户「${target.username}」`);
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

  addDebugLog('Auth', 'warn', `管理员拒绝了用户「${target.username}」的权限`);
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

// ================= Debugger Endpoints =================

/**
 * 1. Get recent system debug logs
 */
export function getDebugLogs(req: AuthenticatedRequest, res: Response): void {
  const limit = Math.min(500, Number(req.query.limit) || 200);
  const level = String(req.query.level || 'all');
  const module = String(req.query.module || 'all');

  const logs = getRecentLogs(limit, level, module);
  res.json({ logs });
}

/**
 * 2. Clear debug logs
 */
export function clearDebugLogs(req: AuthenticatedRequest, res: Response): void {
  clearLogs();
  res.json({ message: '日志已清空' });
}

/**
 * 3. Simulate inbound WeChat message for a given user
 */
export async function debugSimulateInbound(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { userId, content } = req.body;
  if (!userId || !content || !String(content).trim()) {
    res.status(400).json({ error: '缺少 userId 或 content' });
    return;
  }

  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as any;
  if (!user) {
    res.status(404).json({ error: '用户不存在' });
    return;
  }

  const startTime = Date.now();
  addDebugLog('Weixin', 'info', `[调试器模拟] 模拟用户 #${userId} (${user.username}) 发送消息: "${content}"`);

  try {
    const result = await processWeChatMessage(Number(userId), String(content).trim(), `debug_sim_user_${userId}`);
    const elapsedMs = Date.now() - startTime;

    addDebugLog('Weixin', 'success', `[调试器模拟] 模拟消息处理完成，耗时 ${elapsedMs}ms`, {
      replyPreview: result.replyText.slice(0, 80),
    });

    res.json({
      success: true,
      user: { id: user.id, username: user.username },
      inputContent: content,
      replyText: result.replyText,
      diagnostics: result.diagnostics,
      elapsedMs,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
      stack: err.stack,
    });
  }
}

/**
 * 4. Test outbound message sending to real WeChat user
 */
export async function debugTestSendWeChat(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { userId, message } = req.body;
  if (!userId || !message) {
    res.status(400).json({ error: '缺少 userId 或 message' });
    return;
  }

  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings | undefined;
  if (!settings || !settings.weixin_connected || !settings.weixin_bot_token || !settings.weixin_user_id) {
    res.status(400).json({ error: '该用户尚未成功连接微信，无法下发真实微信消息' });
    return;
  }

  const baseUrl = settings.weixin_base_url || 'https://ilinkai.weixin.qq.com';
  const result = await sendWeixinTextMessage(
    baseUrl,
    settings.weixin_bot_token,
    settings.weixin_bot_id || '',
    settings.weixin_user_id,
    String(message),
    settings.weixin_context_token
  );

  res.json({
    success: result.success,
    result,
    toUserId: settings.weixin_user_id,
    botId: settings.weixin_bot_id,
    hasContextToken: Boolean(settings.weixin_context_token),
  });
}

/**
 * 5. Get status of all WeChat transit workers
 */
export function getWorkersStatus(req: AuthenticatedRequest, res: Response): void {
  const workers = weixinTransitManager.getWorkerStatusList();
  res.json({ workers });
}

/**
 * 6. Restart a worker for a user
 */
export function restartUserWorker(req: AuthenticatedRequest, res: Response): void {
  const { userId } = req.params;
  weixinTransitManager.startWorker(Number(userId));
  res.json({ message: `已重新启动用户 #${userId} 的微信轮询管道` });
}

/**
 * 7. Reset sync_buf for a user
 */
export function resetUserSyncBuf(req: AuthenticatedRequest, res: Response): void {
  const { userId } = req.params;
  weixinTransitManager.resetSyncBuf(Number(userId));
  res.json({ message: `已重置用户 #${userId} 的 sync_buf 并重启 Worker` });
}
