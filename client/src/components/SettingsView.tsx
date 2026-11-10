import React, { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../api/client';
import { QRCodeSVG } from 'qrcode.react';
import {
  Bot,
  Brain,
  Calendar,
  Clock,
  Copy,
  Check,
  RefreshCw,
  Save,
  CheckCircle2,
  AlertCircle,
  QrCode,
  Send,
  LogOut,
  Trash2,
  Bell,
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
    return { slots: [], visualSlots: [], totalMinutes: 0, error: '请输入工作时间段' };
  }

  // Support English comma, Chinese comma, semicolons, and newlines
  const parts = trimmed.split(/[,，;\n\r]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { slots: [], visualSlots: [], totalMinutes: 0, error: '请输入工作时间段' };
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
        error: `时段 "${part}" 格式不正确，请使用形如 00:00-02:00, 13:00-18:00 的格式`,
      };
    }

    const sh = parseInt(match[1], 10);
    const sm = parseInt(match[2], 10);
    const eh = parseInt(match[3], 10);
    const em = parseInt(match[4], 10);

    if (sh < 0 || sh > 24 || sm < 0 || sm > 59) {
      return { slots: [], visualSlots: [], totalMinutes: 0, error: `时段 "${part}" 开始时间无效` };
    }
    if (eh < 0 || eh > 24 || em < 0 || em > 59) {
      return { slots: [], visualSlots: [], totalMinutes: 0, error: `时段 "${part}" 结束时间无效` };
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

export const SettingsView: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [activeSection, setActiveSection] = useState<'weixin' | 'scheduler' | 'notification' | 'llm' | 'calendar'>('weixin');

  // Weixin Clawbot Integration State
  const [wxConnected, setWxConnected] = useState(false);
  const [wxUserId, setWxUserId] = useState('');
  const [wxNickname, setWxNickname] = useState('');
  const [, setQrCode] = useState('');
  const [qrCodeImgContent, setQrCodeImgContent] = useState('');
  const [qrStatus, setQrStatus] = useState<'idle' | 'loading' | 'wait' | 'scaned' | 'confirmed' | 'expired'>('idle');
  const [qrStatusMsg, setQrStatusMsg] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // LLM fields
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
  const [remindEnd, setRemindEnd] = useState<number>(5);
  const [calSyncInterval, setCalSyncInterval] = useState<number>(30);

  // Calendar feeds
  const [subs, setSubs] = useState<CalendarSub[]>([]);
  const [newSubName, setNewSubName] = useState('');
  const [newSubUrl, setNewSubUrl] = useState('');
  const [addingSub, setAddingSub] = useState(false);

  // iCal export urls
  const [icalExportUrl, setIcalExportUrl] = useState('');
  const [copiedIcal, setCopiedIcal] = useState(false);

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
      const { settings, urls } = res.data;
      if (settings) {
        setLlmEndpoint(settings.llm_endpoint || 'https://api.deepseek.com/v1');
        setLlmApiKey(settings.llm_api_key || '');
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
        setRemindEnd(settings.reminder_before_end_minutes ?? 5);
        setCalSyncInterval(settings.calendar_sync_interval_minutes ?? 30);
      }

      if (urls?.icalSubscriptionUrl) {
        setIcalExportUrl(urls.icalSubscriptionUrl);
      }

      if (!settings?.weixin_connected) {
        fetchQrCode();
      }
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
      setQrStatusMsg('正在向微信服务器申请登录二维码...');
      const res = await api.get('/weixin/qrcode');
      const { qrcode, qrcodeUrl, qrcode_img_content } = res.data;
      setQrCode(qrcode);
      setQrCodeImgContent(qrcodeUrl || qrcode_img_content);
      setQrStatus('wait');
      setQrStatusMsg('请打开手机微信【扫一扫】屏幕二维码');

      pollTimerRef.current = setInterval(() => {
        checkQrStatus(qrcode);
      }, 2500);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      setQrStatus('idle');
      setQrStatusMsg('获取二维码失败: ' + (error.response?.data?.error || error.message || '网络错误'));
    }
  };

  const checkQrStatus = async (code: string) => {
    try {
      const res = await api.get(`/weixin/status?qrcode=${encodeURIComponent(code)}`);
      const data = res.data;

      if (data.status === 'scaned') {
        setQrStatus('scaned');
        setQrStatusMsg('已扫码！请在手机微信上点击【允许】以完成配对...');
      } else if (data.status === 'confirmed') {
        setQrStatus('confirmed');
        setQrStatusMsg('配对成功！已连接微信助手');
        setWxConnected(true);
        setWxUserId(data.weixinUserId || data.user_id || '');
        setWxNickname(data.nickname || '');

        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      } else if (data.status === 'expired') {
        setQrStatus('expired');
        setQrStatusMsg('二维码已过期，请点击重新获取');
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
    if (!confirm('确定要解除当前微信配对吗？解除后机器人将停止微信通知。')) return;
    try {
      await api.post('/weixin/unbind');
      setWxConnected(false);
      setWxUserId('');
      setWxNickname('');
      fetchQrCode();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      alert('解绑失败: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleSendTestMessage = async () => {
    try {
      setTestSending(true);
      setTestResult(null);
      const res = await api.post('/weixin/test-message');
      setTestResult(res.data.message || '测试消息已成功推送！');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      setTestResult('发送失败: ' + (error.response?.data?.error || error.message));
    } finally {
      setTestSending(false);
    }
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedSlotsInfo.error) {
      alert('工作时间段格式有误：' + parsedSlotsInfo.error);
      return;
    }

    setSaving(true);
    setSaveSuccess(false);

    try {
      await api.put('/settings', {
        llm_endpoint: llmEndpoint,
        llm_api_key: llmApiKey,
        llm_model: llmModel,
        work_slots: parsedSlotsInfo.slots,
        task_buffer_minutes: Number(taskBuffer),
        reminder_before_start_minutes: Number(remindStart),
        reminder_before_end_minutes: Number(remindEnd),
        calendar_sync_interval_minutes: Number(calSyncInterval),
      });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      alert('保存失败：' + (error.response?.data?.error || error.message || '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  const handleAddSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubName.trim() || !newSubUrl.trim()) return;

    setAddingSub(true);
    try {
      await api.post('/calendar/subscriptions', {
        name: newSubName.trim(),
        url: newSubUrl.trim(),
      });
      setNewSubName('');
      setNewSubUrl('');
      fetchSubs();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      alert('添加失败：' + (error.response?.data?.error || error.message));
    } finally {
      setAddingSub(false);
    }
  };

  const handleDeleteSubscription = async (id: number) => {
    if (!confirm('确定要删除此外部日历吗？相关的事件缓存也将被移除。')) return;
    try {
      await api.delete(`/calendar/subscriptions/${id}`);
      fetchSubs();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      alert('删除失败：' + (error.response?.data?.error || error.message));
    }
  };

  const handleSyncNow = async (id: number) => {
    try {
      await api.post(`/calendar/subscriptions/${id}/sync`);
      fetchSubs();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      alert('同步失败：' + (error.response?.data?.error || error.message));
    }
  };

  const copyIcal = () => {
    navigator.clipboard.writeText(icalExportUrl);
    setCopiedIcal(true);
    setTimeout(() => setCopiedIcal(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[360px]">
        <div className="flex items-center gap-3 text-gray-500 dark:text-neutral-400 font-medium text-sm">
          <RefreshCw className="w-5 h-5 animate-spin text-blue-600 dark:text-blue-400" />
          <span>正在读取设置...</span>
        </div>
      </div>
    );
  }

  const navMenuItems = [
    {
      id: 'weixin' as const,
      label: '微信 Clawbot 对接',
      desc: '扫码配对与微信消息通知',
      icon: Bot,
      badge: wxConnected ? '已连接' : '待配对',
      badgeColor: wxConnected
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300'
        : 'bg-amber-100 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300',
    },
    {
      id: 'scheduler' as const,
      label: '日程规划算法偏好',
      desc: '作息时段与 24h 可视化',
      icon: Clock,
    },
    {
      id: 'notification' as const,
      label: '提醒通知与前置周期',
      desc: '任务开始/结束提前提醒',
      icon: Bell,
    },
    {
      id: 'llm' as const,
      label: '大模型 DeepSeek',
      desc: '语义抽取与任务解析 API',
      icon: Brain,
      badge: llmApiKey ? '已配置' : '未设置',
      badgeColor: llmApiKey
        ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/80 dark:text-blue-300'
        : 'bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-neutral-400',
    },
    {
      id: 'calendar' as const,
      label: '外部日历订阅源',
      desc: '双向防冲突与 iCal 导出',
      icon: Calendar,
      badge: subs.length > 0 ? `${subs.length}个源` : undefined,
      badgeColor: 'bg-purple-100 text-purple-700 dark:bg-purple-950/80 dark:text-purple-300',
    },
  ];

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col space-y-3 sm:space-y-4 overflow-hidden">
      {/* Page Header (Google Tasks Style) */}
      <div className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            设置与偏好配置
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-neutral-400 mt-0.5">
            管理微信配对、日程规划偏好、提醒周期与大模型参数
          </p>
        </div>

        <button
          onClick={handleSavePreferences}
          disabled={saving}
          className="flex items-center justify-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-medium text-xs sm:text-sm rounded-full shadow-xs transition disabled:opacity-50 cursor-pointer self-start sm:self-auto"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>{saving ? '保存中...' : '保存更改'}</span>
        </button>
      </div>

      {saveSuccess && (
        <div className="shrink-0 flex items-center gap-2.5 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300 rounded-2xl text-xs sm:text-sm font-medium animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>配置已成功保存！算法排程与微信提醒设置已即时生效。</span>
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
              {item.badge && (
                <span className={`text-[9px] px-1.5 py-0.2 rounded-full ${isActive ? 'bg-white/20 text-white' : item.badgeColor}`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Left-Right Split Layout */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 items-stretch overflow-hidden">
        {/* Left Column: Vertical Nav List */}
        <aside className="hidden lg:flex flex-col w-72 xl:w-80 shrink-0 bg-white dark:bg-[#1e1f20] rounded-2xl border border-gray-200/80 dark:border-neutral-800/80 p-3 shadow-xs space-y-1.5 overflow-y-auto scrollbar-thin">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 dark:text-neutral-500 px-3 py-1.5">
            配置目录
          </div>
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
                    {item.badge && (
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono shrink-0 ${item.badgeColor}`}>
                        {item.badge}
                      </span>
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
        <section className="flex-1 min-w-0 bg-white dark:bg-[#1e1f20] rounded-2xl border border-gray-200/80 dark:border-neutral-800/80 p-5 sm:p-7 shadow-xs overflow-y-auto transition-colors scrollbar-thin">
          {/* 1. WeChat Pairing Section */}
          {activeSection === 'weixin' && (
            <div className="space-y-5 animate-fadeIn">
              <div className="flex items-center gap-3 pb-4 border-b border-gray-100 dark:border-neutral-800">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">微信 Clawbot 对接</h2>
                    {wxConnected ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        已连接
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300">
                        等待扫码配对
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-neutral-400 mt-0.5">
                    扫码绑定个人微信，日程提醒、排程进度与长图预览将直接下发到手机微信
                  </p>
                </div>
              </div>

              {wxConnected ? (
                <div className="bg-gray-50 dark:bg-[#28292a] border border-gray-200/80 dark:border-neutral-700/80 rounded-2xl p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-base shadow-xs">
                        {wxNickname ? wxNickname.slice(0, 1).toUpperCase() : 'W'}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                          {wxNickname ? `已绑定微信：${wxNickname}` : '已绑定微信账号'}
                        </h3>
                        <p className="text-xs font-mono text-gray-500 dark:text-neutral-400 mt-0.5 truncate max-w-sm">
                          通讯 ID: {wxUserId || '已加密保护'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={handleSendTestMessage}
                        disabled={testSending}
                        className="flex items-center gap-1.5 px-4 py-2 bg-white dark:bg-[#1e1f20] hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-700 dark:text-neutral-200 border border-gray-200 dark:border-neutral-700 font-medium text-xs rounded-full shadow-2xs transition disabled:opacity-50 cursor-pointer"
                      >
                        {testSending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />}
                        <span>{testSending ? '发送中...' : '测试微信通知'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleUnbindWeixin}
                        className="flex items-center gap-1.5 px-4 py-2 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 font-medium text-xs rounded-full transition cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>解绑账号</span>
                      </button>
                    </div>
                  </div>

                  {testResult && (
                    <div className="text-xs p-3 bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-700 dark:text-neutral-200 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{testResult}</span>
                    </div>
                  )}

                  <div className="text-xs text-gray-600 dark:text-neutral-400 bg-white/80 dark:bg-[#1e1f20]/60 p-4 rounded-xl border border-gray-200/50 dark:border-neutral-700/50 leading-relaxed space-y-2">
                    <div className="font-semibold text-gray-800 dark:text-neutral-200 flex items-center gap-1.5">
                      <span>💡 微信机器人使用指南与指令：</span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-xs pl-1">
                      <li>
                        <strong className="text-gray-800 dark:text-gray-200">安排日程：</strong>发送如“帮我安排明天下午写报告两小时，加急5分，周三前交”，AI 自动提取关键要素并插入空闲时段。
                      </li>
                      <li>
                        <strong className="text-gray-800 dark:text-gray-200">查看日历：</strong>发送“查看日历”，Clawbot 将即时生成当天日历日程图片发送至微信。
                      </li>
                      <li>
                        <strong className="text-gray-800 dark:text-gray-200">查看任务：</strong>发送“查看任务”，Clawbot 将生成四象限 Todo List 视觉卡片发送至微信。
                      </li>
                      <li>
                        <strong className="text-gray-800 dark:text-gray-200">任务结项：</strong>在任务结束前收到询问时，回复“已完成”即可快速更新状态。
                      </li>
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col md:flex-row items-center gap-6 bg-gray-50/70 dark:bg-[#28292a]/50 border border-gray-200/80 dark:border-neutral-700/80 rounded-2xl p-6">
                  {/* QR Container */}
                  <div className="flex flex-col items-center shrink-0">
                    <div className="w-48 h-48 bg-white p-3 rounded-2xl border-2 border-dashed border-gray-300 shadow-2xs flex items-center justify-center relative overflow-hidden">
                      {qrStatus === 'loading' && (
                        <div className="flex flex-col items-center gap-2 text-gray-400 text-xs">
                          <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
                          <span>正在获取登录二维码...</span>
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
                            <div className="text-xs text-gray-400">二维码加载中...</div>
                          )}

                          {qrStatus === 'scaned' && (
                            <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center text-center p-2 rounded-xl">
                              <CheckCircle2 className="w-8 h-8 text-emerald-600 animate-bounce mb-1" />
                              <span className="text-sm font-bold text-gray-900">扫码成功</span>
                              <span className="text-xs text-gray-500">请在手机微信上点击【确认】</span>
                            </div>
                          )}
                        </div>
                      )}

                      {qrStatus === 'expired' && (
                        <div className="flex flex-col items-center gap-2 text-center p-3">
                          <AlertCircle className="w-8 h-8 text-amber-500" />
                          <span className="text-xs text-gray-600 font-semibold">二维码已过期</span>
                          <button
                            onClick={fetchQrCode}
                            className="text-xs text-blue-600 hover:underline font-bold"
                          >
                            点击重新生成
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
                      <span>刷新二维码</span>
                    </button>
                  </div>

                  {/* Steps */}
                  <div className="space-y-3 text-xs flex-1">
                    <div>
                      <div className="flex items-center gap-2 font-bold text-sm text-gray-900 dark:text-gray-100 mb-1">
                        <QrCode className="w-4 h-4 text-emerald-600" />
                        <span>微信扫码免密配对流程</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-neutral-400 leading-relaxed">
                        手机微信扫一扫即可配对微信 Clawbot，实现日程双向联动：
                      </p>
                    </div>

                    <ol className="space-y-1.5 text-xs text-gray-600 dark:text-neutral-300 list-decimal list-inside leading-relaxed pl-1">
                      <li>手机打开微信，点击右上角【+】号选择【扫一扫】；</li>
                      <li>扫描左侧二维码，在手机上确认【允许】；</li>
                      <li>配对完成后系统将自动开启微信消息监听与主动任务提醒服务。</li>
                    </ol>

                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/60 rounded-xl text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                      <span>当前状态：{qrStatusMsg}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. Scheduler Work Slots & Visual Timeline */}
          {activeSection === 'scheduler' && (
            <div className="space-y-5 animate-fadeIn">
              <div className="flex items-center gap-3 pb-4 border-b border-gray-100 dark:border-neutral-800">
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
                    日程规划算法偏好
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-neutral-400 mt-0.5">
                    配置工作作息时段、24小时可用工时分布与任务缓冲间隔
                  </p>
                </div>
              </div>

              {/* Manual Work Slots Input */}
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5 mb-1.5">
                    <span>自定义工作时段 (手动输入)</span>
                  </label>
                  <input
                    type="text"
                    value={workSlotsText}
                    onChange={(e) => setWorkSlotsText(e.target.value)}
                    placeholder="00:00-02:00, 13:00-18:00"
                    className={`w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#28292a] border rounded-xl font-mono text-xs text-gray-800 dark:text-gray-100 focus:bg-white dark:focus:bg-[#232425] outline-none transition ${
                      parsedSlotsInfo.error
                        ? 'border-rose-300 dark:border-rose-700 focus:ring-2 focus:ring-rose-400/20'
                        : 'border-gray-200 dark:border-neutral-700/80 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                    }`}
                  />
                  {parsedSlotsInfo.error ? (
                    <p className="text-xs text-rose-600 dark:text-rose-400 font-medium mt-1.5 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{parsedSlotsInfo.error}</span>
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-neutral-500 mt-1.5">
                      格式形如 <span className="font-mono text-gray-600 dark:text-neutral-300 font-semibold">00:00-02:00, 13:00-18:00</span>。日程将只安排在亮色时段中，支持跨夜与多时段。
                    </p>
                  )}
                </div>

                {/* 24-Hour Timeline Visual Progress Bar */}
                <div className="p-4 bg-gray-50/90 dark:bg-[#28292a]/60 rounded-2xl border border-gray-200/80 dark:border-neutral-700/80 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-gray-800 dark:text-gray-200">24h 规划分布</span>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 dark:bg-blue-500 inline-block shadow-2xs" />
                          <span className="font-semibold text-blue-700 dark:text-blue-300">亮色: 可安排</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-xs bg-gray-300 dark:bg-neutral-700 border border-gray-400/40 inline-block" />
                          <span className="text-gray-500 dark:text-neutral-400">灰色: 休息</span>
                        </span>
                      </div>
                    </div>

                    {!parsedSlotsInfo.error && (
                      <div className="text-xs text-gray-500 dark:text-neutral-400 font-medium">
                        今日工时：<span className="font-bold text-blue-600 dark:text-blue-400">{(parsedSlotsInfo.totalMinutes / 60).toFixed(1)}h</span> / 24h
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
                          title={`可安排时段：${slot.label} (共 ${durationHours} 小时)`}
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

                {/* Buffer Setting */}
                <div className="pt-2">
                  <label className="block font-semibold text-gray-700 dark:text-neutral-300 mb-1 text-xs">
                    任务缓冲间隔 (分钟)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    value={taskBuffer}
                    onChange={(e) => setTaskBuffer(Number(e.target.value))}
                    className="w-full sm:w-60 px-3.5 py-2 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 text-xs"
                  />
                  <p className="text-xs text-gray-400 dark:text-neutral-500 mt-1">
                    两个任务之间自动预留的切换与休息间隔（建议 10-15 分钟）
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 3. Notification & Reminder Cycles */}
          {activeSection === 'notification' && (
            <div className="space-y-5 animate-fadeIn">
              <div className="flex items-center gap-3 pb-4 border-b border-gray-100 dark:border-neutral-800">
                <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                  <Bell className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
                    提醒通知与前置周期
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-neutral-400 mt-0.5">
                    设置任务开始前与结束前主动推送微信通知的提前量与防重复策略
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs">
                {/* Start reminder */}
                <div className="p-4 bg-gray-50/80 dark:bg-[#28292a]/50 rounded-2xl border border-gray-200/80 dark:border-neutral-700/80 space-y-3">
                  <div>
                    <label className="block font-bold text-gray-800 dark:text-gray-200 mb-1">
                      开始前微信提醒 (分钟)
                    </label>
                    <p className="text-xs text-gray-500 dark:text-neutral-400 mb-2">
                      在任务即将开始前通过微信通知您准备开始
                    </p>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={remindStart}
                      onChange={(e) => setRemindStart(Number(e.target.value))}
                      className="w-full px-3.5 py-2 bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {[5, 10, 15, 30].map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => setRemindStart(mins)}
                        className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition cursor-pointer ${
                          remindStart === mins
                            ? 'bg-blue-600 text-white'
                            : 'bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-700 text-gray-600 dark:text-neutral-300'
                        }`}
                      >
                        {mins} 分钟
                      </button>
                    ))}
                  </div>
                </div>

                {/* End reminder */}
                <div className="p-4 bg-gray-50/80 dark:bg-[#28292a]/50 rounded-2xl border border-gray-200/80 dark:border-neutral-700/80 space-y-3">
                  <div>
                    <label className="block font-bold text-gray-800 dark:text-gray-200 mb-1">
                      结束前微信确认 (分钟)
                    </label>
                    <p className="text-xs text-gray-500 dark:text-neutral-400 mb-2">
                      在任务到期前询问完成情况，可回复“已完成”结项
                    </p>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={remindEnd}
                      onChange={(e) => setRemindEnd(Number(e.target.value))}
                      className="w-full px-3.5 py-2 bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {[3, 5, 10, 15].map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => setRemindEnd(mins)}
                        className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition cursor-pointer ${
                          remindEnd === mins
                            ? 'bg-blue-600 text-white'
                            : 'bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-700 text-gray-600 dark:text-neutral-300'
                        }`}
                      >
                        {mins} 分钟
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Notification Mechanism Card */}
              <div className="p-4 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 rounded-2xl space-y-2 text-xs">
                <div className="font-bold text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span>微信智能提醒策略机制已就绪：</span>
                </div>
                <p className="text-blue-800/80 dark:text-blue-300/80 leading-relaxed">
                  系统每 30 秒执行一次精准日程核验。当任务到达设定的前置时间窗口时，将<strong className="text-blue-950 dark:text-blue-100">仅发送一次</strong>微信通知并原子记录状态，避免任何重复刷屏打扰。
                </p>
              </div>
            </div>
          )}

          {/* 4. LLM Config Section */}
          {activeSection === 'llm' && (
            <div className="space-y-5 animate-fadeIn">
              <div className="flex items-center gap-3 pb-4 border-b border-gray-100 dark:border-neutral-800">
                <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <Brain className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
                    大语言模型配置 (LLM)
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-neutral-400 mt-0.5">
                    从微信用户消息中抽取任务名称、预计耗时、加急度、重要度与截止时间 (DDL)
                  </p>
                </div>
              </div>

              <div className="space-y-4 text-xs max-w-xl">
                <div>
                  <label className="block font-semibold text-gray-700 dark:text-neutral-300 mb-1.5">
                    API 端点 (Base URL)
                  </label>
                  <input
                    type="text"
                    value={llmEndpoint}
                    onChange={(e) => setLlmEndpoint(e.target.value)}
                    placeholder="https://api.deepseek.com/v1"
                    className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 outline-none transition focus:bg-white dark:focus:bg-[#232425] focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                  <span className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1 block">默认预设为 DeepSeek 官方端点</span>
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 dark:text-neutral-300 mb-1.5">
                    API 密钥 (API Key)
                  </label>
                  <input
                    type="password"
                    value={llmApiKey}
                    onChange={(e) => setLlmApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 outline-none transition focus:bg-white dark:focus:bg-[#232425] focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                  <span className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1 block">安全存储在服务器 SQLite 数据库中并按用户完全隔离</span>
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 dark:text-neutral-300 mb-1.5">
                    模型型号 (Model)
                  </label>
                  <input
                    type="text"
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    placeholder="deepseek-chat"
                    className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 outline-none transition focus:bg-white dark:focus:bg-[#232425] focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                  <span className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1 block">推荐 deepseek-chat 或兼容 OpenAI 的模型名称</span>
                </div>
              </div>
            </div>
          )}

          {/* 5. External Calendar Subscriptions & Export */}
          {activeSection === 'calendar' && (
            <div className="space-y-5 animate-fadeIn">
              <div className="flex items-center gap-3 pb-4 border-b border-gray-100 dark:border-neutral-800">
                <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
                    外部日历与订阅同步
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-neutral-400 mt-0.5">
                    导入外部日历自动避开日程冲突 · 导出专属 TODO 订阅链接至手机日历
                  </p>
                </div>
              </div>

              {/* Export TODO link */}
              <div className="p-4 bg-gray-50 dark:bg-[#28292a] rounded-2xl border border-gray-200/80 dark:border-neutral-700/80 space-y-2 text-xs">
                <label className="block font-bold text-gray-800 dark:text-neutral-200 text-xs">
                  TODO 专属日历订阅 (导出至 iPhone / Mac / Google Calendar)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={icalExportUrl}
                    className="w-full px-3.5 py-2 bg-white dark:bg-[#232425] border border-gray-200 dark:border-neutral-700 rounded-xl font-mono text-xs text-gray-700 dark:text-neutral-300 select-all"
                  />
                  <button
                    type="button"
                    onClick={copyIcal}
                    className="px-4 py-2 bg-gray-200 dark:bg-neutral-700 hover:bg-gray-300 dark:hover:bg-neutral-600 text-gray-800 dark:text-neutral-200 text-xs font-medium rounded-xl shrink-0 flex items-center gap-1.5 transition cursor-pointer"
                  >
                    {copiedIcal ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedIcal ? '已复制' : '复制'}</span>
                  </button>
                </div>
              </div>

              {/* Add external sub */}
              <form onSubmit={handleAddSubscription} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 text-xs">
                <input
                  type="text"
                  value={newSubName}
                  onChange={(e) => setNewSubName(e.target.value)}
                  placeholder="日历名称 (如: 日常会议)"
                  className="w-full sm:w-48 px-3.5 py-2 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-800 dark:text-gray-100 outline-none"
                  required
                />
                <input
                  type="text"
                  value={newSubUrl}
                  onChange={(e) => setNewSubUrl(e.target.value)}
                  placeholder="订阅链接 (webcal://... 或 https://...ics)"
                  className="w-full px-3.5 py-2 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 outline-none"
                  required
                />
                <button
                  type="submit"
                  disabled={addingSub}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl shrink-0 transition disabled:opacity-50 cursor-pointer"
                >
                  {addingSub ? '添加中...' : '添加日历'}
                </button>
              </form>

              {/* Subscriptions list */}
              <div className="space-y-2.5 text-xs">
                <div className="font-semibold text-gray-700 dark:text-neutral-300">已订阅日历源列表：</div>
                {subs.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 dark:text-neutral-500 bg-gray-50 dark:bg-[#28292a]/50 rounded-2xl border border-dashed border-gray-200 dark:border-neutral-800 text-xs">
                    暂未导入外部日历。填入 Apple / Google 日历订阅链接即可自动规避已有日程。
                  </div>
                ) : (
                  subs.map((sub) => (
                    <div
                      key={sub.id}
                      className="flex items-center justify-between p-3.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200/80 dark:border-neutral-700/80 rounded-xl"
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
                            {sub.sync_status === 'ok' ? `正常 (${sub.event_count}条)` : '异常'}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-gray-400 dark:text-neutral-500 truncate">
                          {sub.url}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleSyncNow(sub.id)}
                          className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-full transition cursor-pointer"
                          title="立即同步"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSubscription(sub.id)}
                          className="p-2 text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-full transition cursor-pointer"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
