import { FastifyPluginAsync } from 'fastify'
import * as runtimeService from '../services/runtimeService'
import * as executionService from '../services/executionService'

export const runtimeRoutes: FastifyPluginAsync = async (server) => {
  server.post('/runtimes/:workspaceId/create', async (request) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const runtime = await runtimeService.createRuntimeForWorkspace(workspaceId)
    return { ok: true, runtime }
  })

  server.post('/runtimes/:workspaceId/start', async (request) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const runtime = await runtimeService.startRuntime(workspaceId)
    return { ok: true, runtime }
  })

  server.post('/runtimes/:workspaceId/stop', async (request) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const runtime = await runtimeService.stopRuntime(workspaceId)
    return { ok: true, runtime }
  })

  server.post('/runtimes/:workspaceId/exec', async (request) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const body = request.body as any
    const result = await runtimeService.execInRuntime(workspaceId, body.command, body.timeout)
    return result
  })

  server.post('/runtimes/id/:runtimeId/start', async (request) => {
    const { runtimeId } = request.params as { runtimeId: string }
    const runtime = await runtimeService.startRuntimeById(runtimeId)
    return { ok: true, runtime }
  })

  server.post('/runtimes/id/:runtimeId/stop', async (request) => {
    const { runtimeId } = request.params as { runtimeId: string }
    const runtime = await runtimeService.stopRuntimeById(runtimeId)
    return { ok: true, runtime }
  })

  server.post('/runtimes/id/:runtimeId/exec', async (request) => {
    const { runtimeId } = request.params as { runtimeId: string }
    const body = request.body as any
    const result = await runtimeService.execInRuntimeById(runtimeId, body.command, body.timeout)
    return result
  })

  server.get('/runtimes/id/:runtimeId', async (request) => {
    const { runtimeId } = request.params as { runtimeId: string }
    const runtime = await runtimeService.getRuntimeById(runtimeId)
    if (!runtime) {
      throw (server as any).httpErrors?.notFound ? (server as any).httpErrors.notFound('Runtime not found') : new Error('Runtime not found')
    }
    return runtime
  })

  server.get('/runtimes/:workspaceId', async (request) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const runtime = await runtimeService.getRuntimeByWorkspace(workspaceId)
    if (!runtime) {
      throw (server as any).httpErrors?.notFound ? (server as any).httpErrors.notFound('Runtime not found') : new Error('Runtime not found')
    }
    return runtime
  })

  server.get('/executions/:id', async (request) => {
    const { id } = request.params as { id: string }
    const execution = await executionService.getExecutionById(id)
    if (!execution) {
      throw (server as any).httpErrors?.notFound ? (server as any).httpErrors.notFound('Execution not found') : new Error('Execution not found')
    }
    return execution
  })
}
