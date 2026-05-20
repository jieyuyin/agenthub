import prisma from './prisma'
import type { Workspace } from '@agenthub/shared'

export async function listWorkspaces(): Promise<{ workspaces: Workspace[] }> {
  const rows = await prisma.workspace.findMany({
    include: { members: true, runtime: true }
  })
  return { workspaces: rows as any }
}

export async function getWorkspaceById(id: string): Promise<Workspace | null> {
  const ws = await prisma.workspace.findUnique({
    where: { id },
    include: { members: true, runtime: true }
  })
  return ws as any
}

export async function createWorkspace(payload: Partial<Workspace>) {
  const ws = await prisma.workspace.create({
    data: {
      name: payload.name ?? 'Untitled',
      description: payload.description ?? '',
      ownerId: payload.ownerId ?? '',
      status: payload.status ?? 'active'
    }
  })
  return ws as any
}
