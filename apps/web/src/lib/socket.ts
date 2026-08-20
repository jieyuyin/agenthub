import { io, type Socket } from 'socket.io-client'

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ??
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/?$/, '') ??
  'http://localhost:3003'

export function createSocket(): Socket {
  return io(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  })
}

export function getSocketUrl() {
  return SOCKET_URL
}
