import { FastifyPluginAsync } from 'fastify'
import * as taskService from '../services/taskService'
import * as agentExecutionService from '../services/agentExecutionService'
import * as observabilityService from '../services/observabilityService'
import * as timelineService from '../services/timelineService'
import { runTaskAgent } from '../services/taskExecutor'
import prisma from '../services/prisma'

export const taskRoutes: FastifyPluginAsync = async (server) => {
  server.post('/tasks', async (request, reply) => {
    const body = request.body as {
      conversationId: string
      title: string
      description?: string
      assignedAgentId?: string
      priority?: number
    }

    if (!body?.conversationId || !body?.title) {
      return reply.status(400).send({ error: 'conversationId and title are required' })
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: body.conversationId },
      include: { workspace: true }
    })
    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' })
    }

    const task = await taskService.createTask({
      conversationId: body.conversationId,
      title: body.title,
      description: body.description,
      assignedAgentId: body.assignedAgentId,
      priority: body.priority
    })

    void runTaskAgent(task.id).catch((err) => {
      server.log.error({ err, taskId: task.id }, 'runTaskAgent failed')
    })

    return reply.status(201).send({ data: task })
  })

  server.get('/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const task = await taskService.getTaskById(id)
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' })
    }
    return { data: task }
  })

  server.patch('/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as { status?: string; assignedAgentId?: string }
    const existing = await taskService.getTaskById(id)
    if (!existing) {
      return reply.status(404).send({ error: 'Task not found' })
    }
    const task = await prisma.task.update({
      where: { id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.assignedAgentId !== undefined ? { assignedAgentId: body.assignedAgentId } : {})
      }
    })
    return { data: task }
  })

  server.get('/conversations/:conversationId/tasks', async (request) => {
    const { conversationId } = request.params as { conversationId: string }
    const tasks = await taskService.listTasksByConversation(conversationId)
    return { data: { items: tasks, total: tasks.length } }
  })

  server.get('/tasks/:id/timeline', async (request, reply) => {
    const { id } = request.params as { id: string }
    const timeline = await timelineService.buildTaskTimeline(id)
    if (!timeline) {
      return reply.status(404).send({ error: 'Task not found' })
    }
    return { data: timeline }
  })

  server.get('/tasks/:id/observability', async (request, reply) => {
    const { id } = request.params as { id: string }
    const task = await taskService.getTaskById(id)
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' })
    }
    const [toolExecutions, agentTraces, runtimeLogs, agentExecutions] = await Promise.all([
      observabilityService.listToolExecutionsByTask(id),
      observabilityService.listAgentTracesByTask(id),
      observabilityService.listRuntimeLogsByTask(id),
      agentExecutionService.listAgentExecutionsByTask(id)
    ])
    return {
      data: {
        taskId: id,
        toolExecutions,
        agentTraces,
        runtimeLogs,
        agentExecutions
      }
    }
  })

  server.get('/tasks/:id/tool-executions', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await taskService.getTaskById(id))) {
      return reply.status(404).send({ error: 'Task not found' })
    }
    return { data: await observabilityService.listToolExecutionsByTask(id) }
  })

  server.get('/tasks/:id/agent-traces', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await taskService.getTaskById(id))) {
      return reply.status(404).send({ error: 'Task not found' })
    }
    return { data: await observabilityService.listAgentTracesByTask(id) }
  })

  server.get('/tasks/:id/runtime-logs', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await taskService.getTaskById(id))) {
      return reply.status(404).send({ error: 'Task not found' })
    }
    return { data: await observabilityService.listRuntimeLogsByTask(id) }
  })
}
