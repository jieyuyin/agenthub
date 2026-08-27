import { Server as IOServer } from 'socket.io';
import type http from 'http';
import { randomUUID } from 'crypto';
import { createChatCompletion, streamChatCompletion } from './services/aiService';
import * as taskService from './services/taskService';
import { runAgentExecution } from './services/taskExecutor';
import * as agentExecutionService from './services/agentExecutionService';
import path from 'path';
import fs from 'fs';
import { addToolContext, buildModelContext, captureExplicitMemory, getConversationForCompaction, ingestProjectKnowledge, recordConversationMessage, saveConversationCompaction } from './services/contextEngineService';
import { registerDesktopBridge, requestDesktopTool } from './services/desktopBridgeService';
import { DiagnosticWorkflow, type DiagnosticEvent } from './services/diagnosticWorkflow';
import { CodingWorker, ComplexityEvaluator, ContextManager, SubagentScheduler, ToolRegistry, type WorkerModel } from '@agenthub/agent-runtime/dist/coding-worker';
import { routeIntent, type IntentRoute } from './services/intentRouter';

const DESKTOP_TOOLS = [
  { type: 'function', function: { name: 'list_files', description: '列出 Workspace 内的文件和目录。分析项目时应先调用。', parameters: { type: 'object', properties: { path: { type: 'string', description: '相对 Workspace 的路径，默认 .' }, depth: { type: 'number', description: '递归深度，最大 8' } } } } },
  { type: 'function', function: { name: 'read_file', description: '读取 Workspace 内一个 UTF-8 文本文件。', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'create_directory', description: '在 Workspace 内创建目录，需要用户确认。', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write_file', description: '创建或完整覆写 Workspace 内的文本文件，需要用户确认。', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'apply_patch', description: '用精确字符串替换修改已有文件，需要用户确认。oldContent 必须唯一且原样存在。', parameters: { type: 'object', properties: { path: { type: 'string' }, oldContent: { type: 'string' }, newContent: { type: 'string' } }, required: ['path', 'oldContent', 'newContent'] } } },
  { type: 'function', function: { name: 'git_status', description: '识别 Git 仓库当前分支，并查看工作区修改状态。', parameters: { type: 'object', properties: { repository: { type: 'string', description: '仓库相对 Workspace 的目录，默认 .' } } } } },
  { type: 'function', function: { name: 'git_branches', description: '列出 Git 仓库的本地和远程分支。', parameters: { type: 'object', properties: { repository: { type: 'string', description: '仓库相对 Workspace 的目录，默认 .' } } } } },
  { type: 'function', function: { name: 'git_diff', description: '查看 Git 仓库尚未提交的 diff。', parameters: { type: 'object', properties: { repository: { type: 'string', description: '仓库相对 Workspace 的目录，默认 .' }, path: { type: 'string', description: '可选文件路径，默认全部' }, staged: { type: 'boolean', description: '是否查看已暂存的 diff' } } } } },
  { type: 'function', function: { name: 'git_clone', description: '把远程 Git 仓库克隆到 Workspace 的新子目录，可指定分支，需要用户确认。', parameters: { type: 'object', properties: { url: { type: 'string' }, target: { type: 'string', description: 'Workspace 内的新子目录' }, branch: { type: 'string' } }, required: ['url', 'target'] } } },
  { type: 'function', function: { name: 'git_pull', description: '在指定 Git 仓库当前分支执行安全的 fast-forward-only 拉取，需要用户确认。操作前应先 git_status 识别分支和未提交修改。', parameters: { type: 'object', properties: { repository: { type: 'string', description: '仓库相对 Workspace 的目录，默认 .' }, remote: { type: 'string' }, branch: { type: 'string' } } } } },
  { type: 'function', function: { name: 'git_checkout', description: '切换或创建 Git 分支，需要用户确认。切换前应先 git_status。', parameters: { type: 'object', properties: { repository: { type: 'string', description: '仓库相对 Workspace 的目录，默认 .' }, branch: { type: 'string' }, create: { type: 'boolean' } }, required: ['branch'] } } },
  { type: 'function', function: { name: 'git_commit', description: '暂存指定文件并创建本地 Git 提交，需要用户确认。提交前先 git_status 和 git_diff，提交后工具会返回分支及剩余修改。', parameters: { type: 'object', properties: { repository: { type: 'string', description: '仓库相对 Workspace 的目录，默认 .' }, message: { type: 'string', description: '提交说明' }, paths: { type: 'array', items: { type: 'string' }, description: '要提交的相对仓库文件路径；全部修改使用 ["."]' } }, required: ['message', 'paths'] } } },
  { type: 'function', function: { name: 'run_command', description: '执行会自行结束的命令，例如安装、构建、测试或类型检查，需要用户确认。禁止用于 dev/server/watch 等常驻服务。', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'start_service', description: '在 Workspace 后台启动常驻服务，例如 pnpm dev、npm run dev、API/Web server。启动确认后立即返回，不等待服务退出，需要用户确认。', parameters: { type: 'object', properties: { command: { type: 'string' }, name: { type: 'string', description: '便于识别的服务名称，例如 Web 或 API' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'service_status', description: '查看一个或全部后台服务的运行状态和最近日志。启动服务后应调用它确认状态。', parameters: { type: 'object', properties: { serviceId: { type: 'string', description: '省略时返回全部服务' } } } } },
  { type: 'function', function: { name: 'stop_service', description: '停止由 start_service 启动的后台服务，需要用户确认。', parameters: { type: 'object', properties: { serviceId: { type: 'string' } }, required: ['serviceId'] } } }
]

type ProjectRuntimeConfig = {
  preset: 'local' | 'docker-service' | 'sandbox'
  agentRuntime: 'local' | 'docker'
  serviceRuntime: 'local' | 'docker'
}

const LOCAL_PROJECT_RUNTIME: ProjectRuntimeConfig = { preset: 'local', agentRuntime: 'local', serviceRuntime: 'local' }

const cancelledConversations = new Set<string>()

const CONTEXT_COMPACT_THRESHOLD_TOKENS = Math.max(4_000, Number(process.env.CONTEXT_COMPACT_THRESHOLD_TOKENS ?? 18_000))
const CONTEXT_RECENT_MESSAGES = Math.max(6, Number(process.env.CONTEXT_RECENT_MESSAGES ?? 10))

function estimateTokens(value: string) {
  const ascii = (value.match(/[\x00-\x7F]/g) || []).length
  return Math.ceil(ascii / 4 + (value.length - ascii) / 1.6)
}

function normalizeProjectRuntime(value: unknown): ProjectRuntimeConfig {
  if (!value || typeof value !== 'object') return LOCAL_PROJECT_RUNTIME
  const preset = String((value as { preset?: unknown }).preset)
  if (preset === 'docker-service') return { preset, agentRuntime: 'local', serviceRuntime: 'docker' }
  if (preset === 'sandbox') return { preset, agentRuntime: 'docker', serviceRuntime: 'docker' }
  return LOCAL_PROJECT_RUNTIME
}

async function maybeCompactConversation(io: IOServer, conversationId: string) {
  const context = getConversationForCompaction(conversationId)
  if (!context || context.messages.length <= CONTEXT_RECENT_MESSAGES) return null
  const estimatedTokens = estimateTokens(context.summary) + context.messages.reduce((total, message) => total + estimateTokens(message.content) + 8, 0)
  if (estimatedTokens < CONTEXT_COMPACT_THRESHOLD_TOKENS) return null

  const candidates = context.messages.slice(0, -CONTEXT_RECENT_MESSAGES)
  const selected = [] as typeof candidates
  let selectedCharacters = 0
  for (const message of candidates) {
    if (selectedCharacters >= 60_000) break
    selected.push(message)
    selectedCharacters += message.content.length
  }
  if (!selected.length) return null

  io.to(conversationId).emit('context:status', { conversationId, compacting: true, estimatedTokens })
  try {
    const transcript = selected.map((message) => `[${message.role}${message.agentId ? `/${message.agentId}` : ''}] ${message.content}`).join('\n\n')
    const completion = await createChatCompletion({
      messages: [
        { role: 'system', content: '你是对话上下文压缩器。把历史压缩成可供后续模型继续工作的结构化中文摘要。必须保留：用户目标与偏好、已经确认的决定、项目架构与技术栈、创建或修改的文件、执行过的命令及结果、错误与根因、尚未完成的工作和下一步。不得虚构，不要保留寒暄或重复话术。输出纯文本，控制在 2500 字以内。' },
        { role: 'user', content: `${context.summary ? `已有摘要：\n${context.summary}\n\n` : ''}需要合并的新历史：\n${transcript}` }
      ]
    })
    const summary = String(completion.choices?.[0]?.message?.content ?? '').trim()
    if (!summary) return null
    const result = saveConversationCompaction({ conversationId, summary, messageIds: selected.map((message) => message.id) })
    io.to(conversationId).emit('context:status', { conversationId, compacting: false, compacted: true, compactedCount: selected.length, estimatedTokens })
    return result
  } catch (error) {
    console.warn('[context] compaction failed:', error instanceof Error ? error.message : String(error))
    io.to(conversationId).emit('context:status', { conversationId, compacting: false, compacted: false })
    return null
  }
}

function emitDiagnosticStatus(io: IOServer, conversationId: string, event: DiagnosticEvent | null) {
  if (!event) return
  io.to(conversationId).emit('diagnostic:status', { conversationId, ...event, timestamp: new Date().toISOString() })
}

function cleanProtocolText(value: string) {
  const cleanEmptyBlocks = (content: string) => content
    .replace(/```[^\n]*\n\s*```/g, '')
    .replace(/^\s*\\\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!/<\/?(?:tool_call|think|arg_key|arg_value)>/i.test(value)) return { content: cleanEmptyBlocks(value), hadProtocol: false }
  const content = cleanEmptyBlocks(value
    .replace(/<arg_key>\s*[\s\S]*?<\/arg_key>\s*<arg_value>\s*[\s\S]*?<\/arg_value>/gi, '')
    .split('\n')
    .filter((line) => !/<\/?(?:tool_call|think|arg_key|arg_value)>/i.test(line))
    .join('\n')
    .replace(/<\/?(?:tool_call|think|arg_key|arg_value)>/gi, '')
  )
  return { content, hadProtocol: true }
}

export function parseTaggedToolCall(content: string): { name: string; arguments: Record<string, unknown> } | null {
  const decoded = content
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
  const args: Record<string, string> = {}
  const decodeTaggedValue = (value: string) => {
    const escapedLines = (value.match(/\\n/g) || []).length
    const realLines = (value.match(/\n/g) || []).length
    return escapedLines > realLines
      ? value.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
      : value
  }
  const pairPattern = /<arg_key>\s*([\s\S]*?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gi
  for (const match of decoded.matchAll(pairPattern)) {
    const rawKey = match[1].trim()
    const key = rawKey === 'filepath' ? 'path'
      : rawKey === 'old_content' ? 'oldContent'
        : rawKey === 'new_content' ? 'newContent'
          : rawKey
    args[key] = ['content', 'oldContent', 'newContent'].includes(key) ? decodeTaggedValue(match[2]) : match[2]
  }
  if (Object.keys(args).length === 0) return null

  const requestedName = decoded.match(/<(?:tool_name|function)>\s*([\w.-]+)\s*<\/(?:tool_name|function)>/i)?.[1]?.toLowerCase()
  const inferredName = requestedName
    ?? (typeof args.command === 'string' && /(启动|运行|start).{0,16}(服务|server|dev)|(?:pnpm|npm|yarn)\s+(?:run\s+)?dev/i.test(decoded) ? 'start_service'
      : typeof args.command === 'string' ? 'run_command'
      : typeof args.oldContent === 'string' && typeof args.newContent === 'string' ? 'apply_patch'
        : typeof args.content === 'string' ? 'write_file'
          : /(创建|新建|mkdir).{0,12}(文件夹|目录)|create_directory/i.test(decoded) ? 'create_directory'
            : /(读取|查看|read_file)/i.test(decoded) ? 'read_file'
              : /(列出|清单|list_files)/i.test(decoded) ? 'list_files'
                : null)
  if (!inferredName || !DESKTOP_TOOLS.some((tool) => tool.function.name === inferredName)) return null

  const pathValue = typeof args.path === 'string' ? args.path.trim() : undefined
  if (pathValue && path.isAbsolute(pathValue)) return null
  return { name: inferredName, arguments: args }
}

export function parseLegacyToolCall(content: string): { name: string; arguments: Record<string, unknown> } | null {
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
  const result = await requestDesktopTool(io, { conversationId, workspaceToken, name, arguments: args })
  const remaining = 1400 - (Date.now() - startedAt)
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
  return result
}

type DiffAccumulator = {
  repository?: string
  files: Map<string, { path: string; additions: number; deletions: number; binary?: boolean }>
  sections: Map<string, string>
}

async function collectConversationDiff(io: IOServer, conversationId: string, workspaceToken: string, changedPath: string, accumulator: DiffAccumulator) {
  try {
    const result = await executeVisibleDesktopTool(io, conversationId, workspaceToken, 'git_diff', { repository: '.', path: changedPath }) as {
      repository?: string
      files?: Array<{ path: string; additions: number; deletions: number; binary?: boolean }>
      diff?: string
    }
    if (!Array.isArray(result.files) || result.files.length === 0) return
    accumulator.repository = result.repository || accumulator.repository || '.'
    for (const file of result.files) accumulator.files.set(file.path, file)
    accumulator.sections.set(changedPath, String(result.diff || ''))
  } catch (error) {
    console.warn('[diff] unable to collect conversation diff:', error instanceof Error ? error.message : String(error))
  }
}

function publishConversationDiff(io: IOServer, conversationId: string, contextScopeId: string, accumulator: DiffAccumulator) {
  if (accumulator.files.size === 0) return
  const payload = {
    conversationId,
    repository: accumulator.repository || '.',
    files: [...accumulator.files.values()],
    diff: [...accumulator.sections.values()].filter(Boolean).join('\n'),
    timestamp: new Date().toISOString()
  }
  addToolContext({ projectId: contextScopeId, conversationId, tool: 'git_diff', summary: JSON.stringify(payload).slice(0, 3000) })
  io.to(conversationId).emit('conversation:diff', payload)
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

function isProjectStartRequest(content: string) {
  return /(启动|跑起来|起服务|启动服务|运行一下|run\s+(?:the\s+)?project|start\s+(?:the\s+)?(?:project|service|server))/i.test(content)
}

function requiredActionTool(content: string) {
  if (/(提交|commit)/i.test(content)) return 'git_commit'
  if (/(克隆|clone)/i.test(content)) return 'git_clone'
  if (/(拉取|更新.{0,8}代码|git\s*pull|pull\s+(?:latest|code))/i.test(content)) return 'git_pull'
  if (/(切换|创建).{0,10}分支|checkout|switch\s+branch/i.test(content)) return 'git_checkout'
  if (/(列出|查看|显示|有哪些).{0,10}(所有|远程|本地)?分支/i.test(content)) return 'git_branches'
  if (/(查看|显示|看看).{0,10}(diff|差异|改了什么)/i.test(content)) return 'git_diff'
  if (/(当前|哪个).{0,8}分支|git\s*status/i.test(content)) return 'git_status'
  return null
}

function isMultiStepBuildRequest(content: string) {
  return /(创建|搭建|开发|实现|生成|完成|继续完成|完善|修复|解决|重构|修改|改造|添加|新增|改).{0,36}(项目|应用|网站|页面|功能|问题|错误|剩余|前端|后端|react|node|express|typescript|\bts\b)|(?:全栈|前后端|前端.{0,24}后端|后端.{0,24}前端|react.{0,24}node|node.{0,24}react)/i.test(content)
}

export function isWorkspaceMutationRequest(content: string) {
  const asksWhetherChanged = /(?:有没有|是否|是不是|确认|查看|检查).{0,16}(?:变宽|变窄|修改|改动|变化|生效)|(?:变宽|变窄|修改|改动|变化|生效).{0,8}(?:了吗|了么|没有|没|吗)/i.test(content)
  const explicitlyRequestsChange = /(?:请|帮我|麻烦|我要|希望).{0,16}(?:改成|改为|调整|修改|加宽|变宽|变窄|移到|新增|添加)/i.test(content)
  if (asksWhetherChanged && !explicitlyRequestsChange) return false
  return /(改成|改为|换成|调整|修改|新增|添加|删除|移到|放到|加宽|变宽|变窄|右对齐|左对齐|居中|我要|希望).{0,40}(页面|界面|登录框|按钮|背景|颜色|文字|字体|布局|样式|风格|位置|宽度|高度|功能|代码|文件)|(?:页面|界面|登录框|按钮|背景|颜色|文字|字体|布局|样式|风格|位置|宽度|高度).{0,40}(改成|改为|换成|调整|修改|新增|添加|删除|移到|放到|加宽|变宽|变窄|右对齐|左对齐|居中|我要|希望)|(?:页面|界面|登录框|按钮|宽度|高度).{0,16}(?:再|更)?(?:宽|窄|大|小|高|低)(?:一些|一点|点)/i.test(content)
}

export function isChangeVerificationChallenge(content: string) {
  return /(你|真的|到底).{0,10}(确定|确认).{0,8}(改|修改|写|应用|生效).{0,6}(了|吗|没|没有)?|(?:改|修改|写|应用).{0,8}(了吗|了么|没有|没改|在哪|哪里)|为什么.{0,12}(没变化|看不见|没生效|没有变化)/i.test(content)
}

export function isReadOnlyCodeQuestion(content: string) {
  return /(?:\.[a-z_-][\w-]*|class|类|选择器|函数|变量|文件|配置|样式).{0,60}(?:是多少|多宽|宽度|有没有|是否|是什么|在哪里|在哪个|怎么设置|当前值|变宽|变化)|(?:是多少|多宽|宽度|有没有|是否|是什么|在哪里|当前值).{0,60}(?:class|类|选择器|函数|变量|文件|配置|样式)/i.test(content)
}

function isContinuationRequest(content: string) {
  return /^\s*(继续|接着|继续做|继续弄|继续完成|然后呢|再试一次|重试|修好它|完成它|我(?:已经)?切换了|已经切换了|切好了|换好了|设置好了|配置好了|现在可以了|可以继续了)[吧啊呀呢。！!？?\s]*$/i.test(content)
}

export function isSimpleConversation(content: string) {
  const normalized = content.trim().replace(/[。！!？?～~\s]+$/g, '')
  return /^(你好|您好|嗨|哈喽|hello|hi|hey|在吗|早上好|上午好|下午好|晚上好|谢谢|多谢|辛苦了|哈+|哈+哈+|哈哈+|呵呵+|嘿嘿+|好的?(?:[,，]?哈+)?|好[的嘞呀啊]?|行|可以|知道了|明白了|收到|嗯+|哦+|没了|没有了|就这样|暂时没有|不用了|先这样|结束)$/i.test(normalized)
}

function looksLikeUnfinishedPlan(content: string) {
  return /(?:^|\n)\s*(?:(?:现在|接下来|然后|首先|下一步|下面)\s*(?:让我|我将)?|让我|我将|准备)(?:再次|继续|开始|来|会|要|需要|尝试)?\s*(?:创建|实现|添加|新增|修改|编写|配置|安装|启动|完善|处理|继续|测试|验证|检查|运行|构建|修复)/i.test(content)
}

function toolResultSucceeded(result: unknown) {
  if (!result || typeof result !== 'object') return true
  const value = result as { ok?: boolean; success?: boolean; status?: string; error?: unknown }
  return value.ok !== false && value.success !== false && !value.error && !['failed', 'exited'].includes(String(value.status || ''))
}

function verificationErrorSignatures(result: unknown) {
  if (!result || typeof result !== 'object') return []
  const value = result as { success?: boolean; stderr?: unknown; stdout?: unknown }
  if (value.success !== false) return []
  const output = `${String(value.stdout || '')}\n${String(value.stderr || '')}`
  return Array.from(new Set((output.match(/error TS\d+: [^\r\n]+/g) ?? []).map((line) => line.replace(/\s+/g, ' ').trim()))).slice(0, 12)
}

async function runDesktopToolLoop(io: IOServer, messages: any[], workspaceToken: string, contextScopeId: string, conversationId: string) {
  const workingMessages = [...messages]
  const legacyCalls = new Set<string>()
  const executedCalls = new Set<string>()
  let workspaceRevision = 0
  const userRequest = [...messages].reverse().find((message) => message.role === 'user')?.content ?? ''
  const recentUserRequests = messages.filter((message) => message.role === 'user').slice(-6).map((message) => String(message.content || '')).join('\n')
  const diagnostic = new DiagnosticWorkflow(String(userRequest))
  const requiresServiceStart = isProjectStartRequest(String(userRequest))
  const requiredAction = requiredActionTool(String(userRequest))
  const multiStepBuild = isMultiStepBuildRequest(String(userRequest))
    || (isContinuationRequest(String(userRequest)) && isMultiStepBuildRequest(recentUserRequests))
  const successfulTools = new Set<string>()
  const directlyAttemptedTools = new Set<string>()
  const turnDiff: DiffAccumulator = { files: new Map(), sections: new Map() }
  let lastAssistantContent = ''
  let buildVerified = false
  let serviceStarted = false
  let serviceChecked = false
  const verificationErrorCounts = new Map<string, number>()
  emitDiagnosticStatus(io, conversationId, diagnostic.start())
  if (/(创建|新建|文件|文件夹|目录|项目|检查|查看|读取|代码|修改|写入|删除|运行|系统)/i.test(String(userRequest))) {
    const initialResult = await executeVisibleDesktopTool(io, conversationId, workspaceToken, 'list_files', { path: '.', depth: 2 })
    emitDiagnosticStatus(io, conversationId, diagnostic.afterTool('list_files', initialResult))
    if (cancelledConversations.has(conversationId)) return ''
    const serialized = JSON.stringify(initialResult)
    addToolContext({ projectId: contextScopeId, conversationId, tool: 'list_files', summary: serialized.slice(0, 2000) })
    executedCalls.add(JSON.stringify({ name: 'list_files', arguments: { path: '.', depth: 2 } }))
    workingMessages.splice(workingMessages.length - 1, 0, { role: 'system', content: `本地桥接层已先检查 Workspace，文件清单如下：\n${serialized}\n请直接继续用户任务，不要只说“让我检查”。如需读取或修改，立即使用 function tools。` })
  }
  const maxRounds = diagnostic.enabled ? 24 : multiStepBuild ? 32 : requiresServiceStart ? 16 : 10
  for (let round = 0; round < maxRounds; round += 1) {
    if (cancelledConversations.has(conversationId)) return ''
    const completion = await createChatCompletion({ messages: workingMessages, tools: DESKTOP_TOOLS })
    const assistantMessage = completion.choices?.[0]?.message
    lastAssistantContent = String(assistantMessage?.content ?? '').trim()
    const toolCalls = assistantMessage?.tool_calls ?? []
    if (!toolCalls.length) {
      const content = String(assistantMessage?.content ?? '').trim()
      const legacyCall = parseLegacyToolCall(content) ?? parseTaggedToolCall(content)
      if (!legacyCall) {
        if (requiredAction && ['git_status', 'git_branches', 'git_diff'].includes(requiredAction) && !successfulTools.has(requiredAction) && !directlyAttemptedTools.has(requiredAction)) {
          directlyAttemptedTools.add(requiredAction)
          io.to(conversationId).emit('tool:status', { conversationId, running: true, tool: requiredAction })
          let directResult: unknown
          try {
            directResult = await executeVisibleDesktopTool(io, conversationId, workspaceToken, requiredAction, { repository: '.' })
          } catch (error) {
            directResult = { ok: false, error: error instanceof Error ? error.message : String(error) }
          }
          if (toolResultSucceeded(directResult)) successfulTools.add(requiredAction)
          const serialized = JSON.stringify(directResult)
          addToolContext({ projectId: contextScopeId, conversationId, tool: requiredAction, summary: serialized.slice(0, 2000) })
          workingMessages.push({ role: 'assistant', content: cleanProtocolText(content).content || `正在执行 ${requiredAction}` })
          workingMessages.push({ role: 'system', content: `本地桥接层已直接执行只读工具 ${requiredAction}，结果如下：\n${serialized}\n请立即根据这个真实结果回答用户，不要再输出计划，也不要声称操作尚未执行。` })
          continue
        }
        const required = diagnostic.nextRequiredInstruction()
        const serviceRequired = requiresServiceStart && !serviceStarted
          ? '启动任务尚未完成：你上一条只是说明计划，没有执行。不要再输出“让我安装/让我启动/首先”等过渡文字。现在必须立即调用标准 function tool：先按需 read_file 检查 package.json 或 README；依赖缺失时调用 run_command 安装；然后必须调用 start_service 启动常驻服务。'
          : requiresServiceStart && !serviceChecked
            ? '服务已发起启动，但尚未检查。现在立即调用 service_status，依据状态和日志确认服务是否真正运行；如果失败，继续修复并重新启动。'
            : null
        const actionRequired = requiredAction && !successfulTools.has(requiredAction)
          ? `用户要求的操作尚未执行。你上一条只是计划或过渡说明，不能作为最终答案。现在立即调用 ${requiredAction}；在此之前可调用必要的只读检查工具，但不要再次说“让我尝试”“首先”或“接下来”。`
          : null
        const changedFiles = successfulTools.has('write_file') || successfulTools.has('apply_patch') || successfulTools.has('create_directory')
        const unfinishedPlan = looksLikeUnfinishedPlan(content)
          ? '上一条回复以一个尚未执行的动作结束，不能作为最终答复。不要继续描述“现在创建什么”；立即调用 write_file、apply_patch、create_directory、run_command 或其他合适的标准工具完成该动作，并继续完成用户要求的其余前端、后端、配置和验证工作。只有所有必要文件都已落盘且完成验证后才能总结。'
          : null
        const buildVerificationRequired = multiStepBuild && changedFiles && !buildVerified
          ? '完整项目尚未验证，不能回答“已完成”。先检查前端和后端的必要源码与配置是否都已创建，然后立即调用 run_command 安装依赖并运行构建、类型检查或测试。验证失败就继续修复；只有命令成功后才能最终总结。'
          : null
        if (!required && !serviceRequired && !actionRequired && !unfinishedPlan && !buildVerificationRequired) {
          emitDiagnosticStatus(io, conversationId, diagnostic.finish())
          publishConversationDiff(io, conversationId, contextScopeId, turnDiff)
          return content
        }
        if (actionRequired) io.to(conversationId).emit('tool:status', { conversationId, running: true, tool: requiredAction })
        if (unfinishedPlan) io.to(conversationId).emit('tool:status', { conversationId, running: true, tool: 'continuing_build' })
        if (buildVerificationRequired) io.to(conversationId).emit('tool:status', { conversationId, running: true, tool: 'run_command' })
        emitDiagnosticStatus(io, conversationId, diagnostic.nextRequiredEvent())
        workingMessages.push({ role: 'assistant', content: cleanProtocolText(content).content || '我将继续完成诊断闭环。' })
        workingMessages.push({ role: 'system', content: required || serviceRequired || actionRequired || unfinishedPlan || buildVerificationRequired })
        continue
      }
      const signature = JSON.stringify(legacyCall)
      if (legacyCalls.has(signature)) {
        const required = diagnostic.nextRequiredInstruction()
        const serviceRequired = requiresServiceStart && !serviceStarted
          ? '不要重复相同调用，也不要只说明计划。启动任务尚未完成：读取正确的项目脚本后，调用 run_command 完成必要安装，再调用 start_service。'
          : requiresServiceStart && !serviceChecked
            ? '不要重复相同调用。现在调用 service_status 检查已启动服务的状态和日志。'
            : null
        const actionRequired = requiredAction && !successfulTools.has(requiredAction)
          ? `不要重复相同调用。用户要求的 ${requiredAction} 尚未成功执行，请立即调用该工具。`
          : null
        if (!required && !serviceRequired && !actionRequired) {
          emitDiagnosticStatus(io, conversationId, diagnostic.finish())
          const finalResponse = await finishDesktopRun(workingMessages)
          publishConversationDiff(io, conversationId, contextScopeId, turnDiff)
          return finalResponse
        }
        emitDiagnosticStatus(io, conversationId, diagnostic.nextRequiredEvent())
        workingMessages.push({ role: 'system', content: `不要重复相同工具调用。${required || serviceRequired || actionRequired}` })
        continue
      }
      legacyCalls.add(signature)
      let result: unknown
      emitDiagnosticStatus(io, conversationId, diagnostic.beforeTool(legacyCall.name))
      try {
        result = await executeVisibleDesktopTool(io, conversationId, workspaceToken, legacyCall.name, legacyCall.arguments)
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      emitDiagnosticStatus(io, conversationId, diagnostic.afterTool(legacyCall.name, result))
      if (legacyCall.name === 'start_service' && toolResultSucceeded(result)) serviceStarted = true
      if (legacyCall.name === 'service_status' && toolResultSucceeded(result)) serviceChecked = true
      if (toolResultSucceeded(result)) successfulTools.add(legacyCall.name)
      if (legacyCall.name === 'run_command' && toolResultSucceeded(result) && /(build|test|type-?check|tsc|lint)/i.test(String(legacyCall.arguments.command || ''))) buildVerified = true
      if (['write_file', 'apply_patch'].includes(legacyCall.name) && toolResultSucceeded(result)) {
        await collectConversationDiff(io, conversationId, workspaceToken, String(legacyCall.arguments.path || '.'), turnDiff)
      }
      if (cancelledConversations.has(conversationId)) return ''
      const serialized = JSON.stringify(result)
      addToolContext({ projectId: contextScopeId, conversationId, tool: legacyCall.name, summary: serialized.slice(0, 2000) })
      workingMessages.push({ role: 'assistant', content: cleanProtocolText(content).content || `正在调用 ${legacyCall.name}` })
      workingMessages.push({ role: 'system', content: `本地桥接层已执行 ${legacyCall.name}，结果如下：\n${serialized}\n请基于结果继续完成用户任务。不要输出 <tool_call> 或 <think> 标签；如需更多操作，使用提供的标准 function tools。` })
      if (legacyCall.name === 'run_command') {
        const persistent = verificationErrorSignatures(result).filter((signature) => {
          const count = (verificationErrorCounts.get(signature) ?? 0) + 1
          verificationErrorCounts.set(signature, count)
          return count >= 2
        })
        if (persistent.length) workingMessages.push({ role: 'system', content: `验证中出现了重复错误，继续对同一文件做表面替换正在消耗轮数。暂停重复运行命令，先读取报错文件、package.json、tsconfig 和相关依赖版本，定位 API/类型版本不兼容或错误文件编码。必须修复根因后再验证。持续错误：\n- ${persistent.join('\n- ')}` })
      }
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
        continue
      }
      executedCalls.add(signature)
      let result: unknown
      emitDiagnosticStatus(io, conversationId, diagnostic.beforeTool(name))
      try {
        result = await executeVisibleDesktopTool(io, conversationId, workspaceToken, name, args)
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      emitDiagnosticStatus(io, conversationId, diagnostic.afterTool(name, result))
      if (name === 'start_service' && toolResultSucceeded(result)) serviceStarted = true
      if (name === 'service_status' && toolResultSucceeded(result)) serviceChecked = true
      if (toolResultSucceeded(result)) successfulTools.add(name)
      if (name === 'run_command' && toolResultSucceeded(result) && /(build|test|type-?check|tsc|lint)/i.test(String(args.command || ''))) buildVerified = true
      if (['write_file', 'apply_patch'].includes(name) && toolResultSucceeded(result)) {
        await collectConversationDiff(io, conversationId, workspaceToken, String(args.path || '.'), turnDiff)
      }
      if (cancelledConversations.has(conversationId)) return ''
      const serialized = JSON.stringify(result)
      if (['write_file', 'apply_patch', 'create_directory'].includes(name) && (result as { ok?: boolean })?.ok !== false) workspaceRevision += 1
      addToolContext({ projectId: contextScopeId, conversationId, tool: name, summary: serialized.slice(0, 2000) })
      workingMessages.push({ role: 'tool', tool_call_id: call.id, content: serialized })
      if (name === 'run_command') {
        const persistent = verificationErrorSignatures(result).filter((signature) => {
          const count = (verificationErrorCounts.get(signature) ?? 0) + 1
          verificationErrorCounts.set(signature, count)
          return count >= 2
        })
        if (persistent.length) workingMessages.push({ role: 'system', content: `验证中出现了重复错误，继续对同一文件做表面替换正在消耗轮数。暂停重复运行命令，先读取报错文件、package.json、tsconfig 和相关依赖版本，定位 API/类型版本不兼容或错误文件编码。必须修复根因后再验证。持续错误：\n- ${persistent.join('\n- ')}` })
      }
    }
  }
  emitDiagnosticStatus(io, conversationId, diagnostic.finish())
  if (requiresServiceStart && (!serviceStarted || !serviceChecked)) {
    return '项目服务尚未成功启动：模型连续只给出了操作计划，或服务启动/状态检查没有成功完成。请检查模型是否支持标准 function calling；本次没有把未执行的计划误报为完成。'
  }
  if (requiredAction && !successfulTools.has(requiredAction)) {
    return `操作尚未完成：模型没有成功调用 ${requiredAction}。本次已阻止把“准备执行”的文字误报为完成。`
  }
  if (multiStepBuild) {
    const pending = looksLikeUnfinishedPlan(lastAssistantContent) ? `模型最后停在未执行计划：“${lastAssistantContent.slice(0, 120)}”` : '尚未取得完整项目的成功验证结果。'
    return `项目尚未完成：已达到本轮安全执行上限。${pending} 已写入的文件修改已保留，但在任务完整验证前不会发布最终 Diff；本次不会把部分完成误报为全部完成。`
  }
  return finishDesktopRun(workingMessages)
}

async function runUnifiedDesktopWorker(io: IOServer, messages: any[], workspaceToken: string, contextScopeId: string, conversationId: string, intent: IntentRoute, runtimeConfig: ProjectRuntimeConfig) {
  const userRequest = String([...messages].reverse().find((message) => message.role === 'user')?.content ?? '')
  const recentUserRequests = messages.filter((message) => message.role === 'user').slice(-6).map((message) => String(message.content || '')).join('\n')
  const multiStepBuild = isMultiStepBuildRequest(userRequest)
    || (isContinuationRequest(userRequest) && isMultiStepBuildRequest(recentUserRequests))
  const verificationChallenge = intent.intents.includes('verify_change') || isChangeVerificationChallenge(userRequest)
  const mutationRequested = intent.requiresWrite || intent.mode === 'modify'
  const routedGitAction = intent.intents.find((value) => ['git_status', 'git_branches', 'git_diff', 'git_clone', 'git_pull', 'git_checkout', 'git_commit'].includes(value)) ?? null
  const requiredAction = requiredActionTool(userRequest) ?? routedGitAction
  const requiresServiceStart = isProjectStartRequest(userRequest) || intent.intents.includes('start_service')
  const sandboxMode = runtimeConfig.agentRuntime === 'docker'
  const dockerService = runtimeConfig.preset === 'docker-service'
  let sandboxId: string | null = null
  if (sandboxMode) {
    io.to(conversationId).emit('worker:status', { conversationId, phase: 'sandbox-preparing' })
    const prepared = await executeVisibleDesktopTool(io, conversationId, workspaceToken, 'sandbox_prepare', {}) as { sandboxId?: string }
    sandboxId = String(prepared.sandboxId || '')
    if (!sandboxId) throw new Error('Docker Sandbox 创建失败：未返回 Sandbox ID')
  }
  const diagnostic = new DiagnosticWorkflow(userRequest, intent.mode === 'diagnose')
  const readOnlyCodeQuestion = intent.mode === 'inspect' && !mutationRequested && !verificationChallenge
  const diff: DiffAccumulator = { files: new Map(), sections: new Map() }
  const successfulTools = new Set<string>()
  const completedToolCalls = new Map<string, unknown>()
  let workspaceRevision = 0
  let serviceStarted = false
  let serviceChecked = false

  const context = new ContextManager({
    goal: userRequest,
    constraints: [
      '所有路径必须相对 Workspace',
      '只按需搜索和读取相关文件，不一次加载整个项目',
      '修改后必须执行相关验证，验证成功前不能声称完成',
      sandboxMode ? '所有文件和命令工具都在独立 Docker Sandbox 工作副本中执行；验证成功后才同步回原 Workspace' : dockerService ? '项目服务必须通过 Dockerfile 或 Docker Compose 运行，禁止使用本机 start_service' : '项目服务使用本机环境运行'
    ],
    acceptanceCriteria: multiStepBuild
      ? ['需求涉及的文件已经落盘', '相关构建、类型检查或测试成功', '最终结果包含真实 Diff']
      : ['依据真实工具结果回答用户'],
    background: recentUserRequests
  })

  const registry = new ToolRegistry()
  for (const definition of DESKTOP_TOOLS) {
    registry.register({
      name: definition.function.name,
      description: definition.function.description,
      parameters: definition.function.parameters as Record<string, unknown>,
      execute: async (input) => {
        if (cancelledConversations.has(conversationId)) throw new Error('用户已中断任务')
        const name = definition.function.name
        const revisionSensitive = ['list_files', 'read_file', 'git_diff', 'run_command'].includes(name)
        const signature = JSON.stringify({ name, input, revision: revisionSensitive ? workspaceRevision : undefined })
        if (completedToolCalls.has(signature)) return completedToolCalls.get(signature)
        emitDiagnosticStatus(io, conversationId, diagnostic.beforeTool(name))
        const toolInput = sandboxId ? { ...input, __sandboxId: sandboxId } : input
        const result = await executeVisibleDesktopTool(io, conversationId, workspaceToken, name, toolInput)
        emitDiagnosticStatus(io, conversationId, diagnostic.afterTool(name, result))
        addToolContext({ projectId: contextScopeId, conversationId, tool: name, summary: JSON.stringify(result).slice(0, 3000) })
        if (!toolResultSucceeded(result)) throw new Error(JSON.stringify(result).slice(0, 6000))
        successfulTools.add(name)
        completedToolCalls.set(signature, result)
        if (name === 'start_service') serviceStarted = true
        if (name === 'service_status') serviceChecked = true
        if (name === 'read_file') {
          const value = result as { path?: string; content?: string }
          context.addCode({ path: value.path || String(input.path || ''), content: String(value.content || '').slice(0, 12_000) })
        }
        if (['write_file', 'apply_patch'].includes(name)) {
          workspaceRevision += 1
          if (!sandboxMode) await collectConversationDiff(io, conversationId, workspaceToken, String(input.path || '.'), diff)
        }
        return result
      }
    })
  }

  const workingMessages = [...messages]
  let pendingToolCallId: string | null = null
  let observedCount = 0
  const model: WorkerModel = {
    decide: async ({ context: snapshot, subagentResult }) => {
      const observations = snapshot.recentExecution.slice(observedCount)
      if (pendingToolCallId && observations.length) {
        const observation = observations[observations.length - 1]
        workingMessages.push({
          role: 'tool',
          tool_call_id: pendingToolCallId,
          content: JSON.stringify(observation.success ? observation.output : { success: false, error: observation.error })
        })
        pendingToolCallId = null
      }
      observedCount = snapshot.recentExecution.length
      if (subagentResult) workingMessages.push({ role: 'system', content: `专业 Subagent 的只读建议：\n${String(subagentResult)}\n请自行判断并继续下一步。` })

      if (readOnlyCodeQuestion && snapshot.code.length > 0) {
        const answer = await createChatCompletion({
          messages: [
            ...workingMessages,
            { role: 'system', content: `这是只读代码查询，相关文件已经读取，证据如下：\n${JSON.stringify(snapshot.code).slice(0, 18_000)}\n现在禁止继续调用工具。直接准确回答用户询问的当前值；如果用户问是否变过，只能根据文件注释、Diff 或对话中已有证据判断，不得猜测。` }
          ]
        })
        return { uncertainty: 0.1, complete: true, final: cleanProtocolText(String(answer.choices?.[0]?.message?.content ?? '')).content }
      }

      const completion = await createChatCompletion({
        messages: [
          ...workingMessages,
          { role: 'system', content: `你正在统一 Coding Worker Runtime 中工作。证据不足时每轮只选择一个最有价值的工具；证据足够时不要再调用工具，直接给出最终答案。不要输出尚未执行的计划，也不要重复相同的读取。当前状态：\n${JSON.stringify(snapshot).slice(0, 18_000)}` }
        ],
        tools: dockerService ? DESKTOP_TOOLS.filter((tool) => !['start_service', 'service_status', 'stop_service'].includes(tool.function.name)) : DESKTOP_TOOLS
      })
      const assistant = completion.choices?.[0]?.message
      const calls = assistant?.tool_calls ?? []
      if (calls.length) {
        const call = calls[0]
        let input: Record<string, unknown>
        try { input = JSON.parse(call.function?.arguments || '{}') } catch { input = {} }
        pendingToolCallId = call.id
        workingMessages.push({ ...assistant, tool_calls: [call] })
        const recentFailures = snapshot.recentExecution.filter((item) => !item.success).length
        const uncertainty = Math.min(1, 0.25 + recentFailures * 0.15)
        return { reasoning: String(assistant?.content || ''), uncertainty, action: { tool: String(call.function?.name || ''), input } }
      }

      const rawAssistantContent = String(assistant?.content ?? '')
      const compatibilityCall = parseLegacyToolCall(rawAssistantContent) ?? parseTaggedToolCall(rawAssistantContent)
      if (compatibilityCall) {
        const syntheticCallId = `compat-${randomUUID()}`
        pendingToolCallId = syntheticCallId
        workingMessages.push({
          role: 'assistant',
          content: cleanProtocolText(rawAssistantContent).content || null,
          tool_calls: [{ id: syntheticCallId, type: 'function', function: { name: compatibilityCall.name, arguments: JSON.stringify(compatibilityCall.arguments) } }]
        })
        const recentFailures = snapshot.recentExecution.filter((item) => !item.success).length
        return {
          reasoning: cleanProtocolText(rawAssistantContent).content,
          uncertainty: Math.min(1, 0.3 + recentFailures * 0.15),
          action: { tool: compatibilityCall.name, input: compatibilityCall.arguments }
        }
      }

      const content = cleanProtocolText(rawAssistantContent).content
      const changed = snapshot.modifiedFiles.length > 0
      const verified = snapshot.testResults.some((result) => result.success)
      const hasInspectionEvidence = successfulTools.has('read_file') || successfulTools.has('list_files') || successfulTools.has('git_status') || successfulTools.has('git_branches') || successfulTools.has('git_diff') || successfulTools.has('service_status')
      const unmet = intent.mode === 'inspect' && !hasInspectionEvidence
        ? '这是只读检查任务，但尚未取得任何项目证据。先调用 list_files、read_file、Git 或状态工具，再根据真实结果回答。'
        : intent.mode === 'execute' && successfulTools.size === 0
          ? '这是执行任务，但尚未成功执行任何工具。必须调用与 intents 对应的命令、Git 或服务工具，不能只说明计划。'
        : requiredAction && !successfulTools.has(requiredAction)
        ? `必须先调用 ${requiredAction} 完成用户明确要求。`
        : verificationChallenge && !successfulTools.has('git_diff') && !successfulTools.has('read_file')
          ? '用户在质疑修改是否真实发生。禁止口头确认；立即调用 git_diff 查看真实差异，必要时再 read_file 核对目标文件，然后根据证据回答。'
          : mutationRequested && !changed
            ? '用户明确要求修改项目，但本轮尚未成功调用 write_file 或 apply_patch。禁止声称“已修改”或让用户刷新；先读取相关文件并执行真实写入。'
        : requiresServiceStart && dockerService && !successfulTools.has('run_command')
          ? '此项目配置为 Docker 运行。先读取 Dockerfile、compose.yaml 或 docker-compose.yml，然后使用 run_command 执行 docker compose up -d（或项目文档指定的 Docker 启动命令），并依据退出码确认启动结果。禁止调用本机 start_service。'
        : requiresServiceStart && !dockerService && !serviceStarted
          ? '必须先调用 start_service 启动服务。'
          : requiresServiceStart && !dockerService && !serviceChecked
            ? '必须调用 service_status 确认服务状态。'
            : intent.requiresVerification && changed && !verified
              ? '已有文件修改，但必须先运行构建、类型检查或测试并成功。'
              : looksLikeUnfinishedPlan(content)
                ? '不能以计划文字结束，立即调用对应工具执行。'
                : null
      if (unmet) {
        workingMessages.push({ role: 'assistant', content: content || '继续执行任务。' })
        workingMessages.push({ role: 'system', content: unmet })
        return { reasoning: content, uncertainty: 0.45 }
      }
      return { reasoning: content, uncertainty: 0.15, complete: true, final: content }
    }
  }

  const subagents = new SubagentScheduler(async ({ kind, reason, context: specialistContext }) => {
    const completion = await createChatCompletion({
      messages: [
        { role: 'system', content: `你是只读 ${kind} Subagent。只分析证据并给 Coding Worker 提供简洁建议，不调用工具、不声称修改文件。` },
        { role: 'user', content: `触发原因：${reason}\n\n${JSON.stringify(specialistContext).slice(0, 24_000)}` }
      ]
    })
    return String(completion.choices?.[0]?.message?.content ?? '')
  })

  emitDiagnosticStatus(io, conversationId, diagnostic.start())
  const worker = new CodingWorker(context, registry, model, new ComplexityEvaluator(), subagents, multiStepBuild ? 32 : 12, async (event) => {
    if (event.type === 'subagent') {
      const kind = String((event.data as { kind?: string }).kind || 'explore')
      io.to(conversationId).emit('worker:status', { conversationId, phase: 'delegating', subagent: kind })
    }
    if (event.type === 'complexity') io.to(conversationId).emit('worker:complexity', { conversationId, ...(event.data as object) })
  })
  let result
  try {
    result = await worker.run()
    if (sandboxId && result.success) {
      io.to(conversationId).emit('worker:status', { conversationId, phase: 'sandbox-syncing' })
      await executeVisibleDesktopTool(io, conversationId, workspaceToken, 'sandbox_finalize', { sandboxId })
      sandboxId = null
      await collectConversationDiff(io, conversationId, workspaceToken, '.', diff)
    }
  } finally {
    if (sandboxId) {
      try { await executeVisibleDesktopTool(io, conversationId, workspaceToken, 'sandbox_discard', { sandboxId }) } catch {}
    }
  }
  emitDiagnosticStatus(io, conversationId, diagnostic.finish())
  io.to(conversationId).emit('tool:status', { conversationId, running: false })
  if (result.success) {
    publishConversationDiff(io, conversationId, contextScopeId, diff)
    return result.result || '任务已经完成。'
  }
  return `任务尚未完成：${result.result}`
}

const AGENT_ROLE_TO_ID: Record<string, string> = {
  planner: 'planner-1',
  developer: 'developer-1',
  tester: 'tester-1',
  debugger: 'debugger-1',
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
  if (text.includes('@debugger') || text.includes('@debug')) agents.push('debugger')

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
      await maybeCompactConversation(io, conversationId)

      const explicitMention = typeof msg.content === 'string' ? parseMention(msg.content) : null;
      const legacyRoles: Record<string, string> = { pm: 'planner', frontend: 'developer', backend: 'developer', qa: 'tester' };
      const mention = explicitMention ? (legacyRoles[explicitMention] ?? explicitMention) : (msg.projectId ? 'orchestrator' : 'assistant');
      const directAgents = explicitMention && typeof msg.content === 'string' ? extractAgents(msg.content) : [];

      const responseId = `resp-${randomUUID()}`;

      if (mention === 'assistant' || mention === 'orchestrator' || mention === 'debugger') {
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
            prompt.splice(1, 0, { role: 'system', content: `你已连接用户授权的本地 Workspace，并拥有受控的本地文件工具。${mention === 'assistant' ? '即使当前对话未绑定项目，你也可以读取或在用户确认后修改这个 Workspace；不要声称自己无法访问文件系统。' : ''}回答代码或文件问题前先调用 list_files/read_file 获取证据；需要修改时直接调用写入工具。所有 path 和 repository 必须是相对路径，禁止猜测绝对路径。完整项目或前后端任务开始写文件后必须持续执行，直到必要源码、配置、依赖和验证都完成；“现在创建后端文件”“接下来实现前端”“让我继续”等只是计划，不是完成，输出这种句子前必须直接调用相应工具。处理 Git 请求时使用专用 git 工具：克隆用 git_clone；拉取前先 git_status 识别当前分支和未提交修改，再用 git_pull；切换分支用 git_checkout；提交前用 git_status/git_diff 检查并用 git_commit 创建提交；修改后用 git_diff 向用户展示差异。不得只输出“让我尝试”“首先”“接下来”等计划文字；用户要求操作时必须真正调用相应工具并依据结果作答。安装、构建、测试等会结束的命令使用 run_command；pnpm dev、npm run dev、server、watch 等常驻进程必须使用 start_service，启动后使用 service_status 检查日志和状态，禁止用 run_command 等待常驻服务退出。工具或命令返回错误时，把错误当作调试证据：读取相关源码、定位原因、修复后再次验证，不要把它误报成模型连接失败，也不要在第一次命令失败后停止。工具执行结果返回后，简洁说明读取、修改和验证结果。` })
          }
          let streamedDirectly = false
          const currentMessage = String(msg.content ?? '')
          const recentMessages = history.filter((message) => message.role === 'user').map((message) => String(message.content || ''))
          const continuation = isContinuationRequest(currentMessage)
          const previousUserContext = recentMessages.slice(-4).join('\n')
          const intent = await routeIntent({
            message: currentMessage,
            recentMessages,
            hasWorkspace: Boolean(workspaceToken),
            hints: {
              simpleChat: isSimpleConversation(currentMessage),
              diagnostic: new DiagnosticWorkflow(currentMessage).enabled,
              mutation: isWorkspaceMutationRequest(currentMessage) || (continuation && isWorkspaceMutationRequest(previousUserContext)),
              readOnlyCodeQuestion: isReadOnlyCodeQuestion(currentMessage),
              verificationChallenge: isChangeVerificationChallenge(currentMessage),
              continuation,
              projectStart: isProjectStartRequest(currentMessage) || (continuation && isProjectStartRequest(previousUserContext)),
              gitAction: requiredActionTool(currentMessage) || (continuation ? requiredActionTool(previousUserContext) : null)
            }
          })
          console.log('[intent-router]', { conversationId, ...intent })
          if (workspaceToken) addToolContext({ projectId: projectId || `workspace-${workspaceToken}`, conversationId, tool: 'intent_router', summary: JSON.stringify(intent) })
          io.to(conversationId).emit('intent:route', { conversationId, ...intent })
          const useWorkspaceTools = Boolean(workspaceToken) && intent.needsTools
          const runtimeConfig = normalizeProjectRuntime(msg.runtimeConfig)
          const directPrompt = intent.mode === 'chat'
            ? [...prompt, { role: 'system', content: '当前消息是寒暄、确认或对话收尾。只回应用户当前这句话，保持简短自然；不要重复前面的代码结论、项目状态或修改说明，也不要主动重新总结上一项任务。' }]
            : prompt
          const rawResponse = useWorkspaceTools
            ? await runUnifiedDesktopWorker(io, prompt, workspaceToken, projectId || `workspace-${workspaceToken}`, conversationId, intent, runtimeConfig)
            : await streamChatCompletion({ messages: directPrompt, onDelta: (content) => {
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
                `⚠️ **${mention === 'assistant' ? 'AI Assistant' : mention === 'debugger' ? 'Debug Agent' : 'Project Assistant'} 调用失败**`,
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
