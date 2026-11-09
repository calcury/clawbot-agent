import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
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

  // Settings fields
  const [llmEndpoint, setLlmEndpoint] = useState('https://api.deepseek.com/v1');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmModel, setLlmModel] = useState('deepseek-chat');

  const [webhookUrl, setWebhookUrl] = useState('');
  const [clawbotOutboundUrl, setClawbotOutboundUrl] = useState('');
  const [clawbotOutboundKey, setClawbotOutboundKey] = useState('');
  const [clawbotToWxid, setClawbotToWxid] = useState('');

  // Preferences
  const [workSlots, setWorkSlots] = useState<WorkSlot[]>([
    { start: '09:00', end: '12:00' },
    { start: '13:00', end: '18:00' },
    { start: '19:00', end: '24:00' },
    { start: '00:00', end: '02:00' },
  ]);
  const [taskBufferMinutes, setTaskBufferMinutes] = useState(10);
  const [reminderBeforeStart, setReminderBeforeStart] = useState(5);
  const [reminderBeforeEnd, setReminderBeforeEnd] = useState(5);
  const [syncInterval, setSyncInterval] = useState(60);

  // Calendar Subscriptions
  const [subs, setSubs] = useState<CalendarSub[]>([]);
  const [newSubName, setNewSubName] = useState('');
  const [newSubUrl, setNewSubUrl] = useState('');
  const [addingSub, setAddingSub] = useState(false);

  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const fetchSettings = async () => {
    try {
      const res = await api.get('/settings');
      const s = res.data.settings;
      if (s) {
        if (s.llm_endpoint) setLlmEndpoint(s.llm_endpoint);
        if (s.llm_api_key) setLlmApiKey(s.llm_api_key);
        if (s.llm_model) setLlmModel(s.llm_model);
        if (s.clawbot_outbound_url) setClawbotOutboundUrl(s.clawbot_outbound_url);
        if (s.clawbot_outbound_key) setClawbotOutboundKey(s.clawbot_outbound_key);
        if (s.clawbot_to_wxid) setClawbotToWxid(s.clawbot_to_wxid);
        if (s.task_buffer_minutes !== undefined) setTaskBufferMinutes(s.task_buffer_minutes);
        if (s.reminder_before_start_minutes !== undefined) setReminderBeforeStart(s.reminder_before_start_minutes);
        if (s.reminder_before_end_minutes !== undefined) setReminderBeforeEnd(s.reminder_before_end_minutes);
        if (s.calendar_sync_interval_minutes !== undefined) setSyncInterval(s.calendar_sync_interval_minutes);
        if (s.work_slots) {
          try {
            setWorkSlots(JSON.parse(s.work_slots));
          } catch {}
        }
      }
      setWebhookUrl(res.data.urls.webhookUrl);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSubscriptions = async () => {
    try {
      const res = await api.get('/calendar/subscriptions');
      setSubs(res.data.subscriptions);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    Promise.all([fetchSettings(), fetchSubscriptions()]).finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);

    try {
      await api.put('/settings', {
        llm_endpoint: llmEndpoint,
        llm_api_key: llmApiKey,
        llm_model: llmModel,
        clawbot_outbound_url: clawbotOutboundUrl,
        clawbot_outbound_key: clawbotOutboundKey,
        clawbot_to_wxid: clawbotToWxid,
        work_slots: workSlots,
        task_buffer_minutes: taskBufferMinutes,
        reminder_before_start_minutes: reminderBeforeStart,
        reminder_before_end_minutes: reminderBeforeEnd,
        calendar_sync_interval_minutes: syncInterval,
      });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      alert(err.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerateToken = async () => {
    if (!window.confirm('重新生成 Token 后，原有的微信 Webhook 链接将失效，确认继续？')) return;
    try {
      await api.post('/settings/regenerate-token');
      fetchSettings();
    } catch (err) {
      alert('重新生成失败');
    }
  };

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  // Work Slots helpers
  const addSlot = () => {
    setWorkSlots([...workSlots, { start: '09:00', end: '12:00' }]);
  };

  const removeSlot = (index: number) => {
    setWorkSlots(workSlots.filter((_, i) => i !== index));
  };

  const updateSlot = (index: number, field: 'start' | 'end', value: string) => {
    const updated = [...workSlots];
    updated[index][field] = value;
    setWorkSlots(updated);
  };

  // Calendar Subscriptions helpers
  const handleAddSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubName.trim() || !newSubUrl.trim()) return;

    setAddingSub(true);
    try {
      const res = await api.post('/calendar/subscriptions', {
        name: newSubName,
        url: newSubUrl,
      });
      alert(res.data.message || '添加成功');
      setNewSubName('');
      setNewSubUrl('');
      fetchSubscriptions();
    } catch (err: any) {
      alert(err.response?.data?.error || '添加订阅失败');
    } finally {
      setAddingSub(false);
    }
  };

  const handleDeleteSubscription = async (id: number) => {
    if (!window.confirm('确定要删除该日历订阅及同步的外部事件吗？')) return;
    try {
      await api.delete(`/calendar/subscriptions/${id}`);
      fetchSubscriptions();
    } catch {
      alert('删除失败');
    }
  };

  const handleSyncNow = async (id: number) => {
    try {
      const res = await api.post(`/calendar/subscriptions/${id}/sync`);
      alert(res.data.message);
      fetchSubscriptions();
    } catch (err: any) {
      alert(err.response?.data?.error || '同步出错');
    }
  };

  if (loading) {
    return <div className="p-12 text-center text-slate-400">加载配置中...</div>;
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">系统偏好与助手对接配置</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            配置您的微信 Clawbot、DeepSeek 大模型、多段工作时段与日历同步设置。
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-md shadow-indigo-600/20 transition disabled:opacity-50"
        >
          {saving ? (
            <span className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></span>
          ) : saveSuccess ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-300" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          <span>{saveSuccess ? '已保存成功！' : '保存所有设置'}</span>
        </button>
      </div>

      {/* 1. Clawbot Integration Section */}
      <section className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-5">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">微信 Clawbot 对接配置</h3>
            <p className="text-xs text-slate-500">
              设置 Clawbot 消息推送 Webhook 地址及机器人主动推送微信消息的接口端点
            </p>
          </div>
        </div>

        <div className="space-y-4 text-xs">
          {/* Inbound Webhook URL */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">
              Clawbot 接收 Webhook 链接 (配置给您的 Clawbot 回调)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={webhookUrl}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-700 select-all"
              />
              <button
                type="button"
                onClick={copyWebhook}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl flex items-center gap-1.5 shrink-0 transition"
              >
                {copiedWebhook ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedWebhook ? '已复制' : '复制'}</span>
              </button>
              <button
                type="button"
                onClick={handleRegenerateToken}
                className="px-3 py-2 text-rose-600 hover:bg-rose-50 border border-rose-200 font-semibold rounded-xl shrink-0 transition"
              >
                重置Token
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              微信 Clawbot 收到用户发来的消息后，请配置其直接 POST 到此 Webhook 链接。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Clawbot 发送消息 API 端点 (可选)
              </label>
              <input
                type="text"
                value={clawbotOutboundUrl}
                onChange={(e) => setClawbotOutboundUrl(e.target.value)}
                placeholder="例如：http://127.0.0.1:3000/send"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono"
              />
              <span className="text-[10px] text-slate-400">用于助手主动发送开始/结束提醒</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Clawbot API Key / 鉴权令牌 (可选)
              </label>
              <input
                type="password"
                value={clawbotOutboundKey}
                onChange={(e) => setClawbotOutboundKey(e.target.value)}
                placeholder="若您的机器人需要 Token"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                您的微信 Wxid / 接收用户 ID (可选)
              </label>
              <input
                type="text"
                value={clawbotToWxid}
                onChange={(e) => setClawbotToWxid(e.target.value)}
                placeholder="微信发送目标用户 wxid"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              />
              <span className="text-[10px] text-slate-400">若留空，助手会在收到您首条消息时自动记录</span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. LLM Config Section */}
      <section className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-5">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">大模型 LLM 配置 (结构化字段抽取)</h3>
            <p className="text-xs text-slate-500">
              仅在用户发消息时调用一次以提取任务/状态字段，默认预设为 DeepSeek
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              API 端点 (Base URL)
            </label>
            <input
              type="text"
              value={llmEndpoint}
              onChange={(e) => setLlmEndpoint(e.target.value)}
              placeholder="https://api.deepseek.com/v1"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono"
              required
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              DeepSeek API Key *
            </label>
            <input
              type="password"
              value={llmApiKey}
              onChange={(e) => setLlmApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              模型型号 (Model)
            </label>
            <input
              type="text"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              placeholder="deepseek-chat"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono"
            />
          </div>
        </div>
      </section>

      {/* 3. Work Hours & Interval Preferences */}
      <section className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-5">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">工作时间范围与偏好设置</h3>
            <p className="text-xs text-slate-500">
              智能排程算法仅会将任务规划在您的工作时段中，并自动避开外部日历冲突
            </p>
          </div>
        </div>

        <div className="space-y-4 text-xs">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-semibold text-slate-700">
                允许的工作时间段（支持多段，如 9:00-12:00, 13:00-18:00...）
              </label>
              <button
                type="button"
                onClick={addSlot}
                className="flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-semibold"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>添加工作时段</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {workSlots.map((slot, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl"
                >
                  <input
                    type="time"
                    value={slot.start}
                    onChange={(e) => updateSlot(index, 'start', e.target.value)}
                    className="bg-white px-2 py-1 border border-slate-200 rounded-lg text-xs"
                  />
                  <span className="text-slate-400 font-bold">~</span>
                  <input
                    type="time"
                    value={slot.end}
                    onChange={(e) => updateSlot(index, 'end', e.target.value)}
                    className="bg-white px-2 py-1 border border-slate-200 rounded-lg text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => removeSlot(index)}
                    className="text-slate-400 hover:text-rose-600 p-1 ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-100">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                任务间缓冲间隔（分钟）
              </label>
              <input
                type="number"
                value={taskBufferMinutes}
                onChange={(e) => setTaskBufferMinutes(Number(e.target.value))}
                min={0}
                max={60}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              />
              <span className="text-[11px] text-slate-400">安排任务时前后预留休息或准备时间</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                开始前提醒周期（提前分钟数）
              </label>
              <input
                type="number"
                value={reminderBeforeStart}
                onChange={(e) => setReminderBeforeStart(Number(e.target.value))}
                min={0}
                max={60}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              />
              <span className="text-[11px] text-slate-400">日程即将开始前通过微信通知您</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                结束前核对周期（提前分钟数）
              </label>
              <input
                type="number"
                value={reminderBeforeEnd}
                onChange={(e) => setReminderBeforeEnd(Number(e.target.value))}
                min={0}
                max={60}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              />
              <span className="text-[11px] text-slate-400">快完成时微信询问是否已完成或需延期</span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. External Calendar Subscriptions */}
      <section className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-5">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">导入外部日历 (订阅链接定期更新)</h3>
            <p className="text-xs text-slate-500">
              导入 Apple / Google Calendar 等订阅链接，系统自动规避忙碌时间段
            </p>
          </div>
        </div>

        {/* Add subscription form */}
        <form onSubmit={handleAddSubscription} className="flex flex-col sm:flex-row items-center gap-3 text-xs">
          <input
            type="text"
            value={newSubName}
            onChange={(e) => setNewSubName(e.target.value)}
            placeholder="日历名称 (如：工作日历/学校日程)"
            className="w-full sm:w-48 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
            required
          />
          <input
            type="text"
            value={newSubUrl}
            onChange={(e) => setNewSubUrl(e.target.value)}
            placeholder="订阅链接 (webcal://... 或 https://...ics)"
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono"
            required
          />
          <button
            type="submit"
            disabled={addingSub}
            className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shrink-0 transition disabled:opacity-50"
          >
            {addingSub ? '同步中...' : '添加并同步'}
          </button>
        </form>

        {/* List of subscriptions */}
        <div className="space-y-2 text-xs">
          {subs.length === 0 ? (
            <div className="p-6 text-center text-slate-400 bg-slate-50 rounded-xl">
              暂未导入外部日历。您可以填入 Apple 日历或 Google 日历的共享/订阅链接。
            </div>
          ) : (
            subs.map((sub) => (
              <div
                key={sub.id}
                className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-xl"
              >
                <div className="space-y-1 max-w-lg">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800">{sub.name}</span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        sub.sync_status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {sub.sync_status === 'ok' ? `同步正常 (${sub.event_count}条日程)` : '同步异常'}
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
                    className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                    title="立即重新拉取同步"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSubscription(sub.id)}
                    className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition"
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
