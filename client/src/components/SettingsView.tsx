import { copyText } from '../utils/clipboard';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { QRCodeSVG } from 'qrcode.react';
import { CostCurveChart } from './CostCurveChart';
import {
  User,
  Sliders,
  Palette,
  Bot,
  Brain,
  Calendar,
  Clock,
  Copy,
  Check,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  QrCode,
  Send,
  LogOut,
  Trash2,
  Bell,
  Sparkles,
  Coins,
  Menu,
  Lock,
  Mail,
  Upload,
  Sun,
  Moon,
  Monitor,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  Languages,
  Keyboard,
  KeyRound,
  ShieldAlert,
  Gift,
  Zap,
  DollarSign,
  Settings,
  CalendarCheck2,
  BellOff,
  X,
} from 'lucide-react';

interface WorkSlot {
  start: string;
  end: string;
}

interface VisualSlot {
  startMin: number;
  endMin: number;
  label: string;
}

interface CalendarSub {
  id: number;
  name: string;
  url: string;
  color?: string | null;
  last_sync_at: string | null;
  sync_status: 'ok' | 'error';
  error_message: string | null;
  event_count: number;
}

function parseWorkSlotsString(input: string): {
  slots: WorkSlot[];
  visualSlots: VisualSlot[];
  totalMinutes: number;
  error: string | null;
} {
  const trimmed = input.trim();
  if (!trimmed) {
    return { slots: [], visualSlots: [], totalMinutes: 0, error: 'settings.enter_work_slots' };
  }

  // Support English comma, Chinese comma, semicolons, and newlines
  const parts = trimmed.split(/[,，;\n\r]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { slots: [], visualSlots: [], totalMinutes: 0, error: 'settings.enter_work_slots' };
  }

  const slots: WorkSlot[] = [];
  const rawVisual: VisualSlot[] = [];

  for (const part of parts) {
    const match = part.match(/^(\d{1,2}):(\d{2})\s*[-~至到]\s*(\d{1,2}):(\d{2})$/);
    if (!match) {
      return {
        slots: [],
        visualSlots: [],
        totalMinutes: 0,
        error: `settings.slot_format_error|${part}`,
      };
    }

    const sh = parseInt(match[1], 10);
    const sm = parseInt(match[2], 10);
    const eh = parseInt(match[3], 10);
    const em = parseInt(match[4], 10);

    if (sh < 0 || sh > 24 || sm < 0 || sm > 59) {
      return { slots: [], visualSlots: [], totalMinutes: 0, error: `settings.slot_start_invalid|${part}` };
    }
    if (eh < 0 || eh > 24 || em < 0 || em > 59) {
      return { slots: [], visualSlots: [], totalMinutes: 0, error: `settings.slot_end_invalid|${part}` };
    }

    const startFormatted = `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
    const endFormatted = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
    slots.push({ start: startFormatted, end: endFormatted });

    const sMin = sh * 60 + sm;
    const eMin = eh * 60 + em;

    if (eMin <= sMin) {
      // Overnight slot, e.g. 23:00 to 02:00
      rawVisual.push({
        startMin: sMin,
        endMin: 1440,
        label: `${startFormatted}-24:00`,
      });
      if (eMin > 0) {
        rawVisual.push({
          startMin: 0,
          endMin: eMin,
          label: `00:00-${endFormatted}`,
        });
      }
    } else {
      rawVisual.push({
        startMin: sMin,
        endMin: Math.min(1440, eMin),
        label: `${startFormatted}-${endFormatted}`,
      });
    }
  }

  // Merge overlapping segments for the progress bar display and total hours calculation
  const sorted = [...rawVisual].sort((a, b) => a.startMin - b.startMin);
  const merged: VisualSlot[] = [];
  for (const cur of sorted) {
    if (merged.length === 0) {
      merged.push({ ...cur });
    } else {
      const prev = merged[merged.length - 1];
      if (cur.startMin <= prev.endMin) {
        if (cur.endMin > prev.endMin) {
          prev.endMin = cur.endMin;
          const h1 = Math.floor(prev.startMin / 60);
          const m1 = prev.startMin % 60;
          const h2 = Math.floor(prev.endMin / 60);
          const m2 = prev.endMin % 60;
          prev.label = `${String(h1).padStart(2, '0')}:${String(m1).padStart(2, '0')}-${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}`;
        }
      } else {
        merged.push({ ...cur });
      }
    }
  }

  const totalMinutes = merged.reduce((sum, s) => sum + (s.endMin - s.startMin), 0);

  return {
    slots,
    visualSlots: merged,
    totalMinutes,
    error: null,
  };
}

export type SectionType =
  | 'account'
  | 'general'
  | 'appearance'
  | 'weixin'
  | 'scheduler'
  | 'notification'
  | 'llm'
  | 'calendar';

interface SettingsViewProps {
  onOpenMobileMenu?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onOpenMobileMenu }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionType>('account');

  const { user, updateUser, logout } = useAuth();
  const {
    themeMode,
    setThemeMode,
    isDark,
    themeColor,
    setThemeColor,
    displayDensity,
    setDisplayDensity,
    language,
    setLanguage,
    defaultTaskDuration,
    setDefaultTaskDuration,
    soundEnabled,
    setSoundEnabled,
    t,
  } = useTheme();

  // 个人账户管理状态
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  // 修改密码状态
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  // 注销账号状态
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingSubPolicy, setEditingSubPolicy] = useState<{
    sub: CalendarSub;
    color: string;
    allowScheduling: boolean;
    aiReminderEnabled: boolean;
  } | null>(null);
  const [savingSubPolicy, setSavingSubPolicy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 监听并同步 user.nickname
  useEffect(() => {
    if (user?.nickname !== undefined) {
      setNickname(user.nickname || '');
    }
  }, [user?.nickname]);

  // Weixin Clawbot Integration State
  const [wxConnected, setWxConnected] = useState(false);
  const [wxUserId, setWxUserId] = useState('');
  const [wxNickname, setWxNickname] = useState('');
  const [advanceDeadlineDays, setAdvanceDeadlineDays] = useState(1);
  const [scheduleLockMode, setScheduleLockMode] = useState<'none' | 'hours' | 'today' | 'this_week'>('none');
  const [scheduleLockHours, setScheduleLockHours] = useState<number>(4);
  const [, setQrCode] = useState('');
  const [qrCodeImgContent, setQrCodeImgContent] = useState('');
  const [qrStatus, setQrStatus] = useState<'idle' | 'loading' | 'wait' | 'scaned' | 'confirmed' | 'expired'>('idle');
  const [qrStatusMsg, setQrStatusMsg] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // LLM fields
  const [apiMode, setApiMode] = useState<'official' | 'custom'>('official');
  const [userBalance, setUserBalance] = useState<number>(0);
  const [hasGlobalLlm, setHasGlobalLlm] = useState<boolean>(true);
  const [redeemCodeInput, setRedeemCodeInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemResult, setRedeemResult] = useState<{ success: boolean; msg: string } | null>(null);

  const [llmEndpoint, setLlmEndpoint] = useState('https://api.deepseek.com/v1');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmModel, setLlmModel] = useState('deepseek-chat');

  // Preferences: Manual Work Slots
  const [workSlotsText, setWorkSlotsText] = useState('00:00-02:00, 13:00-18:00');
  const parsedSlotsInfo = useMemo(() => {
    return parseWorkSlotsString(workSlotsText);
  }, [workSlotsText]);

  const [taskBuffer, setTaskBuffer] = useState<number>(15);
  const [remindStart, setRemindStart] = useState<number>(10);
  const [calSyncInterval, setCalSyncInterval] = useState<number>(30);

  // Calendar feeds
  const [subs, setSubs] = useState<CalendarSub[]>([]);
  const [newSubName, setNewSubName] = useState('');
  const [newSubUrl, setNewSubUrl] = useState('');
  const [addingSub, setAddingSub] = useState(false);

  // iCal export urls
  const [icalExportUrl, setIcalExportUrl] = useState('');
  const [copiedIcal, setCopiedIcal] = useState(false);
  const [copiedWebcal, setCopiedWebcal] = useState(false);
  const webcalInputRef = useRef<HTMLInputElement>(null);
  const [copyIcalError, setCopyIcalError] = useState('');
  const icalInputRef = useRef<HTMLInputElement>(null);

  const userId = user?.id ? String(user.id) : 'default';

  // LLM testing state
  const [llmTesting, setLlmTesting] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<{ success: boolean; msg: string } | null>(null);
  const [llmApiKeyValid, setLlmApiKeyValid] = useState<boolean>(() => {
    return localStorage.getItem(`clawbot_llm_valid_${userId}`) === 'true';
  });

  const handleTestLlmKey = async () => {
    if (!llmApiKey.trim()) {
      alert(t('settings.deepseek_key_prompt', '请先输入 DeepSeek API Key'));
      return;
    }
    setLlmTesting(true);
    setLlmTestResult(null);
    try {
      const res = await api.post('/settings/test-llm', {
        llm_endpoint: llmEndpoint,
        llm_api_key: llmApiKey,
        llm_model: llmModel,
      });
      setLlmTestResult({ success: true, msg: res.data.message || t('settings.deepseek_key_valid', 'API Key 验证有效！') });
      setLlmApiKeyValid(true);
      localStorage.setItem(`clawbot_llm_valid_${userId}`, 'true');
      fetchLlmUsage();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      const msg = error.response?.data?.error || error.message || t('settings.deepseek_key_invalid', '验证失败，请检查 API Key');
      setLlmTestResult({ success: false, msg });
      setLlmApiKeyValid(false);
      localStorage.removeItem(`clawbot_llm_valid_${userId}`);
    } finally {
      setLlmTesting(false);
    }
  };

  const handleRedeemCode = async () => {
    if (!redeemCodeInput.trim()) {
      alert(t('settings.redeem_code_prompt', '请输入有效的兑换码'));
      return;
    }
    setRedeeming(true);
    setRedeemResult(null);
    try {
      const res = await api.post('/settings/redeem-code', { code: redeemCodeInput.trim() });
      setRedeemResult({ success: true, msg: res.data.message || t('settings.redeem_success', '兑换充值成功！') });
      if (res.data.newBalance !== undefined) {
        setUserBalance(res.data.newBalance);
      }
      setRedeemCodeInput('');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      const msg = error.response?.data?.error || error.message || t('settings.redeem_failed', '兑换失败，请核对兑换码');
      setRedeemResult({ success: false, msg });
    } finally {
      setRedeeming(false);
    }
  };

  // 官方全局 LLM 模型与计费信息
  const [globalLlmInfo, setGlobalLlmInfo] = useState<{
    model: string;
    isDeepSeek: boolean;
    priceInput: number;
    priceOutput: number;
    priceCacheHit: number;
  } | null>(null);

  // API Usage Monitoring State
  const [llmUsageLoading, setLlmUsageLoading] = useState(false);
  const [llmUsageData, setLlmUsageData] = useState<{
    summary: {
      totalRequests: number;
      totalTokens: number;
      promptTokens: number;
      cacheHitTokens: number;
      cacheMissTokens: number;
      completionTokens: number;
      totalCostCny: number;
      inputCostCny: number;
      outputCostCny: number;
      savedCostCny: number;
      cacheHitRate: number;
    };
    dailyHistory: {
      '1d': Array<{ label: string; date: string; cost_cny: number; tokens: number; requests: number }>;
      '7d': Array<{ label: string; date: string; cost_cny: number; tokens: number; requests: number }>;
      '30d': Array<{ label: string; date: string; cost_cny: number; tokens: number; requests: number }>;
    };
  } | null>(null);

  const fetchLlmUsage = async () => {
    setLlmUsageLoading(true);
    try {
      const res = await api.get('/settings/llm-usage');
      if (res.data.success) {
        setLlmUsageData(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch LLM usage:', err);
    } finally {
      setLlmUsageLoading(false);
    }
  };

  const handleClearLlmUsage = async () => {
    if (!confirm(t('llm.clear_confirm'))) return;
    try {
      await api.delete('/settings/llm-usage');
      fetchLlmUsage();
    } catch (err: any) {
      alert(err.response?.data?.error || t('settings.clear_failed', '清空失败'));
    }
  };

  useEffect(() => {
    if (activeSection === 'llm') {
      fetchLlmUsage();
    }
  }, [activeSection]);

  // 头像上传处理 (限制 2MB，并即时更新全局上下文)
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX_SIZE = 2 * 1024 * 1024; // 2MB
    if (file.size > MAX_SIZE) {
      setAvatarError(t('settings.avatar_size_err', '头像图片文件不能超过 2MB，请选择更小的图片'));
      return;
    }

    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setAvatarError(t('settings.avatar_type_err', '仅支持 JPG, PNG, WEBP, GIF 格式图片'));
      return;
    }

    setAvatarError(null);
    setAvatarUploading(true);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Data = reader.result as string;
        const res = await api.post('/auth/avatar', { avatarData: base64Data });
        const newUrl = res.data.avatar_url;
        updateUser({ avatar_url: newUrl });
        setProfileSuccess(t('settings.avatar_updated', '头像上传更新成功！'));
        setTimeout(() => setProfileSuccess(null), 3000);
      } catch (err: any) {
        setAvatarError(err.response?.data?.error || t('settings.avatar_upload_failed', '头像上传失败'));
      } finally {
        setAvatarUploading(false);
      }
    };
    reader.onerror = () => {
      setAvatarError(t('settings.read_file_failed', '读取文件失败'));
      setAvatarUploading(false);
    };
    reader.readAsDataURL(file);
  };

  // 昵称保存处理
  const handleSaveNickname = async () => {
    setSavingProfile(true);
    setProfileSuccess(null);
    try {
      const res = await api.put('/auth/profile', { nickname });
      updateUser({ nickname: res.data.user.nickname });
      setProfileSuccess(t('settings.nickname_saved', '昵称保存修改成功！'));
      setTimeout(() => setProfileSuccess(null), 3000);
    } catch (err: any) {
      alert(err.response?.data?.error || t('settings.nickname_failed', '修改昵称失败'));
    } finally {
      setSavingProfile(false);
    }
  };

  // 密码修改处理 (服务器仅保留不可逆哈希)
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPassword || !newPassword) {
      setPasswordError(t('settings.pwd_empty', '请输入原密码与新密码'));
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError(t('settings.pwd_too_short', '新密码长度不能少于 6 位'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('settings.pwd_not_match', '两次输入的新密码不一致'));
      return;
    }

    setChangingPassword(true);
    setPasswordError(null);
    setPasswordSuccess(null);

    try {
      const res = await api.put('/auth/password', { oldPassword, newPassword });
      setPasswordSuccess(res.data.message || t('settings.pwd_success', '密码修改成功！新密码哈希已安全更新。'));
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(null), 4000);
    } catch (err: any) {
      setPasswordError(err.response?.data?.error || t('settings.pwd_failed', '修改密码失败，请核验原密码'));
    } finally {
      setChangingPassword(false);
    }
  };

  // 用户自主注销账号
  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      setDeleteError(t('settings.delete_pwd_required', '请输入当前登录密码以确认注销'));
      return;
    }
    setDeleteError(null);
    setDeletingAccount(true);
    try {
      const res = await api.delete('/auth/me', { data: { password: deletePassword } });
      alert(res.data.message || t('settings.delete_success', '您的账号已注销成功'));
      logout();
    } catch (err: any) {
      setDeleteError(err.response?.data?.error || t('settings.delete_failed', '注销失败，请核验密码'));
    } finally {
      setDeletingAccount(false);
    }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await api.get('/settings');
      const { settings, urls, user_balance, has_global_llm } = res.data;
      if (user_balance !== undefined) {
        setUserBalance(Number(user_balance) || 0);
      }
      if (has_global_llm !== undefined) {
        setHasGlobalLlm(Boolean(has_global_llm));
      }
      if (res.data.global_llm_info) {
        setGlobalLlmInfo(res.data.global_llm_info);
      }
      if (settings) {
        setApiMode(settings.api_mode || 'official');
        setLlmEndpoint(settings.llm_endpoint || 'https://api.deepseek.com/v1');
        setLlmApiKey(settings.llm_api_key || '');
        if (settings.llm_api_key && settings.llm_api_key.trim().length > 3) {
          setLlmApiKeyValid(true);
        }
        setLlmModel(settings.llm_model || 'deepseek-chat');

        // Weixin status
        setWxConnected(Boolean(settings.weixin_connected));
        setWxUserId(settings.weixin_user_id || '');
        setWxNickname(settings.weixin_nickname || '');

        if (settings.work_slots) {
          try {
            const parsed = JSON.parse(settings.work_slots);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setWorkSlotsText(parsed.map((s: WorkSlot) => `${s.start}-${s.end}`).join(', '));
            } else if (typeof settings.work_slots === 'string' && settings.work_slots.trim()) {
              setWorkSlotsText(settings.work_slots);
            }
          } catch {
            setWorkSlotsText(settings.work_slots);
          }
        }
        setTaskBuffer(settings.task_buffer_minutes ?? 15);
        setRemindStart(settings.reminder_before_start_minutes ?? 10);
        setCalSyncInterval(settings.calendar_sync_interval_minutes ?? 30);
        setAdvanceDeadlineDays(settings.advance_deadline_days ?? 1);
        const lockMode = settings.schedule_lock_mode;
        setScheduleLockMode(
          lockMode === 'hours' || lockMode === 'today' || lockMode === 'this_week' ? lockMode : 'none'
        );
        setScheduleLockHours(
          Number(settings.schedule_lock_hours) > 0 ? Number(settings.schedule_lock_hours) : 4
        );
      }

      if (urls?.icalSubscriptionUrl) {
        setIcalExportUrl(urls.icalSubscriptionUrl);
      }

      if (!settings?.weixin_connected) {
        fetchQrCode();
      }

      setTimeout(() => {
        isInitialLoadDone.current = true;
      }, 500);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubs = async () => {
    try {
      const res = await api.get('/calendar/subscriptions');
      setSubs(res.data.subscriptions || []);
    } catch (err) {
      console.error('Failed to load subscriptions:', err);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchSubs();
  }, []);

  // Fetch WeChat QR Code & start polling
  const fetchQrCode = async () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    try {
      setQrStatus('loading');
      setQrStatusMsg(t('settings.qr_requesting', '正在向微信服务器申请登录二维码...'));
      const res = await api.get('/weixin/qrcode');
      const { qrcode, qrcodeUrl, qrcode_img_content } = res.data;
      setQrCode(qrcode);
      setQrCodeImgContent(qrcodeUrl || qrcode_img_content);
      setQrStatus('wait');
      setQrStatusMsg(t('settings.qr_scan_prompt', '请打开手机微信【扫一扫】屏幕二维码'));

      pollTimerRef.current = setInterval(() => {
        checkQrStatus(qrcode);
      }, 2500);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      setQrStatus('idle');
      setQrStatusMsg(t('settings.qr_fetch_failed', '获取二维码失败: ') + (error.response?.data?.error || error.message || t('common.error', '网络错误')));
    }
  };

  const checkQrStatus = async (code: string) => {
    try {
      const res = await api.get(`/weixin/status?qrcode=${encodeURIComponent(code)}`);
      const data = res.data;

      if (data.status === 'scaned') {
        setQrStatus('scaned');
        setQrStatusMsg(t('settings.qr_scanned', '已扫码！请在手机微信上点击【允许】以完成配对...'));
      } else if (data.status === 'confirmed') {
        setQrStatus('confirmed');
        setQrStatusMsg(t('settings.qr_paired', '配对成功！已连接微信助手'));
        setWxConnected(true);
        setWxUserId(data.weixinUserId || data.user_id || '');
        setWxNickname(data.nickname || '');

        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      } else if (data.status === 'expired') {
        setQrStatus('expired');
        setQrStatusMsg(t('settings.qr_expired', '二维码已过期，请点击重新获取'));
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      }
    } catch {
      // Ignore transient polling network errors
    }
  };

  const handleUnbindWeixin = async () => {
    if (!confirm(t('settings.unbind_confirm', '确定要解除当前微信配对吗？解除后机器人将停止微信通知。'))) return;
    try {
      await api.post('/weixin/unbind');
      setWxConnected(false);
      setWxUserId('');
      setWxNickname('');
      fetchQrCode();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      alert(t('settings.unbind_failed', '解绑失败: ') + (error.response?.data?.error || error.message));
    }
  };

  const handleSendTestMessage = async () => {
    try {
      setTestSending(true);
      setTestResult(null);
      const res = await api.post('/weixin/test-message');
      setTestResult(res.data.message || t('settings.test_msg_sent', '测试消息已成功推送！'));
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      setTestResult(t('settings.test_msg_failed', '发送失败: ') + (error.response?.data?.error || error.message));
    } finally {
      setTestSending(false);
    }
  };

  const isInitialLoadDone = useRef(false);

  // 自动保存偏好设置 (防抖 600ms)
  useEffect(() => {
    if (!isInitialLoadDone.current) return;
    if (parsedSlotsInfo.error) return;

    const timer = setTimeout(async () => {
      try {
        setSaving(true);
        await api.put('/settings', {
          api_mode: apiMode,
          llm_endpoint: llmEndpoint,
          llm_api_key: llmApiKey,
          llm_model: llmModel,
          work_slots: parsedSlotsInfo.slots,
          task_buffer_minutes: Number(taskBuffer),
          reminder_before_start_minutes: Number(remindStart),
          calendar_sync_interval_minutes: Number(calSyncInterval),
          advance_deadline_days: Number(advanceDeadlineDays),
          schedule_lock_mode: scheduleLockMode,
          schedule_lock_hours:
            scheduleLockMode === 'hours'
              ? Math.max(1, Math.min(168, Math.round(Number(scheduleLockHours) || 1)))
              : 0,
        });
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      } catch (err) {
        console.error('自动保存失败:', err);
      } finally {
        setSaving(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [
    apiMode,
    llmEndpoint,
    llmApiKey,
    llmModel,
    workSlotsText,
    taskBuffer,
    remindStart,
    calSyncInterval,
    advanceDeadlineDays,
    scheduleLockMode,
    scheduleLockHours,
  ]);

  const handleAddSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubName.trim() || !newSubUrl.trim()) return;

    setAddingSub(true);
    try {
      const response = await api.post('/calendar/subscriptions', {
        name: newSubName.trim(),
        url: newSubUrl.trim(),
      });
      setNewSubName('');
      setNewSubUrl('');
      await fetchSubs();
      if (response.data.message?.includes('初次同步失败')) alert(response.data.message);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      alert(t('calendar.add_sub_failed', '添加失败：') + (error.response?.data?.error || error.message));
    } finally {
      setAddingSub(false);
    }
  };

  const handleDeleteSubscription = async (id: number) => {
    if (!confirm(t('settings.delete_sub_confirm', '确定要删除此外部日历吗？相关的事件缓存也将被移除。'))) return;
    try {
      await api.delete(`/calendar/subscriptions/${id}`);
      fetchSubs();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      alert(t('common.error', '删除失败：') + (error.response?.data?.error || error.message));
    }
  };

  const handleSyncNow = async (id: number) => {
    try {
      await api.post(`/calendar/subscriptions/${id}/sync`);
      fetchSubs();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      alert(t('calendar.status_sync_err', '同步失败：') + (error.response?.data?.error || error.message));
    }
  };

  const openSubPolicyModal = async (sub: CalendarSub) => {
    const color = sub.color || '#039BE5';
    let allowScheduling = false;
    let aiReminderEnabled = true;
    try {
      const start = new Date(Date.now() - 7 * 86400000).toISOString();
      const end = new Date(Date.now() + 30 * 86400000).toISOString();
      const res = await api.get('/calendar/events', { params: { start, end } });
      const subEvents = (res.data?.events || []).filter(
        (ev: any) =>
          ev.extendedProps?.type === 'external' &&
          Number(ev.subscriptionId ?? ev.extendedProps?.subscriptionId ?? 0) === sub.id
      );
      if (subEvents.length > 0) {
        allowScheduling = subEvents.every((ev: any) => Boolean(ev.extendedProps?.allowScheduling));
        aiReminderEnabled = subEvents.some((ev: any) => ev.extendedProps?.aiReminderEnabled !== false);
      }
    } catch {}
    setEditingSubPolicy({ sub, color, allowScheduling, aiReminderEnabled });
  };

  const handleSaveSubPolicy = async () => {
    if (!editingSubPolicy) return;
    setSavingSubPolicy(true);
    try {
      await api.put('/calendar/external-events/bulk-policy', {
        subscriptionId: editingSubPolicy.sub.id,
        allowScheduling: editingSubPolicy.allowScheduling,
        aiReminderEnabled: editingSubPolicy.aiReminderEnabled,
      });
      setEditingSubPolicy(null);
      fetchSubs();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      alert(t('common.error', '操作失败：') + (error.response?.data?.error || error.message));
    } finally {
      setSavingSubPolicy(false);
    }
  };

  const copyIcal = async () => {
    setCopyIcalError('');
    setCopiedIcal(false);
    if (!icalExportUrl) {
      setCopyIcalError(t('settings.sub_link_not_loaded', '订阅链接尚未加载，请刷新页面后重试。'));
      return;
    }
    if (await copyText(icalExportUrl)) {
      setCopiedIcal(true);
      setTimeout(() => setCopiedIcal(false), 2000);
    } else {
      icalInputRef.current?.focus();
      icalInputRef.current?.select();
      setCopyIcalError(t('settings.sub_manual_copy', '无法自动复制，已选中链接，请手动复制。'));
    }
  };

  const webcalUrl = icalExportUrl.replace(/^https?:\/\//i, 'webcal://');
  const copyWebcal = async () => {
    setCopyIcalError('');
    setCopiedWebcal(false);
    if (!webcalUrl) {
      setCopyIcalError(t('settings.sub_link_not_loaded', '订阅链接尚未加载，请刷新页面后重试。'));
    } else if (await copyText(webcalUrl)) {
      setCopiedWebcal(true);
      setTimeout(() => setCopiedWebcal(false), 2000);
    } else {
      webcalInputRef.current?.focus();
      webcalInputRef.current?.select();
      setCopyIcalError(t('settings.sub_manual_copy', '无法自动复制，已选中链接，请手动复制。'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[360px]">
        <div className="flex items-center gap-3 text-gray-500 dark:text-neutral-400 font-medium text-sm">
          <RefreshCw className="w-5 h-5 animate-spin text-blue-600 dark:text-blue-400" />
          <span>{t('settings.loading_settings', '正在读取设置...')}</span>
        </div>
      </div>
    );
  }

  const isWeixinDone = Boolean(wxConnected);
  const isLlmDone = apiMode === 'official' ? userBalance > 0 : Boolean(llmApiKeyValid || (llmApiKey && llmApiKey.trim().length > 3));

  const navMenuItems = [
    {
      id: 'account' as const,
      label: t('set.tab_account'),
      desc: t('set.tab_account_desc'),
      icon: User,
      showStatus: false,
    },
    {
      id: 'general' as const,
      label: t('set.tab_general'),
      desc: t('set.tab_general_desc'),
      icon: Sliders,
      showStatus: false,
    },
    {
      id: 'appearance' as const,
      label: t('set.tab_appearance'),
      desc: t('set.tab_appearance_desc'),
      icon: Palette,
      showStatus: false,
    },
    {
      id: 'weixin' as const,
      label: t('set.tab_weixin'),
      desc: t('set.tab_weixin_desc'),
      icon: Bot,
      isDone: isWeixinDone,
      showStatus: true,
    },
    {
      id: 'scheduler' as const,
      label: t('set.tab_scheduler'),
      desc: t('set.tab_scheduler_desc'),
      icon: Clock,
      showStatus: false,
    },
    {
      id: 'notification' as const,
      label: t('set.tab_notification'),
      desc: t('set.tab_notification_desc'),
      icon: Bell,
      showStatus: false,
    },
    {
      id: 'llm' as const,
      label: t('set.tab_llm'),
      desc: t('set.tab_llm_desc'),
      icon: Brain,
      isDone: isLlmDone,
      showStatus: true,
    },
    {
      id: 'calendar' as const,
      label: t('set.tab_calendar'),
      desc: t('set.tab_calendar_desc'),
      icon: Calendar,
      showStatus: false,
    },
  ];

  const renderCardHeader = (
    icon: React.ReactNode,
    title: string,
    statusBadge?: React.ReactNode,
    _hideGlobalSave?: boolean
  ) => (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-gray-100 dark:border-neutral-800">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">{title}</h2>
          {statusBadge}
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
        {saving && (
          <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-medium animate-fadeIn">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>{t('settings.auto_saving', '正在自动保存...')}</span>
          </span>
        )}
        {!saving && saveSuccess && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium animate-fadeIn">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{t('settings.auto_saved', '已自动保存')}</span>
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col space-y-2.5 overflow-hidden">

      {onOpenMobileMenu && (
        <div className="md:hidden flex shrink-0 items-center gap-3 px-1 py-1">
          <button type="button" onClick={onOpenMobileMenu} aria-label={t('settings.open_mobile_nav', '打开侧边导航')} className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-800">
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('nav.settings', '设置')}</h1>
        </div>
      )}

      {/* Mobile Horizontal Tabs Rail */}
      <div className="lg:hidden shrink-0 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {navMenuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition cursor-pointer ${
                isActive
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white dark:bg-[#1e1f20] text-gray-600 dark:text-neutral-300 border border-gray-200/80 dark:border-neutral-700/80'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label.split(' ')[0]}</span>
              {item.showStatus && (
                <span className={`w-2 h-2 rounded-full ${item.isDone ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Main Left-Right Split Layout */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 items-stretch overflow-hidden">
        {/* Left Column: Vertical Nav List */}
        <aside className="hidden lg:flex flex-col w-72 xl:w-80 shrink-0 bg-white dark:bg-[#1e1f20] rounded-2xl border border-gray-200/80 dark:border-neutral-800/80 p-3 shadow-xs space-y-1.5 overflow-y-auto scrollbar-thin">
          {navMenuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`w-full flex items-start gap-3 p-3 rounded-xl text-left transition cursor-pointer group ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold shadow-2xs border-l-4 border-blue-600'
                    : 'text-gray-700 dark:text-neutral-300 hover:bg-gray-100/80 dark:hover:bg-neutral-800/60'
                }`}
              >
                <div
                  className={`p-2 rounded-lg shrink-0 mt-0.5 transition ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-neutral-800 text-gray-500 dark:text-neutral-400 group-hover:text-blue-600'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold truncate">{item.label}</span>
                    {item.showStatus && (
                      item.isDone ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-300/70 dark:border-emerald-800 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          {t('common.completed')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-300/70 dark:border-amber-800 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          {t('common.pending')}
                        </span>
                      )
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400 dark:text-neutral-500 truncate mt-0.5 font-normal">
                    {item.desc}
                  </p>
                </div>
              </button>
            );
          })}
        </aside>

        {/* Right Column: Selected Config Panel */}
        <section className="flex-1 min-w-0 bg-white dark:bg-[#1e1f20] rounded-2xl border border-gray-200/80 dark:border-neutral-800/80 p-3 sm:p-7 shadow-xs overflow-y-auto overflow-x-hidden transition-colors scrollbar-thin">
          {/* ===================== A. 个人账户管理 (Account) ===================== */}
          {activeSection === 'account' && (
            <div className="space-y-6 animate-fadeIn">
              {renderCardHeader(
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <User className="w-5 h-5" />
                </div>,
                t('account.title'),
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-neutral-300">
                  @{user?.username}
                </span>,
                true
              )}

              {profileSuccess && (
                <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-medium animate-fadeIn">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>{profileSuccess}</span>
                </div>
              )}

              {avatarError && (
                <div className="flex items-center gap-2 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 rounded-xl text-xs font-medium animate-fadeIn">
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  <span>{avatarError}</span>
                </div>
              )}

              {/* 1. 头像上传 */}
              <div className="space-y-3 pb-6 border-b border-gray-100 dark:border-neutral-800">
                <div className="text-xs font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
                  {t('account.avatar')}
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-5">
                  <div className="relative group shrink-0">
                    {user?.avatar_url ? (
                      <img
                        src={user.avatar_url}
                        alt="Avatar"
                        className="w-18 h-18 rounded-full object-cover ring-2 ring-blue-500/30 dark:ring-blue-400/30 shadow-xs"
                      />
                    ) : (
                      <div className="w-18 h-18 rounded-full bg-blue-600 dark:bg-blue-500 text-white font-bold flex items-center justify-center text-xl shadow-xs">
                        {(user?.nickname || user?.username || 'U').slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    {avatarUploading && (
                      <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center text-white">
                        <RefreshCw className="w-6 h-6 animate-spin" />
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 flex-1">
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={handleAvatarChange}
                      className="hidden"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={avatarUploading}
                        className="flex items-center gap-2 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white text-xs font-semibold rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer"
                      >
                        {avatarUploading ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Upload className="w-3.5 h-3.5" />
                        )}
                        <span>{avatarUploading ? t('account.avatar_uploading') : t('account.avatar_upload')}</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-neutral-400 leading-relaxed">
                      {t('account.avatar_tip')}
                    </p>
                  </div>
                </div>
              </div>

              {/* 2. 账号与昵称设置 */}
              <div className="space-y-3 pb-6 border-b border-gray-100 dark:border-neutral-800">
                <div className="text-xs font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
                  {t('account.user_info')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* 登录账号（只读） */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-neutral-300 mb-1.5">
                      {t('account.username')}
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={user?.username || ''}
                        disabled
                        className="w-full pl-3 pr-8 py-2 text-xs bg-gray-100 dark:bg-neutral-800/80 border border-gray-200 dark:border-neutral-700 text-gray-500 dark:text-neutral-400 rounded-xl cursor-not-allowed font-mono select-none"
                      />
                      <Lock className="w-3.5 h-3.5 text-gray-400 dark:text-neutral-500 absolute right-3 top-1/2 -translate-y-1/2" />
                    </div>
                  </div>

                  {/* 对外展示昵称 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-neutral-300 mb-1.5">
                      {t('account.nickname')}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        placeholder={t('account.nickname_placeholder')}
                        maxLength={30}
                        className="flex-1 px-3 py-2 text-xs bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 text-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                      />
                      <button
                        type="button"
                        onClick={handleSaveNickname}
                        disabled={savingProfile || nickname === user?.nickname}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white text-xs font-semibold rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer shrink-0"
                      >
                        {savingProfile ? t('common.saving') : t('account.save_nickname')}
                      </button>
                    </div>
                  </div>

                  {/* 注册绑定邮箱 */}
                  {user?.email && (
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-gray-700 dark:text-neutral-300 mb-1.5">
                        {t('settings.bound_email_label', '绑定邮箱 (唯一识别)')}
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={user.email}
                          disabled
                          className="w-full pl-3 pr-8 py-2 text-xs bg-gray-100 dark:bg-neutral-800/80 border border-gray-200 dark:border-neutral-700 text-gray-500 dark:text-neutral-400 rounded-xl cursor-not-allowed font-mono select-none"
                        />
                        <Mail className="w-3.5 h-3.5 text-gray-400 dark:text-neutral-500 absolute right-3 top-1/2 -translate-y-1/2" />
                      </div>
                      <span className="text-[10px] text-gray-400 dark:text-neutral-500 mt-1 block">
                        {t('settings.bound_email_desc', '用于验证码接收与身份认证，每个邮箱唯一绑定一个账号')}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* 3. 修改密码 (服务器只保存不可逆哈希) */}
              <div className="space-y-3 pb-6 border-b border-gray-100 dark:border-neutral-800">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>{t('account.password_title')}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-[11px] text-gray-500 dark:text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    <span>{showPassword ? t('account.hide_password') : t('account.show_password')}</span>
                  </button>
                </div>

                {passwordSuccess && (
                  <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-medium animate-fadeIn">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>{passwordSuccess}</span>
                  </div>
                )}

                {passwordError && (
                  <div className="flex items-center gap-2 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 rounded-xl text-xs font-medium animate-fadeIn">
                    <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                    <span>{passwordError}</span>
                  </div>
                )}

                <form onSubmit={handleChangePassword} className="space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-neutral-300 mb-1">
                        {t('account.old_password')}
                      </label>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                        placeholder={t('account.old_password_placeholder')}
                        className="w-full px-3 py-2 text-xs bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 text-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-neutral-300 mb-1">
                        {t('account.new_password')}
                      </label>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder={t('account.new_password_placeholder')}
                        minLength={6}
                        className="w-full px-3 py-2 text-xs bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 text-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-neutral-300 mb-1">
                        {t('account.confirm_password')}
                      </label>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder={t('account.confirm_password_placeholder')}
                        minLength={6}
                        className="w-full px-3 py-2 text-xs bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 text-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={changingPassword || !oldPassword || !newPassword}
                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white text-xs font-semibold rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer"
                    >
                      {changingPassword ? t('account.updating_password') : t('account.change_password_btn')}
                    </button>
                  </div>
                </form>
              </div>

              {/* 4. 退出登录 */}
              <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100">
                    {t('account.logout_title')}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-gray-700 dark:text-neutral-300 rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer shrink-0 self-start sm:self-center"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{t('account.logout_btn')}</span>
                </button>
              </div>

              {/* 5. 危险区域：自主注销/删除账号 */}
              <div className="pt-6 border-t border-rose-100 dark:border-rose-950/40 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t('settings.delete_account_title', '注销并彻底删除个人账号')}</span>
                    </h4>
                    <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-0.5">
                      {t('settings.delete_account_desc', '永久删除您的个人档案、所有待办日程、日历订阅及 API 用量记录，此操作不可撤销。')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDeletePassword('');
                      setDeleteError(null);
                      setShowDeleteModal(true);
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-900 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 self-start sm:self-center"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t('settings.delete_account_btn', '注销账号')}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ===================== B. 通用偏好设置 (General) ===================== */}
          {activeSection === 'general' && (
            <div className="space-y-6 animate-fadeIn">
              {renderCardHeader(
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Sliders className="w-5 h-5" />
                </div>,
                t('general.title'),
                undefined,
                true
              )}

              {/* 1. 界面语言 (下拉选择框) */}
              <div className="space-y-2 pb-6 border-b border-gray-100 dark:border-neutral-800">
                <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
                  <Languages className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>{t('general.lang_title')}</span>
                </div>
                <div className="max-w-xs pt-1">
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as 'zh' | 'en')}
                    className="w-full px-3.5 py-2.5 text-xs bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 text-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition cursor-pointer shadow-2xs font-medium"
                  >
                    <option value="zh">{t('settings.lang_zh', '简体中文 (Simplified Chinese)')}</option>
                    <option value="en">English (US)</option>
                  </select>
                </div>
              </div>

              {/* 2. 默认新建任务耗时 */}
              <div className="space-y-3 pb-6 border-b border-gray-100 dark:border-neutral-800">
                <div className="text-xs font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
                  {t('general.duration_title')}
                </div>
                <div className="flex flex-wrap gap-2.5 pt-1">
                  {[30, 45, 60, 90].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setDefaultTaskDuration(mins)}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                        defaultTaskDuration === mins
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-700 text-gray-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800'
                      }`}
                    >
                      {mins} {t('general.minutes')} {mins === 60 ? `(${t('common.recommended')})` : ''}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. 声音与音效反馈 */}
              <div className="pb-6 border-b border-gray-100 dark:border-neutral-800 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-neutral-800 flex items-center justify-center text-gray-600 dark:text-neutral-300 shrink-0">
                    {soundEnabled ? <Volume2 className="w-4 h-4 text-blue-600 dark:text-blue-400" /> : <VolumeX className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                      {t('general.sound_title')}
                    </div>
                    <div className="text-[10px] text-gray-400 dark:text-neutral-500 mt-0.5">
                      {t('general.sound_desc')}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className={`w-11 h-6 rounded-full p-1 transition cursor-pointer shrink-0 ${
                    soundEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-neutral-700'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform ${
                      soundEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* 4. 键盘快捷键速查 */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
                  <Keyboard className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>{t('general.shortcuts_title')}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div className="p-3 rounded-xl bg-gray-50/70 dark:bg-[#252728] border border-gray-200/80 dark:border-neutral-700 flex items-center justify-between">
                    <span className="text-xs text-gray-700 dark:text-neutral-300">{t('general.shortcut_new')}</span>
                    <kbd className="px-2 py-0.5 rounded bg-white dark:bg-neutral-800 text-[10px] font-mono border border-gray-200 dark:border-neutral-700">
                      N
                    </kbd>
                  </div>
                  <div className="p-3 rounded-xl bg-gray-50/70 dark:bg-[#252728] border border-gray-200/80 dark:border-neutral-700 flex items-center justify-between">
                    <span className="text-xs text-gray-700 dark:text-neutral-300">{t('general.shortcut_close')}</span>
                    <kbd className="px-2 py-0.5 rounded bg-white dark:bg-neutral-800 text-[10px] font-mono border border-gray-200 dark:border-neutral-700">
                      Esc
                    </kbd>
                  </div>
                  <div className="p-3 rounded-xl bg-gray-50/70 dark:bg-[#252728] border border-gray-200/80 dark:border-neutral-700 flex items-center justify-between">
                    <span className="text-xs text-gray-700 dark:text-neutral-300">{t('general.shortcut_submit')}</span>
                    <kbd className="px-2 py-0.5 rounded bg-white dark:bg-neutral-800 text-[10px] font-mono border border-gray-200 dark:border-neutral-700">
                      Enter
                    </kbd>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===================== C. 外观主题定制 (Appearance) ===================== */}
          {activeSection === 'appearance' && (
            <div className="space-y-6 animate-fadeIn">
              {renderCardHeader(
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Palette className="w-5 h-5" />
                </div>,
                t('appearance.title'),
                undefined,
                true
              )}

              {/* 1. 亮暗模式切换 */}
              <div className="space-y-3 pb-6 border-b border-gray-100 dark:border-neutral-800">
                <div className="text-xs font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
                  {t('appearance.mode_title')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  {[
                    { id: 'light' as const, label: t('appearance.mode_light'), icon: Sun, desc: t('appearance.mode_light_desc') },
                    { id: 'dark' as const, label: t('appearance.mode_dark'), icon: Moon, desc: t('appearance.mode_dark_desc') },
                    { id: 'system' as const, label: t('appearance.mode_system'), icon: Monitor, desc: t('appearance.mode_system_desc') },
                  ].map((item) => {
                    const Icon = item.icon;
                    const isSelected = themeMode === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setThemeMode(item.id)}
                        className={`p-3.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 shadow-2xs font-semibold'
                            : 'border-gray-200 dark:border-neutral-700 bg-white dark:bg-[#1e1f20] hover:bg-gray-100/60 dark:hover:bg-neutral-800'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <Icon className={`w-5 h-5 ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`} />
                          {isSelected && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
                        </div>
                        <div>
                          <div className="text-xs font-semibold">{item.label}</div>
                          <div className="text-[10px] text-gray-400 dark:text-neutral-500 mt-0.5">{item.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. 主题强调配色 */}
              <div className="space-y-3 pb-6 border-b border-gray-100 dark:border-neutral-800">
                <div className="text-xs font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
                  {t('appearance.accent_title')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  {[
                    { id: 'blue' as const, name: t('appearance.accent_blue'), hex: '#2563eb' },
                    { id: 'emerald' as const, name: t('appearance.accent_emerald'), hex: '#059669' },
                    { id: 'violet' as const, name: t('appearance.accent_violet'), hex: '#7c3aed' },
                  ].map((c) => {
                    const isSelected = themeColor === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setThemeColor(c.id)}
                        className={`flex items-center gap-3 p-3 rounded-xl border text-left transition cursor-pointer ${
                          isSelected
                            ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 shadow-2xs font-semibold'
                            : 'border-gray-200 dark:border-neutral-700 bg-white dark:bg-[#1e1f20] hover:bg-gray-100/60 dark:hover:bg-neutral-800'
                        }`}
                      >
                        <span
                          className="w-4 h-4 rounded-full shrink-0 ring-2 ring-white dark:ring-neutral-800 shadow-2xs"
                          style={{ backgroundColor: c.hex }}
                        />
                        <span className="text-xs flex-1 truncate text-gray-800 dark:text-gray-200">
                          {c.name}
                        </span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. 界面排版紧凑度风格 */}
              <div className="space-y-3 pt-1">
                <div className="text-xs font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
                  {t('appearance.density_title')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {[
                    {
                      id: 'comfortable' as const,
                      title: t('appearance.density_comfortable'),
                      desc: t('appearance.density_comfortable_desc'),
                    },
                    {
                      id: 'compact' as const,
                      title: t('appearance.density_compact'),
                      desc: t('appearance.density_compact_desc'),
                    },
                  ].map((d) => {
                    const isSelected = displayDensity === d.id;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setDisplayDensity(d.id)}
                        className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                          isSelected
                            ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 shadow-2xs font-semibold'
                            : 'border-gray-200 dark:border-neutral-700 bg-white dark:bg-[#1e1f20] hover:bg-gray-100/60 dark:hover:bg-neutral-800'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold">{d.title}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />}
                        </div>
                        <p className="text-[10px] text-gray-400 dark:text-neutral-500 mt-1">{d.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 1. WeChat Pairing Section */}
          {activeSection === 'weixin' && (
            <div className="space-y-6 animate-fadeIn">
              {renderCardHeader(
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Bot className="w-5 h-5" />
                </div>,
                t('weixin.title'),
                wxConnected ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {t('weixin.connected')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300">
                    {t('weixin.waiting_scan')}
                  </span>
                )
              )}

              {wxConnected ? (
                <div className="space-y-6">
                  {/* WeChat 24-Hour Active Window Notice */}
                  <div className="p-4 rounded-2xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200/90 dark:border-blue-800 text-xs space-y-1.5 animate-fadeIn">
                    <div className="font-bold flex items-center gap-2 text-blue-700 dark:text-blue-300 text-xs">
                      <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400 animate-ping" />
                      <span>{t('settings.weixin_notice_title', '💡 首次对接激活与 24 小时互动机制须知')}</span>
                    </div>
                    <p className="leading-relaxed text-blue-800/90 dark:text-blue-300/90 text-xs">
                      {t('settings.weixin_notice_1', '微信外部通道受平台规则约束，机器人仅能在收到您发信后的 24 小时内 主动向您下发提醒与排程卡片。')}<br />
                      {t('settings.weixin_notice_2', '首次对接成功后，请立即打开手机微信向助手发送任意消息（如“查看日历”或“你好”）完成激活；建议保持每天至少向助手发一条消息以维持推送窗口。')}
                    </p>
                  </div>

                  {/* Connected Account Info & Actions */}
                  <div className="pb-6 border-b border-gray-100 dark:border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-base shadow-xs shrink-0">
                        {wxNickname ? wxNickname.slice(0, 1).toUpperCase() : 'W'}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">
                          {wxNickname ? `${t('weixin.bound_account')}：${wxNickname}` : t('weixin.bound_account')}
                        </h3>
                        <p className="text-xs font-mono text-gray-500 dark:text-neutral-400 mt-0.5 truncate">
                          {t('weixin.comm_id')}: {wxUserId || t('weixin.encrypted')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap shrink-0">
                      <button
                        type="button"
                        onClick={handleSendTestMessage}
                        disabled={testSending}
                        className="flex items-center gap-1.5 px-4 py-2 bg-white dark:bg-[#1e1f20] hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-700 dark:text-neutral-200 border border-gray-200 dark:border-neutral-700 font-medium text-xs rounded-full shadow-2xs transition disabled:opacity-50 cursor-pointer"
                      >
                        {testSending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />}
                        <span>{testSending ? t('weixin.testing') : t('weixin.test_btn')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleUnbindWeixin}
                        className="flex items-center gap-1.5 px-4 py-2 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 font-medium text-xs rounded-full transition cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>{t('weixin.unbind_btn')}</span>
                      </button>
                    </div>
                  </div>

                  {testResult && (
                    <div className="text-xs p-3 bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-800 dark:text-emerald-300 flex items-center gap-2 animate-fadeIn">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{testResult}</span>
                    </div>
                  )}

                  {/* Usage Guide */}
                  <div className="space-y-3 pt-1">
                    <div className="text-xs font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
                      {t('weixin.guide_title')}
                    </div>
                    <ul className="list-disc list-inside space-y-1.5 text-xs text-gray-600 dark:text-neutral-400 leading-relaxed pl-1">
                      <li>{t('weixin.guide_schedule')}</li>
                      <li>{t('weixin.guide_cal')}</li>
                      <li>{t('weixin.guide_task')}</li>
                      <li>{t('weixin.guide_chat')}</li>
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col md:flex-row items-center gap-8 py-2">
                  {/* QR Container */}
                  <div className="flex flex-col items-center shrink-0">
                    <div className="w-48 h-48 bg-white p-3 rounded-2xl border-2 border-dashed border-gray-300 shadow-2xs flex items-center justify-center relative overflow-hidden">
                      {qrStatus === 'loading' && (
                        <div className="flex flex-col items-center gap-2 text-gray-400 text-xs">
                          <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
                          <span>{t('common.loading')}</span>
                        </div>
                      )}

                      {(qrStatus === 'wait' || qrStatus === 'scaned') && (
                        <div className="relative">
                          {qrCodeImgContent ? (
                            <QRCodeSVG
                              value={qrCodeImgContent}
                              size={168}
                              level="M"
                              includeMargin={false}
                            />
                          ) : (
                            <div className="text-xs text-gray-400">{t('common.loading')}</div>
                          )}

                          {qrStatus === 'scaned' && (
                            <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center text-center p-2 rounded-xl">
                              <CheckCircle2 className="w-8 h-8 text-emerald-600 animate-bounce mb-1" />
                              <span className="text-sm font-bold text-gray-900">{t('common.success')}</span>
                              <span className="text-xs text-gray-500">{t('weixin.qr_click_confirm')}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {qrStatus === 'expired' && (
                        <div className="flex flex-col items-center gap-2 text-center p-3">
                          <AlertCircle className="w-8 h-8 text-amber-500" />
                          <span className="text-xs text-gray-600 font-semibold">Expired</span>
                          <button
                            onClick={fetchQrCode}
                            className="text-xs text-blue-600 hover:underline font-bold"
                          >
                            {t('weixin.qr_retry')}
                          </button>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={fetchQrCode}
                      className="mt-3 flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>{t('weixin.qr_retry')}</span>
                    </button>
                  </div>

                  {/* Steps */}
                  <div className="space-y-4 text-xs flex-1 max-w-lg">
                    <div>
                      <div className="flex items-center gap-2 font-bold text-sm text-gray-900 dark:text-gray-100 mb-1">
                        <QrCode className="w-4 h-4 text-emerald-600" />
                        <span>{t('weixin.qr_title')}</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-neutral-400 leading-relaxed">
                        {t('weixin.qr_subtitle')}
                      </p>
                    </div>

                    <ol className="space-y-2 text-xs text-gray-600 dark:text-neutral-300 list-decimal list-inside leading-relaxed pl-1">
                      <li>{t('weixin.qr_step1')}</li>
                      <li>{t('weixin.qr_step2')}</li>
                      <li>{t('weixin.qr_step3')}</li>
                    </ol>

                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/60 rounded-xl text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                      <span>{qrStatusMsg}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. Scheduler Work Slots & Visual Timeline */}
          {activeSection === 'scheduler' && (
            <div className="space-y-6 animate-fadeIn">
              {renderCardHeader(
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Clock className="w-5 h-5" />
                </div>,
                t('scheduler.title')
              )}

              {/* 1. Manual Work Slots Input */}
              <div className="space-y-2 pb-6 border-b border-gray-100 dark:border-neutral-800">
                <label className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider block mb-1">
                  {t('scheduler.work_slots_title')}
                </label>
                <div className="max-w-xl">
                  <input
                    type="text"
                    value={workSlotsText}
                    onChange={(e) => setWorkSlotsText(e.target.value)}
                    placeholder={t('scheduler.work_slots_placeholder')}
                    className={`w-full px-3.5 py-2.5 bg-white dark:bg-[#1e1f20] border rounded-xl font-mono text-xs text-gray-800 dark:text-gray-100 outline-none transition ${
                      parsedSlotsInfo.error
                        ? 'border-rose-300 dark:border-rose-700 focus:ring-2 focus:ring-rose-400/20'
                        : 'border-gray-300 dark:border-neutral-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                    }`}
                  />
                  {parsedSlotsInfo.error ? (
                    <p className="text-xs text-rose-600 dark:text-rose-400 font-medium mt-1.5 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{parsedSlotsInfo.error}</span>
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-neutral-500 mt-1.5">
                      {t('scheduler.work_slots_desc')}
                    </p>
                  )}
                </div>
              </div>

              {/* 2. 24-Hour Timeline Visual Progress Bar */}
              <div className="space-y-3 pb-6 border-b border-gray-100 dark:border-neutral-800">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider">
                      {t('scheduler.preview_24h')}
                    </span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 dark:bg-blue-500 inline-block shadow-2xs" />
                        <span className="font-semibold text-blue-700 dark:text-blue-300">Active</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-xs bg-gray-300 dark:bg-neutral-700 border border-gray-400/40 inline-block" />
                        <span className="text-gray-500 dark:text-neutral-400">Rest</span>
                      </span>
                    </div>
                  </div>

                  {!parsedSlotsInfo.error && (
                    <div className="text-xs text-gray-500 dark:text-neutral-400 font-medium">
                      {t('scheduler.total_available')}：<span className="font-bold text-blue-600 dark:text-blue-400">{(parsedSlotsInfo.totalMinutes / 60).toFixed(1)}{t('scheduler.hours')}</span> / 24h
                    </div>
                  )}
                </div>

                {/* Visual Bar */}
                <div className="relative w-full h-8 bg-gray-200 dark:bg-neutral-800 rounded-xl overflow-hidden shadow-inner flex items-center select-none border border-gray-300/80 dark:border-neutral-700">
                  {parsedSlotsInfo.visualSlots.map((slot, idx) => {
                    const leftPct = (slot.startMin / 1440) * 100;
                    const widthPct = ((slot.endMin - slot.startMin) / 1440) * 100;
                    const durationHours = ((slot.endMin - slot.startMin) / 60).toFixed(1);

                    return (
                      <div
                        key={idx}
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                        }}
                        title={`${slot.label} (${durationHours}h)`}
                        className="absolute top-0 bottom-0 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-400 transition-colors flex items-center justify-center cursor-pointer shadow-xs"
                      >
                        {widthPct >= 6 && (
                          <span className="text-[10px] text-white font-mono font-bold truncate px-1 text-center select-none drop-shadow-2xs">
                            {slot.label}
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {/* Grid Lines at 3h intervals */}
                  {[3, 6, 9, 12, 15, 18, 21].map((hour) => (
                    <div
                      key={hour}
                      style={{ left: `${(hour / 24) * 100}%` }}
                      className="absolute top-0 bottom-0 w-px bg-gray-400/40 dark:bg-neutral-600/50 pointer-events-none"
                    />
                  ))}
                </div>

                {/* Hour Scale */}
                <div className="relative w-full h-4 overflow-hidden">
                  {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => (
                    <span
                      key={hour}
                      style={{ left: `${(hour / 24) * 100}%` }}
                      className={`absolute text-[10px] font-mono text-gray-400 dark:text-neutral-500 -translate-x-1/2 ${
                        hour === 0 ? 'translate-x-0' : hour === 24 ? '-translate-x-full' : ''
                      }`}
                    >
                      {String(hour).padStart(2, '0')}:00
                    </span>
                  ))}
                </div>
              </div>

              {/* 3. Buffer Setting */}
              <div className="space-y-2 pt-1">
                <label className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider block mb-1">
                  {t('scheduler.buffer_title')}
                </label>
                <div className="max-w-xs">
                  <input
                    type="number"
                    min="0"
                    max="120"
                    value={taskBuffer}
                    onChange={(e) => setTaskBuffer(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                  />
                </div>
              </div>

              {/* 4. Advance Deadline Setting (DDL - N 天) */}
              <div className="space-y-2 pt-4 border-t border-gray-100 dark:border-neutral-800">
                <label className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider block mb-1">
                  {t('settings.buffer_days_title', '提前完成缓冲天数')}
                </label>
                <div className="max-w-xs">
                  <select
                    value={advanceDeadlineDays}
                    onChange={(e) => setAdvanceDeadlineDays(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none cursor-pointer"
                  >
                    <option value={0}>{t('settings.buffer_days_0', '0 天 (截止日当天完成即可)')}</option>
                    <option value={1}>{t('settings.buffer_days_1', '1 天 (推荐：截止日前 1 天完成，预留缓冲)')}</option>
                    <option value={2}>{t('settings.buffer_days_2', '2 天 (截止日前 2 天完成)')}</option>
                    <option value={3}>{t('settings.buffer_days_3', '3 天 (截止日前 3 天完成，极端从容)')}</option>
                  </select>
                </div>
              </div>

              {/* 5. Schedule Lock Window */}
              <div className="space-y-3 pt-4 border-t border-gray-100 dark:border-neutral-800">
                <div>
                  <label className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider block mb-1">
                    {t('settings.schedule_lock_title', '近期日程锁定范围')}
                  </label>
                  <p className="text-xs text-gray-400 dark:text-neutral-500 mb-2.5">
                    {t(
                      'settings.schedule_lock_desc',
                      '锁定范围内已排定的日程在自动或手动重排时保持位置不变；锁定区间内的剩余空闲时段仍可用于排入新任务。'
                    )}
                  </p>
                </div>

                <div className="max-w-md">
                  <select
                    value={scheduleLockMode}
                    onChange={(e) =>
                      setScheduleLockMode(e.target.value as 'none' | 'hours' | 'today' | 'this_week')
                    }
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none cursor-pointer"
                  >
                    <option value="none">{t('settings.lock_mode_none', '不锁定（所有未开始日程可随时重排）')}</option>
                    <option value="hours">{t('settings.lock_mode_hours', '按滚动时长锁定（从当前往后锁定 N 小时）')}</option>
                    <option value="today">{t('settings.lock_mode_today', '锁定所在当天（固定今日已排日程，次日自动锁定新一天）')}</option>
                    <option value="this_week">{t('settings.lock_mode_week', '锁定所在当周（固定本周已排日程，下周自动锁定新一周）')}</option>
                  </select>
                </div>

                {scheduleLockMode === 'hours' && (
                  <div className="space-y-2.5 pt-1">
                    <div className="flex items-center gap-2 max-w-xs">
                      <input
                        type="number"
                        min={1}
                        max={168}
                        value={scheduleLockHours}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setScheduleLockHours(Number.isFinite(v) ? Math.max(1, Math.min(168, Math.round(v))) : 1);
                        }}
                        className="w-28 px-3.5 py-2.5 bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                      />
                      <span className="text-xs text-gray-500 dark:text-neutral-400 font-medium">
                        小时（1 ~ 168）
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {[2, 4, 8, 12, 24].map((hrs) => (
                        <button
                          key={hrs}
                          type="button"
                          onClick={() => setScheduleLockHours(hrs)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-mono font-medium transition cursor-pointer ${
                            scheduleLockHours === hrs
                              ? 'bg-blue-600 text-white shadow-xs'
                              : 'bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-700 text-gray-600 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800'
                          }`}
                        >
                          {hrs} 小时
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/70 dark:border-blue-800/50 rounded-xl px-3.5 py-2.5 max-w-xl flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {scheduleLockMode === 'none'
                      ? '当前未开启时间锁：每次重排将按最新优先级重新分配所有未开始日程。'
                      : scheduleLockMode === 'hours'
                      ? `当前将保护至 ${new Date(Date.now() + Math.max(1, scheduleLockHours) * 3600_000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} 前已排定的日程位置；到期未完成或该时间之后仍可重排。`
                      : scheduleLockMode === 'today'
                      ? '当前将保护今日 23:59 前已排定的日程位置不变，当天剩余空闲时段仍可排入新任务；进入次日后会自动锁定新的一天，前一日未完成任务可自动顺延。'
                      : '当前将保护本周日 23:59 前已排定的日程位置不变，本周内剩余空闲时段仍可排入新任务；进入下周后会自动锁定新的一周，未完成任务可自动顺延。'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 3. Notification & Reminder Cycles */}
          {activeSection === 'notification' && (
            <div className="space-y-6 animate-fadeIn">
              {renderCardHeader(
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Bell className="w-5 h-5" />
                </div>,
                t('notification.title')
              )}

              {/* 1. Start reminder */}
              <div className="space-y-3 pb-6 border-b border-gray-100 dark:border-neutral-800 text-xs">
                <div>
                  <label className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider block mb-1">
                    {t('notification.start_title')}
                  </label>
                  <p className="text-xs text-gray-500 dark:text-neutral-400 mb-2.5">
                    {t('notification.start_desc')}
                  </p>
                  <div className="max-w-xs">
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={remindStart}
                      onChange={(e) => setRemindStart(Number(e.target.value))}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  {[5, 10, 15, 30].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setRemindStart(mins)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-mono font-medium transition cursor-pointer ${
                        remindStart === mins
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-700 text-gray-600 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800'
                      }`}
                    >
                      {mins} {t('general.minutes')}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Pure notification mode notice (no start/end check-in confirmation) */}
              <div className="space-y-2 pb-2 text-xs">
                <div className="rounded-xl bg-gray-50 dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-800 px-3.5 py-3 text-gray-600 dark:text-neutral-300">
                  <div className="font-semibold text-gray-800 dark:text-gray-200 mb-1">
                    仅提醒不打卡模式已启用
                  </div>
                  <p className="text-xs text-gray-500 dark:text-neutral-400">
                    系统仅在日程开始前发送纯提醒通知，已取消每个分段的“开始 / 结束打卡确认”追问。
                  </p>
                </div>
              </div>

            </div>
          )}

          {/* 4. LLM Config Section */}
          {activeSection === 'llm' && (
            <div className="space-y-6 animate-fadeIn">
              {renderCardHeader(
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Brain className="w-5 h-5" />
                </div>,
                t('llm.title'),
                isLlmDone ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {apiMode === 'official' ? t('settings.official_ready', '官方接口已就绪') : t('llm.valid_badge')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
                    {apiMode === 'official' ? t('settings.official_low_bal', '额度不足，请充值') : t('llm.unverified_badge')}
                  </span>
                )
              )}

              <div className="space-y-5 text-xs max-w-xl">
                {/* 模式选择 */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider block">
                    {t('llm.mode_select')}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setApiMode('official')}
                      className={`p-3.5 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                        apiMode === 'official'
                          ? 'bg-blue-50/70 dark:bg-blue-950/50 border-2 border-blue-600 text-blue-950 dark:text-blue-100 font-bold shadow-xs'
                          : 'bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-800 text-gray-700 dark:text-gray-300 hover:border-blue-300 dark:hover:border-blue-900/60'
                      }`}
                    >
                      <span className="text-xs flex items-center gap-2">
                        <Sparkles className={`w-4 h-4 ${apiMode === 'official' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-neutral-500'}`} />
                        <span>{t('llm.mode_official')}</span>
                      </span>
                      {apiMode === 'official' && (
                        <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        </div>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setApiMode('custom')}
                      className={`p-3.5 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                        apiMode === 'custom'
                          ? 'bg-blue-50/70 dark:bg-blue-950/50 border-2 border-blue-600 text-blue-950 dark:text-blue-100 font-bold shadow-xs'
                          : 'bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-800 text-gray-700 dark:text-gray-300 hover:border-blue-300 dark:hover:border-blue-900/60'
                      }`}
                    >
                      <span className="text-xs flex items-center gap-2">
                        <KeyRound className={`w-4 h-4 ${apiMode === 'custom' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-neutral-500'}`} />
                        <span>{t('llm.mode_custom')}</span>
                      </span>
                      {apiMode === 'custom' && (
                        <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        </div>
                      )}
                    </button>
                  </div>
                </div>

                {apiMode === 'official' ? (
                  /* 官方接口：余额与兑换码 */
                  <div className="p-4 rounded-xl border border-blue-100 dark:border-blue-900/50 bg-gradient-to-br from-blue-50/50 via-white to-indigo-50/20 dark:from-blue-950/30 dark:via-[#1e1f20] dark:to-indigo-950/10 shadow-2xs space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-blue-100/80 dark:border-blue-900/30">
                      <div>
                        <div className="text-[11px] text-blue-700 dark:text-blue-400 font-semibold flex items-center gap-1.5">
                          <Coins className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          <span>{t('llm.official_balance')}</span>
                        </div>
                        <div className="text-2xl font-black font-mono tracking-tight text-blue-600 dark:text-blue-400 flex items-baseline gap-1 mt-0.5">
                          <span className="text-base font-normal">¥</span>
                          <span>{userBalance.toFixed(4)}</span>
                          <span className="text-xs font-normal text-gray-500 dark:text-neutral-400 ml-1">{t('settings.currency_yuan', '元')}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={fetchSettings}
                          className="px-3 py-1.5 text-xs text-blue-700 dark:text-blue-300 bg-white dark:bg-[#1a1b1e] border border-blue-200 dark:border-blue-800 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-950/60 font-semibold shadow-2xs transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          <span>{t('settings.refresh_bal', '刷新余额')}</span>
                        </button>
                      </div>
                    </div>

                    {/* 官方模型与计费单价透明展示 */}
                    {globalLlmInfo && (
                      <div className="p-2.5 rounded-xl bg-blue-50/50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 text-[11px] text-gray-600 dark:text-neutral-400 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-gray-700 dark:text-gray-300">{t('settings.curr_official_model', '当前官方模型:')}</span>
                          <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{globalLlmInfo.model}</span>
                        </div>
                        <div>
                          {globalLlmInfo.isDeepSeek ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-[10px] font-semibold font-mono border border-blue-200 dark:border-blue-800">
                              {t('settings.deepseek_pricing', 'DeepSeek 动态峰谷计费 (闲时/周末 5折)')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-neutral-400 text-[10px] font-medium font-mono">
                              {t('settings.official_rates_fmt', '输入 ¥{in}/M · 输出 ¥{out}/M · 缓存 ¥{cache}/M').replace('{in}', String(globalLlmInfo.priceInput)).replace('{out}', String(globalLlmInfo.priceOutput)).replace('{cache}', String(globalLlmInfo.priceCacheHit))}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {!hasGlobalLlm && (
                      <div className="p-3 rounded-xl bg-gray-50 dark:bg-neutral-800/40 border border-gray-200 dark:border-neutral-700 text-[11px] text-gray-700 dark:text-neutral-300 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 text-gray-400 dark:text-neutral-500" />
                        <span>{t('settings.no_global_api', '平台尚未配置全局官方接口，请联系管理员在后台配置全局 API。')}</span>
                      </div>
                    )}

                    {userBalance <= 0 && (
                      <div className="p-3 rounded-lg bg-gray-50 dark:bg-neutral-800/50 border border-gray-200 dark:border-neutral-700 text-gray-700 dark:text-neutral-300 text-xs flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                        <div>
                          <div className="font-semibold text-rose-600 dark:text-rose-400">{t('llm.official_balance_zero_tip')}</div>
                        </div>
                      </div>
                    )}

                    {/* 兑换码兑换输入 */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                        <Gift className="w-3.5 h-3.5 text-gray-400 dark:text-neutral-500" />
                        <span>{t('llm.official_redeem_title')}</span>
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={redeemCodeInput}
                          onChange={(e) => setRedeemCodeInput(e.target.value.toUpperCase())}
                          placeholder={t('llm.official_redeem_placeholder')}
                          className="flex-1 px-3 py-2 bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 rounded-xl font-mono text-xs text-gray-800 dark:text-gray-100 outline-none transition focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 uppercase"
                        />
                        <button
                          type="button"
                          onClick={handleRedeemCode}
                          disabled={redeeming || !redeemCodeInput.trim()}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-xs rounded-xl shadow-2xs transition flex items-center gap-1.5 cursor-pointer shrink-0"
                        >
                          {redeeming ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Coins className="w-3.5 h-3.5 text-white/80" />}
                          <span>{redeeming ? t('settings.redeeming', '兑换中...') : t('llm.official_redeem_btn')}</span>
                        </button>
                      </div>

                      {redeemResult && (
                        <div className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 animate-fadeIn ${
                          redeemResult.success
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                            : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
                        }`}>
                          {redeemResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
                          <span>{redeemResult.msg}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* 自定义 API 配置 */
                  <div className="space-y-4">
                    {/* 安全风险提示横幅 */}
                    <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-neutral-800/40 border border-gray-200 dark:border-neutral-700 text-gray-700 dark:text-neutral-300 text-xs flex items-start gap-2.5 leading-relaxed">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-gray-500 dark:text-neutral-400" />
                      <div>
                        <div className="font-semibold mb-0.5">{t('settings.security_warning_title', '安全风险提示')}</div>
                        <div className="text-[11px] opacity-90">{t('llm.custom_risk_warning')}</div>
                      </div>
                    </div>

                    <div className="space-y-1.5 pb-4 border-b border-gray-100 dark:border-neutral-800">
                      <label className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider block">
                        {t('llm.endpoint')}
                      </label>
                      <input
                        type="text"
                        value={llmEndpoint}
                        onChange={(e) => setLlmEndpoint(e.target.value)}
                        placeholder="https://api.deepseek.com/v1"
                        className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 outline-none transition focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                      <span className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1 block">Default: https://api.deepseek.com/v1</span>
                    </div>

                    <div className="space-y-1.5 pb-4 border-b border-gray-100 dark:border-neutral-800">
                      <label className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider block">
                        {t('llm.api_key')}
                      </label>
                      <input
                        type="password"
                        value={llmApiKey}
                        onChange={(e) => {
                          setLlmApiKey(e.target.value);
                          if (llmApiKeyValid) {
                            setLlmApiKeyValid(false);
                            localStorage.removeItem(`clawbot_llm_valid_${userId}`);
                          }
                        }}
                        placeholder={t('llm.api_key_placeholder')}
                        className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 outline-none transition focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                      <span className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1 block">{t('settings.custom_key_desc', '存储于独立隔离配置库中，供微信后台解析调用')}</span>
                    </div>

                    <div className="space-y-1.5 pb-4 border-b border-gray-100 dark:border-neutral-800">
                      <label className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider block">
                        {t('llm.model')}
                      </label>
                      <input
                        type="text"
                        value={llmModel}
                        onChange={(e) => setLlmModel(e.target.value)}
                        placeholder="deepseek-chat"
                        className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 outline-none transition focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                      <span className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1 block">{t('llm.model_tip')}</span>
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={handleTestLlmKey}
                        disabled={llmTesting || !llmApiKey.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-gray-800 dark:text-neutral-200 border border-gray-200 dark:border-neutral-700 font-medium text-xs rounded-xl shadow-2xs transition disabled:opacity-50 cursor-pointer"
                      >
                        {llmTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-gray-400 dark:text-neutral-500" />}
                        <span>{llmTesting ? t('llm.testing') : t('llm.test_btn')}</span>
                      </button>

                      {isLlmDone && (
                        <span className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-neutral-300 font-medium">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          <span>{t('llm.valid_badge')}</span>
                        </span>
                      )}
                    </div>

                    {llmTestResult && (
                      <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 animate-fadeIn ${
                        llmTestResult.success
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                          : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
                      }`}>
                        {llmTestResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
                        <span>{llmTestResult.msg}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* 用量与资费监控卡片 */}
                <div className="pt-6 border-t border-gray-100 dark:border-neutral-800 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Coins className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                        {t('llm.usage_title')}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={fetchLlmUsage}
                        disabled={llmUsageLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-gray-700 dark:text-neutral-300 transition cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 text-gray-400 dark:text-neutral-500 ${llmUsageLoading ? 'animate-spin' : ''}`} />
                        <span>{t('llm.refresh_usage')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleClearLlmUsage}
                        disabled={!llmUsageData?.summary?.totalRequests}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl text-gray-500 hover:text-rose-600 dark:text-neutral-400 dark:hover:text-rose-400 hover:bg-gray-100 dark:hover:bg-neutral-800 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{t('llm.clear_usage')}</span>
                      </button>
                    </div>
                  </div>

                  {/* 核心统计指标卡片 (总消费、输入 Tokens、输出 Tokens) */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-2xl bg-blue-50/40 dark:bg-blue-950/20 border border-blue-200/70 dark:border-blue-800/50 shadow-2xs">
                      <span className="text-[11px] text-blue-700 dark:text-blue-400 font-semibold flex items-center gap-1.5">
                        <DollarSign className="w-3.5 h-3.5" />
                        <span>{t('llm.total_cost')}</span>
                      </span>
                      <div className="text-xl font-bold font-mono text-blue-600 dark:text-blue-400 mt-1">
                        ¥{(llmUsageData?.summary?.totalCostCny || 0).toFixed(4)}
                      </div>
                      <div className="text-[10px] text-gray-500 dark:text-neutral-400 mt-1">
                        {t('settings.total_api_calls', '共 {count} 次 API 调用').replace('{count}', String(llmUsageData?.summary?.totalRequests || 0))}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-blue-50/40 dark:bg-blue-950/20 border border-blue-200/70 dark:border-blue-800/50 shadow-2xs">
                      <span className="text-[11px] text-blue-700 dark:text-blue-400 font-semibold flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5" />
                        <span>{t('settings.input_tokens_prompt', '输入 Tokens (Prompt)')}</span>
                      </span>
                      <div className="text-xl font-bold font-mono text-blue-600 dark:text-blue-400 mt-1">
                        {(llmUsageData?.summary?.promptTokens || 0).toLocaleString()}
                      </div>
                      <div className="text-[10px] text-gray-500 dark:text-neutral-400 mt-1 font-mono flex items-center gap-1.5">
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">{t('settings.cache_hit_fmt', '命中 {count}').replace('{count}', (llmUsageData?.summary?.cacheHitTokens || 0).toLocaleString())}</span>
                        <span className="text-gray-300 dark:text-neutral-600">·</span>
                        <span>{t('settings.cache_miss_fmt', '未中 {count}').replace('{count}', (llmUsageData?.summary?.cacheMissTokens || 0).toLocaleString())}</span>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-blue-50/40 dark:bg-blue-950/20 border border-blue-200/70 dark:border-blue-800/50 shadow-2xs">
                      <span className="text-[11px] text-blue-700 dark:text-blue-400 font-semibold flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{t('settings.output_tokens_label', '输出 Tokens (Output)')}</span>
                      </span>
                      <div className="text-xl font-bold font-mono text-blue-600 dark:text-blue-400 mt-1">
                        {(llmUsageData?.summary?.completionTokens || 0).toLocaleString()}
                      </div>
                      <div className="text-[10px] text-gray-400 dark:text-neutral-500 mt-1 font-mono">
                        {t('settings.total_consumed_fmt', '总消耗 {count} Tokens').replace('{count}', (llmUsageData?.summary?.totalTokens || 0).toLocaleString())}
                      </div>
                    </div>
                  </div>

                  {/* 每一天的消耗价格曲线图表 (前1天 / 前7天 / 前30天 可选择) */}
                  <CostCurveChart data={llmUsageData?.dailyHistory} loading={llmUsageLoading} />
                </div>
              </div>
            </div>
          )}

          {/* 5. External Calendar Subscriptions & Export */}
          {activeSection === 'calendar' && (
            <div className="space-y-6 animate-fadeIn">
              {renderCardHeader(
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Calendar className="w-5 h-5" />
                </div>,
                t('calendar.title')
              )}

              {/* 1. Export TODO link */}
              <div className="space-y-2 pb-6 border-b border-gray-100 dark:border-neutral-800 text-xs">
                <label className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider block">
                  {t('calendar.export_title')}
                </label>
                <div className="flex items-center gap-2 max-w-2xl">
                  <input
                    type="text"
                    readOnly
                    ref={icalInputRef}
                    value={icalExportUrl}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 rounded-xl font-mono text-xs text-gray-700 dark:text-neutral-300 select-all"
                  />
                  <button
                    type="button"
                    onClick={copyIcal}
                    className="px-4 py-2.5 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-800 dark:text-neutral-200 text-xs font-medium rounded-xl shrink-0 flex items-center gap-1.5 transition cursor-pointer border border-gray-200 dark:border-neutral-700"
                  >
                    {copiedIcal ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedIcal ? t('common.copied') : t('calendar.copy_btn')}</span>
                  </button>
                </div>
                <label className="text-xs font-medium text-gray-700 dark:text-neutral-300 block pt-2">{t('calendar.webcal_sub_link', 'Webcal 订阅链接')}</label>
                <div className="flex items-center gap-2 max-w-2xl">
                  <input type="text" readOnly ref={webcalInputRef} value={webcalUrl} aria-label={t('calendar.webcal_sub_link', 'Webcal 订阅链接')} className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 rounded-xl font-mono text-xs text-gray-700 dark:text-neutral-300 select-all" />
                  <button type="button" onClick={copyWebcal} className="px-4 py-2.5 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-800 dark:text-neutral-200 text-xs font-medium rounded-xl shrink-0 flex items-center gap-1.5 transition cursor-pointer border border-gray-200 dark:border-neutral-700">
                    {copiedWebcal ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedWebcal ? t('common.copied') : t('calendar.copy_btn')}</span>
                  </button>
                </div>
                {webcalUrl && <a href={webcalUrl} className="inline-block text-blue-600 dark:text-blue-400 hover:underline">{t('calendar.sub_in_calendar_app', '在日历应用中订阅')}</a>}
                {copyIcalError && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{copyIcalError}</p>}
              </div>

              {/* 2. Add external sub */}
              <div className="space-y-3 pb-6 border-b border-gray-100 dark:border-neutral-800 text-xs">
                <label className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider block">
                  {t('calendar.add_btn')}
                </label>
                <form onSubmit={handleAddSubscription} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 text-xs max-w-2xl">
                  <input
                    type="text"
                    value={newSubName}
                    onChange={(e) => setNewSubName(e.target.value)}
                    placeholder={t('calendar.name_placeholder')}
                    className="w-full sm:w-48 px-3.5 py-2.5 bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 rounded-xl text-gray-800 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    required
                  />
                  <input
                    type="text"
                    value={newSubUrl}
                    onChange={(e) => setNewSubUrl(e.target.value)}
                    placeholder={t('calendar.url_placeholder')}
                    className="w-full flex-1 px-3.5 py-2.5 bg-white dark:bg-[#1e1f20] border border-gray-300 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    required
                  />
                  <button
                    type="submit"
                    disabled={addingSub}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl shrink-0 transition disabled:opacity-50 cursor-pointer shadow-xs"
                  >
                    {addingSub ? t('calendar.adding') : t('calendar.add_btn')}
                  </button>
                </form>
              </div>

              {/* 3. Subscriptions list */}
              <div className="space-y-3 text-xs">
                <div className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider">
                  {t('calendar.list_title')}
                </div>
                {subs.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 dark:text-neutral-500 bg-gray-50/50 dark:bg-neutral-800/20 rounded-2xl border border-dashed border-gray-200 dark:border-neutral-800 text-xs">
                    {t('calendar.empty_list')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {subs.map((sub) => (
                      <div
                        key={sub.id}
                        className="flex items-center justify-between p-3.5 bg-gray-50/70 dark:bg-neutral-800/40 border border-gray-200/80 dark:border-neutral-700/80 rounded-xl"
                      >
                        <div className="space-y-1 max-w-xs sm:max-w-md truncate">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-900 dark:text-gray-100 text-xs">{sub.name}</span>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                sub.sync_status === 'ok'
                                  ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                              }`}
                            >
                              {sub.sync_status === 'ok' ? `OK (${sub.event_count})` : 'Error'}
                            </span>
                          </div>
                          <div className="font-mono text-[10px] text-gray-400 dark:text-neutral-500 truncate">
                            {sub.url}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void openSubPolicyModal(sub)}
                            className="p-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-full transition cursor-pointer"
                            title={t('calendar.sub_policy_settings', '提醒与可排程设置')}
                          >
                            <Settings className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSyncNow(sub.id)}
                            className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-full transition cursor-pointer"
                            title={t('calendar.sync_now')}
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSubscription(sub.id)}
                            className="p-2 text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-full transition cursor-pointer"
                            title={t('common.delete')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* 订阅提醒与可排程设置弹窗 */}
      {editingSubPolicy && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white dark:bg-[#1e1f20] rounded-3xl max-w-md w-full shadow-2xl border border-gray-200 dark:border-[#444746] overflow-hidden transition-colors">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-neutral-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor: isDark
                      ? `color-mix(in srgb, ${editingSubPolicy.color} 25%, #282a2c)`
                      : `color-mix(in srgb, ${editingSubPolicy.color} 15%, #ffffff)`,
                    color: editingSubPolicy.color,
                  }}
                >
                  <Calendar className="w-4 h-4" />
                </span>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                  {editingSubPolicy.sub.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingSubPolicy(null)}
                className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 transition cursor-pointer shrink-0"
                aria-label={t('common.close', '关闭')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div
                className={`rounded-xl p-3 transition-all duration-200 ${
                  editingSubPolicy.allowScheduling ? 'border border-dashed opacity-90' : 'border-l-[3.5px]'
                }`}
                style={{
                  borderColor: editingSubPolicy.allowScheduling ? editingSubPolicy.color : undefined,
                  borderLeftColor: editingSubPolicy.color,
                  backgroundColor: isDark
                    ? `color-mix(in srgb, ${editingSubPolicy.color} ${editingSubPolicy.allowScheduling ? '14%' : '35%'}, #1e1f20)`
                    : `color-mix(in srgb, ${editingSubPolicy.color} ${editingSubPolicy.allowScheduling ? '8%' : '18%'}, #ffffff)`,
                  color: isDark ? '#f3f4f6' : '#1f2937',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold truncate">{editingSubPolicy.sub.name}</span>
                  {editingSubPolicy.aiReminderEnabled ? (
                    <Bell className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  ) : (
                    <BellOff className="w-3.5 h-3.5 shrink-0 opacity-50" />
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-mono opacity-80">
                  <Calendar className="w-3.5 h-3.5 shrink-0" />
                  <span>{editingSubPolicy.sub.event_count} 个事件</span>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-gray-50/80 dark:bg-neutral-800/40 space-y-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={editingSubPolicy.allowScheduling}
                  onClick={() =>
                    setEditingSubPolicy((prev) =>
                      prev ? { ...prev, allowScheduling: !prev.allowScheduling } : null
                    )
                  }
                  className="w-full flex items-center justify-between gap-3 cursor-pointer select-none"
                >
                  <span className="flex items-center gap-2.5 text-xs font-medium text-gray-800 dark:text-neutral-200">
                    <CalendarCheck2
                      className={`w-4 h-4 transition-colors ${
                        editingSubPolicy.allowScheduling
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-gray-400 dark:text-neutral-500'
                      }`}
                    />
                    <span>{t('calendar.schedulable_label', '可排程')}</span>
                  </span>
                  <span
                    className={`relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full transition-colors ${
                      editingSubPolicy.allowScheduling
                        ? 'bg-emerald-500 dark:bg-emerald-600'
                        : 'bg-gray-300 dark:bg-neutral-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                        editingSubPolicy.allowScheduling ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </span>
                </button>

                <div className="border-t border-gray-200/60 dark:border-neutral-700/60 pt-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={editingSubPolicy.aiReminderEnabled}
                    onClick={() =>
                      setEditingSubPolicy((prev) =>
                        prev ? { ...prev, aiReminderEnabled: !prev.aiReminderEnabled } : null
                      )
                    }
                    className="w-full flex items-center justify-between gap-3 cursor-pointer select-none"
                  >
                    <span className="flex items-center gap-2.5 text-xs font-medium text-gray-800 dark:text-neutral-200">
                      {editingSubPolicy.aiReminderEnabled ? (
                        <Bell className="w-4 h-4 text-blue-600 dark:text-blue-400 transition-colors" />
                      ) : (
                        <BellOff className="w-4 h-4 text-gray-400 dark:text-neutral-500 transition-colors" />
                      )}
                      <span>{t('calendar.event_reminder_label', '事件提醒')}</span>
                    </span>
                    <span
                      className={`relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full transition-colors ${
                        editingSubPolicy.aiReminderEnabled
                          ? 'bg-blue-600 dark:bg-blue-500'
                          : 'bg-gray-300 dark:bg-neutral-600'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                          editingSubPolicy.aiReminderEnabled ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 dark:border-neutral-800 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={savingSubPolicy}
                onClick={() => setEditingSubPolicy(null)}
                className="px-3.5 py-1.5 text-xs font-medium text-gray-600 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition cursor-pointer"
              >
                {t('common.cancel', '取消')}
              </button>
              <button
                type="button"
                disabled={savingSubPolicy}
                onClick={() => void handleSaveSubPolicy()}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                {savingSubPolicy ? t('common.saving', '保存中...') : t('common.save', '保存')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 注销账号确认弹窗 */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-800 rounded-3xl p-6 sm:p-7 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
                  {t('settings.delete_modal_title', '确认注销删除账号？')}
                </h3>
                <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">
                  {t('settings.delete_modal_warning', '⚠️ 警告：注销后，您账号下的全部任务待办、外部日历同步、微信配置以及 API 用量数据将被彻底物理清除，且无法以任何方式找回！')}
                </p>
              </div>
            </div>

            {deleteError && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-neutral-300 mb-1.5">
                {t('settings.delete_modal_pwd_prompt', '请输入当前登录密码以验证身份：')}
              </label>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder={t('settings.delete_modal_pwd_placeholder', '请输入密码')}
                className="w-full px-3.5 py-2.5 text-xs bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 text-gray-900 dark:text-gray-100 rounded-xl focus:bg-white dark:focus:bg-[#1e1f20] outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-gray-700 dark:text-neutral-300 transition cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deletingAccount || !deletePassword}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-rose-600 hover:bg-rose-700 text-white transition disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {deletingAccount ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>{deletingAccount ? t('settings.deleting_account', '正在注销...') : t('settings.confirm_delete_forever', '确认彻底注销')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
