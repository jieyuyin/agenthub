'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { createSocket, getSocketUrl } from '@/lib/socket';

/**
 * =========================
 * Types
 * =========================
 */
type Agent = {
  id: string;
  name: string;
  role: string;
  status: string;
  statusLabel: string;
  avatar: string;
  detail: string;
};

type Message = {
  id: string;
  conversationId?: string;
  speaker: string;
  role: string;
  content: string;
  agentId?: string;
  createdAt?: string;
};

/**
 * =========================
 * Static UI Config (KEEP UI SAME)
 * =========================
 */
const AGENTS: Agent[] = [
  {
    id: 'pm',
    name: 'PM',
    role: 'Product Manager',
    status: 'planning',
    statusLabel: 'Planning',
    avatar: '🧠',
    detail: '正在制定实施计划与优先级',
  },
  {
    id: 'frontend',
    name: 'Frontend',
    role: 'UI Engineer',
    status: 'coding',
    statusLabel: 'Coding',
    avatar: '🎨',
    detail: '正在构建界面',
  },
  {
    id: 'backend',
    name: 'Backend',
    role: 'API Engineer',
    status: 'specing',
    statusLabel: 'Specing',
    avatar: '⚙️',
    detail: '正在定义 API',
  },
  {
    id: 'qa',
    name: 'QA',
    role: 'Quality',
    status: 'waiting',
    statusLabel: 'Waiting',
    avatar: '🧪',
    detail: '等待测试',
  },
];

const NAV_ITEMS = ['Chat', 'Tasks', 'Files', 'Timeline'];

/**
 * =========================
 * Page
 * =========================
 */
export default function HomePage() {
  const socketRef = useRef<Socket | null>(null);

  const [activeNav, setActiveNav] = useState('Chat');
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);

  const [typingAgents, setTypingAgents] = useState<Record<string, boolean>>({});
  const [agentStatuses, setAgentStatuses] = useState<Record<string, any>>({});
  const [socketConnected, setSocketConnected] = useState(false);

  /**
   * =========================
   * SOCKET INIT
   * =========================
   */
  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('connected:', socket.id);
      setSocketConnected(true);
    });

    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('connect_error', () => setSocketConnected(false));

    /**
     * Normal message
     */
    socket.on('message', (msg: Message) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        if (msg.role === 'user') return prev;
        return [...prev, msg];
      });
    });

    /**
     * STREAM FIXED (no duplicate append bug)
     */
    socket.on('message:stream', (chunk: any) => {
      setMessages((prev) => {
        const index = prev.findIndex((m) => m.id === chunk.id);

        if (index !== -1) {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            content: updated[index].content + (chunk.content || ''),
          };
          return updated;
        }

        return [
          ...prev,
          {
            id: chunk.id,
            conversationId: chunk.conversationId,
            speaker: chunk.agentId || 'AI',
            role: chunk.role,
            content: chunk.content || '',
            agentId: chunk.agentId,
            createdAt: chunk.createdAt,
          },
        ];
      });
    });

    /**
     * typing state FIXED mapping
     */
    socket.on('agent:typing', (data: { agentId: string; typing: boolean }) => {
      const key = data.agentId?.split('-')[0] || 'backend';

      setTypingAgents((prev) => ({
        ...prev,
        [key]: data.typing,
      }));

      setAgentStatuses((prev) => ({
        ...prev,
        [key]: {
          status: data.typing ? 'Thinking...' : 'Idle',
          detail: data.typing ? 'Agent is working...' : 'Waiting for task',
        },
      }));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  /**
   * =========================
   * SEND MESSAGE
   * =========================
   */
  const sendMessage = () => {
    if (!inputValue.trim()) return;

    const msg: Message = {
      id: crypto.randomUUID(),
      conversationId: 'default',
      speaker: 'You',
      role: 'user',
      content: inputValue,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, msg]);
    socketRef.current?.emit('message:create', msg);
    setInputValue('');
  };

  /**
   * =========================
   * UI
   * =========================
   */
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 lg:p-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-8">

        {/* ================= SIDEBAR ================= */}
        <aside className="space-y-6 rounded-3xl border border-slate-800 bg-slate-900/90 p-5">

          <div>
            <h2 className="text-xl font-semibold">War Room</h2>
          </div>

          <div className="space-y-2">
            {NAV_ITEMS.map((item) => (
              <button
                key={item}
                onClick={() => setActiveNav(item)}
                className={`w-full rounded-2xl border px-4 py-3 text-left text-sm ${
                  activeNav === item
                    ? 'border-violet-500 bg-violet-500/10'
                    : 'border-slate-800 bg-slate-950'
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          {/* ================= AGENTS ================= */}
          <div className="space-y-3">
            {AGENTS.map((agent) => {
              const live = agentStatuses[agent.id];
              const typing = typingAgents[agent.id];

              return (
                <div key={agent.id} className="border border-slate-800 rounded-2xl p-3">
                  <div className="flex justify-between">
                    <span>{agent.name}</span>
                    <span className="text-xs text-green-400">
                      {typing ? 'Typing...' : live?.status || agent.statusLabel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-2">
                    {live?.detail || agent.detail}
                  </p>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ================= MAIN ================= */}
        <section className="space-y-6">

          {/* CHAT STREAM */}
          <div className="border border-slate-800 rounded-3xl p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">Live Stream</h3>
              <span
                className={`text-xs px-2 py-1 rounded-full border ${
                  socketConnected
                    ? 'border-green-800 text-green-400'
                    : 'border-red-800 text-red-400'
                }`}
              >
                {socketConnected ? `已连接 ${getSocketUrl()}` : '未连接 — 请运行 cd apps/api && pnpm dev'}
              </span>
            </div>

            <div className="h-[420px] overflow-y-auto space-y-3">
              {messages.length === 0 && (
                <p className="text-slate-500">Waiting for AI...</p>
              )}

              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`border rounded-2xl p-3 ${
                    m.role === 'agent'
                      ? 'border-violet-800/50 bg-violet-950/20'
                      : 'border-slate-800'
                  }`}
                >
                  <div className="text-xs text-slate-500">
                    {m.role === 'agent' ? `🤖 ${m.agentId ?? m.speaker}` : m.speaker} ·{' '}
                    {new Date(m.createdAt || '').toLocaleTimeString()}
                  </div>
                  <div className="text-sm whitespace-pre-wrap mt-1">{m.content}</div>
                </div>
              ))}
            </div>
          </div>

          {/* INPUT */}
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-xl bg-slate-900 border border-slate-700 px-3 py-2"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type @pm, @frontend, @backend or @qa ..."
            />
            <button
              onClick={sendMessage}
              className="bg-violet-500 px-4 py-2 rounded-xl"
            >
              Send
            </button>
          </div>

        </section>
      </div>
    </main>
  );
}