import { Server as NetServer } from 'http'
import { NextApiRequest, NextApiResponse } from 'next'
import { Server as ServerIO } from 'socket.io'
import { prisma } from './prisma'

export type NextApiResponseServerIO = NextApiResponse & {
  socket: {
    server: NetServer & {
      io: ServerIO
    }
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
}

export const initializeSocketIO = (req: NextApiRequest, res: NextApiResponseServerIO) => {
  if (!res.socket.server.io) {
    console.log('Initializing Socket.IO server...')
    
    const io = new ServerIO(res.socket.server, {
      path: '/api/socket/io',
      addTrailingSlash: false,
      transports: ['polling', 'websocket'], // Start with polling, allow websocket upgrade
      allowEIO3: true, // Allow Engine.IO v3 for compatibility
      pingTimeout: 20000,
      pingInterval: 10000,
      cors: {
        origin: process.env.NODE_ENV === 'production' 
          ? process.env.NEXTAUTH_URL 
          : 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: false,
      },
    })

    io.on('connection', async (socket) => {
      console.log(`User connected: ${socket.id}`)
      console.log('Available transports:', socket.conn.transport.name)
      console.log('Socket handshake:', socket.handshake.headers['user-agent']?.substring(0, 50))

      socket.on('join-room', (conversationId: string) => {
        socket.join(`conversation:${conversationId}`)
        console.log(`User ${socket.id} joined conversation: ${conversationId}`)
      })

      socket.on('leave-room', (conversationId: string) => {
        socket.leave(`conversation:${conversationId}`)
        console.log(`User ${socket.id} left conversation: ${conversationId}`)
      })

      socket.on('join-channel', (channelId: string) => {
        socket.join(`channel:${channelId}`)
        console.log(`User ${socket.id} joined channel: ${channelId}`)
      })

      socket.on('leave-channel', (channelId: string) => {
        socket.leave(`channel:${channelId}`)
        console.log(`User ${socket.id} left channel: ${channelId}`)
      })

      socket.on('join-user-room', (userId: string) => {
        socket.join(`user:${userId}`)
        console.log(`User ${socket.id} joined user room: user:${userId}`)
      })

      socket.on('typing-start', ({ conversationId, channelId, userId, username }) => {
        if (conversationId) {
          socket.to(`conversation:${conversationId}`).emit('user-typing', { userId, username, isTyping: true })
        } else if (channelId) {
          socket.to(`channel:${channelId}`).emit('user-typing', { userId, username, isTyping: true })
        }
      })

      socket.on('typing-stop', ({ conversationId, channelId, userId, username }) => {
        if (conversationId) {
          socket.to(`conversation:${conversationId}`).emit('user-typing', { userId, username, isTyping: false })
        } else if (channelId) {
          socket.to(`channel:${channelId}`).emit('user-typing', { userId, username, isTyping: false })
        }
      })

      socket.on('user-online', async (userId: string) => {
        try {
          // Join the user to their personal room for targeted notifications
          socket.join(`user:${userId}`)
          console.log(`User ${socket.id} joined personal room: user:${userId}`)
          
          const now = new Date()
          await prisma.user.update({
            where: { id: userId },
            data: { isOnline: true, lastSeen: now }
          })
          socket.broadcast.emit('user-status-change', { 
            userId, 
            isOnline: true, 
            lastSeen: now.toISOString() 
          })
        } catch (error) {
          console.error('Error updating user online status:', error)
          // Continue without database update - don't crash the socket
        }
      })

      socket.on('user-offline', async (userId: string) => {
        try {
          const now = new Date()
          await prisma.user.update({
            where: { id: userId },
            data: { isOnline: false, lastSeen: now }
          })
          socket.broadcast.emit('user-status-change', { 
            userId, 
            isOnline: false, 
            lastSeen: now.toISOString() 
          })
        } catch (error) {
          console.error('Error updating user offline status:', error)
          // Continue without database update - don't crash the socket
        }
      })

      socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`)
      })
    })

    res.socket.server.io = io
  }
}

export const getSocketInstance = (req: NextApiRequest, res: NextApiResponse) => {
  const serverRes = res as NextApiResponseServerIO
  if (!serverRes.socket?.server?.io) {
    initializeSocketIO(req, serverRes)
  }
  return serverRes.socket.server.io
}