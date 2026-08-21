'use client';

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import type { Socket } from 'socket.io-client';
import { createSocket } from '@/lib/socket';
import { fetchJson } from '@/lib/api';
import { AIMessageContent } from '@/components/chat/AIMessageContent';

type Message = { id: string; conversationId?: string; speaker: string; role: string; content: string; agentId?: string; createdAt?: string };
type Project = { id: string; name: string; fileCount?: number; context?: string; workspaceToken?: string; desktop?: boolean };
type ConversationItem = { id: string; title: string; projectId: string | null; messages: Message[] };
type Modal = 'project' | 'login' | null;
type SettingsTab = 'profile' | 'model';
type SavedModel = { id: string; provider: string; baseUrl: string; modelId: string; active: boolean; apiKeyConfigured: boolean; apiKeyHint: string };
type DesktopToolRequest = { requestId: string; workspaceToken: string; name: string; arguments: Record<string, unknown> };

const Icon = ({ children, size = 18 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>;
const ChatIcon = () => <Icon><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /><path d="M8 9h8M8 13h5" /></Icon>;
const FolderIcon = () => <Icon><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2h7.5A2.5 2.5 0 0 1 21 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5Z" /></Icon>;
const ChevronIcon = ({ open }: { open: boolean }) => <Icon size={15}><path d={open ? 'm6 9 6 6 6-6' : 'm9 18 6-6-6-6'} /></Icon>;
const MoreIcon = () => <Icon><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></Icon>;
const SendIcon = () => <Icon size={17}><path d="m5 12 7-7 7 7M12 19V5" /></Icon>;
const StopIcon = () => <Icon size={15}><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" /></Icon>;
const CloseIcon = () => <Icon><path d="m6 6 12 12M18 6 6 18" /></Icon>;
const BackIcon = () => <Icon><path d="m15 18-6-6 6-6" /></Icon>;
const ProfileIcon = () => <Icon><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></Icon>;
const ModelIcon = () => <Icon><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M9 9h6v6H9zM12 1v3M12 20v3M1 12h3M20 12h3" /></Icon>;
const HistoryIcon = () => <Icon><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></Icon>;

function getAgentProfile(agentId?: string) {
  const key = (agentId || 'agent').replace(/-agent$/, '').toLowerCase();
  const profiles: Record<string, { avatar: string; name: string; role: string }> = {
    assistant: { avatar: 'AI', name: 'AI Assistant', role: '通用助手' },
    orchestrator: { avatar: 'PA', name: 'Project Assistant', role: 'AI 技术负责人' },
    planner: { avatar: 'PL', name: 'Planner', role: '规划工程师' },
    developer: { avatar: 'DE', name: 'Developer', role: '开发工程师' },
    tester: { avatar: 'TE', name: 'Tester', role: '测试工程师' },
    pm: { avatar: 'PL', name: 'Planner', role: '规划工程师' },
    frontend: { avatar: 'DE', name: 'Developer', role: '开发工程师' },
    backend: { avatar: 'DE', name: 'Developer', role: '开发工程师' },
    qa: { avatar: 'TE', name: 'Tester', role: '测试工程师' }
  };
  return profiles[key] || { avatar: 'AI', name: 'Agent', role: agentId || 'AI Agent' };
}

function getToolStatusLabel(toolName?: string, running = true) {
  const prefix = running ? '正在' : '已完成'
  if (['list_files', 'read_file', 'git_diff'].includes(toolName || '')) return `${prefix}读取文件`
  if (['write_file', 'apply_patch', 'create_directory'].includes(toolName || '')) return `${prefix}编辑文件`
  if (toolName === 'run_command') return `${prefix}运行命令`
  return running ? '正在处理' : '处理已结束'
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
  const menuRef = useRef<HTMLDivElement | null>(null);
  const activeConversationRef = useRef<string | null>(null);
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
      setActiveTool(request);
      const contentLength = String(request.arguments.content ?? '').length;
      const patchLength = String(request.arguments.oldContent ?? '').length + String(request.arguments.newContent ?? '').length;
      const needsApproval = request.name === 'run_command' || (request.name === 'write_file' && contentLength > 50_000) || (request.name === 'apply_patch' && patchLength > 20_000);
      if (needsApproval) {
        setPendingApproval(request);
        return;
      }
      try {
        if (!window.agenthubDesktop) throw new Error('当前不是 AgentHub Desktop')
        const result = await window.agenthubDesktop.invokeTool(request)
        socket.emit('desktop:tool-result', { requestId: request.requestId, ok: true, result })
      } catch (error) {
        if (error instanceof Error && error.message.includes('APPROVAL_REQUIRED')) {
          setPendingApproval(request);
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
          : [...current, { id, name: workspace.name, workspaceToken: workspace.token, desktop: true }]);
      });
    }
    socket.on('disconnect', () => { setConnected(false); setIsGenerating(false); setToolRunning(false); });
    socket.on('connect_error', () => { setConnected(false); setIsGenerating(false); setToolRunning(false); });
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
      if (event.conversationId && event.conversationId !== activeConversationRef.current) return;
      setIsGenerating(Boolean(event.typing));
      if (!event.typing) setToolRunning(false);
    });
    socket.on('tool:status', (event: { conversationId?: string; running?: boolean }) => {
      if (event.conversationId && event.conversationId !== activeConversationRef.current) return;
      setToolRunning(Boolean(event.running));
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
    setIsGenerating(true);
    const selectedProject = projects.find((project) => project.id === draftProjectId);
    socketRef.current?.emit('message:create', { ...message, conversationId, projectId: draftProjectId || null, projectContext: selectedProject?.context, workspaceToken: selectedProject?.workspaceToken || desktopWorkspace?.token });
    setInputValue('');
  };

  const stopGeneration = () => {
    if (!activeConversationRef.current) return;
    if (pendingApproval) {
      socketRef.current?.emit('desktop:tool-result', { requestId: pendingApproval.requestId, ok: false, error: '用户中断了本地操作' });
      setPendingApproval(null);
    }
    socketRef.current?.emit('generation:stop', { conversationId: activeConversationRef.current });
    setIsGenerating(false);
    setToolRunning(false);
  };

  const resolveToolApproval = async (approved: boolean) => {
    const request = pendingApproval;
    if (!request) return;
    setPendingApproval(null);
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
    setProjects((current) => [...current.filter((project) => project.name !== name), { id, name, fileCount: files.length, context }]);
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
    setProjects((current) => [...current.filter((project) => project.name !== workspace.name), { id, name: workspace.name, workspaceToken: workspace.token, desktop: true }]);
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
  };

  const openConversation = (conversation: ConversationItem) => {
    activeConversationRef.current = conversation.id;
    setActiveConversationId(conversation.id);
    setDraftProjectId(conversation.projectId || '');
    setMessages(conversation.messages);
    setActiveProject(conversation.projectId || '');
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
            <div className="project-group" key={project.id}><button type="button" className={`project-item ${activeProject === project.id ? 'active' : ''}`} onClick={() => selectProject(project.id)}>
              <FolderIcon /><span className="project-name">{project.name}</span>{project.desktop ? <span className="file-count">可读写</span> : project.fileCount ? <span className="file-count">{project.fileCount}</span> : null}
            </button><div className="project-conversations">{conversations.filter((conversation) => conversation.projectId === project.id).map((conversation) => <button type="button" key={conversation.id} className={activeConversationId === conversation.id ? 'active' : ''} onClick={() => openConversation(conversation)}>{conversation.title}</button>)}</div></div>
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
          const agent = getAgentProfile(message.agentId || message.speaker);
          return <article key={message.id} className={`message ${message.role === 'user' ? 'user-message' : 'agent-message'}`}>{message.role !== 'user' && <div className="message-avatar">{agent.avatar}</div>}<div className="message-body">{message.role !== 'user' && <div className="agent-identity"><strong>{agent.name}</strong><span>{agent.role}</span></div>}{message.role === 'user' ? <p>{message.content}</p> : <AIMessageContent content={message.content} />}</div></article>;
        })}{toolRunning && <button type="button" className="tool-running" role="status" onClick={() => setToolDetailsOpen((open) => !open)}><span className="tool-running-mark" /><span>{getToolStatusLabel(activeTool?.name)}{'.'.repeat(runningDots)}</span><small>查看详情</small></button>}
        {pendingApproval && <section className="tool-approval-card">
          <div className="tool-approval-heading"><span className="tool-code-icon">›_</span><div><strong>需要你的允许</strong><p>{pendingApproval.name === 'run_command' ? 'AI 请求执行命令' : 'AI 请求进行大范围文件修改'}</p></div></div>
          <pre>{pendingApproval.name === 'run_command' ? String(pendingApproval.arguments.command ?? '') : `${pendingApproval.name}  ${String(pendingApproval.arguments.path ?? '')}`}</pre>
          <div className="tool-approval-actions"><button type="button" onClick={() => void resolveToolApproval(false)}>拒绝</button><button type="button" className="approve" onClick={() => void resolveToolApproval(true)}>允许</button></div>
        </section>}
        {toolDetailsOpen && activeTool && <><button type="button" className="tool-drawer-backdrop" aria-label="关闭工具详情" onClick={() => setToolDetailsOpen(false)} /><aside className="tool-details-drawer" aria-label="工具运行详情"><header><div><span>本地工具</span><strong>运行详情</strong></div><button type="button" aria-label="关闭" onClick={() => setToolDetailsOpen(false)}>×</button></header><div className="tool-drawer-status"><span className={toolRunning ? 'running' : ''} />{getToolStatusLabel(activeTool.name, toolRunning)}</div><section><label>工具</label><code>{activeTool.name}</code></section><section><label>参数与脚本</label><pre>{JSON.stringify(activeTool.arguments, null, 2)}</pre></section></aside></>}<div ref={messageEndRef} className="message-end-anchor" /></div>}</div>

        <div className="composer-wrap"><div className="composer-context"><label>对话项目</label><select value={draftProjectId} onChange={(event) => changeConversationProject(event.target.value)}><option value="">不选择项目（AI Assistant）</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.desktop ? ' · 本地可读写' : ' · 只读上下文'}</option>)}</select><span>{draftProjectId ? (projects.find((project) => project.id === draftProjectId)?.desktop ? 'Project Assistant · 已连接本地工具' : 'Project Assistant · 只读项目上下文') : (desktopWorkspace ? `AI Assistant · 已授权 ${desktopWorkspace.name}` : 'AI Assistant · 尚未选择本地 Workspace')}</span></div><div className="composer"><textarea value={inputValue} onChange={(event) => setInputValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!isGenerating) sendMessage(); } }} placeholder={isGenerating ? 'AI 正在处理，点击右侧按钮可中断' : '给 AgentHub 发消息'} rows={2} /><div className="composer-footer"><div className="composer-tools"><button type="button" className="attach-button" onClick={() => setModal('project')}><PlusIcon /> 添加上下文</button><select className="chat-model-select" value={selectedModelId} onChange={(event) => void selectChatModel(event.target.value)} disabled={chatModels.length === 0 || isGenerating} aria-label="选择对话模型"><option value="">{chatModels.length === 0 ? '未配置模型' : '选择模型'}</option>{chatModels.map((item) => <option key={item.id} value={item.id}>{item.modelId}</option>)}</select></div><button type="button" className={`send-button ${isGenerating ? 'stop-button' : ''}`} onClick={isGenerating ? stopGeneration : sendMessage} disabled={!isGenerating && (!inputValue.trim() || !selectedModelId)} aria-label={isGenerating ? '中断生成' : '发送'}>{isGenerating ? <StopIcon /> : <SendIcon />}</button></div></div><p className="composer-tip">{isGenerating ? '正在生成回复，可随时中断。' : chatModels.length === 0 ? '请先在设置 → 模型配置中添加模型。' : 'AgentHub 可能会犯错，请检查重要内容。'}</p></div>
        </>}
      </section>

      <input ref={fileInputRef} type="file" multiple className="hidden-input" onChange={addLocalProject} {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} />
      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(null)}><section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="关闭" onClick={() => setModal(null)}><CloseIcon /></button>
        {modal === 'project' && <><span className="modal-icon"><FolderIcon /></span><h2>添加本地项目</h2><p>{typeof window !== 'undefined' && window.agenthubDesktop ? '选择一个 Workspace。Project Assistant 可在你确认后读取和修改其中的文件。' : '浏览器模式只会读取你选择的文件；如需 AI 直接修改代码，请使用 AgentHub Desktop。'}</p><button type="button" className="primary-button" onClick={() => void chooseLocalProject()}>选择文件夹</button></>}
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
  const [form, setForm] = useState({ provider: 'mockllm', baseUrl: 'http://localhost:3001/api/mockllm/v1', modelId: 'mock-agent-v1', apiKey: '' });
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
