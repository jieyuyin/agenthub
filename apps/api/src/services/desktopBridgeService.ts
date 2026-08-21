import { randomUUID } from 'node:crypto'
import type { Server, Socket } from 'socket.io'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

let desktopSocketId: string | null = null
const pending = new Map<string, PendingRequest>()

export function registerDesktopBridge(io: Server, socket: Socket) {
  desktopSocketId = socket.id
  console.log('[desktop] bridge registered', socket.id)

  socket.on('desktop:tool-result', (payload: { requestId?: string; ok?: boolean; result?: unknown; error?: string }) => {
    if (!payload?.requestId) return
    const request = pending.get(payload.requestId)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(payload.requestId)
    if (payload.ok) request.resolve(payload.result)
    else request.reject(new Error(payload.error || '本地工具执行失败'))
  })

  socket.once('disconnect', () => {
    if (desktopSocketId !== socket.id) return
    desktopSocketId = null
    for (const [id, request] of pending) {
      clearTimeout(request.timer)
      request.reject(new Error('AgentHub Desktop 已断开连接'))
      pending.delete(id)
    }
  })
}

export function requestDesktopTool(io: Server, input: { workspaceToken: string; name: string; arguments: Record<string, unknown> }) {
  if (!desktopSocketId) throw new Error('未连接 AgentHub Desktop。请从桌面 App 打开项目后重试。')
  const requestId = randomUUID()
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error(`本地工具 ${input.name} 等待超时`))
    }, 130_000)
    pending.set(requestId, { resolve, reject, timer })
    io.to(desktopSocketId as string).emit('desktop:tool-request', { requestId, ...input })
  })
}
