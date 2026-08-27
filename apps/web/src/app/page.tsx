'use client';

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import type { Socket } from 'socket.io-client';
import { createSocket } from '@/lib/socket';
import { fetchJson } from '@/lib/api';
import { AIMessageContent } from '@/components/chat/AIMessageContent';

type Message = { id: string; conversationId?: string; speaker: string; role: string; content: string; agentId?: string; createdAt?: string };
type RuntimePreset = 'local' | 'docker-service' | 'sandbox';
type ProjectRuntimeConfig = { preset: RuntimePreset; agentRuntime: 'local' | 'docker'; serviceRuntime: 'local' | 'docker' };
type Project = { id: string; name: string; fileCount?: number; context?: string; workspaceToken?: string; desktop?: boolean; runtimeConfig: ProjectRuntimeConfig };
type ConversationItem = { id: string; title: string; projectId: string | null; messages: Message[] };
type Modal = 'project' | 'runtime' | 'login' | null;
type SettingsTab = 'profile' | 'model';
type SavedModel = { id: string; provider: string; baseUrl: string; modelId: string; active: boolean; apiKeyConfigured: boolean; apiKeyHint: string };
type DesktopToolRequest = { requestId: string; conversationId: string; workspaceToken: string; name: string; arguments: Record<string, unknown> };
type DiagnosticStep = { conversationId: string; phase: 'inspect' | 'reproduce' | 'diagnose' | 'patch' | 'verify' | 'completed' | 'blocked'; status: 'running' | 'completed' | 'failed'; label: string; detail?: string; timestamp: string };
type ConversationDiff = { conversationId: string; repository: string; files: Array<{ path: string; additions: number; deletions: number; binary?: boolean }>; diff: string; timestamp: string };
type RenderedDiffLine = { content: string; kind: 'context' | 'add' | 'remove' | 'hunk' | 'file'; oldLine?: number; newLine?: number };

const Icon = ({ children, size = 18 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>;
const ChatIcon = () => <Icon><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /><path d="M8 9h8M8 13h5" /></Icon>;
const NewConversationIcon = () => <Icon size={16}><path d="M20 11.5V7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h4.5" /><path d="M16 15v6M13 18h6" /></Icon>;
const SettingsIcon = () => <Icon size={15}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56V20.3h-3v-.08a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 15a1.7 1.7 0 0 0-1.56-1.04H5.3v-3h.14A1.7 1.7 0 0 0 7 9.92a1.7 1.7 0 0 0-.34-1.88L6.6 7.98l2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.7 4.7v-.08h3v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.04h.14v3h-.14A1.7 1.7 0 0 0 19.4 15Z" /></Icon>;

const LOCAL_RUNTIME: ProjectRuntimeConfig = { preset: 'local', agentRuntime: 'local', serviceRuntime: 'local' };
const RUNTIME_PRESETS: Record<RuntimePreset, ProjectRuntimeConfig> = {
  local: LOCAL_RUNTIME,
  'docker-service': { preset: 'docker-service', agentRuntime: 'local', serviceRuntime: 'docker' },
  sandbox: { preset: 'sandbox', agentRuntime: 'docker', serviceRuntime: 'docker' }
};

function savedRuntimeConfig(projectId: string, projectName?: string): ProjectRuntimeConfig {
  try {
    const saved = window.localStorage.getItem(`agenthub:runtime:${projectId}`)
      || (projectName ? window.localStorage.getItem(`agenthub:runtime-name:${projectName}`) : null);
    const value = JSON.parse(saved || 'null') as ProjectRuntimeConfig | null;
    return value && value.preset in RUNTIME_PRESETS ? RUNTIME_PRESETS[value.preset] : LOCAL_RUNTIME;
  } catch { return LOCAL_RUNTIME; }
}

function runtimePresetLabel(config?: ProjectRuntimeConfig) {
  if (config?.preset === 'docker-service') return 'Docker 运行'
  if (config?.preset === 'sandbox') return '完全隔离'
  return '本地开发'
}
const FolderIcon = () => <Icon><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2h7.5A2.5 2.5 0 0 1 21 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5Z" /></Icon>;
const ChevronIcon = ({ open }: { open: boolean }) => <Icon size={15}><path d={open ? 'm6 9 6 6 6-6' : 'm9 18 6-6-6-6'} /></Icon>;
const MoreIcon = () => <Icon><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></Icon>;
const SendIcon = () => <Icon size={17}><path d="m5 12 7-7 7 7M12 19V5" /></Icon>;
const StopIcon = () => <Icon size={15}><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" /></Icon>;
const CopyIcon = () => <Icon size={14}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Icon>;
const EditIcon = () => <Icon size={14}><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></Icon>;
const CloseIcon = () => <Icon><path d="m6 6 12 12M18 6 6 18" /></Icon>;
const BackIcon = () => <Icon><path d="m15 18-6-6 6-6" /></Icon>;
const ProfileIcon = () => <Icon><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></Icon>;
const ModelIcon = () => <Icon><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M9 9h6v6H9zM12 1v3M12 20v3M1 12h3M20 12h3" /></Icon>;
const HistoryIcon = () => <Icon><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></Icon>;

function normalizeDiffText(value: string) {
  let text = String(value || '')
  if (text.startsWith('"') && text.endsWith('"')) {
    try { text = JSON.parse(text) } catch {}
  }
  const escapedLines = (text.match(/\\n/g) || []).length
  const realLines = (text.match(/\n/g) || []).length
  if (escapedLines > realLines) text = text.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
  return text
    .replace(/\r\n/g, '\n')
    .replace(/&#x20;|&nbsp;/gi, ' ')
    .replace(/^\\(?=(?:\+|-){1,3}(?:\s|$))/gm, '')
}

function renderDiffLines(value: string): RenderedDiffLine[] {
  let oldLine = 0
  let newLine = 0
  const output: RenderedDiffLine[] = []
  for (const content of normalizeDiffText(value).split('\n')) {
    const fileHeader = content.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (fileHeader) {
      output.push({ content: fileHeader[2], kind: 'file' })
      continue
    }
    if (content.startsWith('index ') || content.startsWith('--- ') || content.startsWith('+++ ')) continue
    const hunk = content.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      output.push({ content, kind: 'hunk' })
      continue
    }
    if (content.startsWith('new file')) {
      output.push({ content, kind: 'file' })
      continue
    }
    if (content.startsWith('+')) output.push({ content, kind: 'add', newLine: newLine++ })
    else if (content.startsWith('-')) output.push({ content, kind: 'remove', oldLine: oldLine++ })
    else output.push({ content, kind: 'context', oldLine: oldLine++, newLine: newLine++ })
  }
  return output
}

function getAgentProfile(agentId?: string) {
  const key = (agentId || 'agent').replace(/-agent$/, '').toLowerCase();
  const profiles: Record<string, { avatar: string; name: string; role: string }> = {
    assistant: { avatar: 'AI', name: 'AI Assistant', role: '通用助手' },
    orchestrator: { avatar: 'PA', name: 'Project Assistant', role: 'AI 技术负责人' },
    planner: { avatar: 'PL', name: 'Planner', role: '规划工程师' },
    developer: { avatar: 'DE', name: 'Developer', role: '开发工程师' },
    tester: { avatar: 'TE', name: 'Tester', role: '测试工程师' },
    debugger: { avatar: 'DB', name: 'Debug Agent', role: '问题诊断工程师' },
    pm: { avatar: 'PL', name: 'Planner', role: '规划工程师' },
    frontend: { avatar: 'DE', name: 'Developer', role: '开发工程师' },
    backend: { avatar: 'DE', name: 'Developer', role: '开发工程师' },
    qa: { avatar: 'TE', name: 'Tester', role: '测试工程师' }
  };
  return profiles[key] || { avatar: 'AI', name: 'Agent', role: agentId || 'AI Agent' };
}

function getToolStatusLabel(toolName?: string, running = true) {
  const prefix = running ? '正在' : '已完成'
  if (['list_files', 'read_file'].includes(toolName || '')) return `${prefix}读取文件`
  if (['git_status', 'git_branches', 'git_diff'].includes(toolName || '')) return `${prefix}检查 Git`
  if (toolName === 'git_clone') return running ? '正在克隆仓库' : '仓库已克隆'
  if (toolName === 'git_pull') return running ? '正在拉取代码' : '代码已更新'
  if (toolName === 'git_checkout') return running ? '正在切换分支' : '分支已切换'
  if (toolName === 'git_commit') return running ? '正在创建提交' : '提交已创建'
  if (toolName === 'continuing_build') return running ? '正在继续完成项目' : '项目处理已结束'
  if (['write_file', 'apply_patch', 'create_directory'].includes(toolName || '')) return `${prefix}编辑文件`
  if (toolName === 'run_command') return `${prefix}运行命令`
  if (toolName === 'start_service') return running ? '正在启动服务' : '服务已启动'
  if (toolName === 'service_status') return `${prefix}检查服务`
  if (toolName === 'stop_service') return running ? '正在停止服务' : '服务已停止'
  return running ? '正在处理' : '处理已结束'
}

function getApprovalDescription(toolName: string) {
  if (toolName === 'git_clone') return 'AI 请求克隆远程仓库'
  if (toolName === 'git_pull') return 'AI 请求拉取远程代码'
  if (toolName === 'git_checkout') return 'AI 请求切换 Git 分支'
  if (toolName === 'git_commit') return 'AI 请求创建 Git 提交'
  if (toolName === 'start_service') return 'AI 请求启动后台服务'
  if (toolName === 'stop_service') return 'AI 请求停止后台服务'
  if (toolName === 'run_command') return 'AI 请求执行命令'
  return 'AI 请求进行大范围文件修改'
}

function getApprovalDetail(request: DesktopToolRequest) {
  if (request.name === 'git_clone') return `${String(request.arguments.url ?? '')}\n→ ${String(request.arguments.target ?? '')}`
  if (request.name === 'git_pull') return `仓库 ${String(request.arguments.repository ?? '.')} · ${String(request.arguments.branch ?? '当前分支')}`
  if (request.name === 'git_checkout') return `仓库 ${String(request.arguments.repository ?? '.')} → ${String(request.arguments.branch ?? '')}`
  if (request.name === 'git_commit') return `${String(request.arguments.message ?? '')}\n文件：${Array.isArray(request.arguments.paths) ? request.arguments.paths.join(', ') : ''}`
  if (['run_command', 'start_service'].includes(request.name)) return String(request.arguments.command ?? '')
  if (request.name === 'stop_service') return `服务 ${String(request.arguments.serviceId ?? '')}`
  return `${request.name}  ${String(request.arguments.path ?? '')}`
}

async function buildProjectContext(files: File[]) {
  const ignored = /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|vendor)(\/|$)/i;
  const preferredName = /(^|\/)(readme[^/]*|package\.json|pnpm-workspace\.yaml|pyproject\.toml|requirements\.txt|cargo\.toml|go\.mod|docker-compose[^/]*|compose[^/]*|\.env\.example)$/i;
  const textExtension = /\.(md|txt|json|ya?ml|toml|js|jsx|ts|tsx|py|java|go|rs|c|cc|cpp|h|hpp|css|scss|html|vue|svelte|sql|prisma|graphql|sh)$/i;
  const available = files
    .map((file) => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }))
    .filter(({ path }) => !ignored.test(path));
  const manifest = available.slice(0, 300).map(({ path }) => path).join('\n');
  const readable = available
    .filter(({ path, file }) => file.size <= 200_000 && (preferredName.test(path) || textExtension.test(path)))
    .sort((a, b) => Number(preferredName.test(b.path)) - Number(preferredName.test(a.path)))
    .slice(0, 60);
  const sections: string[] = [];
  let totalChars = 0;
  for (const { file, path } of readable) {
    if (totalChars >= 240_000) break;
    const text = (await file.text()).slice(0, Math.min(20_000, 240_000 - totalChars));
    sections.push(`\n--- FILE: ${path} ---\n${text}`);
    totalChars += text.length;
  }
  return `项目文件清单（最多 300 项）：\n${manifest}\n\n关键文件内容：${sections.join('')}`;
}

export default function HomePage() {
  const socketRef = useRef<Socket | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const activeConversationRef = useRef<string | null>(null);
  const generatingConversationsRef = useRef(new Set<string>());
  const toolRunningConversationsRef = useRef(new Set<string>());
  const activeToolsByConversationRef = useRef(new Map<string, DesktopToolRequest>());
  const approvalsByConversationRef = useRef(new Map<string, DesktopToolRequest>());
  const diagnosticsByConversationRef = useRef(new Map<string, DiagnosticStep[]>());
  const diffsByConversationRef = useRef(new Map<string, ConversationDiff>());
  const compactingConversationsRef = useRef(new Set<string>());
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [connected, setConnected] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [email, setEmail] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile');
  const [chatModels, setChatModels] = useState<SavedModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [draftProjectId, setDraftProjectId] = useState('');
  const [desktopWorkspace, setDesktopWorkspace] = useState<{ token: string; name: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [toolRunning, setToolRunning] = useState(false);
  const [runningDots, setRunningDots] = useState(3);
  const [activeTool, setActiveTool] = useState<DesktopToolRequest | null>(null);
  const [pendingApproval, setPendingApproval] = useState<DesktopToolRequest | null>(null);
  const [toolDetailsOpen, setToolDetailsOpen] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [diagnosticSteps, setDiagnosticSteps] = useState<DiagnosticStep[]>([]);
  const [conversationDiff, setConversationDiff] = useState<ConversationDiff | null>(null);
  const [diffDrawerOpen, setDiffDrawerOpen] = useState(false);
  const [contextCompacting, setContextCompacting] = useState(false);
  const [runtimeProjectId, setRuntimeProjectId] = useState<string | null>(null);

  useEffect(() => {
    const savedUser = window.localStorage.getItem('agenthub:user');
    if (savedUser) setUser(JSON.parse(savedUser));
    const socket = createSocket();
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnected(true);
      if (window.agenthubDesktop?.isDesktop) socket.emit('desktop:register');
    });
    socket.on('desktop:tool-request', async (request: DesktopToolRequest) => {
      activeToolsByConversationRef.current.set(request.conversationId, request);
      if (request.conversationId === activeConversationRef.current) setActiveTool(request);
      const contentLength = String(request.arguments.content ?? '').length;
      const patchLength = String(request.arguments.oldContent ?? '').length + String(request.arguments.newContent ?? '').length;
      const needsApproval = ['run_command', 'start_service', 'stop_service', 'git_clone', 'git_pull', 'git_checkout', 'git_commit'].includes(request.name) || (request.name === 'write_file' && contentLength > 50_000) || (request.name === 'apply_patch' && patchLength > 20_000);
      if (needsApproval) {
        approvalsByConversationRef.current.set(request.conversationId, request);
        if (request.conversationId === activeConversationRef.current) setPendingApproval(request);
        return;
      }
      try {
        if (!window.agenthubDesktop) throw new Error('当前不是 AgentHub Desktop')
        const result = await window.agenthubDesktop.invokeTool(request)
        socket.emit('desktop:tool-result', { requestId: request.requestId, ok: true, result })
      } catch (error) {
        if (error instanceof Error && error.message.includes('APPROVAL_REQUIRED')) {
          approvalsByConversationRef.current.set(request.conversationId, request);
          if (request.conversationId === activeConversationRef.current) setPendingApproval(request);
          return;
        }
        socket.emit('desktop:tool-result', { requestId: request.requestId, ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    });
    if (window.agenthubDesktop) {
      void window.agenthubDesktop.getWorkspace().then((workspace) => {
        if (!workspace) return;
        setDesktopWorkspace(workspace);
        const id = `desktop-${workspace.token}`;
        setProjects((current) => current.some((project) => project.id === id)
          ? current
          : [...current, { id, name: workspace.name, workspaceToken: workspace.token, desktop: true, runtimeConfig: savedRuntimeConfig(id, workspace.name) }]);
      });
    }
    const clearActivity = () => {
      generatingConversationsRef.current.clear();
      toolRunningConversationsRef.current.clear();
      activeToolsByConversationRef.current.clear();
      approvalsByConversationRef.current.clear();
      setIsGenerating(false);
      setToolRunning(false);
      setActiveTool(null);
      setPendingApproval(null);
    };
    socket.on('disconnect', () => { setConnected(false); clearActivity(); });
    socket.on('connect_error', () => { setConnected(false); clearActivity(); });
    socket.on('message', (message: Message) => {
      if (message.role !== 'user') setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
    });
    socket.on('message:stream', (chunk: Message) => {
      if (chunk.conversationId && chunk.conversationId !== activeConversationRef.current) return;
      setMessages((current) => {
        const match = current.findIndex((item) => item.id === chunk.id);
        if (match < 0) return [...current, { ...chunk, content: chunk.content || '', speaker: chunk.agentId || 'Agent' }];
        const next = [...current];
        next[match] = { ...next[match], content: next[match].content + (chunk.content || '') };
        return next;
      });
    });
    socket.on('agent:typing', (event: { conversationId?: string; typing?: boolean }) => {
      const conversationId = event.conversationId;
      if (conversationId) {
        if (event.typing) generatingConversationsRef.current.add(conversationId);
        else {
          generatingConversationsRef.current.delete(conversationId);
          toolRunningConversationsRef.current.delete(conversationId);
          activeToolsByConversationRef.current.delete(conversationId);
        }
      }
      if (conversationId && conversationId !== activeConversationRef.current) return;
      setIsGenerating(Boolean(event.typing));
      if (!event.typing) { setToolRunning(false); setActiveTool(null); }
    });
    socket.on('tool:status', (event: { conversationId?: string; running?: boolean; tool?: string }) => {
      const conversationId = event.conversationId;
      if (conversationId) {
        if (event.running) toolRunningConversationsRef.current.add(conversationId);
        else {
          toolRunningConversationsRef.current.delete(conversationId);
          activeToolsByConversationRef.current.delete(conversationId);
        }
      }
      if (conversationId && conversationId !== activeConversationRef.current) return;
      setToolRunning(Boolean(event.running));
      if (event.running && event.tool && conversationId) {
        setActiveTool({ requestId: `status-${event.tool}`, conversationId, workspaceToken: '', name: event.tool, arguments: {} });
      } else if (!event.running) setActiveTool(null);
    });
    socket.on('diagnostic:status', (event: DiagnosticStep) => {
      if (!event.conversationId) return;
      const current = diagnosticsByConversationRef.current.get(event.conversationId) ?? [];
      const existing = current.findIndex((step) => step.phase === event.phase);
      const next = existing < 0
        ? [...current, event]
        : current.map((step, index) => index === existing ? event : step);
      diagnosticsByConversationRef.current.set(event.conversationId, next);
      if (event.conversationId === activeConversationRef.current) setDiagnosticSteps(next);
      if (event.phase === 'completed' || event.phase === 'blocked') {
        window.setTimeout(() => {
          const latest = diagnosticsByConversationRef.current.get(event.conversationId) ?? [];
          if (!latest.some((step) => step.phase === event.phase && step.timestamp === event.timestamp)) return;
          diagnosticsByConversationRef.current.delete(event.conversationId);
          if (event.conversationId === activeConversationRef.current) setDiagnosticSteps([]);
        }, 3500);
      }
    });
    socket.on('conversation:diff', (event: ConversationDiff) => {
      if (!event.conversationId) return;
      diffsByConversationRef.current.set(event.conversationId, event);
      if (event.conversationId === activeConversationRef.current) setConversationDiff(event);
    });
    socket.on('context:status', (event: { conversationId?: string; compacting?: boolean }) => {
      if (!event.conversationId) return;
      if (event.compacting) compactingConversationsRef.current.add(event.conversationId);
      else compactingConversationsRef.current.delete(event.conversationId);
      if (event.conversationId === activeConversationRef.current) setContextCompacting(Boolean(event.compacting));
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    activeConversationRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    if (!toolRunning) { setRunningDots(3); return; }
    const timer = window.setInterval(() => setRunningDots((count) => count >= 6 ? 3 : count + 1), 360);
    return () => window.clearInterval(timer);
  }, [toolRunning]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: isGenerating ? 'auto' : 'smooth', block: 'end' });
  }, [messages, isGenerating, toolRunning, pendingApproval]);

  useEffect(() => {
    if (settingsOpen) return;
    fetchJson<{ models: SavedModel[] }>('/ai/models')
      .then(({ models }) => {
        setChatModels(models);
        setSelectedModelId(models.find((item) => item.active)?.id || models[0]?.id || '');
      })
      .catch(() => {
        setChatModels([]);
        setSelectedModelId('');
      });
  }, [settingsOpen]);

  useEffect(() => {
    if (!activeConversationId) return;
    setConversations((current) => current.map((conversation) => conversation.id === activeConversationId ? { ...conversation, messages } : conversation));
  }, [messages, activeConversationId]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setAccountOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const sendMessage = () => {
    const content = inputValue.trim();
    if (!content || !selectedModelId || isGenerating) return;
    const message: Message = { id: crypto.randomUUID(), speaker: '你', role: 'user', content, createdAt: new Date().toISOString() };
    let conversationId = activeConversationId;
    if (!conversationId) {
      const newConversationId = crypto.randomUUID();
      conversationId = newConversationId;
      activeConversationRef.current = newConversationId;
      setConversations((current) => [{ id: newConversationId, title: content.length > 28 ? `${content.slice(0, 28)}…` : content, projectId: draftProjectId || null, messages: [message] }, ...current]);
      setActiveConversationId(newConversationId);
    }
    setMessages((current) => [...current, message]);
    generatingConversationsRef.current.add(conversationId);
    diagnosticsByConversationRef.current.delete(conversationId);
    diffsByConversationRef.current.delete(conversationId);
    setDiagnosticSteps([]);
    setConversationDiff(null);
    setDiffDrawerOpen(false);
    setContextCompacting(false);
    setIsGenerating(true);
    const selectedProject = projects.find((project) => project.id === draftProjectId);
    socketRef.current?.emit('message:create', { ...message, conversationId, projectId: draftProjectId || null, projectContext: selectedProject?.context, workspaceToken: selectedProject?.workspaceToken || desktopWorkspace?.token, runtimeConfig: selectedProject?.runtimeConfig || LOCAL_RUNTIME });
    setInputValue('');
    setEditingMessageId(null);
  };

  const copyMessage = async (message: Message) => {
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = message.content;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setCopiedMessageId(message.id);
    window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1600);
  };

  const editMessage = (message: Message) => {
    setEditingMessageId(message.id);
    setInputValue(message.content);
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
      composerInputRef.current?.setSelectionRange(message.content.length, message.content.length);
    });
  };

  const stopGeneration = () => {
    const conversationId = activeConversationRef.current;
    if (!conversationId) return;
    if (pendingApproval) {
      socketRef.current?.emit('desktop:tool-result', { requestId: pendingApproval.requestId, ok: false, error: '用户中断了本地操作' });
      approvalsByConversationRef.current.delete(conversationId);
      setPendingApproval(null);
    }
    generatingConversationsRef.current.delete(conversationId);
    toolRunningConversationsRef.current.delete(conversationId);
    activeToolsByConversationRef.current.delete(conversationId);
    socketRef.current?.emit('generation:stop', { conversationId });
    setIsGenerating(false);
    setToolRunning(false);
    setActiveTool(null);
  };

  const resolveToolApproval = async (approved: boolean) => {
    const request = pendingApproval;
    if (!request) return;
    approvalsByConversationRef.current.delete(request.conversationId);
    setPendingApproval(null);
    setConversationDiff(null);
    setDiffDrawerOpen(false);
    setDiagnosticSteps([]);
    if (!approved) {
      socketRef.current?.emit('desktop:tool-result', { requestId: request.requestId, ok: false, error: '用户拒绝了本地操作' });
      return;
    }
    try {
      if (!window.agenthubDesktop) throw new Error('当前不是 AgentHub Desktop');
      const result = await window.agenthubDesktop.invokeTool({ ...request, approved: true });
      socketRef.current?.emit('desktop:tool-result', { requestId: request.requestId, ok: true, result });
    } catch (error) {
      socketRef.current?.emit('desktop:tool-result', { requestId: request.requestId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const addLocalProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const relativePath = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || files[0].name;
    const name = relativePath.split('/')[0] || '本地项目';
    const id = `${name}-${Date.now()}`;
    const context = await buildProjectContext(files);
    setProjects((current) => [...current.filter((project) => project.name !== name), { id, name, fileCount: files.length, context, runtimeConfig: savedRuntimeConfig(id, name) }]);
    setActiveProject(id);
    setProjectsOpen(true);
    setModal(null);
    event.target.value = '';
  };

  const chooseLocalProject = async () => {
    if (!window.agenthubDesktop) {
      fileInputRef.current?.click();
      return;
    }
    const workspace = await window.agenthubDesktop.selectWorkspace();
    if (!workspace) return;
    setDesktopWorkspace(workspace);
    const id = `desktop-${workspace.token}`;
    setProjects((current) => [...current.filter((project) => project.name !== workspace.name), { id, name: workspace.name, workspaceToken: workspace.token, desktop: true, runtimeConfig: savedRuntimeConfig(id, workspace.name) }]);
    setActiveProject(id);
    setDraftProjectId(id);
    setProjectsOpen(true);
    setModal(null);
  };

  const login = () => {
    if (!email.trim()) return;
    const nextUser = { name: email.split('@')[0] || 'AgentHub 用户', email: email.trim() };
    window.localStorage.setItem('agenthub:user', JSON.stringify(nextUser));
    setUser(nextUser);
    setModal(null);
  };
  const logout = () => {
    window.localStorage.removeItem('agenthub:user');
    setUser(null);
    setAccountOpen(false);
  };

  const selectChatModel = async (id: string) => {
    setSelectedModelId(id);
    try {
      await fetchJson(`/ai/models/${id}/activate`, { method: 'POST' });
      setChatModels((current) => current.map((item) => ({ ...item, active: item.id === id })));
    } catch {
      setSelectedModelId(chatModels.find((item) => item.active)?.id || '');
    }
  };

  const startNewConversation = () => {
    activeConversationRef.current = null;
    setActiveConversationId(null);
    setDraftProjectId('');
    setActiveProject('');
    setMessages([]);
    setInputValue('');
    setIsGenerating(false);
    setToolRunning(false);
    setActiveTool(null);
    setPendingApproval(null);
    setContextCompacting(false);
  };

  const startProjectConversation = (projectId: string) => {
    activeConversationRef.current = null;
    setActiveConversationId(null);
    setDraftProjectId(projectId);
    setActiveProject(projectId);
    setMessages([]);
    setInputValue('');
    setIsGenerating(false);
    setToolRunning(false);
    setActiveTool(null);
    setPendingApproval(null);
    setDiagnosticSteps([]);
    setConversationDiff(null);
    setDiffDrawerOpen(false);
    setContextCompacting(false);
    setProjectsOpen(true);
  };

  const openConversation = (conversation: ConversationItem) => {
    activeConversationRef.current = conversation.id;
    setActiveConversationId(conversation.id);
    setDraftProjectId(conversation.projectId || '');
    setMessages(conversation.messages);
    setActiveProject(conversation.projectId || '');
    setIsGenerating(generatingConversationsRef.current.has(conversation.id));
    setToolRunning(toolRunningConversationsRef.current.has(conversation.id));
    setActiveTool(activeToolsByConversationRef.current.get(conversation.id) ?? null);
    setPendingApproval(approvalsByConversationRef.current.get(conversation.id) ?? null);
    setDiagnosticSteps(diagnosticsByConversationRef.current.get(conversation.id) ?? []);
    setConversationDiff(diffsByConversationRef.current.get(conversation.id) ?? null);
    setDiffDrawerOpen(false);
    setContextCompacting(compactingConversationsRef.current.has(conversation.id));
  };

  const changeConversationProject = (projectId: string) => {
    setDraftProjectId(projectId);
    setActiveProject(projectId);
    if (activeConversationId) setConversations((current) => current.map((conversation) => conversation.id === activeConversationId ? { ...conversation, projectId: projectId || null } : conversation));
  };

  const selectProject = (projectId: string) => {
    changeConversationProject(projectId);
    setProjectsOpen(true);
  };

  const openRuntimeSettings = (projectId: string) => {
    setRuntimeProjectId(projectId);
    setModal('runtime');
  };

  const updateRuntimePreset = (preset: RuntimePreset) => {
    if (!runtimeProjectId || isGenerating) return;
    const config = RUNTIME_PRESETS[preset];
    window.localStorage.setItem(`agenthub:runtime:${runtimeProjectId}`, JSON.stringify(config));
    const projectName = projects.find((project) => project.id === runtimeProjectId)?.name;
    if (projectName) window.localStorage.setItem(`agenthub:runtime-name:${projectName}`, JSON.stringify(config));
    setProjects((current) => current.map((project) => project.id === runtimeProjectId ? { ...project, runtimeConfig: config } : project));
    setModal(null);
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        {settingsOpen ? <>
          <button className="back-to-app" type="button" onClick={() => setSettingsOpen(false)}><BackIcon /><span>返回主应用</span></button>
          <div className="settings-nav-title">设置</div>
          <nav className="settings-nav">
            <button type="button" className={settingsTab === 'profile' ? 'active' : ''} onClick={() => setSettingsTab('profile')}><ProfileIcon /><span>个人资料</span></button>
            <button type="button" className={settingsTab === 'model' ? 'active' : ''} onClick={() => setSettingsTab('model')}><ModelIcon /><span>模型配置</span></button>
          </nav>
        </> : <>
        <div className="brand">AgentHub</div>
        <button className="nav-button" type="button" onClick={startNewConversation}><ChatIcon /><span>新对话</span><span className="shortcut">⌘ K</span></button>

        <div className="project-section">
          <div className="project-heading">
            <button type="button" className="project-toggle" onClick={() => setProjectsOpen((open) => !open)} aria-expanded={projectsOpen}><ChevronIcon open={projectsOpen} /><span>项目</span></button>
            <button type="button" className="icon-button" aria-label="添加本地项目" onClick={() => setModal('project')}><PlusIcon /></button>
          </div>
          {projectsOpen && <div className="project-list">{projects.map((project) => (
            <div className="project-group" key={project.id}><div className={`project-row ${activeProject === project.id ? 'active' : ''}`}><button type="button" className="project-item" onClick={() => selectProject(project.id)}>
              <FolderIcon /><span className="project-name">{project.name}</span>{project.desktop ? <span className="file-count">可读写</span> : project.fileCount ? <span className="file-count">{project.fileCount}</span> : null}
            </button><button type="button" className="project-runtime" aria-label={`设置 ${project.name} 的运行方式`} data-tooltip={project.runtimeConfig.preset === 'local' ? '本地开发' : project.runtimeConfig.preset === 'docker-service' ? 'Docker 运行' : '完全隔离'} onClick={() => openRuntimeSettings(project.id)}><SettingsIcon /></button><button type="button" className="project-new-chat" aria-label={`在 ${project.name} 中新建对话`} data-tooltip="新建对话" onClick={() => startProjectConversation(project.id)}><NewConversationIcon /></button></div><div className="project-conversations">{conversations.filter((conversation) => conversation.projectId === project.id).map((conversation) => <button type="button" key={conversation.id} className={activeConversationId === conversation.id ? 'active' : ''} onClick={() => openConversation(conversation)}>{conversation.title}</button>)}</div></div>
          ))}</div>}
        </div>

        <div className="conversation-section">
          <div className="sidebar-section-label"><HistoryIcon /><span>最近对话</span></div>
          <div className="sidebar-conversations">
            {conversations.filter((conversation) => !conversation.projectId).map((conversation) => <button type="button" key={conversation.id} className={activeConversationId === conversation.id ? 'active' : ''} onClick={() => openConversation(conversation)}>{conversation.title}</button>)}
            {!conversations.some((conversation) => !conversation.projectId) && <span className="sidebar-empty">暂无对话</span>}
          </div>
        </div>

        <div className="account-area" ref={menuRef}>
          {accountOpen && <div className="account-menu">{user ? <>
            <button type="button" onClick={() => { setSettingsOpen(true); setSettingsTab('profile'); setAccountOpen(false); }}>设置</button>
            <div className="menu-divider" /><button type="button" className="danger" onClick={logout}>退出登录</button>
          </> : <button type="button" onClick={() => { setModal('login'); setAccountOpen(false); }}>登录 AgentHub</button>}</div>}
          <button type="button" className="account-button" onClick={() => setAccountOpen((open) => !open)}>
            <span className="avatar">{user ? user.name.slice(0, 1).toUpperCase() : '访'}</span>
            <span className="account-copy"><strong>{user?.name || '访客'}</strong><small>{user?.email || '登录以同步项目'}</small></span><MoreIcon />
          </button>
        </div>
        </>}
      </aside>

      <section className="workspace-shell">
        {settingsOpen ? <SettingsContent tab={settingsTab} user={user} /> : <>
        <header className="topbar"><div><span className="eyebrow">当前项目</span><h1>{projects.find((project) => project.id === draftProjectId)?.name || '未选择项目'}</h1></div><span className={`status-pill ${connected ? 'online' : ''}`}><i />{connected ? '服务已连接' : '离线模式'}</span></header>
        <div className="conversation">{messages.length === 0 ? (
          <div className="empty-state"><div className="empty-mark">A</div><h2>今天想一起做点什么？</h2><p>描述一个任务，AgentHub 会和多个智能体协作完成。</p>
            <div className="suggestions"><button onClick={() => setInputValue('分析这个项目并给出改进建议')}>分析当前项目</button><button onClick={() => setInputValue('帮我定位并修复一个问题')}>定位并修复问题</button><button onClick={() => setInputValue('为这个项目添加一个新功能')}>开发新功能</button></div>
          </div>
        ) : <div className="message-list">{messages.map((message) => {
          const isUser = message.role === 'user';
          const agent = getAgentProfile(message.agentId || message.speaker);
          return <article key={message.id} className={`message ${isUser ? 'user-message' : 'agent-message'}`}>
            {!isUser && <div className="message-avatar">{agent.avatar}</div>}
            <div className="message-body">
              {!isUser && <div className="agent-identity"><strong>{agent.name}</strong><span>{agent.role}</span></div>}
              {isUser ? <p>{message.content}</p> : <AIMessageContent content={message.content} />}
              {message.content && <div className="message-actions">
                <button type="button" className="message-action" onClick={() => void copyMessage(message)} aria-label="复制消息" data-tooltip={copiedMessageId === message.id ? '已复制' : '复制消息'}><CopyIcon /></button>
                {isUser && <button type="button" className="message-action" onClick={() => editMessage(message)} aria-label="编辑并重新发送" data-tooltip="编辑并重新发送"><EditIcon /></button>}
              </div>}
            </div>
          </article>;
        })}{contextCompacting && <div className="context-compacting" role="status"><span />正在压缩较早的对话上下文…</div>}{diagnosticSteps.length > 0 && <section className="diagnostic-progress" aria-label="问题诊断进度">
          <header><strong>Debug Agent</strong><span>{diagnosticSteps.some((step) => step.status === 'running') ? '诊断中' : diagnosticSteps.some((step) => step.phase === 'blocked') ? '需要继续处理' : '已完成'}</span></header>
          <ol>{diagnosticSteps.map((step) => <li key={step.phase} className={step.status}>
            <i aria-hidden="true" /><div><strong>{step.label}</strong>{step.detail && <small>{step.detail}</small>}</div>
          </li>)}</ol>
        </section>}{toolRunning && <button type="button" className="tool-running" role="status" onClick={() => setToolDetailsOpen((open) => !open)}><span className="tool-running-mark" /><span>{getToolStatusLabel(activeTool?.name)}{'.'.repeat(runningDots)}</span><small>查看详情</small></button>}
        {pendingApproval && <section className="tool-approval-card">
          <div className="tool-approval-heading"><span className="tool-code-icon">›_</span><div><strong>需要你的允许</strong><p>{getApprovalDescription(pendingApproval.name)}</p></div></div>
          <pre>{getApprovalDetail(pendingApproval)}</pre>
          <div className="tool-approval-actions"><button type="button" onClick={() => void resolveToolApproval(false)}>拒绝</button><button type="button" className="approve" onClick={() => void resolveToolApproval(true)}>允许</button></div>
        </section>}
        {conversationDiff && <button type="button" className="diff-summary-card" onClick={() => setDiffDrawerOpen(true)}>
          <header><div><strong>文件改动</strong><span>{conversationDiff.repository}</span></div><small>查看 Diff ›</small></header>
          <ul>{conversationDiff.files.map((file) => <li key={file.path}><code>{file.path}</code><span><b>+{file.additions}</b><i>-{file.deletions}</i>{file.binary && <em>二进制</em>}</span></li>)}</ul>
          <footer><span>{conversationDiff.files.length} 个文件</span><b>+{conversationDiff.files.reduce((sum, file) => sum + file.additions, 0)}</b><i>-{conversationDiff.files.reduce((sum, file) => sum + file.deletions, 0)}</i></footer>
        </button>}
        {toolDetailsOpen && activeTool && <><button type="button" className="tool-drawer-backdrop" aria-label="关闭工具详情" onClick={() => setToolDetailsOpen(false)} /><aside className="tool-details-drawer" aria-label="工具运行详情"><header><div><span>本地工具</span><strong>运行详情</strong></div><button type="button" aria-label="关闭" onClick={() => setToolDetailsOpen(false)}>×</button></header><div className="tool-drawer-status"><span className={toolRunning ? 'running' : ''} />{getToolStatusLabel(activeTool.name, toolRunning)}</div><section><label>工具</label><code>{activeTool.name}</code></section><section><label>参数与脚本</label><pre>{JSON.stringify(activeTool.arguments, null, 2)}</pre></section></aside></>}<div ref={messageEndRef} className="message-end-anchor" /></div>}</div>
        {diffDrawerOpen && conversationDiff && <><button type="button" className="tool-drawer-backdrop" aria-label="关闭 Diff" onClick={() => setDiffDrawerOpen(false)} /><aside className="tool-details-drawer diff-drawer" aria-label="文件改动 Diff"><header><div><span>{conversationDiff.repository}</span><strong>文件改动</strong></div><button type="button" aria-label="关闭" onClick={() => setDiffDrawerOpen(false)}>×</button></header><section><label>具体 Diff</label><div className="diff-code">{renderDiffLines(conversationDiff.diff).map((line, index) => <div key={`${index}-${line.content.slice(0, 20)}`} className={`diff-${line.kind}-line`}><i>{line.oldLine ?? ''}</i><i>{line.newLine ?? ''}</i><code>{line.content || ' '}</code></div>)}</div></section></aside></>}

        <div className="composer-wrap"><div className="composer-context"><label>对话项目</label><select value={draftProjectId} onChange={(event) => changeConversationProject(event.target.value)}><option value="">不选择项目（AI Assistant）</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.desktop ? ' · 本地可读写' : ' · 只读上下文'}</option>)}</select><span>{draftProjectId ? (projects.find((project) => project.id === draftProjectId)?.desktop ? `Project Assistant · ${runtimePresetLabel(projects.find((project) => project.id === draftProjectId)?.runtimeConfig)}` : 'Project Assistant · 只读项目上下文') : (desktopWorkspace ? `AI Assistant · 已授权 ${desktopWorkspace.name}` : 'AI Assistant · 尚未选择本地 Workspace')}</span></div><div className="composer"><textarea ref={composerInputRef} value={inputValue} onChange={(event) => setInputValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!isGenerating) sendMessage(); } }} placeholder={isGenerating ? 'AI 正在处理，点击右侧按钮可中断' : editingMessageId ? '编辑消息后重新发送' : '给 AgentHub 发消息'} rows={2} /><div className="composer-footer"><div className="composer-tools"><button type="button" className="attach-button" onClick={() => setModal('project')}><PlusIcon /> 添加上下文</button><select className="chat-model-select" value={selectedModelId} onChange={(event) => void selectChatModel(event.target.value)} disabled={chatModels.length === 0 || isGenerating} aria-label="选择对话模型"><option value="">{chatModels.length === 0 ? '未配置模型' : '选择模型'}</option>{chatModels.map((item) => <option key={item.id} value={item.id}>{item.modelId}</option>)}</select></div><button type="button" className={`send-button ${isGenerating ? 'stop-button' : ''}`} onClick={isGenerating ? stopGeneration : sendMessage} disabled={!isGenerating && (!inputValue.trim() || !selectedModelId)} aria-label={isGenerating ? '中断生成' : '发送'}>{isGenerating ? <StopIcon /> : <SendIcon />}</button></div></div><p className="composer-tip">{isGenerating ? '正在生成回复，可随时中断。' : editingMessageId ? '正在编辑历史消息，发送后将作为新消息继续对话。' : chatModels.length === 0 ? '请先在设置 → 模型配置中添加模型。' : 'AgentHub 可能会犯错，请检查重要内容。'}</p></div>
        </>}
      </section>

      <input ref={fileInputRef} type="file" multiple className="hidden-input" onChange={addLocalProject} {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} />
      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(null)}><section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="关闭" onClick={() => setModal(null)}><CloseIcon /></button>
        {modal === 'project' && <><span className="modal-icon"><FolderIcon /></span><h2>添加本地项目</h2><p>{typeof window !== 'undefined' && window.agenthubDesktop ? '选择一个 Workspace。Project Assistant 可在你确认后读取和修改其中的文件。' : '浏览器模式只会读取你选择的文件；如需 AI 直接修改代码，请使用 AgentHub Desktop。'}</p><button type="button" className="primary-button" onClick={() => void chooseLocalProject()}>选择文件夹</button></>}
        {modal === 'runtime' && <><span className="modal-icon"><SettingsIcon /></span><h2>项目运行方式</h2><p>配置只作用于当前项目。已有项目默认保持本地开发模式。</p><div className="runtime-options"><button type="button" onClick={() => updateRuntimePreset('local')}><strong>本地开发</strong><span>Agent 修改本地 Workspace，服务使用本机环境运行。</span></button><button type="button" onClick={() => updateRuntimePreset('docker-service')}><strong>Docker 运行</strong><span>Agent 修改本地文件，项目服务通过 Docker 或 Compose 运行。</span></button><button type="button" onClick={() => updateRuntimePreset('sandbox')}><strong>完全隔离</strong><span>Agent 和服务都在 Docker Sandbox 中运行，不允许静默回退到本地。</span></button></div></>}
        {modal === 'login' && <><span className="modal-kicker">欢迎回来</span><h2>登录 AgentHub</h2><p>登录后可以同步项目与模型配置。</p><label className="field-label">邮箱</label><input className="field-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoFocus /><button type="button" className="primary-button" onClick={login} disabled={!email.trim()}>继续</button><small className="form-note">当前为本地产品演示登录，后端认证接入后可替换。</small></>}
      </section></div>}
    </main>
  );
}

function SettingsContent({ tab, user }: { tab: SettingsTab; user: { name: string; email: string } | null }) {
  return <div className="settings-page">
    <div className="settings-content">
      <span className="settings-eyebrow">设置</span>
      {tab === 'profile' ? <>
        <h1>个人资料</h1>
        <p className="settings-description">管理你的 AgentHub 个人信息。</p>
        <div className="settings-card profile-card">
          <div className="profile-avatar">{user?.name.slice(0, 1).toUpperCase() || '访'}</div>
          <div><strong>{user?.name || '访客用户'}</strong><p>{user?.email || '登录后可编辑个人资料'}</p></div>
        </div>
        <div className="settings-form">
          <label className="field-label">显示名称</label><input className="field-input" defaultValue={user?.name || ''} placeholder="你的名字" disabled={!user} />
          <label className="field-label">邮箱地址</label><input className="field-input" defaultValue={user?.email || ''} placeholder="name@example.com" disabled={!user} />
          <button type="button" className="settings-save" disabled={!user}>保存修改</button>
        </div>
      </> : <ModelSettings />}
    </div>
  </div>;
}

function ModelSettings() {
  const [models, setModels] = useState<SavedModel[]>([]);
  const [form, setForm] = useState({ provider: 'mockllm', baseUrl: 'http://localhost:3003/api/mockllm/v1', modelId: 'mock-agent-v1', apiKey: '' });
  const [busy, setBusy] = useState<'test' | 'save' | string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const loadModels = async () => {
    try {
      const data = await fetchJson<{ models: SavedModel[] }>('/ai/models');
      setModels(data.models);
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : '模型库加载失败' });
    }
  };
  useEffect(() => { void loadModels(); }, []);

  const update = (key: keyof typeof form, value: string) => {
    const presets: Record<string, { baseUrl: string; modelId: string }> = {
      mockllm: { baseUrl: 'http://localhost:3003/api/mockllm/v1', modelId: 'mock-agent-v1' },
      dashscope: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelId: 'qwen-plus' },
      ollama: { baseUrl: 'http://localhost:11434', modelId: 'qwen2.5:latest' },
      'openai-compatible': { baseUrl: '', modelId: '' }
    };
    setForm((current) => key === 'provider' ? { ...current, provider: value, ...presets[value] } : { ...current, [key]: value });
    setNotice(null);
  };

  const testConnection = async () => {
    setBusy('test'); setNotice(null);
    try {
      const result = await fetchJson<{ ok: boolean; latencyMs: number; reply: string }>('/ai/models/test', { method: 'POST', body: JSON.stringify(form) });
      setNotice({ ok: true, text: `连接成功 · ${result.latencyMs}ms · ${result.reply}` });
    } catch (error) { setNotice({ ok: false, text: error instanceof Error ? error.message : '连接失败' }); }
    finally { setBusy(null); }
  };

  const saveModel = async () => {
    setBusy('save'); setNotice(null);
    try {
      await fetchJson('/ai/models', { method: 'POST', body: JSON.stringify(form) });
      setNotice({ ok: true, text: `模型 ${form.modelId} 已保存到模型库，并可设为 Agent 默认模型。` });
      await loadModels();
    } catch (error) { setNotice({ ok: false, text: error instanceof Error ? error.message : '保存失败' }); }
    finally { setBusy(null); }
  };

  const activate = async (id: string) => {
    setBusy(id);
    try { await fetchJson(`/ai/models/${id}/activate`, { method: 'POST' }); await loadModels(); setNotice({ ok: true, text: '已切换 Agent 默认模型。' }); }
    catch (error) { setNotice({ ok: false, text: error instanceof Error ? error.message : '切换失败' }); }
    finally { setBusy(null); }
  };

  const remove = async (id: string) => {
    setBusy(id);
    try { await fetchJson(`/ai/models/${id}`, { method: 'DELETE' }); await loadModels(); }
    catch (error) { setNotice({ ok: false, text: error instanceof Error ? error.message : '删除失败' }); }
    finally { setBusy(null); }
  };

  return <>
    <h1>模型配置</h1>
    <p className="settings-description">连接模型服务、验证可用性，并管理 Agent 实际使用的模型。</p>
    <div className="model-dashboard">
      <div><span>模型总数</span><strong>{models.length}</strong></div>
      <div><span>当前启用</span><strong>{models.find((item) => item.active)?.modelId || '未配置'}</strong></div>
      <div><span>连接状态</span><strong className={models.some((item) => item.active) ? 'healthy' : ''}>{models.some((item) => item.active) ? '已配置' : '待配置'}</strong></div>
    </div>

    <section className="model-panel">
      <div className="section-heading"><div><h2>新增模型</h2><p>支持 DashScope、Ollama、OpenAI 兼容接口及内置 MockLLM。</p></div></div>
      <div className="model-form-grid">
        <label><span>服务提供方</span><select value={form.provider} onChange={(event) => update('provider', event.target.value)}><option value="mockllm">MockLLM（链路测试）</option><option value="dashscope">阿里云 DashScope</option><option value="ollama">Ollama</option><option value="openai-compatible">OpenAI 兼容服务</option></select></label>
        <label className="full"><span>API Base URL</span><input value={form.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} placeholder="https://example.com/v1" /></label>
        <label><span>模型 ID</span><input value={form.modelId} onChange={(event) => update('modelId', event.target.value)} placeholder="例如：qwen-plus" /></label>
        <label><span>API Key <em>{form.provider === 'mockllm' || form.provider === 'ollama' ? '选填' : '必填'}</em></span><input type="password" value={form.apiKey} onChange={(event) => update('apiKey', event.target.value)} placeholder="输入服务密钥" /></label>
      </div>
      {notice && <div className={`connection-notice ${notice.ok ? 'success' : 'error'}`}>{notice.text}</div>}
      <div className="model-actions"><button className="secondary-action" type="button" onClick={testConnection} disabled={busy !== null}>{busy === 'test' ? '测试中…' : '测试连接'}</button><button className="settings-save" type="button" onClick={saveModel} disabled={busy !== null || !form.modelId}>{busy === 'save' ? '保存中…' : '保存模型'}</button></div>
    </section>

    <section className="model-library">
      <div className="section-heading"><div><h2>模型库</h2><p>已保存的模型。启用后，新 Agent 请求会立即使用该模型。</p></div><span>{models.length} 个模型</span></div>
      {models.length === 0 ? <div className="library-empty">还没有模型，请先测试并保存一个配置。</div> : <div className="model-list">{models.map((item) => <article key={item.id} className={item.active ? 'active' : ''}>
        <div className="provider-mark">{item.provider === 'mockllm' ? 'M' : item.provider === 'dashscope' ? 'D' : item.provider === 'ollama' ? 'O' : 'AI'}</div>
        <div className="model-info"><div><strong>{item.modelId}</strong>{item.active && <span className="active-badge">当前使用</span>}</div><p>{item.provider}</p><small>{item.baseUrl || '内置服务'} {item.apiKeyConfigured ? `· ${item.apiKeyHint}` : ''}</small></div>
        <div className="library-actions">{!item.active && <button type="button" onClick={() => activate(item.id)} disabled={busy === item.id}>设为默认</button>}<button className="delete" type="button" onClick={() => remove(item.id)} disabled={busy === item.id}>删除</button></div>
      </article>)}</div>}
    </section>
  </>;
}
