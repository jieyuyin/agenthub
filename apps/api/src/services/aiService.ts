
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
  messages: any[]
) {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false
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

  const content =
    data.message?.content ??
    data.response ??
    ''

  if (!content) {
    throw new Error(
      `[Ollama] 返回为空，模型可能未加载完成: ${model}`
    )
  }

  return {
    choices: [{ message: { content } }]
  }
}

// =======================
// OPENAI COMPATIBLE
// =======================
async function callOpenAICompatible(
  url: string,
  model: string,
  messages: any[],
  apiKey?: string
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
      stream: false
    })
  })

  const text = await response.text()

  if (!response.ok) {
    throw new Error(
      `[OpenAI Error] ${response.status}\n${text}`
    )
  }

  const data = JSON.parse(text)

  const content = data.choices?.[0]?.message?.content ?? ''

  if (!content) {
    throw new Error('[OpenAI] 返回为空')
  }

  return {
    choices: [{ message: { content } }]
  }
}

// =======================
// MAIN ENTRY
// =======================
export async function createChatCompletion(options: {
  messages: any[]
  model?: string
  temperature?: number
}) {
  if (!Array.isArray(options.messages)) {
    throw new Error('[aiService] messages 必须是数组')
  }

  const model = options.model ?? getAIModel()
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
      return callOllama(url, model, options.messages)
    }

    return callOpenAICompatible(
      url,
      model,
      options.messages,
      localApiKey
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
      openaiKey
    )
  }

  // =======================
  // ERROR STATE
  // =======================
  throw new Error(
    '[aiService] 未配置 AI：请设置 LOCAL_AI_BASE=http://localhost:11434 或 OPENAI_API_KEY'
  )
}