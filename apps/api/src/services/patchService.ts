import prisma from './prisma'

export async function createPatch(data: {
  taskId: string
  content: string
  status: string
  createdBy: string
  diff: string
  appliedAt?: Date | null
  appliedBy?: string | null
}) {
  return prisma.patch.create({ data })
}

export async function listPatchesByTask(taskId: string) {
  return prisma.patch.findMany({ where: { taskId }, orderBy: { createdAt: 'desc' } })
}
