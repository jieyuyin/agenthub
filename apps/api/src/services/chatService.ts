import prisma from './prisma'

export async function listMessages(conversationId?: string) {
  const where = conversationId ? { conversationId } : {}
  const rows = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'asc' }
  })
  return rows
}

export async function createMessage(payload: {
  conversationId: string
  authorId: string
  authorType: string
  contentType: string
  content: string
}) {
  const msg = await prisma.message.create({
    data: {
      conversationId: payload.conversationId,
      authorId: payload.authorId,
      authorType: payload.authorType,
      contentType: payload.contentType,
      content: payload.content
    }
  })
  return msg
}
