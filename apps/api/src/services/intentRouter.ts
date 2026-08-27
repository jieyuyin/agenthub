import { createChatCompletion } from './aiService'

export type IntentMode = 'chat' | 'inspect' | 'modify' | 'execute' | 'diagnose'

export type IntentRoute = {
  mode: IntentMode
  needsTools: boolean
  continuePreviousTask: boolean
  intents: string[]
  targets: string[]
  requiresWrite: boolean
  requiresVerification: boolean
  confidence: number
  source: 'rule' | 'model' | 'fallback'
}

type RuleHints = {
  simpleChat: boolean
  diagnostic: boolean
  mutation: boolean
  readOnlyCodeQuestion: boolean
  verificationChallenge: boolean
  continuation: boolean
  projectStart: boolean
  gitAction?: string | null
}

const MODES = new Set<IntentMode>(['chat', 'inspect', 'modify', 'execute', 'diagnose'])

function normalize(raw: unknown, source: IntentRoute['source']): IntentRoute | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const mode = String(value.mode || '') as IntentMode
  if (!MODES.has(mode)) return null
  const needsTools = Boolean(value.needsTools)
  const requiresWrite = mode === 'modify' ? true : Boolean(value.requiresWrite)
  return {
    mode,
    needsTools: mode === 'chat' ? false : needsTools,
    continuePreviousTask: Boolean(value.continuePreviousTask),
    intents: Array.isArray(value.intents) ? value.intents.map(String).filter(Boolean).slice(0, 8) : [],
    targets: Array.isArray(value.targets) ? value.targets.map(String).filter(Boolean).slice(0, 12) : [],
    requiresWrite,
    requiresVerification: requiresWrite || mode === 'execute' || Boolean(value.requiresVerification),
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0.5)),
    source
  }
}

function extractJson(content: string) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) } catch { return null }
}

function ruleRoute(hints: RuleHints, hasWorkspace: boolean): IntentRoute | null {
  if (hints.simpleChat || !hasWorkspace) return normalize({ mode: 'chat', needsTools: false, confidence: 1 }, 'rule')
  if (hints.diagnostic) return normalize({ mode: 'diagnose', needsTools: true, intents: ['diagnose'], requiresVerification: true, confidence: 0.95 }, 'rule')
  if (hints.verificationChallenge) return normalize({ mode: 'inspect', needsTools: true, intents: ['verify_change'], requiresVerification: false, continuePreviousTask: true, confidence: 0.98 }, 'rule')
  const mixedIntent = (hints.mutation && (hints.readOnlyCodeQuestion || hints.projectStart || Boolean(hints.gitAction)))
    || (hints.projectStart && Boolean(hints.gitAction))
  if (mixedIntent) return null
  if (hints.mutation) return normalize({ mode: 'modify', needsTools: true, intents: ['modify_code'], requiresWrite: true, requiresVerification: true, continuePreviousTask: hints.continuation, confidence: 0.96 }, 'rule')
  if (hints.projectStart) return normalize({ mode: 'execute', needsTools: true, intents: ['start_service'], requiresVerification: true, confidence: 0.98 }, 'rule')
  if (hints.gitAction) return normalize({ mode: 'execute', needsTools: true, intents: [hints.gitAction], requiresVerification: true, confidence: 0.98 }, 'rule')
  if (hints.readOnlyCodeQuestion) return normalize({ mode: 'inspect', needsTools: true, intents: ['inspect_code'], confidence: 0.95 }, 'rule')
  return null
}

export async function routeIntent(input: { message: string; recentMessages: string[]; hasWorkspace: boolean; hints: RuleHints }): Promise<IntentRoute> {
  const deterministic = ruleRoute(input.hints, input.hasWorkspace)
  if (deterministic) return deterministic
  try {
    const completion = await createChatCompletion({
      temperature: 0,
      messages: [
        { role: 'system', content: `你是 Coding Agent 的意图路由器。只输出一个 JSON 对象，不要 Markdown。字段：mode(chat|inspect|modify|execute|diagnose)、needsTools(boolean)、continuePreviousTask(boolean)、intents(string[])、targets(string[])、requiresWrite(boolean)、requiresVerification(boolean)、confidence(0到1)。\n规则：普通问答且不需要项目证据为 chat；查看代码或确认当前值为 inspect；要求改变文件为 modify；运行命令/Git/服务为 execute；明确排错为 diagnose。混合意图选择副作用最高的 mode，并把所有子意图写进 intents。询问“是否改过”是 inspect，不是 modify。` },
        { role: 'user', content: `Workspace: ${input.hasWorkspace ? 'available' : 'unavailable'}\nRecent:\n${input.recentMessages.slice(-4).join('\n')}\n\nCurrent:\n${input.message}` }
      ]
    })
    const parsed = extractJson(String(completion.choices?.[0]?.message?.content ?? ''))
    const routed = normalize(parsed, 'model')
    if (routed) return routed
  } catch (error) {
    console.warn('[intent-router] model routing failed:', error instanceof Error ? error.message : String(error))
  }
  return normalize({ mode: input.hasWorkspace ? 'inspect' : 'chat', needsTools: input.hasWorkspace, intents: input.hasWorkspace ? ['inspect_project'] : [], confidence: 0.35 }, 'fallback')!
}
