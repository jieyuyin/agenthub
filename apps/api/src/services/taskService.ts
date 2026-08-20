import prisma from './prisma'
import type { TaskStatus } from '@agenthub/shared'

export async function getTaskById(id: string) {
  return prisma.task.findUnique({
    where: { id },
    include: {
      patches: true,
      conversation: { include: { workspace: { include: { runtime: true } } } },
      agentExecutions: true
    }
  })
}

export async function listTasksByConversation(conversationId: string) {
  return prisma.task.findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' } })
}

export async function createTask(data: {
  conversationId: string
  title: string
  description?: string
  assignedAgentId?: string
  assignedAgentIds?: string[]
  createdBy?: string
  priority?: number
}) {
  return prisma.task.create({
    data: {
      conversationId: data.conversationId,
      title: data.title,
      description: data.description ?? '',
      status: 'pending',
      assignedAgentId: data.assignedAgentId ?? null,
      assignedAgentIds: data.assignedAgentIds ? JSON.stringify(data.assignedAgentIds) : null,
      createdBy: data.createdBy ?? null,
      priority: data.priority ?? 3
    }
  })
}

export async function updateTaskStatus(id: string, status: TaskStatus, extra?: { startedAt?: Date; completedAt?: Date }) {
  return prisma.task.update({
    where: { id },
    data: {
      status,
      ...(extra?.startedAt ? { startedAt: extra.startedAt } : {}),
      ...(extra?.completedAt ? { completedAt: extra.completedAt } : {})
    }
  })
}
