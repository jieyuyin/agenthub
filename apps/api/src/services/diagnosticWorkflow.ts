export type DiagnosticPhase = 'inspect' | 'reproduce' | 'diagnose' | 'patch' | 'verify' | 'completed' | 'blocked'

export type DiagnosticStatus = 'running' | 'completed' | 'failed'

export type DiagnosticEvent = {
  phase: DiagnosticPhase
  status: DiagnosticStatus
  label: string
  detail?: string
}

const CHANGE_TOOLS = new Set(['write_file', 'apply_patch', 'create_patch', 'create_directory'])
const INSPECTION_TOOLS = new Set(['list_files', 'read_file', 'git_diff'])

function resultFailed(result: unknown) {
  if (!result || typeof result !== 'object') return false
  const value = result as { ok?: boolean; success?: boolean; exitCode?: number; error?: unknown }
  return value.ok === false || value.success === false || (typeof value.exitCode === 'number' && value.exitCode !== 0) || Boolean(value.error)
}

export function isDiagnosticRequest(content: string) {
  const normalized = content.trim()
  const explicitlyRequestsDebugging = /(?:请|帮我|麻烦|使用|调用|启动|让).{0,12}(?:debug\s*agent|调试\s*agent|诊断\s*agent).{0,20}(?:排查|诊断|定位|修复|解决|检查)|(?:请|帮我|麻烦).{0,12}(?:排查|诊断|定位|修复|解决).{0,20}(?:错误|异常|失败|问题|bug)/i.test(normalized)
  const asksAboutDiagnostics = /(?:debug\s*agent|调试\s*agent|诊断\s*agent|debugger).{0,30}(?:是什么|有什么|区别|为什么|为何|怎么|如何|何时|什么时候|触发|出现|显示|消失|作用|职责)|(?:为什么|为何|怎么|如何|何时|什么时候).{0,30}(?:debug\s*agent|调试\s*agent|诊断\s*agent|诊断卡片).{0,20}(?:触发|出现|显示|启动|运行)?/i.test(normalized)
  if (asksAboutDiagnostics && !explicitlyRequestsDebugging) return false
  // “能不能/可不可以”是在询问能力或提出改动，并不表示程序发生了“不能运行”。
  const diagnosticText = normalized
    .replace(/能不能|能否|可不可以|是否可以|可否/g, '')
  const isChangeRequestWithoutFailure = /(改成|改为|换成|调整|设计|实现|添加|新增|制作).{0,30}(风格|样式|页面|界面|布局|颜色|功能|效果)/i.test(normalized)
    && !/(报错|错误|异常|失败|崩溃|不工作|bug|issue|无法运行|不能运行|加载失败)/i.test(diagnosticText)
  if (isChangeRequestWithoutFailure) return false
  if (/(当前|哪个|查看|显示).{0,12}(分支|git\s*status|diff|差异)/i.test(content)) return false
  if (/你.{0,6}(不能|无法).{0,8}(识别|查看|读取)/i.test(content)) return false
  return /(定位|排查|诊断|修复|解决|报错|错误|异常|失败|不能|无法|不工作|bug|debug|issue)/i.test(diagnosticText)
}

export class DiagnosticWorkflow {
  readonly enabled: boolean
  readonly requiresChange: boolean
  private inspected = false
  private reproduced = false
  private changed = false
  private verified = false

  constructor(request: string, enabled?: boolean) {
    this.enabled = enabled ?? isDiagnosticRequest(request)
    this.requiresChange = /(修复|解决|改好|修改|实现|添加|新增|fix)/i.test(request)
  }

  start(): DiagnosticEvent | null {
    return this.enabled ? { phase: 'inspect', status: 'running', label: '正在检查项目' } : null
  }

  beforeTool(name: string): DiagnosticEvent | null {
    if (!this.enabled) return null
    if (name === 'run_command' || name === 'run_terminal') {
      return this.changed
        ? { phase: 'verify', status: 'running', label: '正在验证修复' }
        : { phase: 'reproduce', status: 'running', label: '正在复现问题' }
    }
    if (CHANGE_TOOLS.has(name)) return { phase: 'patch', status: 'running', label: '正在修改代码' }
    if (INSPECTION_TOOLS.has(name)) {
      return this.inspected
        ? { phase: 'diagnose', status: 'running', label: '正在定位根因' }
        : { phase: 'inspect', status: 'running', label: '正在检查项目' }
    }
    return { phase: 'diagnose', status: 'running', label: '正在分析问题' }
  }

  afterTool(name: string, result: unknown): DiagnosticEvent | null {
    if (!this.enabled) return null
    const failed = resultFailed(result)
    if (INSPECTION_TOOLS.has(name)) this.inspected = true
    if ((name === 'run_command' || name === 'run_terminal') && !this.changed) this.reproduced = true
    if (CHANGE_TOOLS.has(name) && !failed) this.changed = true
    if ((name === 'run_command' || name === 'run_terminal') && this.changed && !failed) this.verified = true

    const current = this.beforeTool(name)
    if (!current) return null
    return {
      ...current,
      status: failed ? 'failed' : 'completed',
      detail: failed ? '操作失败，正在根据错误继续定位' : undefined
    }
  }

  nextRequiredInstruction(): string | null {
    if (!this.enabled) return null
    if (!this.inspected) return '诊断尚未完成：先使用 list_files 或 read_file 检查项目证据，然后继续。'
    if (!this.reproduced) return '诊断尚未完成：使用 run_command 或 run_terminal 执行最小检查、类型检查或测试来复现并收集证据，不要提前给最终答复。'
    if (this.requiresChange && !this.changed) return '修复尚未完成：根据已收集的错误和源码证据调用 write_file、apply_patch 或 create_patch 修改代码，然后继续。'
    if (this.changed && !this.verified) return '验证尚未完成：修改代码后必须使用 run_command 或 run_terminal 运行针对性的类型检查、测试或健康检查；失败时继续修复。'
    return null
  }

  nextRequiredEvent(): DiagnosticEvent | null {
    if (!this.enabled) return null
    if (!this.inspected) return { phase: 'inspect', status: 'running', label: '正在检查项目' }
    if (!this.reproduced) return { phase: 'reproduce', status: 'running', label: '正在复现问题' }
    if (this.requiresChange && !this.changed) return { phase: 'patch', status: 'running', label: '正在准备修复' }
    if (this.changed && !this.verified) return { phase: 'verify', status: 'running', label: '正在验证修复' }
    return null
  }

  finish(): DiagnosticEvent | null {
    if (!this.enabled) return null
    const missing = this.nextRequiredInstruction()
    return missing
      ? { phase: 'blocked', status: 'failed', label: '诊断未形成闭环', detail: missing }
      : { phase: 'completed', status: 'completed', label: '定位、修复和验证已完成' }
  }
}
