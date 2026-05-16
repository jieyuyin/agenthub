import { FastifyPluginAsync } from 'fastify';

const memory: any = {
  messages: [],
};

export const chatRoutes: FastifyPluginAsync = async (server) => {
  server.get('/messages', async (request, reply) => {
    return { messages: memory.messages };
  });

  server.post('/messages', async (request, reply) => {
    const body = request.body as any;
    const msg = {
      id: `m-${Date.now()}`,
      conversationId: body.conversationId || 'default',
      role: body.role || 'user',
      content: body.content || '',
      agentId: body.agentId,
      createdAt: new Date().toISOString(),
    };
    memory.messages.push(msg);

    // simple broadcast via server log - real-time via socket.io handled elsewhere
    server.log.info('New message saved', msg.id);

    return msg;
  });
};
