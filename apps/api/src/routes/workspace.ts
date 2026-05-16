import { FastifyPluginAsync } from 'fastify';
import { Workspace } from '@agenthub/shared';

export const workspaceRoutes: FastifyPluginAsync = async (server) => {
  // Mock data - replace with actual DB queries later
  const mockWorkspaces: Workspace[] = [
    {
      id: '1',
      name: 'My First Project',
      description: 'A sample workspace for development',
      ownerId: 'user-1',
      members: [
        {
          userId: 'user-1',
          role: 'admin',
          joinedAt: new Date(),
        }
      ],
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  ];

  server.get('/workspaces', async () => {
    return {
      workspaces: mockWorkspaces,
    };
  });

  server.get('/workspaces/:id', async (request) => {
    const { id } = request.params as { id: string };
    const workspace = mockWorkspaces.find(w => w.id === id);

    if (!workspace) {
      throw server.httpErrors.notFound('Workspace not found');
    }

    return workspace;
  });
};