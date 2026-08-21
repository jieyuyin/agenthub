import { FastifyPluginAsync } from 'fastify'
import { createChatCompletion, getAIConfigSummary, testModelConnection } from '../services/aiService'
import { activateModelConfig, deleteModelConfig, listModelConfigs, saveModelConfig, type ModelConfigInput } from '../services/modelConfigService'
import { loadedEnvFiles } from '../loadEnv'

export const aiRoutes: FastifyPluginAsync = async (server) => {
  server.get('/ai/models', async () => ({ models: listModelConfigs() }))

  server.post('/ai/models/test', async (request, reply) => {
    try {
      return await testModelConnection(request.body as ModelConfigInput)
    } catch (error: any) {
      return reply.status(503).send({ ok: false, error: error?.message ?? String(error) })
    }
  })

  server.post('/ai/models', async (request, reply) => {
    const input = request.body as ModelConfigInput
    if (!input?.provider || !input?.modelId?.trim()) {
      return reply.status(400).send({ error: '提供方和模型 ID 为必填项' })
    }
    if (input.provider !== 'mockllm' && !input.baseUrl?.trim()) {
      return reply.status(400).send({ error: 'API Base URL 为必填项' })
    }
    return saveModelConfig(input)
  })

  server.post('/ai/models/:id/activate', async (request, reply) => {
    const model = activateModelConfig((request.params as { id: string }).id)
    return model ?? reply.status(404).send({ error: '模型不存在' })
  })

  server.delete('/ai/models/:id', async (request, reply) => {
    return deleteModelConfig((request.params as { id: string }).id)
      ? { ok: true }
      : reply.status(404).send({ error: '模型不存在' })
  })
  server.get('/ai/status', async () => {
    const config = getAIConfigSummary()
    return {
      ok: config.provider !== 'none',
      config,
      envFiles: loadedEnvFiles,
      hints: {
        expectedEnvPath: 'apps/api/.env',
        localAiBaseSet: Boolean(process.env.LOCAL_AI_BASE),
        openaiKeySet: Boolean(process.env.OPENAI_API_KEY)
      }
    }
  })

  server.post('/ai/chat-test', async (request, reply) => {
    const body = (request.body as { message?: string }) ?? {}
    const message = body.message ?? '你好，请用一句话回复'

    try {
      const completion = await createChatCompletion({
        messages: [
          { role: 'system', content: '你是通用 AI Assistant，请用中文简洁回复。' },
          { role: 'user', content: message }
        ]
      })
      const text = completion.choices?.[0]?.message?.content ?? ''
      return { ok: true, reply: text }
    } catch (error: any) {
      return reply.status(503).send({
        ok: false,
        error: error?.message ?? String(error),
        config: getAIConfigSummary()
      })
    }
  })
}
