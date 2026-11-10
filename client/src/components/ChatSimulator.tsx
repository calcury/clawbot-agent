import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { Bot, User, Send, Sparkles, RefreshCw } from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'clawbot';
  content: string;
  time: string;
}

export const ChatSimulator: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init-1',
      sender: 'clawbot',
      content:
        '👋 你好！我是你的 Clawbot 时间管理助手。\n' +
        '您可以直接给我发消息，比如：\n' +
        '• "明天下午写周报，2小时，加急5分，周五前交"\n' +
        '• "看下今天的日程待办"\n' +
        '• "刚刚的任务搞定了"\n' +
        '• "时间不够，延长30分钟"',
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [webhookToken, setWebhookToken] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get('/settings').then((res) => {
      setWebhookToken(res.data.settings?.clawbot_webhook_token || '');
    });
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || loading || !webhookToken) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      content: text,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.post('/webhook/simulate', {
        token: webhookToken,
        content: text,
      });

      const botMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        sender: 'clawbot',
        content: res.data.reply || '已收到',
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        sender: 'clawbot',
        content: `⚠️ 处理异常：${error.response?.data?.error || error.message}\n请确保在「设置」中配置了有效的 DeepSeek API Key。`,
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const quickPrompts = [
    '帮我安排写代码，耗时90分钟，紧急5分重要5分，明天中午前完成',
    '安排一下阅读技术文档',
    '耗时45分钟，今晚8点前交，紧急3重要3',
    '看下今天的日程待办',
    '提前完成了',
    '时间不够，延长30分钟',
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <span>微信对话模拟器</span>
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-neutral-400 mt-0.5">
            在此直接模拟向 Clawbot 发送微信自然语言指令，测试排程抽取与自动回复
          </p>
        </div>

        <button
          onClick={() => setMessages(messages.slice(0, 1))}
          className="text-xs text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-300 flex items-center gap-1 transition cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>重置</span>
        </button>
      </div>

      {/* Chat container (Google Tasks Card) */}
      <div className="bg-white dark:bg-[#1e1f20] rounded-3xl border border-gray-200/80 dark:border-neutral-800/80 shadow-xs flex flex-col h-[520px] overflow-hidden transition-colors">
        {/* Messages list */}
        <div className="flex-1 p-4 sm:p-5 overflow-y-auto space-y-4 bg-gray-50/50 dark:bg-[#18191a]/50">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex items-start gap-3 ${m.sender === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-2xs ${
                  m.sender === 'user' ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white'
                }`}
              >
                {m.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div
                className={`max-w-[80%] sm:max-w-[70%] rounded-2xl p-3.5 text-xs sm:text-sm whitespace-pre-wrap leading-relaxed shadow-xs ${
                  m.sender === 'user'
                    ? 'bg-blue-600 text-white rounded-tr-none'
                    : 'bg-white dark:bg-[#28292a] text-gray-800 dark:text-neutral-100 border border-gray-200/80 dark:border-neutral-700/80 rounded-tl-none'
                }`}
              >
                {m.content}
                <div
                  className={`text-[10px] mt-1 text-right ${
                    m.sender === 'user' ? 'text-blue-200' : 'text-gray-400 dark:text-neutral-500'
                  }`}
                >
                  {m.time}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-white dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 rounded-2xl p-3.5 rounded-tl-none text-xs text-gray-500 dark:text-neutral-400 flex items-center gap-2">
                <span className="inline-block animate-spin rounded-full h-3 w-3 border-2 border-blue-600 border-t-transparent"></span>
                <span>Clawbot 正在调用 LLM 抽取要素并规划排程...</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Quick test buttons */}
        <div className="p-2.5 bg-gray-50 dark:bg-[#232425] border-t border-gray-200/80 dark:border-neutral-800/80 overflow-x-auto flex items-center gap-1.5 scrollbar-none">
          <span className="text-[11px] font-semibold text-gray-500 dark:text-neutral-400 shrink-0 flex items-center gap-1 pl-1">
            <Sparkles className="w-3.5 h-3.5 text-blue-500" />
            快速测试：
          </span>
          {quickPrompts.map((q, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSend(q)}
              className="px-3 py-1 bg-white dark:bg-[#2d2e30] hover:bg-blue-50 dark:hover:bg-blue-950/60 hover:text-blue-600 dark:hover:text-blue-400 border border-gray-200 dark:border-neutral-700 rounded-full text-[11px] text-gray-600 dark:text-neutral-300 whitespace-nowrap shrink-0 transition shadow-2xs cursor-pointer"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Input box */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="p-3 bg-white dark:bg-[#1e1f20] border-t border-gray-200/80 dark:border-neutral-800/80 flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入自然语言指令，回车发送..."
            className="flex-1 px-4 py-2.5 text-xs sm:text-sm bg-gray-50 dark:bg-[#28292a] border border-gray-200 dark:border-neutral-700 text-gray-900 dark:text-gray-100 rounded-full focus:bg-white dark:focus:bg-[#232425] outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium transition"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full text-xs sm:text-sm font-medium flex items-center gap-1.5 shadow-sm transition disabled:opacity-50 shrink-0 cursor-pointer"
          >
            <span>发送</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
