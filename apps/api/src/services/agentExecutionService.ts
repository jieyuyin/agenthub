import prisma from './prisma'

const MAX_JSON_FIELD = 100_000

function serialize(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  return raw.length > MAX_JSON_FIELD ? `${raw.slice(0, MAX_JSON_FIELD)}…[truncated]` : raw
}

export async function createAgentExecution(data: {
  taskId: string
  agentId: string
  title: string
  input?: unknown
}) {
  return prisma.agentExecution.create({
    data: {
      taskId: data.taskId,
      agentId: data.agentId,
      title: data.title,
      status: 'queued',
      input: data.input != null ? serialize(data.input) : null,
      logs: JSON.stringify([]),
    }
  })
}

export async function updateAgentExecutionStatus(data: {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  output?: unknown
  error?: string | null
  logs?: string[]
  startedAt?: Date | null
  completedAt?: Date | null
}) {
  return prisma.agentExecution.update({
    where: { id: data.id },
    data: {
      status: data.status,
      output: data.output != null ? serialize(data.output) : null,
      error: data.error ?? null,
      logs: data.logs != null ? JSON.stringify(data.logs) : undefined,
      startedAt: data.startedAt ?? undefined,
      completedAt: data.completedAt ?? undefined
    }
  })
}

export async function getAgentExecutionById(id: string) {
  return prisma.agentExecution.findUnique({ where: { id } })
}

export async function listAgentExecutionsByTask(taskId: string) {
  return prisma.agentExecution.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' }
  })
}
