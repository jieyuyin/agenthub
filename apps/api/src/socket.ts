import { Server as IOServer } from 'socket.io';
import type http from 'http';

export function initSocket(httpServer: http.Server) {
  const io = new IOServer(httpServer, {
    cors: {
      origin: ['http://localhost:3000', 'http://localhost:3002'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    socket.join('global');

    socket.on('message:create', (msg) => {
      // Broadcast incoming message to other clients
      io.to('global').emit('message', msg);

      // If message addressed to an agent, simulate agent streaming response
      if (typeof msg.content === 'string' && msg.content.startsWith('@')) {
        const mention = msg.content.split(' ')[0].replace('@', '').toLowerCase();

        // Simulate agent response streaming tokens every 200ms
        const agentId = `${mention}-agent`;
        const responseId = `resp-${Date.now()}`;
        const fullResponse = `收到任务：${msg.content} \n好的，我会开始处理并返回步骤和代码片段。`;
        const tokens = fullResponse.match(/.{1,20}/g) || [fullResponse];

        // Notify typing start
        io.to('global').emit('agent:typing', { agentId, conversationId: msg.conversationId, typing: true });

        let idx = 0;
        const interval = setInterval(() => {
          const chunk = tokens[idx];
          io.to('global').emit('message:stream', {
            id: responseId,
            conversationId: msg.conversationId,
            role: 'agent',
            agentId,
            content: chunk,
            isFinal: false,
            createdAt: new Date().toISOString(),
          });

          idx += 1;
          if (idx >= tokens.length) {
            clearInterval(interval);
            io.to('global').emit('message:stream', {
              id: responseId,
              conversationId: msg.conversationId,
              role: 'agent',
              agentId,
              content: '',
              isFinal: true,
              createdAt: new Date().toISOString(),
            });
            io.to('global').emit('agent:typing', { agentId, conversationId: msg.conversationId, typing: false });
          }
        }, 200);
      }
    });

    socket.on('disconnect', () => {
      // noop for now
    });
  });

  return io;
}
