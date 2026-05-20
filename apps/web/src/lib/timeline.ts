export type TimelineEventType = 'agent_reasoning' | 'tool_call' | 'runtime_execution'

export type TimelineFilter = 'all' | TimelineEventType

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

export function matchesFilter(event: TimelineEvent, filter: TimelineFilter): boolean {
  if (filter === 'all') return true
  return event.type === filter
}

export const FILTER_OPTIONS: { id: TimelineFilter; label: string }[] = [
  { id: 'all', label: 'All events' },
  { id: 'agent_reasoning', label: 'Agent reasoning' },
  { id: 'tool_call', label: 'Tool calls' },
  { id: 'runtime_execution', label: 'Runtime logs' }
]
