import { FastifyPluginAsync } from 'fastify'
import { createChatCompletion, getAIConfigSummary } from '../services/aiService'
import { loadedEnvFiles } from '../loadEnv'

export const aiRoutes: FastifyPluginAsync = async (server) => {
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
    const message = body.message ?? '@pm 你好，请用一句话回复'

    try {
      const completion = await createChatCompletion({
        messages: [
          { role: 'system', content: '你是 PM，请用中文简洁回复。' },
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
