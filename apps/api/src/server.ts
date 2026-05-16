import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health';
import { workspaceRoutes } from './routes/workspace';
import { agentRoutes } from './routes/agents';
import { chatRoutes } from './routes/chat';
import { initSocket } from './socket';

const PORT = Number(process.env.API_PORT || 3001);
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

try {
  await server.listen({ port: PORT, host: HOST });
  server.log.info(`API server listening on http://${HOST}:${PORT}`);

  // Initialize Socket.IO attached to Fastify's underlying http server
  // @ts-ignore - Fastify's `server` property is the underlying http.Server
  const io = initSocket((server as any).server);
  server.log.info('Socket.IO initialized');
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
