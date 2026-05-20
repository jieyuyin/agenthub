import prisma from './prisma'

export async function getExecutionById(id: string) {
  return prisma.execution.findUnique({ where: { id } })
}

export async function listExecutionsByWorkspace(workspaceId: string) {
  return prisma.execution.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' }
  })
}
