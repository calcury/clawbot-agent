import { Router } from 'express';
import { register, login, getMe } from '../controllers/authController.js';
import { listUsers, approveUser, rejectUser, setUserRole, deleteUser } from '../controllers/adminController.js';
import { getSettings, updateSettings, regenerateWebhookToken } from '../controllers/settingsController.js';
import { listTasks, createTask, updateTask, deleteTask, rescheduleTask, quickActionTask } from '../controllers/taskController.js';
import {
  listSubscriptions,
  createSubscription,
  deleteSubscription,
  syncSubscriptionNow,
  getCalendarEvents,
  exportDedicatedIcal,
} from '../controllers/calendarController.js';
import { handleClawbotWebhook } from '../controllers/webhookController.js';
import { getQRCode, getStatus, unbindWeixin, sendTestMessage } from '../controllers/weixinController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

export const router = Router();

// ================= Public Routes =================
router.post('/auth/register', register);
router.post('/auth/login', login);
router.get('/calendar/subscribe/:token.ics', exportDedicatedIcal);
router.post('/webhook/clawbot/:token', handleClawbotWebhook);

// ================= Protected Routes =================
router.get('/auth/me', requireAuth, getMe);

// User Settings
router.get('/settings', requireAuth, getSettings);
router.put('/settings', requireAuth, updateSettings);
router.post('/settings/regenerate-token', requireAuth, regenerateWebhookToken);

// WeChat Clawbot iLink Gateway & QR Code Scan
router.get('/weixin/qrcode', requireAuth, getQRCode);
router.get('/weixin/status', requireAuth, getStatus);
router.post('/weixin/unbind', requireAuth, unbindWeixin);
router.post('/weixin/test-message', requireAuth, sendTestMessage);

// Task / TODO Management
router.get('/tasks', requireAuth, listTasks);
router.post('/tasks', requireAuth, createTask);
router.put('/tasks/:id', requireAuth, updateTask);
router.delete('/tasks/:id', requireAuth, deleteTask);
router.post('/tasks/:id/reschedule', requireAuth, rescheduleTask);
router.post('/tasks/:id/action', requireAuth, quickActionTask);

// Calendar Management
router.get('/calendar/subscriptions', requireAuth, listSubscriptions);
router.post('/calendar/subscriptions', requireAuth, createSubscription);
router.delete('/calendar/subscriptions/:id', requireAuth, deleteSubscription);
router.post('/calendar/subscriptions/:id/sync', requireAuth, syncSubscriptionNow);
router.get('/calendar/events', requireAuth, getCalendarEvents);

// ================= Admin Routes =================
router.get('/admin/users', requireAdmin, listUsers);
router.put('/admin/users/:id/approve', requireAdmin, approveUser);
router.put('/admin/users/:id/reject', requireAdmin, rejectUser);
router.put('/admin/users/:id/role', requireAdmin, setUserRole);
router.delete('/admin/users/:id', requireAdmin, deleteUser);
