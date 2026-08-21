import type { FastifyPluginAsync } from 'fastify'
import { addMemory, addToolContext, getContextSnapshot, getLongTermMemory, updateTaskState, updateUserProfile, writeMemoryMarkdown } from '../services/contextEngineService'

export const contextRoutes: FastifyPluginAsync = async (server) => {
  server.get('/context/conversations/:conversationId', async (request) => {
    return getContextSnapshot((request.params as { conversationId: string }).conversationId)
  })

  server.post('/context/memories', async (request, reply) => {
    const body = request.body as { scope?: 'user' | 'project' | 'conversation'; scopeId?: string; content?: string }
    if (!body.scope || !body.scopeId?.trim() || !body.content?.trim()) {
      return reply.status(400).send({ error: 'scope、scopeId 和 content 为必填项' })
    }
    return addMemory({ scope: body.scope, scopeId: body.scopeId, content: body.content.trim() })
  })

  server.get('/context/long-term-memory', async (request) => {
    const query = request.query as { projectId?: string }
    return getLongTermMemory(query.projectId)
  })

  server.put('/context/user-profile', async (request) => {
    const body = request.body as { facts?: string[]; preferences?: string[] }
    return updateUserProfile({ facts: body.facts, preferences: body.preferences })
  })

  server.put('/context/memory-md', async (request, reply) => {
    const body = request.body as { content?: string; projectId?: string | null }
    if (typeof body.content !== 'string') return reply.status(400).send({ error: 'content 必须是字符串' })
    return writeMemoryMarkdown(body.content, body.projectId)
  })

  server.put('/context/projects/:projectId/task-state', async (request, reply) => {
    const projectId = (request.params as { projectId: string }).projectId
    const body = request.body as { goal?: string; phase?: string; status?: string; nextStep?: string }
    if (!body.goal?.trim() || !body.phase?.trim() || !body.status?.trim()) {
      return reply.status(400).send({ error: 'goal、phase 和 status 为必填项' })
    }
    return updateTaskState({ projectId, goal: body.goal, phase: body.phase, status: body.status, nextStep: body.nextStep })
  })

  server.post('/context/projects/:projectId/tools', async (request, reply) => {
    const projectId = (request.params as { projectId: string }).projectId
    const body = request.body as { conversationId?: string; tool?: string; summary?: string }
    if (!body.tool?.trim() || !body.summary?.trim()) {
      return reply.status(400).send({ error: 'tool 和 summary 为必填项' })
    }
    return addToolContext({ projectId, conversationId: body.conversationId, tool: body.tool, summary: body.summary })
  })
}
