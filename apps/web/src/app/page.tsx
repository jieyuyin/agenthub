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

const TIMELINE_LANES = [
  { id: 'PM', avatar: '🧠', role: 'Product Manager' },
  { id: 'Frontend', avatar: '🎨', role: 'UI Engineer' },
  { id: 'Backend', avatar: '⚙️', role: 'API Engineer' },
  { id: 'QA', avatar: '🧪', role: 'Quality' },
];

const TIMELINE_STEPS = ['需求拆解', 'UI 开发', 'API 开发', '端到端测试'];

export default function HomePage() {
  const [activeNav, setActiveNav] = useState('Chat');
  const [workflowPhase, setWorkflowPhase] = useState<'pending' | 'running' | 'bug' | 'rejected'>('pending');
  const [showCanvas, setShowCanvas] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const taskStateLabel = useMemo(() => {
    if (workflowPhase === 'rejected') return 'Rejected';
    return workflowPhase === 'pending' ? 'Pending review' : 'Approved';
  }, [workflowPhase]);

  const devActive = workflowPhase !== 'pending';
  const qaFailed = workflowPhase === 'bug' || workflowPhase === 'rejected';

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 lg:p-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-8">
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
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
                <button
                  type="button"
                  onClick={() => setShowCanvas(true)}
                  className="inline-flex items-center gap-2 rounded-3xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-600 hover:bg-slate-900"
                >
                  <span>🖥</span>
                  Dynamic Canvas
                </button>
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-3xl border border-slate-800 bg-slate-950/90 p-5 shadow-inner shadow-slate-950/10">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">你</p>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Human - 任务发布者</p>
                  </div>
                </div>
                <p className="mt-4 text-slate-300 leading-7">
                  我们需要开发一个用户登录页面，支持邮箱密码登录。前端需要考虑响应式布局，后端需要对接现有的 JWT 鉴权接口。请大家协作完成。
                </p>
              </div>

              <div className="rounded-[2rem] border border-violet-500/30 bg-slate-950/90 p-5 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.15)]">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-xl">👔</span>
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-violet-300/80">PM Agent</p>
                        <h2 className="mt-2 text-2xl font-semibold text-slate-100">正在解析需求，评估技术栈...</h2>
                      </div>
                    </div>
                    <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 text-sm text-slate-300">
                      <p className="font-semibold text-slate-100">需求拆解与任务分配清单</p>
                      <ul className="mt-3 space-y-2 pl-4 text-slate-300">
                        <li>• [Task-01] @Frontend：开发登录页 UI，处理表单校验与 React 状态管理。</li>
                        <li>• [Task-02] @Backend：提供 JWT 登录 API 接口并输出规范文档。</li>
                        <li>• [Task-03] @QA：基于前后端产出编写并执行端到端（E2E）集成测试。</li>
                      </ul>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:w-56">
                    <button
                      type="button"
                      onClick={() => setWorkflowPhase('bug')}
                      className="rounded-3xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                    >
                      批准并执行
                    </button>
                    <button
                      type="button"
                      onClick={() => setWorkflowPhase('pending')}
                      className="rounded-3xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-600 hover:bg-slate-800"
                    >
                      修改计划
                    </button>
                  </div>
                </div>
              </div>

              {devActive && (
                <>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-3xl border border-slate-800 bg-slate-950/90 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Backend Agent</p>
                          <h3 className="text-lg font-semibold text-slate-100">后端</h3>
                        </div>
                        <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">🟢 Backend 状态：API 开发中...</span>
                      </div>
                      <p className="mt-4 text-slate-300">收到。JWT Auth API 规范已提取，正在构建 Mock 环境供前端使用。</p>
                      <p className="mt-3 text-xs text-slate-500">📎 auth_api_spec.json</p>
                    </div>
                    <div className="rounded-3xl border border-slate-800 bg-slate-950/90 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Frontend Agent</p>
                          <h3 className="text-lg font-semibold text-slate-100">前端</h3>
                        </div>
                        <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">🟢 Frontend 状态：编码中...</span>
                      </div>
                      <p className="mt-4 text-slate-300">收到 API 规范。正在构建组件与 CSS 布局...</p>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-800 bg-slate-950/90 p-5">
                    <p className="text-sm font-semibold text-slate-100">Frontend & Backend</p>
                    <p className="mt-3 text-slate-300">联调完毕，代码已提交至主分支沙盒。 @QA 请进行评估。</p>
                  </div>

                  <div className={`rounded-[2rem] border p-5 ${qaFailed ? 'border-red-500/40 bg-red-950/80' : 'border-dashed border-slate-600 bg-slate-950/80'}`}>
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${qaFailed ? 'bg-red-500/10 text-red-300' : 'bg-slate-800 text-slate-300'}`}>🕵️</span>
                      <div>
                        <p className="text-sm font-semibold text-slate-100">QA Agent</p>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">测试</p>
                      </div>
                    </div>
                    <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                      <p>⚙️ 正在运行自动化测试脚本...</p>
                      <p className="font-semibold text-slate-100">🔴 测试报告：未通过 (1 Bug Found)</p>
                      <p>Bug 详情：密码输入错误时，前端未正确捕获接口返回的 401 状态码，未显示红色的错误提示语。</p>
                      <p className="text-xs text-slate-500">责任方： @Frontend</p>
                      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-3 text-sm text-slate-300">
                        📎 View Diff
                      </div>
                    </div>
                    {qaFailed && (
                      <div className="mt-4 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => setWorkflowPhase('rejected')}
                          className="rounded-3xl bg-red-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-red-400"
                        >
                          一键退回重做
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="rounded-3xl border border-slate-800 bg-slate-950/90 p-4">
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <textarea
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      placeholder="输入消息或意见...（Ctrl+Enter 发送）"
                      className="w-full resize-none rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                      rows={3}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) && inputValue.trim()) {
                          setInputValue('');
                        }
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (inputValue.trim()) {
                        setInputValue('');
                      }
                    }}
                    className="flex-shrink-0 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-violet-400 active:bg-violet-600"
                  >
                    发送
                  </button>
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
              <div className="min-w-[980px] rounded-[2rem] border border-slate-800 bg-slate-950/80 p-6">
                <div className="mb-4 flex items-center justify-between text-slate-400">
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Time axis</div>
                  <div className="flex items-center gap-8 text-sm">
                    <span className="font-medium text-slate-300">Step 1</span>
                    <span className="font-medium text-slate-300">Step 2</span>
                    <span className="font-medium text-slate-300">Step 3</span>
                    <span className="font-medium text-slate-300">Step 4</span>
                  </div>
                </div>

                <div className="relative overflow-hidden rounded-[1.75rem] border border-slate-800 bg-slate-900/90 p-6">
                  <div className="absolute left-[180px] right-6 top-24 h-px bg-slate-800/60" />

                  <div className="space-y-8">
                    {TIMELINE_LANES.map((lane) => (
                      <div key={lane.id} className="grid grid-cols-[180px_minmax(0,1fr)] items-center gap-4">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-800 text-xl">{lane.avatar}</span>
                          <div>
                            <p className="text-sm font-semibold text-slate-100">{lane.id}</p>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{lane.role}</p>
                          </div>
                        </div>

                        <div className="relative h-24">
                          <div className="absolute inset-y-1/2 left-0 right-0 h-px bg-slate-800/60" />

                          {lane.id === 'PM' && (
                            <div className="absolute left-[6%] top-1/2 w-44 -translate-y-1/2 rounded-3xl border border-emerald-400 bg-emerald-500/10 p-4 text-sm text-emerald-200 shadow-[0_0_0_1px_rgba(52,211,153,0.15)]">
                              <div className="flex items-center gap-2 font-semibold">
                                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-green-300">✅</span>
                                需求拆解
                              </div>
                            </div>
                          )}

                          {lane.id === 'Frontend' && (
                            <div className="absolute left-[34%] top-1/2 w-44 -translate-y-1/2 rounded-3xl border border-sky-400 bg-sky-500/10 p-4 text-sm text-slate-100 shadow-[0_0_0_1px_rgba(56,189,248,0.15)]">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold">UI 开发</span>
                                <span className="text-xs text-slate-400 animate-pulse">⌛</span>
                              </div>
                              <div className="mt-3 h-1 rounded-full bg-slate-800">
                                <div className="h-full w-2/3 rounded-full bg-sky-400 animate-pulse" />
                              </div>
                            </div>
                          )}

                          {lane.id === 'Backend' && (
                            <div className="absolute left-[34%] top-1/2 w-44 -translate-y-1/2 rounded-3xl border border-sky-400 bg-sky-500/10 p-4 text-sm text-slate-100 shadow-[0_0_0_1px_rgba(56,189,248,0.15)]">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold">API 开发</span>
                                <span className="text-xs text-slate-400 animate-pulse">💻</span>
                              </div>
                              <div className="mt-3 h-1 rounded-full bg-slate-800">
                                <div className="h-full w-1/2 rounded-full bg-sky-400 animate-pulse" />
                              </div>
                            </div>
                          )}

                          {lane.id === 'QA' && (
                            <div className={`absolute left-[72%] top-1/2 w-48 -translate-y-1/2 rounded-3xl p-4 text-sm ${qaFailed ? 'border border-red-400 bg-red-950/80 text-red-200' : 'border border-dashed border-slate-600 bg-slate-950/80 text-slate-300'}`}>
                              <div className="flex items-center gap-2 font-semibold">
                                <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${qaFailed ? 'bg-red-500/10 text-red-300' : 'bg-slate-800/80 text-slate-300'}`}>
                                  {qaFailed ? '⚠️' : '⏳'}
                                </span>
                                端到端测试
                              </div>
                              <p className="mt-3 text-xs text-slate-500">
                                {qaFailed
                                  ? 'QA 发现 Bug，正在退回 Frontend 进行修复'
                                  : '等待 Frontend 与 Backend 完成后执行'}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <svg className="pointer-events-none absolute left-0 top-0 h-full w-full" viewBox="0 0 980 320" fill="none">
                    <defs>
                      <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse">
                        <path d="M0 0L8 4L0 8" fill="#f87171" />
                      </marker>
                    </defs>
                    <path d="M240 120 C 320 120, 320 170, 400 170" stroke="#38bdf8" strokeWidth="2" />
                    <path d="M240 120 C 320 120, 320 80, 400 80" stroke="#38bdf8" strokeWidth="2" />
                    <path d="M620 80 C 700 80, 700 150, 760 150" stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 4" />
                    <path d="M620 170 C 700 170, 700 150, 760 150" stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 4" />
                    <path d="M760 150 C 820 150, 840 260, 500 260" stroke="#f87171" strokeWidth="2" strokeDasharray="6 4" markerEnd="url(#arrow)" />
                    <text x="620" y="40" className="text-xs fill-red-400" fontFamily="Inter, ui-sans-serif" fontSize="12">Bug Fix</text>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="hidden">
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
      {showCanvas && (
        <div className="fixed inset-0 z-50 flex items-start justify-end bg-slate-950/80 p-6">
          <div className="w-full max-w-3xl overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-900/95 shadow-2xl shadow-slate-950/40">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Dynamic Canvas</p>
                <h2 className="text-lg font-semibold text-slate-100">文件与代码沙盒</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowCanvas(false)}
                className="rounded-full bg-slate-800 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-700"
              >
                关闭
              </button>
            </div>

            <div className="grid gap-6 p-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-6">
                <div className="rounded-3xl border border-slate-800 bg-slate-950/90 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">File Sandbox</p>
                      <h3 className="mt-2 text-lg font-semibold text-slate-100">dashboard.tsx</h3>
                    </div>
                    <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400">Live</span>
                  </div>
                  <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-900 p-4 text-sm leading-6 text-slate-300">
                    <pre className="max-h-[340px] overflow-y-auto text-xs"><code>{CODE_SNIPPET}</code></pre>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-950/90 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Code Diff</p>
                      <h3 className="mt-2 text-lg font-semibold text-slate-100">最近改动</h3>
                    </div>
                    <div className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400">3 changes</div>
                  </div>
                  <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-900 p-4 text-sm font-mono leading-6 text-slate-300">
                    <pre className="max-h-[240px] overflow-y-auto text-xs"><code>{DIFF_SNIPPET}</code></pre>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-950/90 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Live Preview</p>
                    <h3 className="mt-2 text-lg font-semibold text-slate-100">实时预览</h3>
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
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
