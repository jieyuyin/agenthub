
import { getActiveModelConfig, type ModelConfigInput } from './modelConfigService'

const REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 120_000)

// =======================
// ENV (read at call time — after loadEnv runs)
// =======================
function getLocalBase() {
  return (
    process.env.LOCAL_AI_BASE?.trim() ||
    process.env.OLLAMA_HOST?.trim() ||
    undefined
  )
}

function getLocalApiKey() {
  return process.env.LOCAL_AI_API_KEY?.trim()
}

function getOpenaiKey() {
  return (
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.AI_API_KEY?.trim() ||
    undefined
  )
}

function getOpenaiBase() {
  return (
    process.env.OPENAI_BASE_URL?.trim() ||
    process.env.AI_API_BASE?.trim() ||
    'https://api.openai.com/v1'
  )
}

// 
function stripEnv(value?: string) {
  return value?.trim().replace(/^["']|["']$/g, '') || undefined
}

export function getAIModel() {
  return (
    getActiveModelConfig()?.modelId ||
    stripEnv(process.env.LOCAL_AI_MODEL) ||
    stripEnv(process.env.OPENAI_MODEL) ||
    'qwen2.5:latest'
  )
}

async function listOllamaModels(base: string): Promise<string[]> {
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/tags`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.models ?? []).map((m: { name: string }) => m.name)
  } catch {
    return []
  }
}

// =======================
// CONFIG DEBUG
// =======================
export function getAIConfigSummary() {
  const saved = getActiveModelConfig()
  if (saved) {
    return { provider: saved.provider, url: saved.baseUrl, model: saved.modelId, source: 'model-library' }
  }
  const localBase = getLocalBase()
  const openaiKey = getOpenaiKey()
  const openaiBase = getOpenaiBase()

  if (localBase) {
    const { mode, url } = resolveLocalEndpoint(localBase)
    return { provider: mode, url, model: getAIModel(), localBase }
  }

  if (openaiKey) {
    return {
      provider: 'openai',
      url: `${openaiBase}/chat/completions`,
      model: getAIModel()
    }
  }

  return { provider: 'none', url: null, model: getAIModel() }
}

// =======================
// ENDPOINT RESOLUTION
// =======================
function resolveLocalEndpoint(base: string): {
  url: string
  mode: 'ollama' | 'openai'
} {
  const trimmed = base.replace(/\/$/, '')

  // OpenAI-compatible endpoint
  if (trimmed.endsWith('/v1')) {
    return {
      url: `${trimmed}/chat/completions`,
      mode: 'openai'
    }
  }

  // Ollama native
  return {
    url: `${trimmed}/api/chat`,
    mode: 'ollama'
  }
}

// =======================
// FETCH WITH TIMEOUT
// =======================
async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  )

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(
        `[aiService] 请求超时 ${REQUEST_TIMEOUT_MS}ms，检查 Ollama 是否启动`
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

// =======================
// OLLAMA CALL
// =======================
async function callOllama(
  url: string,
  model: string,
  messages: any[],
  tools?: any[]
) {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...(tools?.length ? { tools } : {})
    })
  })

  const text = await response.text()

  if (!response.ok) {
    const base = url.replace(/\/api\/chat$/, '')
    const available = await listOllamaModels(base)
    const hint =
      available.length > 0
        ? `\n可用模型: ${available.join(', ')}\n请在 apps/api/.env 设置 LOCAL_AI_MODEL=其中某一个`
        : '\n请运行 ollama list 确认模型名'
    throw new Error(
      `[Ollama Error] ${response.status}\n${text}\n` +
        `当前配置模型: ${model}${hint}`
    )
  }

  const data = JSON.parse(text)

  const message = data.message ?? { content: data.response ?? '' }
  if (!message.content && !message.tool_calls?.length) {
    throw new Error(
      `[Ollama] 返回为空，模型可能未加载完成: ${model}`
    )
  }

  return {
    choices: [{ message }]
  }
}

// =======================
// OPENAI COMPATIBLE
// =======================
async function callOpenAICompatible(
  url: string,
  model: string,
  messages: any[],
  apiKey?: string,
  tools?: any[]
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {})
    })
  })

  const text = await response.text()

  if (!response.ok) {
    throw new Error(
      `[OpenAI Error] ${response.status}\n${text}`
    )
  }

  const data = JSON.parse(text)

  const message = data.choices?.[0]?.message
  if (!message?.content && !message?.tool_calls?.length) {
    throw new Error('[OpenAI] 返回为空')
  }

  return {
    choices: [{ message }]
  }
}

function callMockLLM(model: string, messages: any[], tools?: any[]) {
  const lastMessage = [...messages].reverse().find((message) => message.role === 'user')?.content ?? ''
  const toolMessages = messages.filter((message) => message.role === 'tool')
  if (tools?.length && toolMessages.length === 0) {
    return { choices: [{ message: { content: '', tool_calls: [{ id: `mock-${Date.now()}`, type: 'function', function: { name: 'list_files', arguments: JSON.stringify({ path: '.', depth: 2 }) } }] } }] }
  }
  if (tools?.length && toolMessages.length > 0) {
    return { choices: [{ message: { content: `MockLLM 本地工具链路正常。已成功调用 \`list_files\` 并收到 Workspace 结果。\n\n真实模型接入后，Project Assistant 会根据你的问题继续读取相关文件、提出修改，并在你确认后写入。` } }] }
  }
  return {
    choices: [{
      message: {
        content: `MockLLM 链路正常：模型 ${model} 已收到请求「${String(lastMessage).slice(0, 80)}」`
      }
    }]
  }
}

export async function testModelConnection(config: ModelConfigInput) {
  const startedAt = Date.now()
  const completion = await createChatCompletion({
    messages: [{ role: 'user', content: 'AgentHub connection test' }],
    model: config.modelId,
    config
  })
  return {
    ok: true,
    latencyMs: Date.now() - startedAt,
    reply: completion.choices?.[0]?.message?.content ?? ''
  }
}

// =======================
// MAIN ENTRY
// =======================
export async function createChatCompletion(options: {
  messages: any[]
  model?: string
  temperature?: number
  config?: ModelConfigInput
  tools?: any[]
}) {
  if (!Array.isArray(options.messages)) {
    throw new Error('[aiService] messages 必须是数组')
  }

  const savedConfig = options.config ?? getActiveModelConfig()
  const model = savedConfig?.modelId ?? options.model ?? getAIModel()

  if (savedConfig) {
    if (savedConfig.provider === 'mockllm') return callMockLLM(model, options.messages, options.tools)
    const endpoint = savedConfig.provider === 'ollama'
      ? `${savedConfig.baseUrl.replace(/\/$/, '')}/api/chat`
      : `${savedConfig.baseUrl.replace(/\/$/, '')}/chat/completions`
    if (savedConfig.provider === 'ollama') return callOllama(endpoint, model, options.messages, options.tools)
    return callOpenAICompatible(endpoint, model, options.messages, savedConfig.apiKey, options.tools)
  }
  const localBase = getLocalBase()
  const localApiKey = getLocalApiKey()
  const openaiKey = getOpenaiKey()
  const openaiBase = getOpenaiBase()

  console.log('[aiService] LOCAL_AI_BASE:', localBase ?? '(unset)')
  console.log('[aiService] model:', model)

  // =======================
  // LOCAL AI (OLLAMA)
  // =======================
  if (localBase) {
    const { url, mode } = resolveLocalEndpoint(localBase)

    if (mode === 'ollama') {
      return callOllama(url, model, options.messages, options.tools)
    }

    return callOpenAICompatible(
      url,
      model,
      options.messages,
      localApiKey,
      options.tools
    )
  }

  // =======================
  // OPENAI CLOUD
  // =======================
  if (openaiKey) {
    const url = `${openaiBase.replace(/\/$/, '')}/chat/completions`

    return callOpenAICompatible(
      url,
      model,
      options.messages,
      openaiKey,
      options.tools
    )
  }

  // =======================
  // ERROR STATE
  // =======================
  throw new Error(
    '[aiService] 未配置 AI：请设置 LOCAL_AI_BASE=http://localhost:11434 或 OPENAI_API_KEY'
  )
}

export async function streamChatCompletion(options: { messages: any[]; onDelta: (content: string) => void; model?: string; config?: ModelConfigInput }) {
  const savedConfig = options.config ?? getActiveModelConfig()
  const model = savedConfig?.modelId ?? options.model ?? getAIModel()
  if (savedConfig?.provider === 'mockllm') {
    const content = String(callMockLLM(model, options.messages).choices[0].message.content)
    for (const chunk of content.match(/[\s\S]{1,12}/g) ?? []) options.onDelta(chunk)
    return content
  }

  let url: string
  let apiKey: string | undefined
  let ollama = false
  if (savedConfig) {
    ollama = savedConfig.provider === 'ollama'
    url = ollama ? `${savedConfig.baseUrl.replace(/\/$/, '')}/api/chat` : `${savedConfig.baseUrl.replace(/\/$/, '')}/chat/completions`
    apiKey = savedConfig.apiKey
  } else if (getLocalBase()) {
    const resolved = resolveLocalEndpoint(getLocalBase() as string)
    url = resolved.url; ollama = resolved.mode === 'ollama'; apiKey = getLocalApiKey()
  } else if (getOpenaiKey()) {
    url = `${getOpenaiBase().replace(/\/$/, '')}/chat/completions`; apiKey = getOpenaiKey()
  } else throw new Error('[aiService] 未配置 AI')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const response = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify({ model, messages: options.messages, stream: true }) })
  if (!response.ok || !response.body) throw new Error(`[AI Stream Error] ${response.status}\n${await response.text()}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue
      try {
        const data = JSON.parse(ollama ? line : line.replace(/^data:\s*/, ''))
        const delta = String(ollama ? (data.message?.content ?? data.response ?? '') : (data.choices?.[0]?.delta?.content ?? ''))
        if (delta) { full += delta; options.onDelta(delta) }
      } catch { /* ignore SSE keepalive and [DONE] */ }
    }
  }
  return full
}
