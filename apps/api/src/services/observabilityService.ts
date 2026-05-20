import prisma from './prisma'

const MAX_JSON_FIELD = 100_000

function serialize(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  return raw.length > MAX_JSON_FIELD ? `${raw.slice(0, MAX_JSON_FIELD)}…[truncated]` : raw
}

export async function recordToolExecution(data: {
  taskId: string
  stepIndex: number
  toolName: string
  input: unknown
  output?: unknown
  status: 'success' | 'failed'
  error?: string
  duration: number
}) {
  return prisma.toolExecution.create({
    data: {
      taskId: data.taskId,
      stepIndex: data.stepIndex,
      toolName: data.toolName,
      input: serialize(data.input),
      output: data.output != null ? serialize(data.output) : null,
      status: data.status,
      error: data.error ?? null,
      duration: data.duration
    }
  })
}

export async function recordAgentTrace(data: {
  taskId: string
  stepIndex: number
  prompt: unknown
  reasoning?: string | null
  toolSelected?: string | null
  result?: unknown
}) {
  return prisma.agentTrace.create({
    data: {
      taskId: data.taskId,
      stepIndex: data.stepIndex,
      prompt: serialize(data.prompt),
      reasoning: data.reasoning ?? null,
      toolSelected: data.toolSelected ?? null,
      result: data.result != null ? serialize(data.result) : null
    }
  })
}

export async function recordRuntimeLog(data: {
  runtimeId: string
  taskId?: string
  stepIndex?: number
  executionId?: string
  command: string
  stdout?: string | null
  stderr?: string | null
  exitCode?: number | null
  duration?: number
  status: 'success' | 'failed'
}) {
  return prisma.runtimeLog.create({
    data: {
      runtimeId: data.runtimeId,
      taskId: data.taskId ?? null,
      stepIndex: data.stepIndex ?? 0,
      executionId: data.executionId ?? null,
      command: data.command,
      stdout: data.stdout ?? null,
      stderr: data.stderr ?? null,
      exitCode: data.exitCode ?? null,
      duration: data.duration ?? null,
      status: data.status
    }
  })
}

export async function listToolExecutionsByTask(taskId: string) {
  return prisma.toolExecution.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' }
  })
}

export async function listAgentTracesByTask(taskId: string) {
  return prisma.agentTrace.findMany({
    where: { taskId },
    orderBy: { stepIndex: 'asc' }
  })
}

export async function listRuntimeLogsByTask(taskId: string) {
  return prisma.runtimeLog.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' }
  })
}
