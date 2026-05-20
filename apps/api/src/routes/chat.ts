import { FastifyPluginAsync } from 'fastify';
import * as chatService from '../services/chatService';

export const chatRoutes: FastifyPluginAsync = async (server) => {
  server.get('/messages', async (request) => {
    const q = request.query as any;
    const messages = await chatService.listMessages(q.conversationId as string | undefined);
    return { messages };
  });

  server.post('/messages', async (request) => {
    const body = request.body as any;
    const msg = await chatService.createMessage({
      conversationId: body.conversationId || 'default',
      authorId: body.authorId || 'unknown',
      authorType: body.authorType || 'user',
      contentType: body.contentType || 'text',
      content: body.content || '',
    });

    server.log.info('New message saved ' + msg.id);

    // broadcast via Socket.IO if available
    // @ts-ignore
    const io = server.io;
    if (io) {
      io.to(body.conversationId || 'global').emit('message', msg);
    }

    return msg;
  });
};
