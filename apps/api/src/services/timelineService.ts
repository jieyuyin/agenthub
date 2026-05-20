import * as taskService from './taskService'
import * as observabilityService from './observabilityService'

export type TimelineEventType = 'agent_reasoning' | 'tool_call' | 'runtime_execution'

export interface TimelineEventBase {
  id: string
  type: TimelineEventType
  stepIndex: number
  timestamp: string
}

export interface AgentReasoningEvent extends TimelineEventBase {
  type: 'agent_reasoning'
  reasoning: string | null
  toolSelected: string[] | null
  prompt: unknown
  result: unknown
}

export interface ToolCallEvent extends TimelineEventBase {
  type: 'tool_call'
  toolName: string
  input: unknown
  output: unknown | null
  status: string
  error: string | null
  duration: number
}

export interface RuntimeExecutionEvent extends TimelineEventBase {
  type: 'runtime_execution'
  command: string
  stdout: string | null
  stderr: string | null
  exitCode: number | null
  duration: number | null
  status: string
  executionId: string | null
}

export type TimelineEvent = AgentReasoningEvent | ToolCallEvent | RuntimeExecutionEvent

export interface TimelineStep {
  stepIndex: number
  timestamp: string
  agentTraceId: string | null
  reasoning: AgentReasoningEvent | null
  children: Array<ToolCallEvent | RuntimeExecutionEvent>
}

export interface TaskTimeline {
  taskId: string
  task: {
    id: string
    title: string
    description: string
    status: string
    createdAt: string
    startedAt: string | null
    completedAt: string | null
  }
  steps: TimelineStep[]
  events: TimelineEvent[]
}

function parseJsonField(raw: string | null | undefined): unknown {
  if (raw == null || raw === '') return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function parseToolSelected(raw: string | null | undefined): string[] | null {
  const parsed = parseJsonField(raw)
  if (Array.isArray(parsed)) return parsed.map(String)
  if (typeof parsed === 'string') {
    try {
      const again = JSON.parse(parsed)
      return Array.isArray(again) ? again.map(String) : [parsed]
    } catch {
      return [parsed]
    }
  }
  return null
}

export async function buildTaskTimeline(taskId: string): Promise<TaskTimeline | null> {
  const task = await taskService.getTaskById(taskId)
  if (!task) return null

  const [agentTraces, toolExecutions, runtimeLogs] = await Promise.all([
    observabilityService.listAgentTracesByTask(taskId),
    observabilityService.listToolExecutionsByTask(taskId),
    observabilityService.listRuntimeLogsByTask(taskId)
  ])

  const stepIndices = new Set<number>()
  agentTraces.forEach((t) => stepIndices.add(t.stepIndex))
  toolExecutions.forEach((t) => stepIndices.add(t.stepIndex))
  runtimeLogs.forEach((t) => stepIndices.add(t.stepIndex))
  if (stepIndices.size === 0) stepIndices.add(0)

  const sortedSteps = [...stepIndices].sort((a, b) => a - b)
  const events: TimelineEvent[] = []
  const steps: TimelineStep[] = []

  for (const stepIndex of sortedSteps) {
    const trace = agentTraces.find((t) => t.stepIndex === stepIndex)
    const tools = toolExecutions.filter((t) => t.stepIndex === stepIndex)
    const runtimes = runtimeLogs.filter((t) => t.stepIndex === stepIndex)

    let reasoning: AgentReasoningEvent | null = null
    if (trace) {
      reasoning = {
        id: trace.id,
        type: 'agent_reasoning',
        stepIndex,
        timestamp: trace.createdAt.toISOString(),
        reasoning: trace.reasoning,
        toolSelected: parseToolSelected(trace.toolSelected),
        prompt: parseJsonField(trace.prompt),
        result: parseJsonField(trace.result)
      }
      events.push(reasoning)
    }

    const children: Array<ToolCallEvent | RuntimeExecutionEvent> = []

    for (const tool of tools) {
      const ev: ToolCallEvent = {
        id: tool.id,
        type: 'tool_call',
        stepIndex,
        timestamp: tool.createdAt.toISOString(),
        toolName: tool.toolName,
        input: parseJsonField(tool.input),
        output: parseJsonField(tool.output),
        status: tool.status,
        error: tool.error,
        duration: tool.duration
      }
      children.push(ev)
      events.push(ev)
    }

    for (const log of runtimes) {
      const ev: RuntimeExecutionEvent = {
        id: log.id,
        type: 'runtime_execution',
        stepIndex,
        timestamp: log.createdAt.toISOString(),
        command: log.command,
        stdout: log.stdout,
        stderr: log.stderr,
        exitCode: log.exitCode,
        duration: log.duration,
        status: log.status,
        executionId: log.executionId
      }
      children.push(ev)
      events.push(ev)
    }

    children.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

    steps.push({
      stepIndex,
      timestamp: trace?.createdAt.toISOString() ?? children[0]?.timestamp ?? new Date().toISOString(),
      agentTraceId: trace?.id ?? null,
      reasoning,
      children
    })
  }

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  return {
    taskId,
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      createdAt: task.createdAt.toISOString(),
      startedAt: task.startedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null
    },
    steps,
    events
  }
}
