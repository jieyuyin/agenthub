import { FastifyPluginAsync } from 'fastify';
import * as workspaceService from '../services/workspaceService';

export const workspaceRoutes: FastifyPluginAsync = async (server) => {
  server.get('/workspaces', async () => {
    const data = await workspaceService.listWorkspaces();
    return data;
  });

  server.get('/workspaces/:id', async (request) => {
    const { id } = request.params as { id: string };
    const ws = await workspaceService.getWorkspaceById(id);
    if (!ws) throw (server as any).httpErrors?.notFound ? (server as any).httpErrors.notFound('Workspace not found') : new Error('Workspace not found');
    return ws;
  });

  server.post('/workspaces', async (request) => {
    const body = request.body as any;
    const ws = await workspaceService.createWorkspace(body);
    return ws;
  });
};