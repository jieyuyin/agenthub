import { Server as IOServer } from 'socket.io';
import type http from 'http';
import { randomUUID } from 'crypto';
import { createChatCompletion } from './services/aiService';
import * as taskService from './services/taskService';
import { runAgentExecution } from './services/taskExecutor';
import * as agentExecutionService from './services/agentExecutionService';
import path from 'path';
import fs from 'fs';

const AGENT_ROLE_TO_ID: Record<string, string> = {
  frontend: 'frontend-1',
  backend: 'backend-1',
  qa: 'qa-1',
  pm: 'pm-1'
};

function loadAgentPrompt(agentName: string) {
  try {
    const filePath = path.join(
      process.cwd(),
      'packages',
      'prompts',
      'agents',
      `${agentName}.md`
    )

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
  const agents = []

  if (text.includes('@frontend')) agents.push('frontend')
  if (text.includes('@backend')) agents.push('backend')
  if (text.includes('@qa')) agents.push('qa')

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
  visited = new Set<string>()
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

  io.to('global').emit('agent:typing', { agentId, conversationId, typing: true });
  const responseId = `resp-${randomUUID()}`;

  try {
    const completion = await createChatCompletion({ messages: prompt });
    const fullResponse = String(completion.choices?.[0]?.message?.content ?? '').trim();

    if (!fullResponse) {
      throw new Error('模型返回空内容');
    }

    streamAgentReply(io, {
      agentId,
      conversationId,
      responseId,
      fullResponse,
      typingAlreadyShown: true,
    });

    const nextAgents = extractAgents(fullResponse);
    await Promise.all(
      nextAgents.map((nextAgent) => triggerAgent(io, nextAgent, conversationId, fullResponse, visited))
    );
  } catch (error: any) {
    console.error('[socket] trigger agent failed', agent, error);
    const hint = error?.message ?? String(error);
    const fullResponse = `⚠️ **@${agent} 触发失败**\n\n${hint}`;

    streamAgentReply(io, {
      agentId,
      conversationId,
      responseId,
      fullResponse,
      typingAlreadyShown: true,
    });
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
    io.to('global').emit('agent:typing', { agentId, conversationId, typing: true });
  }

  const interval = setInterval(() => {
    const chunk = tokens[idx];
    io.to('global').emit('message:stream', {
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
      io.to('global').emit('message:stream', {
        id: responseId,
        conversationId,
        role: 'agent',
        agentId,
        type: 'text',
        content: '',
        isFinal: true,
        createdAt: new Date().toISOString()
      });
      io.to('global').emit('agent:typing', { agentId, conversationId, typing: false });
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
    socket.join('global');
    console.log('[socket] client connected', socket.id);

    socket.on('message:create', async (msg) => {
      io.to('global').emit('message', msg);

      const mention = typeof msg.content === 'string' ? parseMention(msg.content) : null;
      const directAgents = typeof msg.content === 'string' ? extractAgents(msg.content) : [];
      if (!mention && directAgents.length === 0) {
        return;
      }

      const conversationId = msg.conversationId ?? 'default';
      const responseId = `resp-${randomUUID()}`;

      if (mention === 'pm') {
        const agentId = `${mention}-agent`;
        const systemPrompt = loadAgentPrompt(mention)
        const prompt = [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: msg.content
          }
        ]

        io.to('global').emit('agent:typing', { agentId, conversationId, typing: true });

        try {
          console.log('[socket] @%s → calling AI…', mention);
          const completion = await createChatCompletion({ messages: prompt });
          const fullResponse = String(completion.choices?.[0]?.message?.content ?? '').trim();

          if (!fullResponse) {
            throw new Error('模型返回空内容');
          }

          streamAgentReply(io, {
            agentId,
            conversationId,
            responseId,
            fullResponse,
            typingAlreadyShown: true
          });

          const createdTasks = await createTasksFromPmOutput(conversationId, fullResponse)
          if (createdTasks.length > 0) {
            io.to('global').emit('tasks:created', {
              conversationId,
              tasks: createdTasks.map((task) => ({ id: task.id, title: task.title, assignedAgentId: task.assignedAgentId }))
            })
          }

          const nextAgents = extractAgents(fullResponse).filter((agent) => agent !== 'pm')
          if (nextAgents.length > 0) {
            const uniqueAgents = Array.from(new Set(nextAgents))
            await Promise.all(
              uniqueAgents.map((agent) => triggerAgent(io, agent, conversationId, fullResponse, new Set(['pm'])))
            )
          }
        } catch (error: any) {
          console.error('[socket] AI response failed', error);
          const hint = error?.message ?? String(error);
          const fullResponse = [
            `⚠️ **@${mention} 调用失败**`,
            '',
            hint,
            '',
            '**请检查：**',
            '1. `apps/api/.env` 中 `LOCAL_AI_BASE`（Ollama 用 `http://localhost:11434`，不要加 `/v1`）',
            '2. `LOCAL_AI_MODEL` 与 `ollama list` 中的模型名一致',
            '3. 终端执行 `ollama serve` 或确认 Ollama 已启动',
            '4. API 运行在 **3003** 端口（与前端 socket 一致）',
            '',
            '配置好后重新发送 @pm …'
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
