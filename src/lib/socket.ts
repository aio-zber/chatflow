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
    
    try {
      const io = new ServerIO(res.socket.server, {
        path: '/api/socket/io',
        addTrailingSlash: false,
        transports: ['polling'], // Match client - polling only for stability
        allowEIO3: true,
        pingTimeout: 60000, // Longer timeout to prevent disconnections
        pingInterval: 25000, // Longer interval for stability
        maxHttpBufferSize: 1e6,
        httpCompression: false, // Disable compression to reduce overhead
        upgradeTimeout: 30000, // Longer upgrade timeout
        cors: {
          origin: process.env.NODE_ENV === 'production' 
            ? [process.env.NEXTAUTH_URL, process.env.NEXT_PUBLIC_SOCKET_URL].filter(Boolean)
            : ['http://localhost:3000', 'http://localhost:3001'],
          methods: ['GET', 'POST'],
          credentials: false,
          allowedHeaders: ['Content-Type'],
        },
        connectTimeout: 45000,
        serveClient: false,
        allowUpgrades: false, // Disable upgrades to prevent transport switching issues
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
        // Store user ID for this socket
        socket.data.userId = userId
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

      // Call state storage
      const activeCalls = new Map()

      // Call system event handlers
      socket.on('initiate_call', async (data: {
        conversationId: string
        callType: 'voice' | 'video'
        callerName: string
        callerAvatar?: string | null
        conversationName?: string | null
        isGroupCall: boolean
        participantCount: number
      }) => {
        console.log(`[CALL] Initiated in conversation ${data.conversationId} by ${data.callerName} (${socket.data.userId || 'unknown'})`)
        
        const callId = `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        const callData = {
          ...data,
          callId,
          callerId: socket.data.userId,
          status: 'ringing',
          participants: new Set([socket.data.userId]),
          startTime: Date.now()
        }
        
        // Store call state
        activeCalls.set(callId, callData)
        
        // Join call room
        socket.join(`call:${callId}`)
        
        console.log(`[CALL] Broadcasting to room: conversation:${data.conversationId}`)
        socket.to(`conversation:${data.conversationId}`).emit('incoming_call', {
          ...data,
          callId,
          callerId: socket.data.userId
        })
        
        // Set call timeout (30 seconds)
        setTimeout(async () => {
          const call = activeCalls.get(callId)
          if (call && call.status === 'ringing') {
            console.log(`[CALL] Timeout for call ${callId}`)
            
            // Create missed call record
            try {
              await prisma.callRecord.create({
                data: {
                  conversationId: data.conversationId,
                  callerId: call.callerId,
                  callType: call.callType,
                  status: 'missed',
                  duration: 0,
                  participants: Array.from(call.participants),
                  startedAt: new Date(call.startTime),
                  endedAt: new Date()
                }
              })
              console.log(`[CALL] Created missed call record for call ${callId}`)
            } catch (error) {
              console.error(`[CALL] Failed to create missed call record:`, error)
            }
            
            io.to(`call:${callId}`).emit('call_timeout', { callId })
            io.to(`conversation:${data.conversationId}`).emit('call_ended', { 
              conversationId: data.conversationId, 
              callId,
              reason: 'timeout' 
            })
            activeCalls.delete(callId)
          }
        }, 30000)
        
        const room = io.sockets.adapter.rooms.get(`conversation:${data.conversationId}`)
        const roomSize = room ? room.size : 0
        console.log(`[CALL] Room conversation:${data.conversationId} has ${roomSize} participants (including caller)`)
      })

      socket.on('call_response', (data: {
        conversationId: string
        callId: string
        accepted: boolean
        participantId: string
      }) => {
        console.log(`[CALL] Response for call ${data.callId}: ${data.accepted ? 'accepted' : 'declined'} by ${data.participantId}`)
        
        const call = activeCalls.get(data.callId)
        if (!call) {
          console.log(`[CALL] Call ${data.callId} not found`)
          return
        }
        
        if (data.accepted) {
          // Add participant to call
          call.participants.add(data.participantId)
          socket.join(`call:${data.callId}`)
          
          // Update call status to connected if this is the first acceptance
          if (call.status === 'ringing') {
            call.status = 'connected'
            call.connectedTime = Date.now()
          }
          
          // Notify all call participants about the new participant
          io.to(`call:${data.callId}`).emit('participant_joined', {
            callId: data.callId,
            participantId: data.participantId,
            participantCount: call.participants.size
          })
        }
        
        // Broadcast the response to all participants in the conversation
        io.to(`conversation:${data.conversationId}`).emit('call_response', {
          ...data,
          participantCount: call.participants.size,
          callStatus: call.status
        })
      })

      socket.on('end_call', async (data: {
        conversationId: string
        callId: string
        participantId: string
      }) => {
        console.log(`[CALL] Ended call ${data.callId} by ${data.participantId}`)
        
        const call = activeCalls.get(data.callId)
        if (call) {
          call.participants.delete(data.participantId)
          socket.leave(`call:${data.callId}`)
          
          // If caller ends call or no participants left, end for everyone
          if (data.participantId === call.callerId || call.participants.size === 0) {
            const endTime = Date.now()
            const duration = call.status === 'connected' && call.connectedTime ? 
              Math.floor((endTime - call.connectedTime) / 1000) : 0
            
            // Create call record
            try {
              await prisma.callRecord.create({
                data: {
                  conversationId: data.conversationId,
                  callerId: call.callerId,
                  callType: call.callType,
                  status: call.status === 'connected' ? 'completed' : 'cancelled',
                  duration,
                  participants: Array.from(call.participants),
                  startedAt: new Date(call.startTime),
                  endedAt: new Date(endTime)
                }
              })
              console.log(`[CALL] Created call record for call ${data.callId}`)
            } catch (error) {
              console.error(`[CALL] Failed to create call record:`, error)
            }
            
            io.to(`call:${data.callId}`).emit('call_ended', {
              conversationId: data.conversationId,
              callId: data.callId,
              reason: 'ended'
            })
            io.to(`conversation:${data.conversationId}`).emit('call_ended', {
              conversationId: data.conversationId,
              callId: data.callId,
              reason: 'ended'
            })
            activeCalls.delete(data.callId)
          } else {
            // Just notify remaining participants that someone left
            io.to(`call:${data.callId}`).emit('participant_left', {
              callId: data.callId,
              participantId: data.participantId,
              participantCount: call.participants.size
            })
          }
        }
      })

      // WebRTC signaling events
      socket.on('webrtc_offer', (data: {
        callId: string
        targetUserId: string
        offer: RTCSessionDescriptionInit
      }) => {
        console.log(`[WebRTC] Offer from ${socket.data.userId} to ${data.targetUserId} for call ${data.callId}`)
        io.to(`user:${data.targetUserId}`).emit('webrtc_offer', {
          callId: data.callId,
          fromUserId: socket.data.userId,
          offer: data.offer
        })
      })

      socket.on('webrtc_answer', (data: {
        callId: string
        targetUserId: string
        answer: RTCSessionDescriptionInit
      }) => {
        console.log(`[WebRTC] Answer from ${socket.data.userId} to ${data.targetUserId} for call ${data.callId}`)
        io.to(`user:${data.targetUserId}`).emit('webrtc_answer', {
          callId: data.callId,
          fromUserId: socket.data.userId,
          answer: data.answer
        })
      })

      socket.on('webrtc_ice_candidate', (data: {
        callId: string
        targetUserId: string
        candidate: RTCIceCandidateInit
      }) => {
        console.log(`[WebRTC] ICE candidate from ${socket.data.userId} to ${data.targetUserId} for call ${data.callId}`)
        io.to(`user:${data.targetUserId}`).emit('webrtc_ice_candidate', {
          callId: data.callId,
          fromUserId: socket.data.userId,
          candidate: data.candidate
        })
      })

        socket.on('disconnect', async () => {
          console.log(`User disconnected: ${socket.id}`)
          
          // Mark user as offline if they had a userId stored
          if (socket.data.userId) {
            try {
              const now = new Date()
              await prisma.user.update({
                where: { id: socket.data.userId },
                data: { isOnline: false, lastSeen: now }
              })
              socket.broadcast.emit('user-status-change', { 
                userId: socket.data.userId, 
                isOnline: false, 
                lastSeen: now.toISOString() 
              })
              console.log(`Marked user ${socket.data.userId} as offline due to disconnect`)
            } catch (error) {
              console.error('Error updating user offline status on disconnect:', error)
            }
          }
        })
      })

      res.socket.server.io = io
      setGlobalSocketIO(io)
      console.log('Socket.IO server successfully initialized')
    } catch (error) {
      console.error('Failed to initialize Socket.IO server:', error)
      throw error
    }
  } else {
    console.log('Socket.IO server already initialized')
  }
}

export const getSocketInstance = (req: NextApiRequest, res: NextApiResponse) => {
  const serverRes = res as NextApiResponseServerIO
  if (!serverRes.socket?.server?.io) {
    initializeSocketIO(req, serverRes)
  }
  return serverRes.socket.server.io
}

// Global variable to store the Socket.IO instance
let globalSocketIO: ServerIO | null = null

export const setGlobalSocketIO = (io: ServerIO) => {
  globalSocketIO = io
}

export const getIO = (): ServerIO | null => {
  return globalSocketIO
}