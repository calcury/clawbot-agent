import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { QRCodeSVG } from 'qrcode.react';
import {
  Bot,
  Brain,
  Calendar,
  Clock,
  Copy,
  Check,
  Plus,
  Trash2,
  RefreshCw,
  Save,
  CheckCircle2,
  AlertCircle,
  QrCode,
  Send,
  LogOut,
  ExternalLink,
} from 'lucide-react';

interface WorkSlot {
  start: string;
  end: string;
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

  // Preferences
  const [workSlots, setWorkSlots] = useState<WorkSlot[]>([
    { start: '09:00', end: '12:00' },
    { start: '13:00', end: '18:00' },
    { start: '19:00', end: '24:00' },
    { start: '00:00', end: '02:00' },
  ]);
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
            setWorkSlots(JSON.parse(settings.work_slots));
          } catch {
            // fallback
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

      // If not connected to WeChat, load QR code
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
      const { qrcode, qrcode_img_content } = res.data;
      setQrCode(qrcode);
      setQrCodeImgContent(qrcode_img_content);
      setQrStatus('wait');
      setQrStatusMsg('请打开手机微信【扫一扫】屏幕二维码');

      // Start polling status
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
        setWxUserId(data.user_id || '');
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
    setSaving(true);
    setSaveSuccess(false);

    try {
      await api.put('/settings', {
        llm_endpoint: llmEndpoint,
        llm_api_key: llmApiKey,
        llm_model: llmModel,
        work_slots: workSlots,
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

  const handleAddSlot = () => {
    setWorkSlots([...workSlots, { start: '09:00', end: '12:00' }]);
  };

  const handleRemoveSlot = (index: number) => {
    setWorkSlots(workSlots.filter((_, idx) => idx !== index));
  };

  const handleSlotChange = (index: number, field: 'start' | 'end', val: string) => {
    const updated = [...workSlots];
    updated[index][field] = val;
    setWorkSlots(updated);
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
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-3 text-slate-500 font-medium">
          <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" />
          <span>正在载入系统偏好设置...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-16">
      {/* Top Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">配置中心 & 微信配对</h1>
          <p className="text-sm text-slate-500 mt-1">
            无需繁琐配置，扫码即连微信 Clawbot；全自动日历同步、智能时间规划与提醒机制。
          </p>
        </div>

        <button
          onClick={handleSavePreferences}
          disabled={saving}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-semibold rounded-xl shadow-md shadow-indigo-100 transition disabled:opacity-50"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>{saving ? '保存中...' : '保存全部配置'}</span>
        </button>
      </div>

      {saveSuccess && (
        <div className="flex items-center gap-2 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-sm font-medium animate-fadeIn">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>所有配置已持久化保存！微信 Clawbot 实时规划及提醒已同步更新。</span>
        </div>
      )}

      {/* 1. WeChat Clawbot Pair Section (QR Code) */}
      <section className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-xs relative overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 pb-5">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-bold text-slate-900">微信 Clawbot 对接</h2>
                {wxConnected ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    已成功连接
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                    等待微信扫码配对
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                基于微信官方 iLink 通道直接中转，用户严格隔离，扫码即可与您的专属助手建立联系
              </p>
            </div>
          </div>
        </div>

        <div className="pt-6">
          {wxConnected ? (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                    {wxNickname ? wxNickname.slice(0, 1).toUpperCase() : 'W'}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">
                      {wxNickname ? `已绑定微信：${wxNickname}` : '已绑定专属微信账号'}
                    </h3>
                    <p className="text-xs font-mono text-slate-500 mt-0.5">
                      专属通讯 ID: <span className="text-slate-700">{wxUserId || '已加密保护'}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSendTestMessage}
                    disabled={testSending}
                    className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-semibold text-xs rounded-xl shadow-2xs transition disabled:opacity-50"
                  >
                    {testSending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 text-indigo-600" />}
                    <span>{testSending ? '发送中...' : '发送测试微信'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleUnbindWeixin}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-semibold text-xs rounded-xl transition"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>解除配对</span>
                  </button>
                </div>
              </div>

              {testResult && (
                <div className="text-xs p-3 bg-white border border-slate-200 rounded-xl text-slate-700 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{testResult}</span>
                </div>
              )}

              <div className="text-xs text-slate-500 bg-white/70 p-4 rounded-xl border border-slate-200/60 leading-relaxed">
                💡 <span className="font-semibold text-slate-700">使用提示：</span>现在您可以直接用您的手机微信向此 Clawbot 发送日程安排要求（例如：“帮我规划明天上午写报告两小时，紧急程度高”），助手将自动识别并在控制面板生成 TODO 和日历，并在任务开始与结束前通过微信主动提醒您。
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-8 bg-slate-50/70 border border-slate-200/80 rounded-2xl p-6 sm:p-8">
              {/* QR Code Container */}
              <div className="flex flex-col items-center shrink-0">
                <div className="w-52 h-52 bg-white p-3.5 rounded-2xl border-2 border-dashed border-slate-300 shadow-sm flex items-center justify-center relative overflow-hidden group">
                  {qrStatus === 'loading' && (
                    <div className="flex flex-col items-center gap-2 text-slate-400 text-xs">
                      <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
                      <span>生成中...</span>
                    </div>
                  )}

                  {(qrStatus === 'wait' || qrStatus === 'scaned') && (
                    <div className="relative">
                      {qrCodeImgContent ? (
                        <QRCodeSVG
                          value={qrCodeImgContent}
                          size={180}
                          level="M"
                          includeMargin={false}
                        />
                      ) : (
                        <div className="text-xs text-slate-400">二维码生成失败</div>
                      )}

                      {qrStatus === 'scaned' && (
                        <div className="absolute inset-0 bg-white/90 backdrop-blur-xs flex flex-col items-center justify-center text-center p-2 rounded-lg">
                          <CheckCircle2 className="w-8 h-8 text-emerald-600 animate-bounce mb-1" />
                          <span className="text-xs font-bold text-slate-900">扫码成功</span>
                          <span className="text-[11px] text-slate-500">请在手机点击允许</span>
                        </div>
                      )}
                    </div>
                  )}

                  {qrStatus === 'expired' && (
                    <div className="flex flex-col items-center gap-2 text-center p-2">
                      <AlertCircle className="w-8 h-8 text-amber-500" />
                      <span className="text-xs text-slate-600 font-semibold">二维码已过期</span>
                      <button
                        onClick={fetchQrCode}
                        className="text-xs text-indigo-600 hover:underline font-bold"
                      >
                        点击重新生成
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={fetchQrCode}
                  className="mt-3 flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 font-semibold"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>刷新二维码</span>
                </button>
              </div>

              {/* Instructions */}
              <div className="space-y-4 text-xs">
                <div>
                  <div className="flex items-center gap-2 font-bold text-sm text-slate-900 mb-1">
                    <QrCode className="w-4 h-4 text-emerald-600" />
                    <span>微信极速免密配对流程</span>
                  </div>
                  <p className="text-slate-500 text-xs leading-relaxed">
                    我们已在后台使用 Tencent OpenClaw 微信专属中转网关。您无需填写复杂的 Webhook 或申请服务号，仅需 2 步完成绑定：
                  </p>
                </div>

                <ol className="space-y-2.5 text-slate-600 list-decimal list-inside font-medium leading-relaxed">
                  <li>打开手机微信，点击右上角【+】号选择【扫一扫】；</li>
                  <li>扫描左侧二维码，并在手机微信上点击【允许 / 确认登录】；</li>
                  <li>系统将自动识别并创建您的专属隔离沙箱会话。</li>
                </ol>

                <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-800 text-[11px] flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span>状态指示：{qrStatusMsg}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 2. LLM Config Section */}
      <section className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-xs space-y-5">
        <div className="flex items-center gap-3.5 border-b border-slate-100 pb-5">
          <div className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <Brain className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">大模型 LLM 配置 (语义提取引擎)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              仅在用户发消息时调用一次以提取任务/状态字段，回复均采用预设模版拼接以保证极速响应
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">
              API 端点 (Base URL)
            </label>
            <input
              type="text"
              value={llmEndpoint}
              onChange={(e) => setLlmEndpoint(e.target.value)}
              placeholder="https://api.deepseek.com/v1"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">兼容 OpenAI 规范，默认预设为 DeepSeek</span>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">
              API 密钥 (API Key)
            </label>
            <input
              type="password"
              value={llmApiKey}
              onChange={(e) => setLlmApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">密钥直接保存在服务端数据库，加密安全隔离</span>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">
              模型型号 (Model)
            </label>
            <input
              type="text"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              placeholder="deepseek-chat"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">例如: deepseek-chat 或 gpt-4o-mini</span>
          </div>
        </div>
      </section>

      {/* 3. Smart Schedule Preferences */}
      <section className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-xs space-y-6">
        <div className="flex items-center gap-3.5 border-b border-slate-100 pb-5">
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">日程规划算法偏好 & 提醒周期</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              配置个人日常作息工作时段、任务缓冲间隔与自动通知机制
            </p>
          </div>
        </div>

        {/* Work Time Slots */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <span>自定义工作/规划时间段 (动态规划将自动避开非工作时段)</span>
            </label>
            <button
              type="button"
              onClick={handleAddSlot}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>增加时段</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {workSlots.map((slot, index) => (
              <div
                key={index}
                className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
              >
                <input
                  type="time"
                  value={slot.start}
                  onChange={(e) => handleSlotChange(index, 'start', e.target.value)}
                  className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 font-mono"
                />
                <span className="text-slate-400 font-medium">至</span>
                <input
                  type="time"
                  value={slot.end}
                  onChange={(e) => handleSlotChange(index, 'end', e.target.value)}
                  className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 font-mono"
                />
                {workSlots.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveSlot(index)}
                    className="p-1 text-slate-400 hover:text-rose-600 ml-auto transition"
                    title="删除这时段"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400">
            支持跨夜配置（例如 19:00-24:00 及 00:00-02:00）。所有事件排期均严格安排在上述设定的可用窗口内。
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 pt-3 border-t border-slate-100 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">
              任务间缓冲间隔 (分钟)
            </label>
            <input
              type="number"
              min="0"
              max="120"
              value={taskBuffer}
              onChange={(e) => setTaskBuffer(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">任务排程之间的休息缓冲（推荐 10-15 分钟）</span>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">
              事件开始前微信提醒 (分钟)
            </label>
            <input
              type="number"
              min="1"
              max="60"
              value={remindStart}
              onChange={(e) => setRemindStart(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">Clawbot 将提前通过微信提醒准备开始任务</span>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">
              事件结束前微信确认 (分钟)
            </label>
            <input
              type="number"
              min="1"
              max="60"
              value={remindEnd}
              onChange={(e) => setRemindEnd(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">提醒您是否已完成或需要延长时间</span>
          </div>
        </div>
      </section>

      {/* 4. Dedicated TODO Calendar Subscription (Export) */}
      <section className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex items-center gap-3.5 border-b border-slate-100 pb-5">
          <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">TODO List 专用日历订阅 (导出至系统日历)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              包含 Clawbot 为您动态安排的全部待办日程，支持在 iPhone 日历、Mac 日历、Google Calendar 等订阅
            </p>
          </div>
        </div>

        <div className="text-xs space-y-2">
          <label className="block font-semibold text-slate-700">
            日历订阅专属 iCal / Webcal 链接 (只读保密)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={icalExportUrl}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-700 select-all"
            />
            <button
              type="button"
              onClick={copyIcal}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl flex items-center gap-1.5 shrink-0 transition"
            >
              {copiedIcal ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedIcal ? '已复制' : '复制订阅链接'}</span>
            </button>
            <a
              href={icalExportUrl.replace(/^https?:/, 'webcal:')}
              className="px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-600 font-semibold rounded-xl flex items-center gap-1.5 shrink-0 transition"
              title="一键调起系统日历添加订阅"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>一键订阅</span>
            </a>
          </div>
          <p className="text-[11px] text-slate-400">
            在外部日历添加此订阅后，一旦 Clawbot 安排新任务，外部日历将定期自动同步更新。
          </p>
        </div>
      </section>

      {/* 5. External Calendar Subscriptions (Import) */}
      <section className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-xs space-y-5">
        <div className="flex items-center gap-3.5 border-b border-slate-100 pb-5">
          <div className="w-11 h-11 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">导入外部日历 (订阅链接定期同步)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              导入 Apple / Google Calendar / 飞书 等订阅链接，算法自动规避已有会议与日程冲突
            </p>
          </div>
        </div>

        {/* Add subscription form */}
        <form onSubmit={handleAddSubscription} className="flex flex-col sm:flex-row items-center gap-3 text-xs">
          <input
            type="text"
            value={newSubName}
            onChange={(e) => setNewSubName(e.target.value)}
            placeholder="日历名称 (例如：公司日常会议 / 课程表)"
            className="w-full sm:w-56 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
            required
          />
          <input
            type="text"
            value={newSubUrl}
            onChange={(e) => setNewSubUrl(e.target.value)}
            placeholder="订阅链接 (webcal://... 或 https://...ics)"
            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
            required
          />
          <button
            type="submit"
            disabled={addingSub}
            className="w-full sm:w-auto px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shrink-0 transition disabled:opacity-50"
          >
            {addingSub ? '正在同步...' : '添加并拉取'}
          </button>
        </form>

        {/* List of subscriptions */}
        <div className="space-y-2.5 text-xs">
          {subs.length === 0 ? (
            <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              暂未导入外部日历。填入您日常使用的 Apple 日历或 Google 日历订阅链接，机器人即可掌握您何时忙碌。
            </div>
          ) : (
            subs.map((sub) => (
              <div
                key={sub.id}
                className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200/80 rounded-2xl"
              >
                <div className="space-y-1 max-w-lg">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{sub.name}</span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        sub.sync_status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {sub.sync_status === 'ok' ? `同步正常 (${sub.event_count} 条日程)` : '同步异常'}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-400 truncate max-w-md">{sub.url}</div>
                  <div className="text-[10px] text-slate-400">
                    上次同步时间：{sub.last_sync_at ? new Date(sub.last_sync_at).toLocaleString('zh-CN') : '未同步'}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSyncNow(sub.id)}
                    className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-xl transition"
                    title="立即重新拉取同步"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSubscription(sub.id)}
                    className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl transition"
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
