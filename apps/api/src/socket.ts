import { Server as IOServer } from 'socket.io';
import type http from 'http';
import { randomUUID } from 'crypto';
import { createChatCompletion, streamChatCompletion } from './services/aiService';
import * as taskService from './services/taskService';
import { runAgentExecution } from './services/taskExecutor';
import * as agentExecutionService from './services/agentExecutionService';
import path from 'path';
import fs from 'fs';
import { addToolContext, buildModelContext, captureExplicitMemory, ingestProjectKnowledge, recordConversationMessage } from './services/contextEngineService';
import { registerDesktopBridge, requestDesktopTool } from './services/desktopBridgeService';

const DESKTOP_TOOLS = [
  { type: 'function', function: { name: 'list_files', description: '列出 Workspace 内的文件和目录。分析项目时应先调用。', parameters: { type: 'object', properties: { path: { type: 'string', description: '相对 Workspace 的路径，默认 .' }, depth: { type: 'number', description: '递归深度，最大 8' } } } } },
  { type: 'function', function: { name: 'read_file', description: '读取 Workspace 内一个 UTF-8 文本文件。', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'create_directory', description: '在 Workspace 内创建目录，需要用户确认。', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write_file', description: '创建或完整覆写 Workspace 内的文本文件，需要用户确认。', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'apply_patch', description: '用精确字符串替换修改已有文件，需要用户确认。oldContent 必须唯一且原样存在。', parameters: { type: 'object', properties: { path: { type: 'string' }, oldContent: { type: 'string' }, newContent: { type: 'string' } }, required: ['path', 'oldContent', 'newContent'] } } },
  { type: 'function', function: { name: 'git_diff', description: '查看 Workspace 的 git diff。', parameters: { type: 'object', properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'run_command', description: '在 Workspace 根目录执行 shell 命令，需要用户确认。', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } }
]

const cancelledConversations = new Set<string>()

function cleanProtocolText(value: string) {
  if (!/<\/?(?:tool_call|think)>/i.test(value)) return { content: value.trim(), hadProtocol: false }
  const content = value
    .split('\n')
    .filter((line) => !/<\/?(?:tool_call|think)>/i.test(line))
    .join('\n')
    .replace(/<\/?(?:tool_call|think)>/gi, '')
    .trim()
  return { content, hadProtocol: true }
}

function parseLegacyToolCall(content: string): { name: string; arguments: Record<string, unknown> } | null {
  if (!/<tool_call>/i.test(content)) return null
  const expression = content.match(/<tool_call>\s*([\s\S]*?)(?=<tool_call>|<\/tool_call>|<\/think>|$)/i)?.[1]?.trim() ?? ''
  const functionName = expression.match(/^([\w.]+)/)?.[1]?.toLowerCase() ?? ''
  const pathValue = expression.match(/path\s*=\s*["']([^"']+)["']/i)?.[1] ?? '.'
  const safePath = path.isAbsolute(pathValue) ? '.' : pathValue
  if (['file.exists', 'file.list', 'list_files'].includes(functionName)) {
    return { name: 'list_files', arguments: { path: safePath, depth: 2 } }
  }
  if (['file.read', 'read_file'].includes(functionName)) {
    if (path.isAbsolute(pathValue)) return null
    return { name: 'read_file', arguments: { path: safePath } }
  }
  if (['file.mkdir', 'create_directory'].includes(functionName)) {
    if (path.isAbsolute(pathValue)) return null
    return { name: 'create_directory', arguments: { path: safePath } }
  }
  return null
}

async function executeVisibleDesktopTool(io: IOServer, conversationId: string, workspaceToken: string, name: string, args: Record<string, unknown>) {
  io.to(conversationId).emit('tool:status', { conversationId, running: true, tool: name })
  const startedAt = Date.now()
  const result = await requestDesktopTool(io, { workspaceToken, name, arguments: args })
  const remaining = 1400 - (Date.now() - startedAt)
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
  return result
}

async function finishDesktopRun(messages: any[]) {
  const completion = await createChatCompletion({
    messages: [
      ...messages,
      { role: 'system', content: '工具阶段已经结束。请只根据已有工具结果直接回答用户，总结已检查、已创建或已修改的内容。不要继续请求工具，不要输出 <tool_call>、<think> 或内部协议。' }
    ]
  })
  const raw = String(completion.choices?.[0]?.message?.content ?? '').trim()
  const cleaned = cleanProtocolText(raw).content
  return cleaned || '本地操作已结束，已保留当前工具执行结果。'
}

async function runDesktopToolLoop(io: IOServer, messages: any[], workspaceToken: string, contextScopeId: string, conversationId: string) {
  const workingMessages = [...messages]
  const legacyCalls = new Set<string>()
  const executedCalls = new Set<string>()
  let workspaceRevision = 0
  const userRequest = [...messages].reverse().find((message) => message.role === 'user')?.content ?? ''
  if (/(创建|新建|文件|文件夹|目录|项目|检查|查看|读取|代码|修改|写入|删除|运行|系统)/i.test(String(userRequest))) {
    const initialResult = await executeVisibleDesktopTool(io, conversationId, workspaceToken, 'list_files', { path: '.', depth: 2 })
    if (cancelledConversations.has(conversationId)) return ''
    const serialized = JSON.stringify(initialResult)
    addToolContext({ projectId: contextScopeId, conversationId, tool: 'list_files', summary: serialized.slice(0, 2000) })
    executedCalls.add(JSON.stringify({ name: 'list_files', arguments: { path: '.', depth: 2 } }))
    workingMessages.splice(workingMessages.length - 1, 0, { role: 'system', content: `本地桥接层已先检查 Workspace，文件清单如下：\n${serialized}\n请直接继续用户任务，不要只说“让我检查”。如需读取或修改，立即使用 function tools。` })
  }
  for (let round = 0; round < 8; round += 1) {
    if (cancelledConversations.has(conversationId)) return ''
    const completion = await createChatCompletion({ messages: workingMessages, tools: DESKTOP_TOOLS })
    const assistantMessage = completion.choices?.[0]?.message
    const toolCalls = assistantMessage?.tool_calls ?? []
    if (!toolCalls.length) {
      const content = String(assistantMessage?.content ?? '').trim()
      const legacyCall = parseLegacyToolCall(content)
      if (!legacyCall) return content
      const signature = JSON.stringify(legacyCall)
      if (legacyCalls.has(signature)) return finishDesktopRun(workingMessages)
      legacyCalls.add(signature)
      let result: unknown
      try {
        result = await executeVisibleDesktopTool(io, conversationId, workspaceToken, legacyCall.name, legacyCall.arguments)
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      if (cancelledConversations.has(conversationId)) return ''
      const serialized = JSON.stringify(result)
      addToolContext({ projectId: contextScopeId, conversationId, tool: legacyCall.name, summary: serialized.slice(0, 2000) })
      workingMessages.push({ role: 'assistant', content: cleanProtocolText(content).content || `正在调用 ${legacyCall.name}` })
      workingMessages.push({ role: 'system', content: `本地桥接层已执行 ${legacyCall.name}，结果如下：\n${serialized}\n请基于结果继续完成用户任务。不要输出 <tool_call> 或 <think> 标签；如需更多操作，使用提供的标准 function tools。` })
      continue
    }
    workingMessages.push(assistantMessage)
    for (const call of toolCalls) {
      const name = String(call.function?.name ?? '')
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(call.function?.arguments || '{}') } catch { throw new Error(`工具 ${name} 的参数不是有效 JSON`) }
      const signature = JSON.stringify({ name, arguments: args, ...(name === 'run_command' ? { workspaceRevision } : {}) })
      if (executedCalls.has(signature)) {
        workingMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ skipped: true, reason: '相同工具和参数已经执行，复用之前的结果' }) })
        return finishDesktopRun(workingMessages)
      }
      executedCalls.add(signature)
      let result: unknown
      try {
        result = await executeVisibleDesktopTool(io, conversationId, workspaceToken, name, args)
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      if (cancelledConversations.has(conversationId)) return ''
      const serialized = JSON.stringify(result)
      if (['write_file', 'apply_patch', 'create_directory'].includes(name) && (result as { ok?: boolean })?.ok !== false) workspaceRevision += 1
      addToolContext({ projectId: contextScopeId, conversationId, tool: name, summary: serialized.slice(0, 2000) })
      workingMessages.push({ role: 'tool', tool_call_id: call.id, content: serialized })
    }
  }
  return finishDesktopRun(workingMessages)
}

const AGENT_ROLE_TO_ID: Record<string, string> = {
  planner: 'planner-1',
  developer: 'developer-1',
  tester: 'tester-1',
  frontend: 'developer-1',
  backend: 'developer-1',
  qa: 'tester-1',
  pm: 'planner-1'
};

function loadAgentPrompt(agentName: string) {
  try {
    const candidates = [
      path.join(process.cwd(), 'packages', 'prompts', 'agents', `${agentName}.md`),
      path.resolve(process.cwd(), '..', '..', 'packages', 'prompts', 'agents', `${agentName}.md`)
    ]
    const filePath = candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]

    console.log('[prompt] loading:', filePath)

    const content = fs.readFileSync(filePath, 'utf-8')

    console.log('[prompt] loaded:', agentName)

    return content
  } catch (error) {
    console.error('[prompt] load failed:', error)

    return `
You are ${agentName} agent in AgentHub.
Respond helpfully.
`
  }
}
function extractAgents(text: string) {
  const agents: string[] = []
  if (text.includes('@planner') || text.includes('@pm')) agents.push('planner')
  if (text.includes('@developer') || text.includes('@frontend') || text.includes('@backend')) agents.push('developer')
  if (text.includes('@tester') || text.includes('@qa')) agents.push('tester')

  return agents
}

function parseMention(content: string): string | null {
  const match = content.trim().match(/^@([a-zA-Z][a-zA-Z0-9_-]*)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

interface ParsedPmTask {
  id: string
  agent: string
  title: string
  description?: string
  dependsOn?: string[]
  input?: Record<string, unknown>
}

interface ParsedTaskPlan {
  tasks: ParsedPmTask[]
  edges?: Array<{ from: string; to: string }>;
}

function parseAgentTasksJson(text: string): ParsedTaskPlan | null {
  const match = /```agent_tasks\s*([\s\S]*?)```/i.exec(text)
  if (!match) return null

  try {
    const json = JSON.parse(match[1])
    if (json?.tasks && Array.isArray(json.tasks)) {
      return {
        tasks: json.tasks.map((task: any) => ({
          id: String(task.id ?? ''),
          agent: String(task.agent ?? ''),
          title: String(task.title ?? task.id ?? ''),
          description: task.description ? String(task.description) : undefined,
          dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map(String) : undefined,
          input: task.input && typeof task.input === 'object' ? task.input : undefined
        })),
        edges: Array.isArray(json.edges)
          ? json.edges.map((edge: any) => ({ from: String(edge.from), to: String(edge.to) }))
          : undefined
      }
    }
  } catch (error) {
    console.warn('[socket] failed to parse agent_tasks json', error)
  }

  return null
}

async function createTasksFromPmOutput(conversationId: string, userMessage: string, fullResponse: string) {
  const taskPlan = parseAgentTasksJson(fullResponse)
  if (!taskPlan) return []

  const task = await taskService.createTask({
    conversationId,
    title: userMessage.replace(/^@pm\s*/i, '').trim() || 'PM generated task',
    description: fullResponse,
    assignedAgentIds: taskPlan.tasks
      .map((taskInfo) => AGENT_ROLE_TO_ID[taskInfo.agent?.toLowerCase() ?? ''])
      .filter(Boolean) as string[]
  })

  const planExecutions: Array<{ planTask: ParsedPmTask; execution: Awaited<ReturnType<typeof agentExecutionService.createAgentExecution>> }> = []
  for (const taskInfo of taskPlan.tasks) {
    const assignedAgentId = AGENT_ROLE_TO_ID[taskInfo.agent?.toLowerCase() ?? '']
    if (!assignedAgentId) continue

    const execution = await agentExecutionService.createAgentExecution({
      taskId: task.id,
      agentId: assignedAgentId,
      title: taskInfo.title || taskInfo.id || `Execution ${taskInfo.agent}`,
      input: {
        taskTitle: task.title,
        taskDescription: task.description,
        node: {
          id: taskInfo.id,
          title: taskInfo.title,
          description: taskInfo.description,
          dependsOn: taskInfo.dependsOn,
          input: taskInfo.input
        }
      }
    })
    planExecutions.push({ planTask: taskInfo, execution })
  }

  const dependencyMap = buildDependencyMap(taskPlan)
  void dispatchExecutionGraph(planExecutions, dependencyMap).catch((err) => {
    console.error('[socket] dispatchExecutionGraph failed', err)
  })

  return [task]
}

function buildDependencyMap(plan: ParsedTaskPlan) {
  const map: Record<string, string[]> = {}
  for (const taskInfo of plan.tasks) {
    map[taskInfo.id] = [...(taskInfo.dependsOn ?? [])]
  }
  if (Array.isArray(plan.edges)) {
    for (const edge of plan.edges) {
      map[edge.to] = [...(map[edge.to] ?? []), edge.from]
      if (!map[edge.from]) {
        map[edge.from] = []
      }
    }
  }
  return map
}

async function dispatchExecutionGraph(
  planExecutions: Array<{ planTask: ParsedPmTask; execution: Awaited<ReturnType<typeof agentExecutionService.createAgentExecution>> }>,
  dependencyMap: Record<string, string[]>
) {
  const executionByPlanId = new Map(planExecutions.map((item) => [item.planTask.id, item.execution]))
  const orderedIds = topologicalSort(planExecutions.map((item) => item.planTask.id), dependencyMap)
  const nodePromises = new Map<string, Promise<boolean>>()

  for (const planId of orderedIds) {
    const current = executionByPlanId.get(planId)
    if (!current) continue
    const deps = dependencyMap[planId] ?? []
    const promise = (async () => {
      if (deps.length > 0) {
        const depResults = await Promise.all(deps.map((depId) => nodePromises.get(depId)!))
        if (depResults.some((result) => result === false)) {
          await agentExecutionService.updateAgentExecutionStatus({
            id: current.id,
            status: 'failed',
            error: `Dependency failed: ${deps.join(', ')}`,
            completedAt: new Date()
          })
          return false
        }
      }
      return await runAgentExecution(current.id)
    })()
    nodePromises.set(planId, promise)
  }

  await Promise.all(nodePromises.values())
}

function topologicalSort(nodeIds: string[], dependencyMap: Record<string, string[]>) {
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  nodeIds.forEach((id) => {
    inDegree.set(id, 0)
    adjacency.set(id, [])
  })
  for (const [id, deps] of Object.entries(dependencyMap)) {
    deps.forEach((depId) => {
      if (!inDegree.has(id)) return
      if (!adjacency.has(depId)) adjacency.set(depId, [])
      adjacency.get(depId)?.push(id)
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1)
    })
  }

  const queue = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0)
  const sorted: string[] = []

  while (queue.length > 0) {
    const current = queue.shift() as string
    sorted.push(current)
    const children = adjacency.get(current) ?? []
    for (const child of children) {
      inDegree.set(child, (inDegree.get(child) ?? 1) - 1)
      if ((inDegree.get(child) ?? 0) === 0) {
        queue.push(child)
      }
    }
  }

  if (sorted.length !== nodeIds.length) {
    throw new Error('Detected a cycle in the execution graph')
  }

  return sorted
}

function normalizeTriggerContent(agent: string, payload: string) {
  const cleanedPayload = payload.replace(/^(@[a-zA-Z][a-zA-Z0-9_-]*[,，]?\s*)+/i, '').trim();
  const body = cleanedPayload || payload;
  return `@${agent} ${body}`;
}

async function triggerAgent(
  io: IOServer,
  agent: string,
  conversationId: string,
  payload: string,
  visited = new Set<string>(),
  visible = true
) {
  if (visited.has(agent)) return;
  visited.add(agent);

  const agentId = `${agent}-agent`;
  const systemPrompt = loadAgentPrompt(agent);
  const prompt = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: normalizeTriggerContent(agent, payload),
    },
  ];

  if (visible) io.to(conversationId).emit('agent:typing', { agentId, conversationId, typing: true });
  const responseId = `resp-${randomUUID()}`;

  try {
    const completion = await createChatCompletion({ messages: prompt });
    const fullResponse = String(completion.choices?.[0]?.message?.content ?? '').trim();

    if (!fullResponse) {
      throw new Error('模型返回空内容');
    }

    if (visible) {
      streamAgentReply(io, { agentId, conversationId, responseId, fullResponse, typingAlreadyShown: true });
    }

    const nextAgents = extractAgents(fullResponse);
    await Promise.all(
      nextAgents.map((nextAgent) => triggerAgent(io, nextAgent, conversationId, fullResponse, visited, visible))
    );
  } catch (error: any) {
    console.error('[socket] trigger agent failed', agent, error);
    const hint = error?.message ?? String(error);
    const fullResponse = `⚠️ **@${agent} 触发失败**\n\n${hint}`;

    if (visible) {
      streamAgentReply(io, { agentId, conversationId, responseId, fullResponse, typingAlreadyShown: true });
    }
  }
}

function streamAgentReply(
  io: IOServer,
  opts: {
    agentId: string;
    conversationId: string;
    responseId: string;
    fullResponse: string;
    typingAlreadyShown?: boolean;
  }
) {
  const { agentId, conversationId, responseId, fullResponse, typingAlreadyShown } = opts;
  const tokens = fullResponse.match(/[\s\S]{1,40}/g) || [fullResponse];
  let idx = 0;

  if (!typingAlreadyShown) {
    io.to(conversationId).emit('agent:typing', { agentId, conversationId, typing: true });
  }

  const interval = setInterval(() => {
    if (cancelledConversations.has(conversationId)) {
      clearInterval(interval)
      io.to(conversationId).emit('agent:typing', { agentId, conversationId, typing: false })
      io.to(conversationId).emit('tool:status', { conversationId, running: false })
      return
    }
    const chunk = tokens[idx];
    io.to(conversationId).emit('message:stream', {
      id: responseId,
      conversationId,
      role: 'agent',
      agentId,
      type: 'text',
      content: chunk,
      isFinal: false,
      createdAt: new Date().toISOString()
    });

    idx += 1;
    if (idx >= tokens.length) {
      clearInterval(interval);
      io.to(conversationId).emit('message:stream', {
        id: responseId,
        conversationId,
        role: 'agent',
        agentId,
        type: 'text',
        content: '',
        isFinal: true,
        createdAt: new Date().toISOString()
      });
      io.to(conversationId).emit('agent:typing', { agentId, conversationId, typing: false });
    }
  }, 80);
}

export function initSocket(httpServer: http.Server) {
  const io = new IOServer(httpServer, {
    cors: {
      origin: (origin, cb) => {
        if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          cb(null, true);
        } else {
          cb(null, false);
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log('[socket] client connected', socket.id);

    socket.on('desktop:register', () => registerDesktopBridge(io, socket));

    socket.on('generation:stop', ({ conversationId }: { conversationId?: string }) => {
      if (!conversationId) return
      cancelledConversations.add(conversationId)
      io.to(conversationId).emit('agent:typing', { conversationId, typing: false })
      io.to(conversationId).emit('tool:status', { conversationId, running: false })
    });

    socket.on('message:create', async (msg) => {
      const conversationId = msg.conversationId ?? 'default';
      cancelledConversations.delete(conversationId)
      const projectId = typeof msg.projectId === 'string' && msg.projectId ? msg.projectId : null
      socket.join(conversationId)
      io.to(conversationId).emit('message', msg);
      if (projectId && typeof msg.projectContext === 'string' && msg.projectContext.trim()) {
        ingestProjectKnowledge(projectId, msg.projectContext.slice(0, 300_000))
      }
      recordConversationMessage({ conversationId, projectId, role: 'user', content: String(msg.content ?? ''), id: msg.id })
      captureExplicitMemory(String(msg.content ?? ''), projectId, conversationId)

      const explicitMention = typeof msg.content === 'string' ? parseMention(msg.content) : null;
      const legacyRoles: Record<string, string> = { pm: 'planner', frontend: 'developer', backend: 'developer', qa: 'tester' };
      const mention = explicitMention ? (legacyRoles[explicitMention] ?? explicitMention) : (msg.projectId ? 'orchestrator' : 'assistant');
      const directAgents = explicitMention && typeof msg.content === 'string' ? extractAgents(msg.content) : [];

      const responseId = `resp-${randomUUID()}`;

      if (mention === 'assistant' || mention === 'orchestrator') {
        const agentId = `${mention}-agent`;
        const systemPrompt = loadAgentPrompt(mention)
        const assembled = buildModelContext({ conversationId, projectId, query: String(msg.content ?? '') })
        const history = assembled.history.filter((message) => message.id !== msg.id).slice(-12)
        const prompt = [
          {
            role: 'system',
            content: systemPrompt
          },
          ...(assembled.contextText ? [{ role: 'system', content: `Context Engine 已检索以下上下文。仅使用与当前问题相关的事实：\n\n${assembled.contextText}` }] : []),
          ...history.map((message) => ({ role: message.role, content: message.content })),
          {
            role: 'user',
            content: msg.content
          }
        ]

        io.to(conversationId).emit('agent:typing', { agentId, conversationId, typing: true });

        try {
          console.log('[socket] @%s → calling AI…', mention);
          const workspaceToken = typeof msg.workspaceToken === 'string' ? msg.workspaceToken : ''
          if (workspaceToken) {
            prompt.splice(1, 0, { role: 'system', content: `你已连接用户授权的本地 Workspace，并拥有受控的本地文件工具。${mention === 'assistant' ? '即使当前对话未绑定项目，你也可以读取或在用户确认后修改这个 Workspace；不要声称自己无法访问文件系统。' : ''}回答代码或文件问题前先调用 list_files/read_file 获取证据；需要修改时直接调用写入工具。所有 path 必须是相对路径，禁止猜测绝对路径。工具或命令返回错误时，把错误当作调试证据：读取相关源码、定位原因、修复后再次验证，不要把它误报成模型连接失败，也不要在第一次命令失败后停止。工具执行结果返回后，简洁说明读取、修改和验证结果。` })
          }
          let streamedDirectly = false
          const rawResponse = workspaceToken
            ? await runDesktopToolLoop(io, prompt, workspaceToken, projectId || `workspace-${workspaceToken}`, conversationId)
            : await streamChatCompletion({ messages: prompt, onDelta: (content) => {
                if (cancelledConversations.has(conversationId)) return
                streamedDirectly = true
                io.to(conversationId).emit('message:stream', { id: responseId, conversationId, role: 'agent', agentId, type: 'text', content, isFinal: false, createdAt: new Date().toISOString() })
              } });
          if (cancelledConversations.has(conversationId)) return
          const cleaned = cleanProtocolText(rawResponse)
          if (cleaned.hadProtocol) io.to(conversationId).emit('tool:status', { conversationId, running: false })
          const fullResponse = cleaned.content || (cleaned.hadProtocol ? '本地工具运行已结束。' : '')

          if (!fullResponse) {
            throw new Error('模型返回空内容');
          }

          recordConversationMessage({ conversationId, projectId, role: 'assistant', content: fullResponse, agentId, id: responseId })

          if (streamedDirectly) {
            io.to(conversationId).emit('message:stream', { id: responseId, conversationId, role: 'agent', agentId, type: 'text', content: '', isFinal: true, createdAt: new Date().toISOString() })
            io.to(conversationId).emit('agent:typing', { agentId, conversationId, typing: false })
          } else {
            streamAgentReply(io, { agentId, conversationId, responseId, fullResponse, typingAlreadyShown: true });
          }

          const createdTasks: Array<{ id: string; title: string; assignedAgentId?: string | null }> = []
          if (createdTasks.length > 0) {
            io.to(conversationId).emit('tasks:created', {
              conversationId,
              tasks: createdTasks.map((task) => ({ id: task.id, title: task.title, assignedAgentId: task.assignedAgentId }))
            })
          }

          const nextAgents = extractAgents(fullResponse)
          if (nextAgents.length > 0) {
            const uniqueAgents = Array.from(new Set(nextAgents))
            await Promise.all(
              uniqueAgents.map((agent) => triggerAgent(io, agent, conversationId, fullResponse, new Set([mention]), false))
            )
          }
        } catch (error: any) {
          if (cancelledConversations.has(conversationId)) return
          console.error('[socket] AI response failed', error);
          const hint = error?.message ?? String(error);
          const isLocalToolError = /workspace:tool|Command failed|APPROVAL_REQUIRED|本地工具|用户拒绝|Workspace/i.test(hint)
          const fullResponse = isLocalToolError
            ? [`⚠️ **本地操作未完成**`, '', hint, '', '这属于项目代码或本地工具执行错误，不是模型连接错误。你可以让我根据错误继续定位并修复。'].join('\n')
            : [
                `⚠️ **${mention === 'assistant' ? 'AI Assistant' : 'Project Assistant'} 调用失败**`,
                '', hint, '', '**请检查模型服务：**',
                '1. 模型配置中的 Base URL 与 API Key 是否正确',
                '2. 模型 ID 是否真实存在',
                '3. 本地 Ollama 是否已经启动',
                '4. API 与前端 Socket 端口是否一致'
              ].join('\n');

          streamAgentReply(io, {
            agentId,
            conversationId,
            responseId,
            fullResponse,
            typingAlreadyShown: true
          });
        }

        return;
      }

      if (directAgents.length > 0) {
        const uniqueAgents = Array.from(new Set(directAgents));
        await Promise.all(
          uniqueAgents.map((agent) => triggerAgent(io, agent, conversationId, msg.content as string, new Set()))
        );
      }
    });

    socket.on('disconnect', () => {
      console.log('[socket] client disconnected', socket.id);
    });
  });

  return io;
}
