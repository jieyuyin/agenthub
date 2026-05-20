import prisma from './prisma'

export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id } })
}

export async function findOrCreateUserByEmail(email: string, name?: string) {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return existing
  return prisma.user.create({ data: { email, name: name ?? email.split('@')[0], role: 'user' } })
}
