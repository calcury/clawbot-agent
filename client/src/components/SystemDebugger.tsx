import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import {
  Terminal,
  Send,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
  Smartphone,
  Play,
  Sparkles,
  Bot,
  Search,
  Filter,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  module: 'Weixin' | 'LLM' | 'Scheduler' | 'Calendar' | 'Auth' | 'System';
  message: string;
  details?: any;
}

interface WorkerStatus {
  userId: number;
  username: string;
  role: string;
  weixinConnected: boolean;
  weixinBotId: string;
  weixinUserId: string;
  weixinBaseUrl: string;
  hasBotToken: boolean;
  hasSyncBuf: boolean;
  hasContextToken: boolean;
  hasLlmKey: boolean;
  workerRunning: boolean;
  startedAt: string | null;
  lastPollAt: string | null;
  lastError?: string;
}

interface UserOption {
  id: number;
  username: string;
  role: string;
  status: string;
}

export const SystemDebugger: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'logs' | 'inbound' | 'outbound' | 'workers'>('logs');

  // Logs state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logFilterLevel, setLogFilterLevel] = useState<string>('all');
  const [logFilterModule, setLogFilterModule] = useState<string>('all');
  const [logSearch, setLogSearch] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Inbound simulate state
  const [users, setUsers] = useState<UserOption[]>([]);
  const [simUserId, setSimUserId] = useState<number>(1);
  const [simContent, setSimContent] = useState<string>('帮我安排明天下午2点写代码90分钟，加急4分，周五前完成');
  const [simLoading, setSimLoading] = useState<boolean>(false);
  const [simResult, setSimResult] = useState<any>(null);

  // Outbound test state
  const [outboundUserId, setOutboundUserId] = useState<number>(1);
  const [outboundMessage, setOutboundMessage] = useState<string>(
    `【Clawbot 调试测试】您的微信双向通道测试成功！当前时间：${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`
  );
  const [outboundLoading, setOutboundLoading] = useState<boolean>(false);
  const [outboundResult, setOutboundResult] = useState<any>(null);

  // Workers state
  const [workers, setWorkers] = useState<WorkerStatus[]>([]);
  const [workersLoading, setWorkersLoading] = useState<boolean>(false);

  const logsEndRef = useRef<HTMLDivElement>(null);

  // Fetch users for selector
  const fetchUsers = async () => {
    try {
      const res = await api.get('/admin/users');
      const list: UserOption[] = res.data.users || [];
      setUsers(list);
      if (list.length > 0 && !simUserId) {
        setSimUserId(list[0].id);
        setOutboundUserId(list[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
  };

  // Fetch logs
  const fetchLogs = async () => {
    try {
      const res = await api.get('/admin/debug/logs', {
        params: {
          limit: 250,
          level: logFilterLevel !== 'all' ? logFilterLevel : undefined,
          module: logFilterModule !== 'all' ? logFilterModule : undefined,
        },
      });
      setLogs(res.data.logs || []);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  };

  // Fetch workers
  const fetchWorkers = async () => {
    setWorkersLoading(true);
    try {
      const res = await api.get('/admin/debug/workers');
      setWorkers(res.data.workers || []);
    } catch (err) {
      console.error('Failed to fetch workers:', err);
    } finally {
      setWorkersLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchLogs();
    fetchWorkers();
  }, []);

  // Auto-refresh logs when enabled
  useEffect(() => {
    if (!autoRefresh || activeTab !== 'logs') return;
    const timer = setInterval(() => {
      fetchLogs();
    }, 2500);
    return () => clearInterval(timer);
  }, [autoRefresh, activeTab, logFilterLevel, logFilterModule]);

  // Clear logs
  const handleClearLogs = async () => {
    try {
      await api.delete('/admin/debug/logs');
      setLogs([]);
    } catch {
      alert('清空日志失败');
    }
  };

  // Handle simulate inbound
  const handleSimulateInbound = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simContent.trim()) return;
    setSimLoading(true);
    setSimResult(null);

    try {
      const res = await api.post('/admin/debug/simulate-inbound', {
        userId: Number(simUserId),
        content: simContent.trim(),
      });
      setSimResult(res.data);
      fetchLogs();
    } catch (err: any) {
      setSimResult({
        success: false,
        error: err.response?.data?.error || err.message,
      });
    } finally {
      setSimLoading(false);
    }
  };

  // Handle real WeChat test send
  const handleTestSendWeChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outboundMessage.trim()) return;
    setOutboundLoading(true);
    setOutboundResult(null);

    try {
      const res = await api.post('/admin/debug/test-send-wechat', {
        userId: Number(outboundUserId),
        message: outboundMessage.trim(),
      });
      setOutboundResult(res.data);
      fetchLogs();
    } catch (err: any) {
      setOutboundResult({
        success: false,
        error: err.response?.data?.error || err.message,
      });
    } finally {
      setOutboundLoading(false);
    }
  };

  // Restart Worker
  const handleRestartWorker = async (userId: number) => {
    try {
      await api.post(`/admin/debug/workers/${userId}/restart`);
      fetchWorkers();
      fetchLogs();
    } catch (err: any) {
      alert('重启 Worker 失败：' + err.message);
    }
  };

  // Reset SyncBuf
  const handleResetSyncBuf = async (userId: number) => {
    if (!confirm('重置 SyncBuf 将清空最后更新点并重新拉取未确认消息，是否继续？')) return;
    try {
      await api.post(`/admin/debug/workers/${userId}/reset-sync`);
      fetchWorkers();
      fetchLogs();
    } catch (err: any) {
      alert('重置 SyncBuf 失败：' + err.message);
    }
  };

  // Filter logs by search in memory
  const filteredLogs = logs.filter((l) => {
    if (!logSearch.trim()) return true;
    const query = logSearch.toLowerCase();
    return (
      l.message.toLowerCase().includes(query) ||
      l.module.toLowerCase().includes(query) ||
      JSON.stringify(l.details || '').toLowerCase().includes(query)
    );
  });

  const sampleMessages = [
    '查看日历',
    '查看任务',
    '重新排程',
    '帮我安排明天下午2点写代码90分钟，加急4分，周五前完成',
    '刚才的任务做完了',
    '时间不够了，再延长30分钟',
    '排个任务：准备下周开会PPT，耗时2小时',
  ];

  return (
    <div className="w-full space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Terminal className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <span>系统运行调试器</span>
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 font-mono">
              ADMIN ONLY
            </span>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-neutral-400 mt-0.5">
            微信双向消息管道监控 · LLM 语义解析沙盒 · 动态规划排程模拟追踪
          </p>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-1.5 bg-white dark:bg-[#1e1f20] p-1 rounded-2xl border border-gray-200/80 dark:border-neutral-700/80 shadow-2xs self-start sm:self-auto overflow-x-auto">
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'logs'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-neutral-200'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            <span>实时日志</span>
            {logs.length > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-mono ${
                activeTab === 'logs' ? 'bg-white/20 text-white' : 'bg-gray-100 dark:bg-neutral-800'
              }`}>
                {logs.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('inbound')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'inbound'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-neutral-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>消息接收模拟</span>
          </button>

          <button
            onClick={() => setActiveTab('outbound')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'outbound'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-neutral-200'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>真实微信发送</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('workers');
              fetchWorkers();
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'workers'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-neutral-200'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>管道线程状态</span>
          </button>
        </div>
      </div>

      {/* 1. Live Logs Tab */}
      {activeTab === 'logs' && (
        <div className="space-y-3">
          {/* Controls Bar */}
          <div className="bg-white dark:bg-[#1e1f20] rounded-2xl p-3 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Filter pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 text-xs">
                <Filter className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-gray-500 font-semibold text-[11px]">级别:</span>
                {['all', 'info', 'success', 'warn', 'error'].map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setLogFilterLevel(lvl)}
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                      logFilterLevel === lvl
                        ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-bold'
                        : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    {lvl.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="h-4 w-px bg-gray-200 dark:bg-neutral-700 hidden sm:block" />

              <div className="flex items-center gap-1 text-xs">
                <span className="text-gray-500 font-semibold text-[11px]">模块:</span>
                {['all', 'Weixin', 'LLM', 'Scheduler', 'Calendar'].map((mod) => (
                  <button
                    key={mod}
                    onClick={() => setLogFilterModule(mod)}
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                      logFilterModule === mod
                        ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-bold'
                        : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    {mod}
                  </button>
                ))}
              </div>
            </div>

            {/* Search & Actions */}
            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-48">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  placeholder="搜索日志..."
                  className="w-full pl-7 pr-2.5 py-1 text-xs bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-lg outline-none"
                />
              </div>

              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1 ${
                  autoRefresh
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-gray-100 dark:bg-neutral-800 text-gray-500'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
                <span>{autoRefresh ? '自动刷新' : '已暂停'}</span>
              </button>

              <button
                onClick={fetchLogs}
                className="p-1.5 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 rounded-lg text-gray-600 dark:text-neutral-300 transition cursor-pointer"
                title="刷新日志"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={handleClearLogs}
                className="p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition cursor-pointer"
                title="清空日志"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Log Stream Terminal Window */}
          <div className="bg-[#1e1f20] text-gray-200 rounded-2xl border border-neutral-800 shadow-lg font-mono text-xs overflow-hidden flex flex-col h-[520px]">
            {/* Terminal Titlebar */}
            <div className="bg-[#18191a] px-4 py-2 border-b border-neutral-800 flex items-center justify-between text-[11px] text-neutral-400 select-none">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
                <span className="ml-2 font-semibold text-neutral-300">clawbot-agent: stdout / stderr / weixin-transit</span>
              </div>
              <div>共 {filteredLogs.length} 条记录</div>
            </div>

            {/* Log Stream Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-thin">
              {filteredLogs.length === 0 ? (
                <div className="text-center py-20 text-neutral-500">
                  暂无日志记录，可在上方切换筛选条件或执行测试
                </div>
              ) : (
                filteredLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  const timeStr = log.timestamp.slice(11, 19);

                  let badgeColor = 'text-blue-400 bg-blue-950/60 border-blue-800';
                  let icon = <Info className="w-3 h-3 text-blue-400" />;
                  if (log.level === 'success') {
                    badgeColor = 'text-emerald-400 bg-emerald-950/60 border-emerald-800';
                    icon = <CheckCircle2 className="w-3 h-3 text-emerald-400" />;
                  } else if (log.level === 'warn') {
                    badgeColor = 'text-amber-400 bg-amber-950/60 border-amber-800';
                    icon = <AlertTriangle className="w-3 h-3 text-amber-400" />;
                  } else if (log.level === 'error') {
                    badgeColor = 'text-rose-400 bg-rose-950/60 border-rose-800';
                    icon = <AlertCircle className="w-3 h-3 text-rose-400" />;
                  }

                  return (
                    <div
                      key={log.id}
                      className="p-1.5 px-2 rounded-lg hover:bg-neutral-800/60 transition flex flex-col gap-1 border border-transparent hover:border-neutral-700/50"
                    >
                      <div className="flex items-start gap-2 leading-relaxed">
                        <span className="text-neutral-500 text-[10px] shrink-0 font-mono mt-0.5">
                          {timeStr}
                        </span>
                        <span className="shrink-0 mt-0.5">{icon}</span>
                        <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border shrink-0 ${badgeColor}`}>
                          {log.module}
                        </span>
                        <span className="text-neutral-200 font-sans text-xs break-all flex-1">
                          {log.message}
                        </span>
                        {log.details && (
                          <button
                            onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                            className="text-[10px] text-neutral-400 hover:text-white px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded transition cursor-pointer shrink-0 flex items-center gap-1"
                          >
                            <span>JSON</span>
                            {isExpanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                          </button>
                        )}
                      </div>

                      {/* Expandable JSON details */}
                      {isExpanded && log.details && (
                        <pre className="p-2.5 bg-[#121314] rounded-lg text-[10px] text-emerald-400 overflow-x-auto border border-neutral-800 ml-6">
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      )}

      {/* 2. Inbound Message Simulation Tab */}
      {activeTab === 'inbound' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Form: Input message */}
          <div className="lg:col-span-5 bg-white dark:bg-[#1e1f20] rounded-2xl p-5 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-neutral-800">
              <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                模拟微信消息传入
              </h2>
            </div>

            <form onSubmit={handleSimulateInbound} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-gray-700 dark:text-neutral-300 mb-1">
                  目标测试用户 (模拟该用户微信发信)
                </label>
                <select
                  value={simUserId}
                  onChange={(e) => setSimUserId(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      #{u.id} - {u.username} ({u.role === 'admin' ? '管理员' : '普通用户'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-gray-700 dark:text-neutral-300 mb-1">
                  微信消息文本内容
                </label>
                <textarea
                  rows={4}
                  value={simContent}
                  onChange={(e) => setSimContent(e.target.value)}
                  placeholder="输入模拟微信发来的文本..."
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none text-xs leading-relaxed"
                  required
                />
              </div>

              {/* Sample Quick Preset Pills */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-gray-400 block">快捷测试用例：</span>
                <div className="flex flex-wrap gap-1.5">
                  {sampleMessages.map((sample, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSimContent(sample)}
                      className="text-left px-2 py-1 bg-gray-100 dark:bg-[#28292a] hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-700 dark:text-neutral-300 text-[10px] rounded-lg transition cursor-pointer truncate max-w-xs"
                    >
                      {sample}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={simLoading}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5 text-xs"
              >
                {simLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                <span>{simLoading ? '正在通过 LLM & 算法排程...' : '触发微信流程模拟'}</span>
              </button>
            </form>
          </div>

          {/* Right: Diagnostic Pipeline Result */}
          <div className="lg:col-span-7 bg-white dark:bg-[#1e1f20] rounded-2xl p-5 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-emerald-600" />
                <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  执行链路与诊断追踪结果
                </h2>
              </div>
              {simResult && (
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold font-mono ${
                  simResult.success
                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                    : 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                }`}>
                  {simResult.success ? `成功 (${simResult.elapsedMs}ms)` : '处理异常'}
                </span>
              )}
            </div>

            {!simResult ? (
              <div className="p-12 text-center text-gray-400 dark:text-neutral-500 text-xs space-y-1">
                <Play className="w-8 h-8 mx-auto text-gray-300 dark:text-neutral-600 stroke-[1.5]" />
                <div>在左侧输入测试文本并点击运行，查看完整的 LLM 提取、排程算法计算与回传微信消息</div>
              </div>
            ) : (
              <div className="space-y-3.5 text-xs">
                {/* 1. Reply Bubble */}
                <div className="space-y-1.5">
                  <span className="font-bold text-gray-700 dark:text-neutral-300 text-[11px] flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    <span>微信回复内容 (将推给用户手机)：</span>
                  </span>
                  <div className="p-3 bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/80 rounded-xl text-emerald-900 dark:text-emerald-200 whitespace-pre-wrap font-sans text-xs leading-relaxed">
                    {simResult.replyText}
                  </div>
                </div>

                {/* 1.5 Image Card Preview if generated */}
                {simResult.imagePreviewBase64 && (
                  <div className="space-y-1.5">
                    <span className="font-bold text-gray-700 dark:text-neutral-300 text-[11px] flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                      <span>微信图片卡片下发预览：</span>
                    </span>
                    <div className="p-3 bg-gray-50 dark:bg-[#28292a] rounded-xl border border-gray-200 dark:border-neutral-700 flex flex-col items-center">
                      <img
                        src={simResult.imagePreviewBase64}
                        alt="WeChat Image Card"
                        className="w-full max-w-[480px] rounded-xl shadow-md border border-gray-200 dark:border-neutral-700"
                      />
                      <span className="text-[10px] text-gray-400 mt-2">已成功生成高清卡片并同步上传至腾讯 CDN 下发</span>
                    </div>
                  </div>
                )}

                {/* 2. LLM Parsed intent */}
                {simResult.diagnostics?.parsed && (
                  <div className="space-y-1.5">
                    <span className="font-bold text-gray-700 dark:text-neutral-300 text-[11px] flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                      <span>LLM 语义提取字段：</span>
                    </span>
                    <div className="p-3 bg-gray-50 dark:bg-[#28292a] rounded-xl border border-gray-200 dark:border-neutral-700 font-mono text-[11px] space-y-1">
                      <div>意图: <span className="font-bold text-blue-600 dark:text-blue-400">{simResult.diagnostics.parsed.intent}</span></div>
                      {simResult.diagnostics.parsed.title && <div>任务标题: {simResult.diagnostics.parsed.title}</div>}
                      {simResult.diagnostics.parsed.duration_minutes && <div>耗时: {simResult.diagnostics.parsed.duration_minutes} 分钟</div>}
                      {simResult.diagnostics.parsed.urgency && <div>紧急度: {simResult.diagnostics.parsed.urgency}/5</div>}
                      {simResult.diagnostics.parsed.importance && <div>重要度: {simResult.diagnostics.parsed.importance}/5</div>}
                      {simResult.diagnostics.parsed.deadline && <div>截止时间: {simResult.diagnostics.parsed.deadline}</div>}
                    </div>
                  </div>
                )}

                {/* 3. Scheduling Plan */}
                {simResult.diagnostics?.plan && (
                  <div className="space-y-1.5">
                    <span className="font-bold text-gray-700 dark:text-neutral-300 text-[11px] flex items-center gap-1.5">
                      <Bot className="w-3.5 h-3.5 text-purple-500" />
                      <span>动态规划算法计算：</span>
                    </span>
                    <div className="p-3 bg-gray-50 dark:bg-[#28292a] rounded-xl border border-gray-200 dark:border-neutral-700 font-mono text-[11px]">
                      <div>排程结果: <span className="font-bold text-emerald-600">{simResult.diagnostics.plan.success ? '成功' : '失败'}</span></div>
                      <div>安排开始: {simResult.diagnostics.plan.scheduled_start || '无'}</div>
                      <div>安排结束: {simResult.diagnostics.plan.scheduled_end || '无'}</div>
                      {simResult.diagnostics.plan.message && <div>附注: {simResult.diagnostics.plan.message}</div>}
                    </div>
                  </div>
                )}

                {/* Raw diagnostic JSON */}
                <details className="text-[11px] text-gray-500 cursor-pointer pt-1">
                  <summary className="hover:text-gray-700 dark:hover:text-neutral-300 font-semibold">查看完整诊断 JSON 结果</summary>
                  <pre className="mt-2 p-3 bg-gray-50 dark:bg-[#28292a] rounded-xl overflow-x-auto text-[10px] text-gray-700 dark:text-neutral-300 font-mono">
                    {JSON.stringify(simResult, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Real WeChat Outbound Test Tab */}
      {activeTab === 'outbound' && (
        <div className="max-w-2xl mx-auto bg-white dark:bg-[#1e1f20] rounded-2xl p-5 sm:p-6 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-neutral-800">
            <Smartphone className="w-5 h-5 text-emerald-600" />
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                真实微信消息下发测试
              </h2>
              <p className="text-[11px] text-gray-500 dark:text-neutral-400">
                通过腾讯 Weixin iLink 官方网关直接推送通知到用户手机微信
              </p>
            </div>
          </div>

          <form onSubmit={handleTestSendWeChat} className="space-y-3.5 text-xs">
            <div>
              <label className="block font-semibold text-gray-700 dark:text-neutral-300 mb-1">
                选择接收消息的微信绑定用户
              </label>
              <select
                value={outboundUserId}
                onChange={(e) => setOutboundUserId(Number(e.target.value))}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    #{u.id} - {u.username}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-gray-700 dark:text-neutral-300 mb-1">
                测试消息文本
              </label>
              <textarea
                rows={3}
                value={outboundMessage}
                onChange={(e) => setOutboundMessage(e.target.value)}
                placeholder="输入下发至微信的文本..."
                className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-xl text-gray-900 dark:text-gray-100 outline-none font-sans leading-relaxed"
                required
              />
            </div>

            <button
              type="submit"
              disabled={outboundLoading}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
            >
              {outboundLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>{outboundLoading ? '正在向微信官方网关发送...' : '发送至真实微信'}</span>
            </button>
          </form>

          {outboundResult && (
            <div className={`p-4 rounded-xl border space-y-2 text-xs animate-fadeIn ${
              outboundResult.success
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
            }`}>
              <div className="flex items-center gap-2 font-bold text-sm">
                {outboundResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-rose-600" />}
                <span>{outboundResult.success ? '消息下发成功！请查看手机微信通知' : '消息下发失败'}</span>
              </div>

              {outboundResult.error && (
                <div className="text-rose-700 dark:text-rose-300 font-mono text-[11px]">
                  错误原因: {outboundResult.error}
                </div>
              )}

              <div className="text-[11px] font-mono space-y-0.5 text-gray-600 dark:text-neutral-400">
                <div>目标用户: {outboundResult.toUserId || '未知'}</div>
                <div>会话 Token: {outboundResult.hasContextToken ? '已携带' : '无 (首次发送)'}</div>
                {outboundResult.result?.message_id && <div>消息 ID: {outboundResult.result.message_id}</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. Workers Status Tab */}
      {activeTab === 'workers' && (
        <div className="bg-white dark:bg-[#1e1f20] rounded-2xl p-5 border border-gray-200/80 dark:border-neutral-800/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-neutral-800">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                微信多租户长轮询 Worker 管道监视器
              </h2>
            </div>
            <button
              onClick={fetchWorkers}
              className="flex items-center gap-1.5 px-3 py-1 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-700 dark:text-neutral-300 text-xs font-semibold rounded-lg transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${workersLoading ? 'animate-spin' : ''}`} />
              <span>刷新状态</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-gray-100 dark:border-neutral-800 text-gray-400 font-semibold text-[11px]">
                  <th className="pb-2.5">用户</th>
                  <th className="pb-2.5">微信账号 ID</th>
                  <th className="pb-2.5">Worker 管道状态</th>
                  <th className="pb-2.5">Context Token</th>
                  <th className="pb-2.5">LLM Key</th>
                  <th className="pb-2.5">最近轮询时间</th>
                  <th className="pb-2.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-neutral-800/80">
                {workers.map((w) => (
                  <tr key={w.userId} className="hover:bg-gray-50/60 dark:hover:bg-neutral-800/40 transition">
                    <td className="py-3 font-semibold text-gray-900 dark:text-gray-100">
                      #{w.userId} {w.username}
                    </td>
                    <td className="py-3 font-mono text-[11px] text-gray-600 dark:text-neutral-400 truncate max-w-xs">
                      {w.weixinUserId || <span className="text-gray-400">未配对</span>}
                    </td>
                    <td className="py-3">
                      {w.workerRunning ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          正在长轮询
                        </span>
                      ) : w.weixinConnected ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
                          已停止
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 dark:bg-neutral-800 text-gray-500">
                          未连接微信
                        </span>
                      )}
                    </td>
                    <td className="py-3 font-mono text-[11px]">
                      {w.hasContextToken ? (
                        <span className="text-emerald-600 font-semibold">已获取</span>
                      ) : (
                        <span className="text-gray-400">等待首次来信</span>
                      )}
                    </td>
                    <td className="py-3">
                      {w.hasLlmKey ? (
                        <span className="text-blue-600 font-semibold">已配置</span>
                      ) : (
                        <span className="text-rose-500 font-semibold">未填 Key</span>
                      )}
                    </td>
                    <td className="py-3 font-mono text-[10px] text-gray-500">
                      {w.lastPollAt ? new Date(w.lastPollAt).toLocaleTimeString() : '无记录'}
                    </td>
                    <td className="py-3 text-right space-x-1.5">
                      {w.weixinConnected && (
                        <>
                          <button
                            onClick={() => handleRestartWorker(w.userId)}
                            className="px-2.5 py-1 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 text-blue-600 dark:text-blue-400 rounded-lg text-[10px] font-semibold transition cursor-pointer"
                          >
                            重启 Worker
                          </button>
                          <button
                            onClick={() => handleResetSyncBuf(w.userId)}
                            className="px-2.5 py-1 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 text-gray-600 dark:text-neutral-300 rounded-lg text-[10px] font-semibold transition cursor-pointer"
                          >
                            重置 SyncBuf
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
