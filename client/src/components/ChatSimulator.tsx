import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { Bot, User, Send, Sparkles, RefreshCw, MessageSquare } from 'lucide-react';

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
        '• "看下今天的待办日程"\n' +
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
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        sender: 'clawbot',
        content: `⚠️ 处理异常：${err.response?.data?.error || err.message}\n请确保在「设置」中配置了有效的 DeepSeek API Key。`,
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
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-indigo-600" />
            <span>微信 Clawbot 对话模拟器</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            在此直接模拟微信向 Clawbot 发送自然语言消息，实时测试 LLM 结构化抽取与排程响应
          </p>
        </div>

        <button
          onClick={() => setMessages(messages.slice(0, 1))}
          className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>清空聊天记录</span>
        </button>
      </div>

      {/* Chat container */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[520px] overflow-hidden">
        {/* Messages list */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-50/50">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex items-start gap-3 ${m.sender === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-xs ${
                  m.sender === 'user' ? 'bg-indigo-600 text-white' : 'bg-emerald-600 text-white'
                }`}
              >
                {m.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div
                className={`max-w-[75%] rounded-2xl p-3.5 text-xs whitespace-pre-wrap leading-relaxed shadow-xs ${
                  m.sender === 'user'
                    ? 'bg-indigo-600 text-white rounded-tr-none'
                    : 'bg-white text-slate-800 border border-slate-200/80 rounded-tl-none'
                }`}
              >
                {m.content}
                <div
                  className={`text-[10px] mt-1 text-right ${
                    m.sender === 'user' ? 'text-indigo-200' : 'text-slate-400'
                  }`}
                >
                  {m.time}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-3.5 rounded-tl-none text-xs text-slate-400 flex items-center gap-2">
                <span className="inline-block animate-spin rounded-full h-3 w-3 border-2 border-indigo-600 border-t-transparent"></span>
                <span>Clawbot 正在调用 LLM 抽取数据并规划时间槽...</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Quick test buttons */}
        <div className="p-2.5 bg-slate-100/70 border-t border-slate-200 overflow-x-auto flex items-center gap-1.5 scrollbar-none">
          <span className="text-[11px] font-semibold text-slate-500 shrink-0 flex items-center gap-1 pl-1">
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
            快捷测试：
          </span>
          {quickPrompts.map((q, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSend(q)}
              className="px-2.5 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-600 border border-slate-200 rounded-lg text-[11px] text-slate-600 whitespace-nowrap shrink-0 transition shadow-2xs"
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
          className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入自然语言消息，回车发送..."
            className="flex-1 px-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-medium"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-600/20 transition disabled:opacity-50 shrink-0"
          >
            <span>发送</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
