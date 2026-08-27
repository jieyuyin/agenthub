import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

type ContextMessage = { id: string; role: 'user' | 'assistant'; content: string; agentId?: string; createdAt: string }
type MemoryItem = { id: string; scope: 'user' | 'project' | 'conversation'; scopeId: string; content: string; createdAt: string }
type TaskState = { projectId: string; goal: string; phase: string; status: string; nextStep?: string; updatedAt: string }
type KnowledgeChunk = { id: string; projectId: string; path: string; content: string; hash: string }
type ToolContext = { id: string; projectId: string; conversationId?: string; tool: string; summary: string; createdAt: string }
type ConversationContext = { id: string; projectId: string | null; messages: ContextMessage[]; summary?: string; compactedMessageIds?: string[]; compactedAt?: string; updatedAt: string }
type ContextStore = {
  conversations: Record<string, ConversationContext>
  memories: MemoryItem[]
  taskStates: Record<string, TaskState>
  knowledge: KnowledgeChunk[]
  toolContexts: ToolContext[]
}

const dataDir = path.resolve(process.cwd(), 'data')
const storeFile = path.join(dataDir, 'context-store.json')
const memoryDir = path.join(dataDir, 'memory')
const userProfileFile = path.join(memoryDir, 'user-profile.json')
const globalMemoryFile = path.join(memoryDir, 'MEMORY.md')
const emptyStore = (): ContextStore => ({ conversations: {}, memories: [], taskStates: {}, knowledge: [], toolContexts: [] })

function readStore(): ContextStore {
  try {
    return { ...emptyStore(), ...JSON.parse(readFileSync(storeFile, 'utf8')) }
  } catch {
    return emptyStore()
  }
}

function writeStore(store: ContextStore) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(storeFile, JSON.stringify(store, null, 2), { mode: 0o600 })
}

function safeProjectId(projectId: string) {
  return projectId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

function readText(filePath: string) {
  try { return readFileSync(filePath, 'utf8').trim() } catch { return '' }
}

function readJson<T>(filePath: string, fallback: T): T {
  try { return JSON.parse(readFileSync(filePath, 'utf8')) as T } catch { return fallback }
}

export function getLongTermMemory(projectId?: string | null) {
  const profile = readJson<{ facts: string[]; preferences: string[]; updatedAt?: string }>(userProfileFile, { facts: [], preferences: [] })
  const globalMemory = readText(globalMemoryFile)
  const projectMemory = projectId ? readText(path.join(memoryDir, 'projects', safeProjectId(projectId), 'MEMORY.md')) : ''
  return { profile, globalMemory, projectMemory }
}

export function updateUserProfile(input: { facts?: string[]; preferences?: string[] }) {
  const current = getLongTermMemory().profile
  const unique = (items: string[]) => Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(-100)
  const next = {
    facts: unique([...(current.facts ?? []), ...(input.facts ?? [])]),
    preferences: unique([...(current.preferences ?? []), ...(input.preferences ?? [])]),
    updatedAt: new Date().toISOString()
  }
  mkdirSync(memoryDir, { recursive: true })
  writeFileSync(userProfileFile, JSON.stringify(next, null, 2), { mode: 0o600 })
  return next
}

export function writeMemoryMarkdown(content: string, projectId?: string | null) {
  const filePath = projectId
    ? path.join(memoryDir, 'projects', safeProjectId(projectId), 'MEMORY.md')
    : globalMemoryFile
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content.trim() ? `${content.trim()}\n` : '', { mode: 0o600 })
  return { scope: projectId ? 'project' : 'global', projectId: projectId ?? null, content: readText(filePath) }
}

function extractPreference(content: string) {
  const patterns = [
    /我的偏好(?:是|为|：|:)\s*(.+?)(?:[，,。\n]|$)/,
    /我(?:喜欢|偏好|习惯)\s*(.+?)(?:[，,。\n]|$)/,
    /我希望以后\s*(.+?)(?:[，,。\n]|$)/
  ]
  for (const pattern of patterns) {
    const value = content.match(pattern)?.[1]?.trim()
    if (value) return value.replace(/(?:请)?记住(?:它|这个|这些)?$/, '').trim()
  }
  return ''
}

export function captureExplicitMemory(content: string, projectId?: string | null, conversationId?: string) {
  const trimmed = content.trim()
  const remember = trimmed.match(/(?:请)?记住[：:,，]?\s*(.+)/s)?.[1]?.trim()
  if (remember) {
    const current = getLongTermMemory(projectId)
    const existing = projectId ? current.projectMemory : current.globalMemory
    if (!existing.includes(remember)) writeMemoryMarkdown(`${existing}${existing ? '\n' : '# Long-term Memory\n\n'}- ${remember}`, projectId)
  }
  const name = trimmed.match(/我叫\s*([^，。,.\n]{1,30})/)?.[1]?.trim()
  let preference = extractPreference(trimmed)
  const asksToRememberPreviousPreference = /(?:把|将)?我(?:刚才|之前)?(?:说的)?(?:个人)?偏好记住|记住我(?:刚才|之前)?(?:说的)?(?:个人)?偏好/.test(trimmed)
  if (!preference && asksToRememberPreviousPreference && conversationId) {
    const conversation = readStore().conversations[conversationId]
    preference = [...(conversation?.messages ?? [])]
      .reverse()
      .filter((message) => message.role === 'user' && message.content !== content)
      .map((message) => extractPreference(message.content))
      .find(Boolean) ?? ''
  }
  if (name || preference) updateUserProfile({ facts: name ? [`用户名字：${name}`] : [], preferences: preference ? [preference] : [] })
}

function words(value: string) {
  return new Set((value.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []).slice(0, 100))
}

function relevance(query: Set<string>, content: string) {
  const lower = content.toLowerCase()
  let score = 0
  query.forEach((word) => { if (lower.includes(word)) score += word.length > 3 ? 2 : 1 })
  return score
}

export function recordConversationMessage(input: { conversationId: string; projectId?: string | null; role: 'user' | 'assistant'; content: string; agentId?: string; id?: string }) {
  const store = readStore()
  const current = store.conversations[input.conversationId] ?? { id: input.conversationId, projectId: input.projectId ?? null, messages: [], updatedAt: new Date().toISOString() }
  current.projectId = input.projectId ?? current.projectId
  if (!current.messages.some((message) => message.id === input.id)) {
    current.messages.push({ id: input.id ?? randomUUID(), role: input.role, content: input.content, agentId: input.agentId, createdAt: new Date().toISOString() })
  }
  current.messages = current.messages.slice(-80)
  current.updatedAt = new Date().toISOString()
  store.conversations[input.conversationId] = current
  writeStore(store)
}

export function getConversationForCompaction(conversationId: string) {
  const conversation = readStore().conversations[conversationId]
  if (!conversation) return null
  const compactedIds = new Set(conversation.compactedMessageIds ?? [])
  return {
    summary: conversation.summary ?? '',
    messages: conversation.messages.filter((message) => !compactedIds.has(message.id)),
    totalMessages: conversation.messages.length,
    compactedMessages: compactedIds.size
  }
}

export function saveConversationCompaction(input: { conversationId: string; summary: string; messageIds: string[] }) {
  const store = readStore()
  const conversation = store.conversations[input.conversationId]
  if (!conversation) return null
  conversation.summary = input.summary.trim().slice(0, 24_000)
  conversation.compactedMessageIds = Array.from(new Set([...(conversation.compactedMessageIds ?? []), ...input.messageIds])).slice(-240)
  conversation.compactedAt = new Date().toISOString()
  conversation.updatedAt = conversation.compactedAt
  store.conversations[input.conversationId] = conversation
  writeStore(store)
  return { summary: conversation.summary, compactedCount: input.messageIds.length, compactedAt: conversation.compactedAt }
}

export function addMemory(input: { scope: MemoryItem['scope']; scopeId: string; content: string }) {
  const store = readStore()
  const duplicate = store.memories.find((item) => item.scope === input.scope && item.scopeId === input.scopeId && item.content === input.content)
  if (duplicate) return duplicate
  const item: MemoryItem = { id: randomUUID(), ...input, createdAt: new Date().toISOString() }
  store.memories.push(item)
  store.memories = store.memories.slice(-500)
  writeStore(store)
  return item
}

export function updateTaskState(input: Omit<TaskState, 'updatedAt'>) {
  const store = readStore()
  const state = { ...input, updatedAt: new Date().toISOString() }
  store.taskStates[input.projectId] = state
  writeStore(store)
  return state
}

export function addToolContext(input: Omit<ToolContext, 'id' | 'createdAt'>) {
  const store = readStore()
  const item: ToolContext = { id: randomUUID(), ...input, createdAt: new Date().toISOString() }
  store.toolContexts.push(item)
  store.toolContexts = store.toolContexts.slice(-300)
  writeStore(store)
  return item
}

export function ingestProjectKnowledge(projectId: string, rawContext: string) {
  if (!projectId || !rawContext.trim()) return { added: 0 }
  const store = readStore()
  const parts = rawContext.split(/\n--- FILE: ([^\n]+) ---\n/g)
  const chunks: Array<{ path: string; content: string }> = []
  if (parts[0]?.trim()) chunks.push({ path: '_manifest', content: parts[0].trim() })
  for (let index = 1; index < parts.length; index += 2) {
    const filePath = parts[index]?.trim()
    const content = parts[index + 1]?.trim()
    if (!filePath || !content) continue
    for (let offset = 0; offset < content.length; offset += 6000) {
      chunks.push({ path: filePath, content: content.slice(offset, offset + 6000) })
    }
  }
  store.knowledge = store.knowledge.filter((item) => item.projectId !== projectId)
  const next = chunks.slice(0, 120).map(({ path: filePath, content }) => ({
    id: randomUUID(), projectId, path: filePath, content,
    hash: createHash('sha256').update(`${filePath}:${content}`).digest('hex').slice(0, 16)
  }))
  store.knowledge.push(...next)
  writeStore(store)
  return { added: next.length }
}

export function buildModelContext(input: { conversationId: string; projectId?: string | null; userId?: string; query: string }) {
  const store = readStore()
  const conversation = store.conversations[input.conversationId]
  const projectId = input.projectId ?? conversation?.projectId ?? null
  const queryWords = words(input.query)
  const compactedIds = new Set(conversation?.compactedMessageIds ?? [])
  const history = (conversation?.messages ?? []).filter((message) => !compactedIds.has(message.id)).slice(-12)
  const memories = store.memories
    .filter((item) => (item.scope === 'user' && item.scopeId === (input.userId ?? 'local-user')) || (item.scope === 'conversation' && item.scopeId === input.conversationId) || (projectId && item.scope === 'project' && item.scopeId === projectId))
    .sort((a, b) => relevance(queryWords, b.content) - relevance(queryWords, a.content))
    .slice(0, 10)
  const knowledge = projectId
    ? store.knowledge.filter((item) => item.projectId === projectId).map((item) => ({ ...item, score: relevance(queryWords, `${item.path} ${item.content}`) })).sort((a, b) => b.score - a.score).slice(0, 10)
    : []
  const tools = projectId
    ? store.toolContexts.filter((item) => item.projectId === projectId && (!item.conversationId || item.conversationId === input.conversationId)).slice(-8)
    : []
  const taskState = projectId ? store.taskStates[projectId] : undefined
  const longTermMemory = getLongTermMemory(projectId)

  const sections: string[] = []
  if (conversation?.summary) sections.push(`<conversation_summary>\n${conversation.summary}\n</conversation_summary>`)
  if (longTermMemory.profile.facts.length || longTermMemory.profile.preferences.length) sections.push(`<user_profile>\n${[...longTermMemory.profile.facts, ...longTermMemory.profile.preferences.map((item) => `偏好：${item}`)].map((item) => `- ${item}`).join('\n')}\n</user_profile>`)
  if (longTermMemory.globalMemory) sections.push(`<global_memory_md>\n${longTermMemory.globalMemory}\n</global_memory_md>`)
  if (longTermMemory.projectMemory) sections.push(`<project_memory_md>\n${longTermMemory.projectMemory}\n</project_memory_md>`)
  if (memories.length) sections.push(`<memory>\n${memories.map((item) => `- ${item.content}`).join('\n')}\n</memory>`)
  if (taskState) sections.push(`<task_state>\n目标: ${taskState.goal}\n阶段: ${taskState.phase}\n状态: ${taskState.status}\n下一步: ${taskState.nextStep ?? '未设置'}\n</task_state>`)
  if (knowledge.length) sections.push(`<project_knowledge>\n${knowledge.map((item) => `### ${item.path}\n${item.content}`).join('\n\n')}\n</project_knowledge>`)
  if (tools.length) sections.push(`<tool_context>\n${tools.map((item) => `- ${item.tool}: ${item.summary}`).join('\n')}\n</tool_context>`)

  return { projectId, history, memories, longTermMemory, taskState, knowledge, tools, contextText: sections.join('\n\n') }
}

export function getContextSnapshot(conversationId: string) {
  const store = readStore()
  const conversation = store.conversations[conversationId]
  const projectId = conversation?.projectId ?? null
  return {
    conversation,
    memoryCount: store.memories.filter((item) => item.scopeId === conversationId || (projectId && item.scopeId === projectId)).length,
    knowledgeCount: projectId ? store.knowledge.filter((item) => item.projectId === projectId).length : 0,
    taskState: projectId ? store.taskStates[projectId] : null,
    toolContextCount: projectId ? store.toolContexts.filter((item) => item.projectId === projectId).length : 0
  }
}
