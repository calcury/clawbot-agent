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
  ExternalLink,
  Trash2,
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

  return (
    <div className="max-w-4xl mx-auto space-y-6 sm:space-y-8">
      {/* Page Header (Google Tasks Style) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            设置与配置
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-neutral-400 mt-1">
            管理微信配对、大模型参数、日程规划算法偏好及外部日历同步
          </p>
        </div>

        <button
          onClick={handleSavePreferences}
          disabled={saving}
          className="flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-medium text-sm rounded-full shadow-sm transition disabled:opacity-50 cursor-pointer self-start sm:self-auto"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>{saving ? '保存中...' : '保存更改'}</span>
        </button>
      </div>

      {saveSuccess && (
        <div className="flex items-center gap-2.5 p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300 rounded-2xl text-xs sm:text-sm font-medium animate-fadeIn">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>配置已成功保存！算法排程与微信提醒设置已即时生效。</span>
        </div>
      )}

      {/* 1. WeChat Pairing Section */}
      <section className="bg-white dark:bg-[#1e1f20] rounded-3xl p-5 sm:p-7 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs space-y-5 transition-colors">
        <div className="flex items-center gap-3 pb-4 border-b border-gray-100 dark:border-neutral-800">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100">微信 Clawbot 对接</h2>
              {wxConnected ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  已连接
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300">
                  等待扫码配对
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-neutral-400 mt-0.5">
              扫码即可将助手绑定到微信，用户会话独立隔离，日程提醒将直接推送到手机
            </p>
          </div>
        </div>

        <div>
          {wxConnected ? (
            <div className="bg-gray-50 dark:bg-[#28292a] border border-gray-200/80 dark:border-neutral-700/80 rounded-2xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-base shadow-xs">
                    {wxNickname ? wxNickname.slice(0, 1).toUpperCase() : 'W'}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                      {wxNickname ? `已绑定微信：${wxNickname}` : '已绑定微信账号'}
                    </h3>
                    <p className="text-xs font-mono text-gray-500 dark:text-neutral-400 mt-0.5 truncate max-w-xs sm:max-w-md">
                      通讯 ID: {wxUserId || '已加密保护'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 flex-wrap">
                  <button
                    type="button"
                    onClick={handleSendTestMessage}
                    disabled={testSending}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-white dark:bg-[#1e1f20] hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-700 dark:text-neutral-200 border border-gray-200 dark:border-neutral-700 font-medium text-xs rounded-full shadow-2xs transition disabled:opacity-50"
                  >
                    {testSending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />}
                    <span>{testSending ? '发送中...' : '发送测试微信'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleUnbindWeixin}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 font-medium text-xs rounded-full transition"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>解除配对</span>
                  </button>
                </div>
              </div>

              {testResult && (
                <div className="text-xs p-3 bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-700 dark:text-neutral-200 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{testResult}</span>
                </div>
              )}

              <div className="text-xs text-gray-500 dark:text-neutral-400 bg-white/70 dark:bg-[#1e1f20]/60 p-3.5 rounded-xl border border-gray-200/50 dark:border-neutral-700/50 leading-relaxed">
                💡 <span className="font-semibold text-gray-700 dark:text-neutral-200">使用提示：</span>微信中向此 Clawbot 发送日程安排要求（例如：“帮我安排明天下午写报告两小时，加急5分，周三前交”），机器人将自动抽取字段并在后台安排时间，并在开始/结束前通过微信主动提醒。
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-6 bg-gray-50/70 dark:bg-[#28292a]/50 border border-gray-200/80 dark:border-neutral-700/80 rounded-2xl p-5 sm:p-7">
              {/* QR Container (Always clean white for camera scanning) */}
              <div className="flex flex-col items-center shrink-0">
                <div className="w-48 h-48 bg-white p-3 rounded-2xl border-2 border-dashed border-gray-300 shadow-sm flex items-center justify-center relative overflow-hidden">
                  {qrStatus === 'loading' && (
                    <div className="flex flex-col items-center gap-2 text-gray-400 text-xs">
                      <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
                      <span>生成中...</span>
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
                        <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center text-center p-2 rounded-lg">
                          <CheckCircle2 className="w-8 h-8 text-emerald-600 animate-bounce mb-1" />
                          <span className="text-xs font-bold text-gray-900">扫码成功</span>
                          <span className="text-[11px] text-gray-500">请在手机点击允许</span>
                        </div>
                      )}
                    </div>
                  )}

                  {qrStatus === 'expired' && (
                    <div className="flex flex-col items-center gap-2 text-center p-2">
                      <AlertCircle className="w-8 h-8 text-amber-500" />
                      <span className="text-xs text-gray-600 font-semibold">二维码已过期</span>
                      <button
                        onClick={fetchQrCode}
                        className="text-xs text-blue-600 hover:underline font-bold"
                      >
                        重新生成
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={fetchQrCode}
                  className="mt-2.5 flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>刷新二维码</span>
                </button>
              </div>

              {/* Steps */}
              <div className="space-y-3.5 text-xs">
                <div>
                  <div className="flex items-center gap-2 font-bold text-sm text-gray-900 dark:text-gray-100 mb-1">
                    <QrCode className="w-4 h-4 text-emerald-600" />
                    <span>微信极速免密配对</span>
                  </div>
                  <p className="text-gray-500 dark:text-neutral-400 leading-relaxed">
                    无需任何复杂的 Webhook 填写，使用手机微信扫描即可配对：
                  </p>
                </div>

                <ol className="space-y-2 text-gray-600 dark:text-neutral-300 list-decimal list-inside font-medium leading-relaxed">
                  <li>手机打开微信，点击右上角【+】号选择【扫一扫】；</li>
                  <li>扫描二维码，并在手机微信上点击【允许】；</li>
                  <li>配对完成后，系统将自动绑定并建立专属微信通知管道。</li>
                </ol>

                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/60 rounded-xl text-emerald-800 dark:text-emerald-300 text-[11px] flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span>状态：{qrStatusMsg}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 2. Schedule Preferences & 24h Visual Progress Bar */}
      <section className="bg-white dark:bg-[#1e1f20] rounded-3xl p-5 sm:p-7 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs space-y-6 transition-colors">
        <div className="flex items-center gap-3 pb-4 border-b border-gray-100 dark:border-neutral-800">
          <div className="w-10 h-10 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100">
              日程规划算法偏好 & 提醒周期
            </h2>
            <p className="text-xs text-gray-500 dark:text-neutral-400 mt-0.5">
              配置个人日常作息工作时段、任务缓冲间隔与自动通知机制
            </p>
          </div>
        </div>

        {/* Manual Work Slots Input */}
        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5 mb-1.5">
              <span>自定义工作 / 规划时间段 (手动输入)</span>
            </label>
            <input
              type="text"
              value={workSlotsText}
              onChange={(e) => setWorkSlotsText(e.target.value)}
              placeholder="00:00-02:00, 13:00-18:00"
              className={`w-full px-4 py-2.5 bg-gray-50 dark:bg-[#28292a] border rounded-2xl font-mono text-xs sm:text-sm text-gray-800 dark:text-gray-100 focus:bg-white dark:focus:bg-[#232425] outline-none transition ${
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
              <p className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1.5">
                格式形如 <span className="font-mono text-gray-600 dark:text-neutral-300 font-semibold">00:00-02:00, 13:00-18:00</span>（用逗号分隔）。动态规划将严格仅在亮色可安排时段内插入任务日程。
              </p>
            )}
          </div>

          {/* 24-Hour Timeline Visual Progress Bar (Google Material Card) */}
          <div className="p-4 sm:p-5 bg-gray-50/90 dark:bg-[#28292a]/60 rounded-2xl border border-gray-200/80 dark:border-neutral-700/80 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-3">
                <span className="font-bold text-gray-800 dark:text-gray-200">全天 24 小时排程进度条</span>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-blue-600 dark:bg-blue-500 inline-block shadow-2xs" />
                    <span className="font-semibold text-blue-700 dark:text-blue-300">亮色：可安排</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-gray-300 dark:bg-neutral-700 border border-gray-400/40 dark:border-neutral-600 inline-block" />
                    <span className="font-medium text-gray-600 dark:text-neutral-400">灰色：休息 / 免打扰</span>
                  </span>
                </div>
              </div>

              {!parsedSlotsInfo.error && (
                <div className="text-[11px] text-gray-500 dark:text-neutral-400 font-medium">
                  今日可排程时长：<span className="font-bold text-blue-600 dark:text-blue-400">{(parsedSlotsInfo.totalMinutes / 60).toFixed(1)}</span> 小时 / 24 小时 (
                  <span className="font-semibold text-gray-700 dark:text-neutral-200">{Math.round((parsedSlotsInfo.totalMinutes / 1440) * 100)}%</span>)
                </div>
              )}
            </div>

            {/* Visual Bar (Gray background represents rest, bright color represents available) */}
            <div className="relative w-full h-8 bg-gray-200 dark:bg-neutral-800 rounded-xl overflow-hidden shadow-inner flex items-center select-none border border-gray-300/80 dark:border-neutral-700">
              {/* Highlight Segments (亮色) */}
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
                    {widthPct >= 5 && (
                      <span className="text-[10px] text-white font-mono font-bold truncate px-1 text-center select-none drop-shadow-xs">
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

            {/* Hour Axis Scale (00:00 to 24:00) */}
            <div className="relative w-full h-4 overflow-hidden sm:overflow-visible">
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
        </div>

        {/* Other Preference Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-gray-100 dark:border-neutral-800 text-xs">
          <div>
            <label className="block font-semibold text-gray-700 dark:text-neutral-300 mb-1.5">
              任务间缓冲间隔 (分钟)
            </label>
            <input
              type="number"
              min="0"
              max="120"
              value={taskBuffer}
              onChange={(e) => setTaskBuffer(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100"
            />
            <span className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1 block">推荐 10-15 分钟</span>
          </div>

          <div>
            <label className="block font-semibold text-gray-700 dark:text-neutral-300 mb-1.5">
              事件开始前微信提醒 (分钟)
            </label>
            <input
              type="number"
              min="1"
              max="60"
              value={remindStart}
              onChange={(e) => setRemindStart(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100"
            />
            <span className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1 block">提前提醒准备开始任务</span>
          </div>

          <div>
            <label className="block font-semibold text-gray-700 dark:text-neutral-300 mb-1.5">
              事件结束前微信确认 (分钟)
            </label>
            <input
              type="number"
              min="1"
              max="60"
              value={remindEnd}
              onChange={(e) => setRemindEnd(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100"
            />
            <span className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1 block">提醒确认完成或延长</span>
          </div>
        </div>
      </section>

      {/* 3. LLM Config Section */}
      <section className="bg-white dark:bg-[#1e1f20] rounded-3xl p-5 sm:p-7 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs space-y-5 transition-colors">
        <div className="flex items-center gap-3 pb-4 border-b border-gray-100 dark:border-neutral-800">
          <div className="w-10 h-10 rounded-2xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100">
              大模型 LLM 配置 (语义提取引擎)
            </h2>
            <p className="text-xs text-gray-500 dark:text-neutral-400 mt-0.5">
              仅在收到用户发来的消息时单次调用以提取任务要素，回复均采用预设模版保证秒级响应
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
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
            <span className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1 block">默认预设为 DeepSeek</span>
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
            <span className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1 block">保存在数据库中安全隔离</span>
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
            <span className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1 block">如 deepseek-chat</span>
          </div>
        </div>
      </section>

      {/* 4. Dedicated TODO Calendar Subscription (Export) */}
      <section className="bg-white dark:bg-[#1e1f20] rounded-3xl p-5 sm:p-7 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs space-y-4 transition-colors">
        <div className="flex items-center gap-3 pb-4 border-b border-gray-100 dark:border-neutral-800">
          <div className="w-10 h-10 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100">
              TODO List 专用日历订阅 (导出至系统日历)
            </h2>
            <p className="text-xs text-gray-500 dark:text-neutral-400 mt-0.5">
              支持在 iPhone 日历、Mac 日历、Google Calendar 等第三方客户端中添加订阅
            </p>
          </div>
        </div>

        <div className="text-xs space-y-2">
          <label className="block font-semibold text-gray-700 dark:text-neutral-300">
            日历订阅专属 iCal / Webcal 链接 (只读私密)
          </label>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              readOnly
              value={icalExportUrl}
              className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl font-mono text-gray-700 dark:text-neutral-300 select-all"
            />
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={copyIcal}
                className="flex-1 sm:flex-none px-4 py-2.5 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-700 dark:text-neutral-200 font-medium rounded-full flex items-center justify-center gap-1.5 transition"
              >
                {copiedIcal ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedIcal ? '已复制' : '复制链接'}</span>
              </button>
              <a
                href={icalExportUrl.replace(/^https?:/, 'webcal:')}
                className="flex-1 sm:flex-none px-4 py-2.5 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-600 dark:text-blue-400 font-medium rounded-full flex items-center justify-center gap-1.5 transition"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>一键订阅</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* 5. External Calendar Subscriptions (Import) */}
      <section className="bg-white dark:bg-[#1e1f20] rounded-3xl p-5 sm:p-7 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs space-y-5 transition-colors">
        <div className="flex items-center gap-3 pb-4 border-b border-gray-100 dark:border-neutral-800">
          <div className="w-10 h-10 rounded-2xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100">
              导入外部日历 (订阅链接定期同步)
            </h2>
            <p className="text-xs text-gray-500 dark:text-neutral-400 mt-0.5">
              导入 Apple / Google Calendar 订阅链接，算法自动规避已有日程冲突
            </p>
          </div>
        </div>

        {/* Add form */}
        <form onSubmit={handleAddSubscription} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 text-xs">
          <input
            type="text"
            value={newSubName}
            onChange={(e) => setNewSubName(e.target.value)}
            placeholder="日历名称 (例如：日常会议)"
            className="w-full sm:w-52 px-3.5 py-2.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-800 dark:text-gray-100 outline-none"
            required
          />
          <input
            type="text"
            value={newSubUrl}
            onChange={(e) => setNewSubUrl(e.target.value)}
            placeholder="订阅链接 (webcal://... 或 https://...ics)"
            className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl font-mono text-gray-800 dark:text-gray-100 outline-none"
            required
          />
          <button
            type="submit"
            disabled={addingSub}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-full shrink-0 transition disabled:opacity-50 cursor-pointer"
          >
            {addingSub ? '正在同步...' : '添加并同步'}
          </button>
        </form>

        {/* List */}
        <div className="space-y-2.5 text-xs">
          {subs.length === 0 ? (
            <div className="p-6 text-center text-gray-400 dark:text-neutral-500 bg-gray-50 dark:bg-[#28292a]/50 rounded-2xl border border-dashed border-gray-200 dark:border-neutral-800">
              暂未导入外部日历。填入 Apple 日历或 Google 日历的共享链接即可自动避开忙碌时段。
            </div>
          ) : (
            subs.map((sub) => (
              <div
                key={sub.id}
                className="flex items-center justify-between p-3.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200/80 dark:border-neutral-700/80 rounded-2xl"
              >
                <div className="space-y-1 max-w-lg">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900 dark:text-gray-100">{sub.name}</span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        sub.sync_status === 'ok'
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                          : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                      }`}
                    >
                      {sub.sync_status === 'ok' ? `正常 (${sub.event_count} 条)` : '异常'}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-gray-400 dark:text-neutral-500 truncate max-w-xs sm:max-w-md">
                    {sub.url}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleSyncNow(sub.id)}
                    className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-full transition"
                    title="立即重新拉取同步"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSubscription(sub.id)}
                    className="p-2 text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-full transition"
                    title="删除订阅"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};
