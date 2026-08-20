'use client';

import React, {
  useEffect,
  useRef,
  useState,
  memo,
} from 'react';

import type { Socket } from 'socket.io-client';
import { createSocket, getSocketUrl } from '@/lib/socket';

// ==========================================
// Types
// ==========================================

export type Message = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'agent' | 'system';
  content: string;
  agentId?: string;
  createdAt: string;
  type?: 'text' | 'INTERACTIVE_TASK_CARD';
};

// ==========================================
// Socket
// ==========================================

let socket: Socket | null = null;

// ==========================================
// Markdown Renderer
// ==========================================

function renderMarkdown(text: string) {
  // 支持 ```ts xxx ```
  const codeFence = /```(?:\w+)?\n?([\s\S]*?)```/g;

  const parts: React.ReactNode[] = [];

  let lastIndex = 0;
  let match;

  while ((match = codeFence.exec(text)) !== null) {
    const idx = match.index;

    // 普通文本
    if (idx > lastIndex) {
      parts.push(
        <div key={`t-${lastIndex}`}>
          {text
            .slice(lastIndex, idx)
            .split('\n')
            .map((line, i) => (
              <div key={i}>{line}</div>
            ))}
        </div>
      );
    }

    // code block
    parts.push(
      <pre
        key={`c-${idx}`}
        className="bg-slate-800 p-3 rounded mt-2 overflow-x-auto text-sm border border-slate-700"
      >
        <code>{match[1]}</code>
      </pre>
    );

    lastIndex = idx + match[0].length;
  }

  // 剩余文本
  if (lastIndex < text.length) {
    parts.push(
      <div key="t-end">
        {text
          .slice(lastIndex)
          .split('\n')
          .map((line, i) => (
            <div key={i}>{line}</div>
          ))}
      </div>
    );
  }

  return <div>{parts}</div>;
}

// ==========================================
// Agent Color
// ==========================================

const getAgentColor = (agentId?: string) => {
  if (!agentId) return 'text-slate-400';

  const id = agentId.toLowerCase();

  if (id.includes('pm')) {
    return 'text-purple-400 font-bold';
  }

  if (id.includes('frontend')) {
    return 'text-cyan-400 font-bold';
  }

  if (id.includes('backend')) {
    return 'text-green-400 font-bold';
  }

  if (id.includes('qa')) {
    return 'text-amber-400 font-bold';
  }

  return 'text-slate-300 font-bold';
};

// ==========================================
// Message Item
// ==========================================

const MessageItem = memo(({ m }: { m: Message }) => {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <div
          className={`text-sm ${
            m.role === 'user'
              ? 'text-slate-300'
              : getAgentColor(m.agentId)
          }`}
        >
          {m.role === 'user'
            ? '👤 You'
            : `🤖 @${m.agentId ?? 'agent'}`}
        </div>

        <div className="text-xs text-slate-500">
          {m.createdAt
            ? new Date(m.createdAt).toLocaleTimeString()
            : ''}
        </div>
      </div>

      <div className="text-slate-200">
        {m.type === 'INTERACTIVE_TASK_CARD' ? (
          <div className="p-4 border border-purple-500/30 bg-purple-500/10 rounded-lg">
            <p className="mb-2 font-semibold text-purple-200">
              [交互卡片占位] 任务需审批
            </p>

            <div className="text-sm">
              {renderMarkdown(m.content)}
            </div>

            <button className="mt-3 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-sm transition-colors">
              批准并执行
            </button>
          </div>
        ) : (
          renderMarkdown(m.content)
        )}
      </div>
    </div>
  );
});

MessageItem.displayName = 'MessageItem';

// ==========================================
// Main Component
// ==========================================

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);

  const [input, setInput] = useState('');

  const [typingAgents, setTypingAgents] = useState<
    Record<string, boolean>
  >({});

  const [socketConnected, setSocketConnected] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);

  // ==========================================
  // Socket Setup
  // ==========================================

  useEffect(() => {
    // 防止热更新重复创建
    if (!socket) {
      socket = createSocket();
    }

    socket.on('connect', () => {
      console.log('Connected to AgentHub Server');
      setSocketConnected(true);
    });

    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('connect_error', (err) => {
      console.error('Socket connect_error', err);
      setSocketConnected(false);
    });

    // ==========================================
    // 普通消息
    // ==========================================

    socket.on('message', (msg: Message) => {
      setMessages((prev) => {
        // 防止重复插入
        if (prev.some((m) => m.id === msg.id)) {
          return prev;
        }

        return [...prev, msg];
      });
    });

    // ==========================================
    // Stream Message
    // ==========================================

    socket.on('message:stream', (chunk: any) => {
      setMessages((prev) => {
        const existing = prev.find(
          (m) => m.id === chunk.id
        );

        // 已存在 -> 拼接
        if (existing) {
          return prev.map((m) =>
            m.id === chunk.id
              ? {
                  ...m,
                  content:
                    m.content + (chunk.content || ''),
                }
              : m
          );
        }

        // 不存在 -> 新建
        return [
          ...prev,
          {
            id: chunk.id,
            conversationId:
              chunk.conversationId || 'default',
            role: 'agent',
            content: chunk.content || '',
            agentId: chunk.agentId,
            type: chunk.type || 'text',
            createdAt:
              chunk.createdAt ||
              new Date().toISOString(),
          },
        ];
      });
    });

    // ==========================================
    // Typing
    // ==========================================

    socket.on(
      'agent:typing',
      (data: {
        agentId: string;
        typing: boolean;
      }) => {
        setTypingAgents((prev) => ({
          ...prev,
          [data.agentId]: data.typing,
        }));
      }
    );

    // ==========================================
    // Cleanup
    // ==========================================

    return () => {
      socket?.off('connect');
      socket?.off('message');
      socket?.off('message:stream');
      socket?.off('agent:typing');
    };
  }, []);

  // ==========================================
  // Auto Scroll
  // ==========================================

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop =
        listRef.current.scrollHeight;
    }
  }, [messages, typingAgents]);

  // ==========================================
  // Send Message
  // ==========================================

  const send = () => {
    if (!input.trim()) {
      return;
    }

    const msg: Message = {
      id:
        crypto.randomUUID?.() ??
        `c-${Date.now()}`,

      conversationId: 'default',

      role: 'user',

      content: input,

      createdAt: new Date().toISOString(),

      type: 'text',
    };

    // 乐观更新
    setMessages((prev) => [...prev, msg]);

    // emit
    socket?.emit('message:create', msg);

    setInput('');
  };

  // ==========================================
  // Keyboard
  // ==========================================

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // ==========================================
  // Render
  // ==========================================

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8 flex flex-col items-center">
      <div className="w-full max-w-4xl flex flex-col h-[85vh]">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <span className="text-indigo-500">❖</span>
            AgentHub War Room
          </h1>
          <span
            className={`text-xs px-2 py-1 rounded-full border ${
              socketConnected
                ? 'border-green-800 text-green-400 bg-green-950/40'
                : 'border-red-800 text-red-400 bg-red-950/40'
            }`}
          >
            {socketConnected
              ? `已连接 ${getSocketUrl()}`
              : '未连接 — 请在 apps/api 运行 pnpm dev'}
          </span>
        </div>

        {/* 消息区域 */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto p-6 rounded-xl bg-slate-900 border border-slate-800 mb-4 shadow-xl scroll-smooth scrollbar-thin scrollbar-thumb-slate-700"
        >
          {messages.length === 0 && (
            <div className="h-full flex items-center justify-center text-slate-500 italic">
              等待下达任务指令...
              <br />
              (例如:
              @PM 帮我规划一个登录页面)
            </div>
          )}

          {/* 消息列表 */}
          {messages.map((m) => (
            <MessageItem
              key={m.id}
              m={m}
            />
          ))}

          {/* Typing */}
          <div className="flex flex-col gap-1 mt-2">
            {Object.entries(typingAgents).map(
              ([agentId, typing]) =>
                typing ? (
                  <div
                    key={agentId}
                    className="flex items-center gap-2 text-sm text-slate-400 italic animate-pulse"
                  >
                    <div className="w-4 h-4 rounded-full border-2 border-slate-500 border-t-transparent animate-spin" />

                    {agentId}
                    正在思考并输入...
                  </div>
                ) : null
            )}
          </div>
        </div>

        {/* 输入框 */}
        <div className="flex gap-3 bg-slate-900 p-2 rounded-xl border border-slate-800 shadow-lg focus-within:border-indigo-500 transition-colors">
          <input
            value={input}
            onChange={(e) =>
              setInput(e.target.value)
            }
            onKeyDown={handleKeyDown}
            placeholder="指派任务, e.g. @frontend 实现一下登录UI布局..."
            className="flex-1 p-3 bg-transparent border-none outline-none text-slate-200 placeholder-slate-500"
          />

          <button
            onClick={send}
            disabled={!input.trim()}
            className="px-6 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 font-medium transition-colors"
          >
            发送
          </button>
        </div>
      </div>
    </main>
  );
}
