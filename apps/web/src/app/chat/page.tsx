'use client';

import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';

type Message = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'agent' | 'system';
  content: string;
  agentId?: string;
  createdAt: string;
};

const socket = io('http://localhost:3003');

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const typingRef = useRef<Record<string, boolean>>({});
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    socket.on('connect', () => {
      // console.log('connected');
    });

    socket.on('message', (msg: Message) => {
      setMessages((s) => [...s, msg]);
    });

    socket.on('message:stream', (chunk: any) => {
      setMessages((prev) => {
        const existing = prev.find((m) => m.id === chunk.id);
        if (existing) {
          return prev.map((m) => (m.id === chunk.id ? { ...m, content: m.content + chunk.content } : m));
        }
        // append new streaming message
        return [...prev, { id: chunk.id, conversationId: chunk.conversationId, role: 'agent', content: chunk.content || '', agentId: chunk.agentId, createdAt: chunk.createdAt }];
      });
      if (chunk.isFinal) {
        // finalize
      }
    });

    socket.on('agent:typing', (data: any) => {
      typingRef.current[data.agentId] = data.typing;
      // trigger re-render
      setMessages((s) => [...s]);
    });

    return () => {
      socket.off('message');
      socket.off('message:stream');
      socket.off('agent:typing');
    };
  }, []);

  useEffect(() => {
    // auto-scroll
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const send = () => {
    if (!input.trim()) return;
    const msg: Message = {
      id: `c-${Date.now()}`,
      conversationId: 'default',
      role: 'user',
      content: input,
      createdAt: new Date().toISOString(),
    };
    setMessages((s) => [...s, msg]);
    socket.emit('message:create', msg);
    setInput('');
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-semibold mb-4">Chat</h1>

        <div ref={listRef} className="space-y-4 mb-4 max-h-[60vh] overflow-y-auto p-4 rounded bg-slate-900 border border-slate-800">
          {messages.map((m) => (
            <div key={m.id} className="">
              <div className="flex items-center gap-2">
                <div className="text-sm text-slate-400">
                  {m.role === 'user' ? 'You' : m.agentId ? `@${m.agentId}` : m.role}
                </div>
                <div className="text-xs text-slate-500">{new Date(m.createdAt).toLocaleTimeString()}</div>
              </div>
              <div className="mt-1 text-slate-200">
                {renderMarkdown(m.content)}
              </div>
            </div>
          ))}

          {/* typing indicators */}
          {Object.entries(typingRef.current).map(([agentId, typing]) => (
            typing ? (
              <div key={agentId} className="text-sm text-slate-400">{agentId} 正在输入…</div>
            ) : null
          ))}
        </div>

        <div className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Send a message, e.g. @frontend 做个 landing page" className="flex-1 p-2 rounded bg-slate-800 border border-slate-700" />
          <button onClick={send} className="px-4 py-2 rounded bg-indigo-600">发送</button>
        </div>
      </div>
    </main>
  );
}

function renderMarkdown(text: string) {
  // very small markdown support: code fences and line breaks
  const codeFence = /```([\s\S]*?)```/g;
  const parts: any[] = [];
  let lastIndex = 0;
  let match;
  while ((match = codeFence.exec(text)) !== null) {
    const idx = match.index;
    if (idx > lastIndex) {
      parts.push(<div key={`t-${lastIndex}`}>{text.slice(lastIndex, idx).split('\n').map((l, i) => <div key={i}>{l}</div>)}</div>);
    }
    parts.push(<pre key={`c-${idx}`} className="bg-slate-800 p-3 rounded mt-2"><code>{match[1]}</code></pre>);
    lastIndex = idx + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(<div key={`t-end`}>{text.slice(lastIndex).split('\n').map((l, i) => <div key={i}>{l}</div>)}</div>);
  }
  return <div>{parts}</div>;
}
