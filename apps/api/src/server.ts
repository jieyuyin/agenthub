import { loadedEnvFiles } from './loadEnv';
import Fastify from 'fastify';
import { getAIConfigSummary } from './services/aiService';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health';
import { workspaceRoutes } from './routes/workspace';
import { agentRoutes } from './routes/agents';
import { chatRoutes } from './routes/chat';
import { runtimeRoutes } from './routes/runtime';
import { taskRoutes } from './routes/tasks';
import { aiRoutes } from './routes/ai';
import { contextRoutes } from './routes/context';
import { initSocket } from './socket';

const PORT = Number(process.env.API_PORT || 3003);
const HOST = process.env.API_HOST || '0.0.0.0';

const server = Fastify({
  logger: true,
});

await server.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:3002'],
  credentials: true,
});

await server.register(healthRoutes, { prefix: '/api' });
await server.register(workspaceRoutes, { prefix: '/api' });
await server.register(agentRoutes, { prefix: '/api' });
await server.register(chatRoutes, { prefix: '/api' });
await server.register(runtimeRoutes, { prefix: '/api' });
await server.register(taskRoutes, { prefix: '/api' });
await server.register(aiRoutes, { prefix: '/api' });
await server.register(contextRoutes, { prefix: '/api' });

try {
  // Socket.IO must attach before listen (same underlying http.Server)
  initSocket(server.server);

  await server.listen({ port: PORT, host: HOST });
  server.log.info(`API server listening on http://${HOST}:${PORT}`);
  const ai = getAIConfigSummary();
  server.log.info(`Env loaded from: ${loadedEnvFiles.length ? loadedEnvFiles.join(', ') : '(none)'}`);
  server.log.info(
    ai.provider === 'none'
      ? 'AI: not configured — create apps/api/.env from .env.example'
      : `AI: ${ai.provider} model=${ai.model} url=${ai.url}`
  );
  if (ai.provider === 'ollama') {
    server.log.info(`AI model from env LOCAL_AI_MODEL=${process.env.LOCAL_AI_MODEL ?? '(unset)'}`);
  }
  server.log.info('Socket.IO ready (path /socket.io/)');
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
