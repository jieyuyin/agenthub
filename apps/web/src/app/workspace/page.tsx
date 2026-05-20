'use client';

import { useMemo, useState } from 'react';

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
  speaker: string;
  role: string;
  content: string;
  tone: string;
};

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
    detail: '正在构建暗色模式交互界面',
  },
  {
    id: 'backend',
    name: 'Backend',
    role: 'API Engineer',
    status: 'specing',
    statusLabel: 'Specing',
    avatar: '⚙️',
    detail: '正在定义接口规范与依赖关系',
  },
  {
    id: 'qa',
    name: 'QA',
    role: 'Quality',
    status: 'waiting',
    statusLabel: 'Waiting',
    avatar: '🧪',
    detail: '等待 Backend 完成后触发集成测试',
  },
];

const MESSAGES: Message[] = [
  {
    id: 'm1',
    speaker: 'PM',
    role: 'pm',
    tone: 'Planning',
    content: '我们先把 Dashboard 核心模块拆分为 Chat、Tasks、Files、Timeline，Frontend 负责 UI、Backend 负责 API、QA 负责回归验证。',
  },
  {
    id: 'm2',
    speaker: 'Backend',
    role: 'backend',
    tone: 'Confirming',
    content: '收到。已开始创建 /api/dashboard.json 接口规范，同时准备数据依赖文档。',
  },
  {
    id: 'm3',
    speaker: 'Frontend',
    role: 'frontend',
    tone: 'Progress',
    content: '我已经搭建了暗色模式框架，并将左侧导航、中心战争室与右侧文件画布布局搞定。',
  },
];

const TASK_CARD = {
  title: 'Create AI Collaboration Dashboard',
  description: 'Build the high-fidelity dark mode workspace with live agent chat, execution timeline, and file sandbox preview.',
  owners: ['PM', 'Frontend', 'Backend'],
  due: 'Today · High priority',
};

const CODE_SNIPPET = `import React from 'react';

export default function DashboardPage() {
  return (
    <div className="dashboard-shell">
      <h1>AI Native Collaboration</h1>
      <p>Multi-agent war room in dark mode.</p>
    </div>
  );
}
`;

const DIFF_SNIPPET = `- const title = 'Old Dashboard';
+ const title = 'AI Native Collaboration';
+ const theme = 'dark';
`;

const NAV_ITEMS = ['Chat', 'Tasks', 'Files', 'Timeline'];

const TIMELINE_STEPS = [
  {
    lane: 'Frontend',
    title: 'Design War Room UI',
    status: 'Completed',
    detail: 'Grid layout, nav, and preview canvas complete.',
  },
  {
    lane: 'Backend',
    title: 'Define dashboard API',
    status: 'Completed',
    detail: 'Schema and contract ready for QA.',
  },
  {
    lane: 'QA',
    title: 'Run integration checks',
    status: 'Pending',
    detail: '等待 Backend 完成触发执行。',
  },
];

export default function WorkspacePage() {
  const [activeNav, setActiveNav] = useState('Chat');
  const [taskState, setTaskState] = useState<'pending' | 'approved' | 'rejected'>('pending');

  const taskStateLabel = useMemo(() => {
    if (taskState === 'approved') return 'Approved';
    if (taskState === 'rejected') return 'Rejected';
    return 'Pending review';
  }, [taskState]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 lg:p-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] gap-6 lg:grid-cols-[320px_minmax(0,1fr)_420px] lg:gap-8">
        <aside className="space-y-6 rounded-3xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl shadow-slate-950/20 lg:sticky lg:top-6">
          <div className="mb-6">
            <div className="flex items-center justify-between gap-3 rounded-3xl bg-slate-950 px-4 py-4 shadow-inner shadow-slate-950/60">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">AgentHub</p>
                <h2 className="text-xl font-semibold">War Room</h2>
              </div>
              <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">Dark</span>
            </div>
          </div>

          <div className="space-y-2">
            {NAV_ITEMS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setActiveNav(item)}
                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-medium transition ${
                  activeNav === item
                    ? 'border-violet-500 bg-violet-500/10 text-slate-50 shadow-[0_0_0_1px_rgba(139,92,246,0.35)]'
                    : 'border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700 hover:bg-slate-900/80'
                }`}
              >
                <span>{item}</span>
                <span className="text-xs text-slate-500">↗</span>
              </button>
            ))}
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Agent Status</p>
                <h3 className="text-lg font-semibold">Live Overview</h3>
              </div>
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">4 agents</span>
            </div>
            <div className="space-y-3">
              {AGENTS.map((agent) => (
                <div key={agent.id} className="rounded-3xl border border-slate-800 bg-slate-950 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-xl">{agent.avatar}</div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="truncate text-sm font-semibold text-slate-100">{agent.name}</h4>
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          {agent.statusLabel}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">{agent.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="space-y-6">
          <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-6 shadow-xl shadow-slate-950/20">
            <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">War Room</p>
                <h1 className="text-3xl font-semibold text-slate-100">Multi-Agent Collaboration</h1>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
                  实时对话、任务决策与执行时间线在一个暗色 War Room 中融合，适用于 PM、Frontend、Backend、QA 的协同开发。
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-3xl border border-slate-800 bg-slate-950/80 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Active stream</p>
                  <p className="mt-2 text-sm font-medium text-slate-100">PM → Backend → Frontend</p>
                </div>
                <div className="rounded-3xl border border-slate-800 bg-slate-950/80 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Decision</p>
                  <p className="mt-2 text-sm font-medium text-slate-100">Approve task cards instantly</p>
                </div>
              </div>
            </div>

            <div className="space-y-5">
              {MESSAGES.map((message) => (
                <div key={message.id} className="rounded-3xl border border-slate-800 bg-slate-950/90 p-5 shadow-inner shadow-slate-950/10">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{message.speaker}</p>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{message.role}</p>
                    </div>
                    <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400">{message.tone}</span>
                  </div>
                  <p className="mt-4 text-slate-300 leading-7">{message.content}</p>
                </div>
              ))}

              <div className="rounded-[2rem] border border-violet-500/30 bg-slate-950/90 p-5 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.15)]">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-violet-300/80">Interactive Task Card</p>
                    <h2 className="mt-2 text-2xl font-semibold text-slate-100">{TASK_CARD.title}</h2>
                    <p className="mt-3 text-sm leading-7 text-slate-400">{TASK_CARD.description}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {TASK_CARD.owners.map((owner) => (
                      <span key={owner} className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                        {owner}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                    <p className="text-sm text-slate-400">Status</p>
                    <p className="mt-2 text-lg font-semibold text-slate-100">{taskStateLabel}</p>
                    <p className="mt-3 text-sm text-slate-500">{TASK_CARD.due}</p>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => setTaskState('approved')}
                      disabled={taskState === 'approved'}
                      className="flex-1 rounded-3xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition enabled:hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-800/50"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaskState('rejected')}
                      disabled={taskState === 'rejected'}
                      className="flex-1 rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-100 transition enabled:hover:border-slate-600 enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-500"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-6 shadow-xl shadow-slate-950/20">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Execution Timeline</p>
                <h2 className="text-2xl font-semibold text-slate-100">Horizontal Swimlanes</h2>
              </div>
              <p className="text-sm text-slate-400 max-w-xl">
                Backend 完成后自动触发 QA，任务依赖与节点状态一目了然。
              </p>
            </div>

            <div className="overflow-x-auto pb-3">
              <div className="min-w-[760px] rounded-[2rem] border border-slate-800 bg-slate-950/80 p-6">
                <div className="grid gap-4">
                  {TIMELINE_STEPS.map((step, index) => (
                    <div key={step.lane} className="rounded-3xl border border-slate-800 bg-slate-900/90 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{step.lane}</p>
                          <h3 className="mt-2 text-lg font-semibold text-slate-100">{step.title}</h3>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          step.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-300' : step.status === 'Pending' ? 'bg-amber-500/10 text-amber-300' : 'bg-slate-800 text-slate-300'
                        }`}>
                          {step.status}
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-slate-400">{step.detail}</p>
                      {index < TIMELINE_STEPS.length - 1 && (
                        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                          <span>Triggers next lane when complete</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-6 rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5 shadow-xl shadow-slate-950/20 lg:sticky lg:top-6">
          <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-slate-500">File Sandbox</p>
                <h2 className="text-lg font-semibold text-slate-100">dashboard.tsx</h2>
              </div>
              <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400">Live</span>
            </div>
            <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-950 p-4 text-sm leading-6 text-slate-300">
              <pre className="max-h-[260px] overflow-y-auto text-xs"><code>{CODE_SNIPPET}</code></pre>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Live Preview</p>
                <p className="mt-1 text-sm text-slate-400">快速查看渲染结果</p>
              </div>
              <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400">React</span>
            </div>
            <div className="mt-4 rounded-[1.75rem] border border-slate-800 bg-slate-900 p-4">
              <div className="rounded-3xl bg-slate-950/70 p-5 text-slate-200 shadow-inner shadow-slate-950/30">
                <h3 className="text-lg font-semibold">AI Collaboration</h3>
                <p className="mt-2 text-sm text-slate-400">实时任务卡和执行状态，支持立即批准 / 拒绝。</p>
                <div className="mt-4 grid gap-3">
                  <div className="rounded-3xl bg-slate-900 p-3 text-sm text-slate-300">Chat • Tasks • Files • Timeline</div>
                  <div className="rounded-3xl bg-slate-950/80 p-3 text-sm text-slate-300">Backend API complete → QA triggered</div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Code Diff</p>
                <p className="mt-1 text-sm text-slate-400">最近改动预览</p>
              </div>
              <div className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400">3 changes</div>
            </div>
            <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-900 p-4 text-sm font-mono leading-6 text-slate-300">
              <pre className="max-h-[180px] overflow-y-auto text-xs"><code>{DIFF_SNIPPET}</code></pre>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
