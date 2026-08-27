export type WorkerStatus = 'idle' | 'reasoning' | 'acting' | 'observing' | 'delegating' | 'completed' | 'failed'

export interface TaskContext {
  goal: string
  constraints: string[]
  acceptanceCriteria: string[]
  background?: string
}

export interface ToolObservation {
  tool: string
  input: Record<string, unknown>
  output?: unknown
  error?: string
  success: boolean
  durationMs: number
  createdAt: string
}

export interface CodeContextItem { path: string; summary?: string; content?: string }

export class ContextManager {
  readonly code = new Map<string, CodeContextItem>()
  readonly execution: ToolObservation[] = []
  readonly modifiedFiles = new Set<string>()
  readonly testResults: ToolObservation[] = []

  constructor(public readonly task: TaskContext, private readonly observationLimit = 40) {}

  record(observation: ToolObservation) {
    this.execution.push(observation)
    if (this.execution.length > this.observationLimit) this.execution.splice(0, this.execution.length - this.observationLimit)
    const filepath = String(observation.input.filepath ?? observation.input.path ?? '')
    if (filepath && ['write_file', 'apply_patch'].includes(observation.tool) && observation.success) this.modifiedFiles.add(filepath)
    if (/test|build|lint|type.?check|tsc/i.test(String(observation.input.command ?? ''))) this.testResults.push(observation)
  }

  addCode(item: CodeContextItem) { this.code.set(item.path, item) }

  snapshot() {
    return {
      task: this.task,
      code: [...this.code.values()],
      recentExecution: this.execution.slice(-12),
      modifiedFiles: [...this.modifiedFiles],
      testResults: this.testResults.slice(-8)
    }
  }
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (input: Record<string, unknown>) => Promise<unknown>
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>()
  register(tool: ToolDefinition) { this.tools.set(tool.name, tool); return this }
  get(name: string) { return this.tools.get(name) }
  list() { return [...this.tools.values()].map(({ execute: _execute, ...definition }) => definition) }
  async execute(name: string, input: Record<string, unknown>) {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)
    return tool.execute(input)
  }
}

export interface ComplexityFactors {
  failure: number
  uncertainty: number
  scope: number
  context: number
  risk: number
}

export interface ComplexityAssessment extends ComplexityFactors { score: number; reasons: string[] }

const clamp = (value: number) => Math.max(0, Math.min(1, value))

export class ComplexityEvaluator {
  assess(context: ContextManager, uncertainty = 0): ComplexityAssessment {
    const failures = context.execution.filter((item) => !item.success).length
    const failure = clamp(failures / 3)
    const scope = clamp(context.modifiedFiles.size / 8)
    const contextScore = clamp((context.code.size + context.execution.length / 4) / 20)
    const risky = /auth|permission|payment|billing|database|migration|security|权限|支付|认证|数据库/i.test(
      `${context.task.goal} ${[...context.modifiedFiles].join(' ')}`
    )
    const risk = risky ? 0.9 : 0.2
    const factors = { failure, uncertainty: clamp(uncertainty), scope, context: contextScore, risk }
    const score = 0.25 * failure + 0.25 * factors.uncertainty + 0.2 * scope + 0.15 * contextScore + 0.15 * risk
    const reasons = [failures ? `${failures} 次工具失败` : '', risky ? '涉及高风险模块' : '', scope >= 0.5 ? '修改范围较大' : ''].filter(Boolean)
    return { ...factors, score, reasons }
  }
}

export type SubagentKind = 'debug' | 'review' | 'explore'
export interface SubagentRequest { kind: SubagentKind; reason: string; context: ReturnType<ContextManager['snapshot']> }
export type SubagentDispatcher = (request: SubagentRequest) => Promise<unknown>

export class SubagentScheduler {
  constructor(private readonly dispatch: SubagentDispatcher, private readonly threshold = 0.6) {}
  select(assessment: ComplexityAssessment, context: ContextManager, completed: boolean): SubagentKind | null {
    if (assessment.score < this.threshold) return null
    if (completed && assessment.risk >= 0.6) return 'review'
    if (assessment.failure >= 0.6 && assessment.uncertainty >= 0.5) return 'debug'
    return 'explore'
  }
  async run(kind: SubagentKind, assessment: ComplexityAssessment, context: ContextManager) {
    return this.dispatch({ kind, reason: assessment.reasons.join('；') || `复杂度 ${assessment.score.toFixed(2)}`, context: context.snapshot() })
  }
}

export interface WorkerDecision {
  reasoning?: string
  uncertainty?: number
  complete?: boolean
  final?: string
  action?: { tool: string; input: Record<string, unknown> }
}

export interface WorkerModel {
  decide(input: { context: ReturnType<ContextManager['snapshot']>; tools: ReturnType<ToolRegistry['list']>; subagentResult?: unknown }): Promise<WorkerDecision>
}

export interface WorkerEvent { type: 'status' | 'tool' | 'complexity' | 'subagent'; data: unknown }

export class CodingWorker {
  status: WorkerStatus = 'idle'
  private readonly delegatedKinds = new Set<SubagentKind>()
  constructor(
    readonly context: ContextManager,
    readonly tools: ToolRegistry,
    private readonly model: WorkerModel,
    private readonly evaluator = new ComplexityEvaluator(),
    private readonly subagents?: SubagentScheduler,
    private readonly maxRounds = 32,
    private readonly onEvent?: (event: WorkerEvent) => void | Promise<void>
  ) {}

  private async emit(type: WorkerEvent['type'], data: unknown) { await this.onEvent?.({ type, data }) }

  async run() {
    let subagentResult: unknown
    for (let round = 0; round < this.maxRounds; round++) {
      this.status = 'reasoning'; await this.emit('status', { status: this.status, round })
      const decision = await this.model.decide({ context: this.context.snapshot(), tools: this.tools.list(), subagentResult })
      const assessment = this.evaluator.assess(this.context, decision.uncertainty ?? 0)
      await this.emit('complexity', assessment)
      const selectedKind = this.subagents?.select(assessment, this.context, Boolean(decision.complete))
      const kind = selectedKind && !this.delegatedKinds.has(selectedKind) ? selectedKind : null
      if (kind) {
        this.delegatedKinds.add(kind)
        this.status = 'delegating'; await this.emit('subagent', { kind, assessment })
        subagentResult = await this.subagents!.run(kind, assessment, this.context)
        continue
      }
      if (decision.complete) {
        this.status = 'completed'; await this.emit('status', { status: this.status, round })
        return { success: true, result: decision.final ?? '', context: this.context.snapshot(), assessment }
      }
      if (!decision.action) continue
      this.status = 'acting'
      const started = Date.now()
      let observation: ToolObservation
      try {
        const output = await this.tools.execute(decision.action.tool, decision.action.input)
        observation = { tool: decision.action.tool, input: decision.action.input, output, success: true, durationMs: Date.now() - started, createdAt: new Date().toISOString() }
      } catch (error: any) {
        observation = { tool: decision.action.tool, input: decision.action.input, error: error?.message ?? String(error), success: false, durationMs: Date.now() - started, createdAt: new Date().toISOString() }
      }
      this.status = 'observing'; this.context.record(observation); await this.emit('tool', observation)
    }
    this.status = 'failed'; await this.emit('status', { status: this.status, reason: 'max_rounds' })
    return { success: false, result: 'Agent loop reached its safety limit.', context: this.context.snapshot() }
  }
}
