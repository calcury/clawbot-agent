import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { db } from '../config/database.js';
import { UserSettings } from '../models/types.js';
import {
  requestLoginQRCode,
  checkLoginQRStatus,
  sendWeixinTextMessage,
  weixinTransitManager,
} from '../services/weixinGateway.js';

export async function getQRCode(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  try {
    const qrData = await requestLoginQRCode(userId);
    res.json({
      success: true,
      qrcode: qrData.qrcode,
      qrcodeUrl: qrData.qrcodeUrl,
    });
  } catch (err: any) {
    res.status(500).json({ error: '获取微信登录二维码失败：' + err.message });
  }
}

export async function getStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings | undefined;

  // If already connected
  if (settings && settings.weixin_connected && settings.weixin_bot_token) {
    res.json({
      connected: true,
      weixinUserId: settings.weixin_user_id || '已连接',
      weixinBotId: settings.weixin_bot_id,
      status: 'confirmed',
    });
    return;
  }

  // Otherwise poll the current active QR session
  try {
    const qrStatus = await checkLoginQRStatus(userId);
    res.json({
      connected: qrStatus.status === 'confirmed',
      status: qrStatus.status,
      weixinUserId: qrStatus.userId,
    });
  } catch (err: any) {
    res.json({
      connected: false,
      status: 'wait',
      error: err.message,
    });
  }
}

export function unbindWeixin(req: AuthenticatedRequest, res: Response): void {
  const userId = req.user!.id;

  // Stop active worker for this user
  weixinTransitManager.stopWorker(userId);

  // Clear DB records
  db.prepare(`
    UPDATE user_settings
    SET
      weixin_connected = 0,
      weixin_bot_token = '',
      weixin_bot_id = '',
      weixin_user_id = '',
      weixin_sync_buf = '',
      updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(userId);

  res.json({ message: '已成功解除微信配对绑定' });
}

export async function sendTestMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings | undefined;

  if (!settings || !settings.weixin_connected || !settings.weixin_bot_token || !settings.weixin_user_id) {
    res.status(400).json({ error: '当前账号尚未绑定微信，请先扫码登录配对' });
    return;
  }

  const result = await sendWeixinTextMessage(
    settings.weixin_base_url || 'https://ilinkai.weixin.qq.com',
    settings.weixin_bot_token,
    settings.weixin_bot_id || '',
    settings.weixin_user_id,
    '🎉 恭喜！您的微信已成功与 Clawbot 智能时间规划助手完成配对连接。\n您现在可以直接在此向我发送日常时间安排或任务需求了～',
    settings.weixin_context_token
  );

  if (result.success) {
    res.json({ message: '测试消息已成功推送至您的微信！请在手机端查收。' });
  } else {
    res.status(500).json({ error: '消息推送失败：' + (result.error || '请稍后重试或重新扫码绑定') });
  }
}
