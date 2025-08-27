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

// Global call state storage - MUST be outside socket initialization to persist across connections
const activeCalls = new Map()

// Track call traces to prevent duplicates
const createdCallTraces = new Set<string>()

// ENHANCED: Centralized call trace creation function with deduplication
async function createCallTrace(call: any, status: 'missed' | 'completed' | 'declined' | 'cancelled', duration: number = 0, io: any) {
  try {
    // CRITICAL: Prevent duplicate call traces
    const traceKey = `${call.callId}-${status}`
    if (createdCallTraces.has(traceKey)) {
      console.log(`[CALL] ⚠️ Call trace already created for ${call.callId} with status ${status}, skipping duplicate`)
      return
    }
    createdCallTraces.add(traceKey)
    
    console.log(`[CALL] Creating ${status} call trace for call ${call.callId || 'unknown'}`)
    
    // Create call record first
    const callRecord = await prisma.callRecord.create({
      data: {
        conversationId: call.conversationId,
        callerId: call.callerId,
        callType: call.callType,
        status,
        duration,
        participants: Array.from(call.participants || []),
        startedAt: new Date(call.startTime),
        endedAt: new Date()
      }
    })
    console.log(`[CALL] Created ${status} call record: ${callRecord.id}`)
    
    // Generate trace message content to match expected format
    const callTypeIcon = call.callType === 'voice' ? '📞' : '📹'
    
    let traceContent = ''
    
    // Format based on status to match expected UI
    if (status === 'completed' && duration > 0) {
      const mins = Math.floor(duration / 60)
      const secs = duration % 60
      traceContent = `${callTypeIcon} ${call.callType} call (${mins}:${secs.toString().padStart(2, '0')}) - Completed`
    } else if (status === 'missed' || status === 'declined') {
      traceContent = `${callTypeIcon} ${call.callType} call - Missed`
    } else {
      traceContent = `${callTypeIcon} ${call.callType} call - Cancelled`
    }
    
    // Create trace message as regular message from caller (not system message)
    const traceMessage = await prisma.message.create({
      data: {
        conversationId: call.conversationId,
        senderId: call.callerId,
        content: traceContent,
        type: 'call_trace',
        isSystem: false // Changed to false so it appears as regular message from caller
      }
    })
    console.log(`[CALL] Created ${status} call trace message: ${traceMessage.id}`)
    
    // Broadcast trace message with sender details
    const messageWithSender = await prisma.message.findUnique({
      where: { id: traceMessage.id },
      include: {
        sender: {
          select: { id: true, name: true, username: true, avatar: true }
        }
      }
    })
    
    if (messageWithSender) {
      io.to(`conversation:${call.conversationId}`).emit('message_received', {
        ...messageWithSender,
        status: 'sent'
      })
      console.log(`[CALL] ✅ Broadcasted ${status} call trace message`)
    }
    
    // Cleanup trace key after successful creation (allow new traces for different statuses)
    setTimeout(() => {
      const traceKey = `${call.callId}-${status}`
      createdCallTraces.delete(traceKey)
    }, 5000) // Clear after 5 seconds
    
    return { callRecord, traceMessage }
    
  } catch (error) {
    console.error(`[CALL] Failed to create ${status} call trace:`, error)
    // Remove trace key on error to allow retry
    const traceKey = `${call.callId}-${status}`
    createdCallTraces.delete(traceKey)
    throw error
  }
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
            : ['http://localhost:3000'],
          methods: ['GET', 'POST'],
          credentials: false,
          allowedHeaders: ['Content-Type'],
        },
        connectTimeout: 45000,
        serveClient: false,
        allowUpgrades: false, // Disable upgrades to prevent transport switching issues
      })

      io.on('connection', async (socket) => {
        console.log(`\n🔌 [SOCKET] NEW CONNECTION: ${socket.id}`)
        console.log('[SOCKET] Available transports:', socket.conn.transport.name)
        console.log('[SOCKET] Socket handshake:', socket.handshake.headers['user-agent']?.substring(0, 50))
        console.log('[SOCKET] Client IP:', socket.handshake.address)
        console.log('[SOCKET] Connection time:', new Date().toISOString())
        console.log(`[SOCKET] 📞 ACTIVE CALLS COUNT: ${activeCalls.size}`)
        
        // Test socket event registration
        socket.on('test_event', (data) => {
          console.log('[SOCKET] Test event received:', data)
          socket.emit('test_response', { message: 'Test successful', timestamp: Date.now() })
        })

      socket.on('join-room', (conversationId: string) => {
        socket.join(`conversation:${conversationId}`)
        console.log(`\n💬 [SOCKET] JOIN-ROOM: conversation:${conversationId}`)
        console.log(`[SOCKET] Socket ID: ${socket.id}`)
        console.log(`[SOCKET] User ID: ${socket.data.userId || 'NOT_SET'}`)
        
        // Verify room membership
        const conversationRoom = io.sockets.adapter.rooms.get(`conversation:${conversationId}`)
        console.log(`[SOCKET] Conversation room has ${conversationRoom?.size || 0} members`)
        console.log(`[SOCKET] Socket ${socket.id} is now in rooms:`, Array.from(socket.rooms))
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
        console.log(`\n👤 [SOCKET] JOIN-USER-ROOM: user:${userId}`)
        console.log(`[SOCKET] Socket ID: ${socket.id}`)
        
        // Verify room membership
        const userRoom = io.sockets.adapter.rooms.get(`user:${userId}`)
        console.log(`[SOCKET] User room has ${userRoom?.size || 0} members`)
        console.log(`[SOCKET] Socket ${socket.id} is now in rooms:`, Array.from(socket.rooms))
        
        // Debug: Show all sockets for this user
        const allSocketsForUser = Array.from(io.sockets.sockets.values())
          .filter(s => s.data.userId === userId)
        console.log(`[SOCKET] Total sockets for user ${userId}:`, allSocketsForUser.length)
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
          // CRITICAL: Ensure socket data is set and user joins room
          socket.data.userId = userId
          socket.join(`user:${userId}`)
          console.log(`\n👤 [SOCKET] USER-ONLINE: ${userId}`)
          console.log(`[SOCKET] Socket ID: ${socket.id}`)
          console.log(`[SOCKET] Joined room: user:${userId}`)
          
          // Verify room membership
          const userRoom = io.sockets.adapter.rooms.get(`user:${userId}`)
          console.log(`[SOCKET] User room verification - user:${userId} has ${userRoom?.size || 0} members`)
          
          // Show all current rooms for this socket
          console.log(`[SOCKET] Socket ${socket.id} is now in rooms:`, Array.from(socket.rooms))
          
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
        console.log(`\n📞 [CALL] INITIATE_CALL RECEIVED`)
        console.log(`[CALL] Conversation: ${data.conversationId}`)
        console.log(`[CALL] Caller: ${data.callerName} (ID: ${socket.data.userId || 'unknown'})`)
        console.log(`[CALL] Socket ID: ${socket.id}`)
        console.log(`[CALL] Call Type: ${data.callType}`)
        console.log(`[CALL] Is Group: ${data.isGroupCall}`)
        
        const callId = `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        const callData = {
          ...data,
          callId,
          callerId: socket.data.userId,
          conversationId: data.conversationId,
          status: 'ringing',
          participants: new Set([socket.data.userId]),
          startTime: Date.now(),
          ringingStartTime: Date.now(),
          // ENHANCED: Track individual participant states
          participantStates: new Map([[socket.data.userId, 'ringing']])
        }
        
        // ENHANCED: Store call metadata for proper trace generation later
        console.log(`[CALL] Call initiated - trace will be created based on call outcome`)
        
        // Store call state
        activeCalls.set(callId, callData)
        
        // Join call room  
        socket.join(`call:${callId}`)
        console.log(`[CALL] Caller ${socket.data.userId} joined call room: call:${callId}`)
        
        // Emit the call ID back to the caller
        socket.emit('call_initiated', {
          callId,
          conversationId: data.conversationId,
          callType: data.callType
        })
        
        console.log(`[CALL] Broadcasting to room: conversation:${data.conversationId}`)
        
        // Enhanced broadcasting with verification
        const conversationRoom = io.sockets.adapter.rooms.get(`conversation:${data.conversationId}`)
        const roomSize = conversationRoom ? conversationRoom.size : 0
        console.log(`[CALL] Room conversation:${data.conversationId} has ${roomSize} members`)
        
        if (roomSize <= 1) {
          console.log(`[CALL] ⚠️  WARNING: Only ${roomSize} member(s) in room, call may not reach recipients`)
        }
        
        // Broadcast to conversation room
        socket.to(`conversation:${data.conversationId}`).emit('incoming_call', {
          ...data,
          callId,
          callerId: socket.data.userId
        })
        
        // Also broadcast to individual user rooms for better reliability
        const incomingCallData = {
          ...data,
          callId,
          callerId: socket.data.userId
        }
        
        // Get all participants in the conversation from the room and notify them individually
        if (conversationRoom) {
          conversationRoom.forEach(socketId => {
            const targetSocket = io.sockets.sockets.get(socketId)
            if (targetSocket && targetSocket.id !== socket.id) {
              const targetUserId = targetSocket.data.userId
              console.log(`[CALL] Direct notification to user: ${targetUserId} (socket: ${socketId})`)
              targetSocket.emit('incoming_call', incomingCallData)
              // Also notify via user room
              if (targetUserId) {
                io.to(`user:${targetUserId}`).emit('incoming_call', incomingCallData)
              }
            }
          })
        }
        
        // Set call timeout (60 seconds - increased for better connection time)
        const timeoutId = setTimeout(async () => {
          const call = activeCalls.get(callId)
          if (call && call.status === 'ringing') {
            console.log(`[CALL] Timeout for call ${callId} - status: ${call.status}, participants: ${call.participants.size}`)
            
            // Create missed call trace using centralized function
            try {
              await createCallTrace(call, 'missed', 0, io)
            } catch (error) {
              console.error(`[CALL] Failed to create missed call trace:`, error)
            }
            
            const timeoutData = {
              conversationId: data.conversationId, 
              callId,
              reason: 'timeout'
            }
            
            // Notify timeout to all call participants
            io.to(`call:${callId}`).emit('call_timeout', { callId })
            io.to(`call:${callId}`).emit('call_ended', timeoutData)
            
            // Notify conversation members
            io.to(`conversation:${data.conversationId}`).emit('call_ended', timeoutData)
            
            // Clean up call room and force all participants to leave
            const callRoom = io.sockets.adapter.rooms.get(`call:${callId}`)
            if (callRoom) {
              callRoom.forEach(socketId => {
                const socket = io.sockets.sockets.get(socketId)
                if (socket) {
                  socket.leave(`call:${callId}`)
                  // Send direct timeout notification
                  socket.emit('call_ended', timeoutData)
                  console.log(`[CALL] Forced socket ${socketId} to leave due to timeout`)
                }
              })
            }
            
            // Also notify individual participants via their user rooms
            call.participants.forEach(participantId => {
              io.to(`user:${participantId}`).emit('call_ended', timeoutData)
            })
            
            console.log(`[CALL] 🔴 DELETING CALL ${callId} from TIMEOUT cleanup`)
            activeCalls.delete(callId)
          } else if (call) {
            console.log(`[CALL] Call ${callId} was not timed out - current status: ${call.status}, participants: ${call.participants.size}`)
          }
        }, 60000) // Increased to 60 seconds
        
        // Store timeout ID in call object for cleanup
        callData.timeoutId = timeoutId
        
        console.log(`[CALL] Room conversation:${data.conversationId} has ${roomSize} participants (including caller)`)
        console.log(`[CALL] ✅ Call ${callId} created and broadcast completed`)
        console.log(`[CALL] Active calls now: ${activeCalls.size}`)
      })

      socket.on('call_response', (data: {
        conversationId: string
        callId: string
        accepted: boolean
        participantId: string
      }) => {
        console.log(`\n🔥🔥🔥 [CALL] RESPONSE RECEIVED FROM CLIENT 🔥🔥🔥`)
        console.log(`[CALL] Raw data received:`, JSON.stringify(data, null, 2))
        console.log(`[CALL] Response for call ${data.callId}: ${data.accepted ? 'accepted' : 'declined'} by ${data.participantId}`)
        console.log(`[CALL] Socket user ID: ${socket.data.userId}`)
        console.log(`[CALL] Socket ID: ${socket.id}`)
        console.log(`[CALL] Socket rooms:`, Array.from(socket.rooms))
        console.log(`[CALL] 🎯 CRITICAL: Active calls at start of response handler:`, Array.from(activeCalls.keys()))
        console.log(`[CALL] 🎯 CRITICAL: Total active calls count:`, activeCalls.size)
        console.log(`[CALL] Timestamp: ${new Date().toISOString()}`)
        
        // CRITICAL: Ensure socket has user ID - if not, set it from the data
        if (!socket.data.userId && data.participantId) {
          socket.data.userId = data.participantId
          socket.join(`user:${data.participantId}`)
          console.log(`[CALL] 🚨 EMERGENCY: Set socket user ID to ${data.participantId} and joined user room`)
        }
        
        // VALIDATION: Check for self-call issues
        if (socket.data.userId === data.participantId) {
          console.log(`[CALL] ✅ Socket user ID matches participant ID: ${data.participantId}`)
        } else {
          console.log(`[CALL] ⚠️ Socket user ID (${socket.data.userId}) != participant ID (${data.participantId})`)
        }
        
        const call = activeCalls.get(data.callId)
        if (!call) {
          console.log(`[CALL] ❌ Call ${data.callId} not found in active calls`)
          console.error(`[CALL] Available calls:`, Array.from(activeCalls.keys()))
          return
        }
        
        console.log(`[CALL] ✅ Found call with status: ${call.status}`)
        console.log(`[CALL] Call participants:`, Array.from(call.participants))
        console.log(`[CALL] Caller ID: ${call.callerId}`)
        console.log(`[CALL] Is this the caller? ${call.callerId === data.participantId}`)
        
        // CRITICAL: Check for self-call scenario
        if (call.participants.has(data.participantId) && call.callerId === data.participantId) {
          console.log(`[CALL] 🚨 DETECTED SELF-CALL SCENARIO - CALLER TRYING TO ACCEPT OWN CALL!`)
          console.log(`[CALL] This should not happen. Ignoring call_response.`)
          return
        }
        
        if (data.accepted) {
          // Add participant to call
          call.participants.add(data.participantId)
          
          // ENHANCED: Initialize participant state tracking
          if (!call.participantStates) {
            call.participantStates = new Map()
          }
          call.participantStates.set(data.participantId, 'connecting')
          
          // CRITICAL: Ensure participant is in ALL necessary rooms
          socket.join(`call:${data.callId}`)
          socket.join(`user:${data.participantId}`)
          socket.join(`conversation:${data.conversationId}`)
          
          console.log(`[CALL] Participant ${data.participantId} joined ALL rooms: call:${data.callId}, user:${data.participantId}, conversation:${data.conversationId}`)
          console.log(`[CALL] Call ${data.callId} now has ${call.participants.size} participants:`, Array.from(call.participants))
          
          // Verify room memberships
          const callRoom = io.sockets.adapter.rooms.get(`call:${data.callId}`)
          const userRoom = io.sockets.adapter.rooms.get(`user:${data.participantId}`)
          const conversationRoom = io.sockets.adapter.rooms.get(`conversation:${data.conversationId}`)
          console.log(`[CALL] Room verification - Call: ${callRoom?.size || 0}, User: ${userRoom?.size || 0}, Conversation: ${conversationRoom?.size || 0}`)
          
          // CRITICAL FIX: Immediately transition to connecting when call is accepted
          // This allows WebRTC initialization to proceed properly
          call.status = 'connecting'
          console.log(`[CALL] Call ${data.callId} accepted - transitioning to connecting state for WebRTC initialization`)
          
          // CRITICAL: Immediately broadcast the state change to all participants
          const connectingStateData = {
            callId: data.callId,
            status: 'connecting',
            participantCount: call.participants.size
          }
          io.to(`call:${data.callId}`).emit('call_state_update', connectingStateData)
          io.to(`conversation:${data.conversationId}`).emit('call_state_update', connectingStateData)
          call.participants.forEach(participantId => {
            io.to(`user:${participantId}`).emit('call_state_update', connectingStateData)
          })
          console.log(`[CALL] 📡 Broadcasted connecting state to all participants`)
          
          // Clear timeout since call is now being accepted
          if (call.timeoutId) {
            clearTimeout(call.timeoutId)
            delete call.timeoutId
            console.log(`[CALL] Cleared timeout for accepted call ${data.callId}`)
          }
          
          // Get current room members for verification
          const currentCallRoom = io.sockets.adapter.rooms.get(`call:${data.callId}`)
          const callRoomSize = currentCallRoom ? currentCallRoom.size : 0
          console.log(`[CALL] Call room call:${data.callId} now has ${callRoomSize} socket connections`)
          
          // Notify ALL participants in the call about the new participant (including the joiner)
          console.log(`[CALL] Broadcasting participant_joined to all participants in call:${data.callId}`)
          const participantJoinedData = {
            callId: data.callId,
            participantId: data.participantId,
            participantCount: call.participants.size
          }
          
          io.to(`call:${data.callId}`).emit('participant_joined', participantJoinedData)
          
          // Also notify the conversation room (for any listeners not in call yet)
          socket.to(`conversation:${data.conversationId}`).emit('participant_joined', participantJoinedData)
          
          console.log(`[CALL] participant_joined event sent with data:`, participantJoinedData)
          
          // ENHANCED: Broadcast individual participant state update
          const participantStateData = {
            callId: data.callId,
            participantId: data.participantId,
            state: 'connecting' as const
          }
          
          io.to(`call:${data.callId}`).emit('participant_state_update', participantStateData)
          io.to(`conversation:${call.conversationId}`).emit('participant_state_update', participantStateData)
          
          call.participants.forEach(participantId => {
            io.to(`user:${participantId}`).emit('participant_state_update', participantStateData)
          })
          
          console.log(`[CALL] ✅ Participant state update broadcasted: ${data.participantId} -> connecting`)
        } else {
          // Handle declined call
          console.log(`[CALL] Call declined by ${data.participantId}`)
          console.log(`[CALL] Current participants in call:`, Array.from(call.participants))
          
          // For 1-on-1 calls or when the only other participant declines, end the call
          if (!call.isGroupCall || call.participants.size === 1) {
            console.log(`[CALL] Ending call due to decline - isGroupCall: ${call.isGroupCall}, participants: ${call.participants.size}`)
            
            // Clear timeout if exists
            if (call.timeoutId) {
              clearTimeout(call.timeoutId)
              delete call.timeoutId
            }
            
            // Create declined call trace using centralized function (non-blocking)
            createCallTrace(call, 'declined', 0, io).catch((error) => {
              console.error(`[CALL] Failed to create declined call trace:`, error)
            })
            
            // Immediately emit call_ended to ALL participants and conversation members
            const endCallData = {
              conversationId: data.conversationId,
              callId: data.callId,
              reason: 'declined'
            }
            
            // Force end for all participants in call room
            io.to(`call:${data.callId}`).emit('call_ended', endCallData)
            
            // Force end for all members in conversation
            io.to(`conversation:${data.conversationId}`).emit('call_ended', endCallData)
            
            // Also notify the caller and decliner directly via their user rooms AND individual sockets
            console.log(`[CALL] 🎯 Sending call_ended to caller via user room: user:${call.callerId}`)
            io.to(`user:${call.callerId}`).emit('call_ended', endCallData)
            
            console.log(`[CALL] 🎯 Sending call_ended to decliner via user room: user:${data.participantId}`)
            io.to(`user:${data.participantId}`).emit('call_ended', endCallData)
            
            // BACKUP: Direct socket emission to both parties
            const callerSockets = Array.from(io.sockets.sockets.values())
              .filter(s => s.data.userId === call.callerId)
            console.log(`[CALL] Found ${callerSockets.length} caller sockets for direct notification`)
            callerSockets.forEach(callerSocket => {
              callerSocket.emit('call_ended', endCallData)
              console.log(`[CALL] ✅ Sent call_ended directly to caller socket ${callerSocket.id}`)
            })
            
            const declinerSockets = Array.from(io.sockets.sockets.values())
              .filter(s => s.data.userId === data.participantId)
            console.log(`[CALL] Found ${declinerSockets.length} decliner sockets for direct notification`)
            declinerSockets.forEach(declinerSocket => {
              declinerSocket.emit('call_ended', endCallData)
              console.log(`[CALL] ✅ Sent call_ended directly to decliner socket ${declinerSocket.id}`)
            })
            
            // Force all participants to leave call room
            const callRoom = io.sockets.adapter.rooms.get(`call:${data.callId}`)
            if (callRoom) {
              callRoom.forEach(socketId => {
                const socket = io.sockets.sockets.get(socketId)
                if (socket) {
                  socket.leave(`call:${data.callId}`)
                  console.log(`[CALL] Forced socket ${socketId} to leave call room due to decline`)
                }
              })
            }
            
            activeCalls.delete(data.callId)
            console.log(`[CALL] ✅ Call ${data.callId} deleted from active calls`)
            console.log(`[CALL] Active calls remaining: ${activeCalls.size}`)
          }
        }
        
        // Broadcast the response via multiple channels for reliability
        const responseData = {
          ...data,
          participantCount: call.participants.size,
          callStatus: call.status
        }
        
        // Broadcast to conversation room
        io.to(`conversation:${data.conversationId}`).emit('call_response', responseData)
        
        // Direct notification to all participants via their user rooms
        call.participants.forEach(participantId => {
          io.to(`user:${participantId}`).emit('call_response', responseData)
        })
        
        // Additional broadcast to call room
        io.to(`call:${data.callId}`).emit('call_response', responseData)
        
        console.log(`[CALL] Multi-channel call_response broadcasted:`, responseData)
      })

      socket.on('end_call', async (data: {
        conversationId: string
        callId: string
        participantId: string
      }) => {
        console.log(`[CALL] User ${data.participantId} ending call ${data.callId}`)
        
        const call = activeCalls.get(data.callId)
        if (call) {
          // Remove participant from call and ready list
          call.participants.delete(data.participantId)
          if (call.readyParticipants) {
            call.readyParticipants.delete(data.participantId)
          }
          
          // ENHANCED: Remove from participant states and broadcast update
          if (call.participantStates) {
            call.participantStates.delete(data.participantId)
          }
          
          // Broadcast participant state disconnection
          const participantStateData = {
            callId: data.callId,
            participantId: data.participantId,
            state: 'disconnected' as const
          }
          
          io.to(`call:${data.callId}`).emit('participant_state_update', participantStateData)
          io.to(`conversation:${call.conversationId}`).emit('participant_state_update', participantStateData)
          socket.leave(`call:${data.callId}`)
          console.log(`[CALL] User ${data.participantId} left call room: call:${data.callId}`)
          console.log(`[CALL] Remaining participants: ${call.participants.size}`)
          
          // Check if call should end (less than 2 participants or caller left)
          const shouldEndCall = call.participants.size < 2 || data.participantId === call.callerId
          
          if (shouldEndCall) {
            console.log(`[CALL] Ending call ${data.callId} - reason: ${data.participantId === call.callerId ? 'caller left' : 'insufficient participants'}`)
            const endTime = Date.now()
            // ENHANCED: Better duration calculation with fallback logic
            let duration = 0
            
            if (call.status === 'connected' && call.connectedTime) {
              // Call was properly connected - calculate actual duration
              duration = Math.floor((endTime - call.connectedTime) / 1000)
              console.log(`[CALL] Duration calculation: End(${endTime}) - Connected(${call.connectedTime}) = ${duration} seconds`)
            } else if (call.status === 'connecting' && call.connectingStartTime) {
              // Call was connecting but never reached connected state
              const connectingDuration = Math.floor((endTime - call.connectingStartTime) / 1000)
              console.log(`[CALL] Call ended during connecting phase after ${connectingDuration} seconds - marking as cancelled`)
              duration = 0 // Don't count connecting time as call duration
            } else {
              console.log(`[CALL] Call ended without proper connection - Status: ${call.status}, ConnectedTime: ${call.connectedTime}`)
              duration = 0
            }
            
            console.log(`[CALL] Final calculated duration for call ${data.callId}: ${duration} seconds`)
            
            // Create call trace using centralized function
            try {
              // Enhanced status logic for better tracing
              let callStatus: 'completed' | 'cancelled' = 'cancelled'
              
              if (call.status === 'connected' && duration > 0) {
                // Call was actually connected and had duration
                callStatus = 'completed'
              } else if (call.status === 'connected' && duration === 0) {
                // Connected but no meaningful duration (very short call)
                callStatus = 'completed' 
              } else {
                // Never properly connected or ended during setup
                callStatus = 'cancelled'
              }
              
              console.log(`[CALL] Trace status decision: ${callStatus} (was ${call.status}, duration: ${duration}s)`)
              await createCallTrace(call, callStatus, duration, io)
            } catch (error) {
              console.error(`[CALL] Failed to create call trace:`, error)
            }
            
            // Immediately notify all participants that call ended
            const endCallData = {
              conversationId: data.conversationId,
              callId: data.callId,
              reason: 'ended_by_participant'
            }
            
            // Force end for all participants in call room
            io.to(`call:${data.callId}`).emit('call_ended', endCallData)
            
            // Force end for all members in conversation
            io.to(`conversation:${data.conversationId}`).emit('call_ended', endCallData)
            
            // Force remaining participants to leave call room immediately
            const callRoom = io.sockets.adapter.rooms.get(`call:${data.callId}`)
            if (callRoom) {
              callRoom.forEach(socketId => {
                const socket = io.sockets.sockets.get(socketId)
                if (socket) {
                  socket.leave(`call:${data.callId}`)
                  // Also send direct call_ended to ensure they receive it
                  socket.emit('call_ended', endCallData)
                  console.log(`[CALL] Forced socket ${socketId} to leave call room and sent direct call_ended`)
                }
              })
            }
            
            // Also notify individual participants via their user rooms
            const remainingParticipants = Array.from(call.participants)
            remainingParticipants.forEach(participantId => {
              io.to(`user:${participantId}`).emit('call_ended', endCallData)
              console.log(`[CALL] Sent call_ended to user room: user:${participantId}`)
            })
            
            activeCalls.delete(data.callId)
            console.log(`[CALL] ✅ Call ${data.callId} deleted from active calls`)
            console.log(`[CALL] Active calls remaining: ${activeCalls.size}`)
          } else {
            // Just notify remaining participants that someone left
            console.log(`[CALL] Participant left, but call continues with ${call.participants.size} participants`)
            io.to(`call:${data.callId}`).emit('participant_left', {
              callId: data.callId,
              participantId: data.participantId,
              participantCount: call.participants.size
            })
          }
        } else {
          console.log(`[CALL] Call ${data.callId} not found when trying to end`)
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

      socket.on('webrtc_stream_ready', (data: {
        callId: string
        participantId: string
        streamId: string
        hasAudio?: boolean
        hasVideo?: boolean
      }) => {
        console.log(`\n🎥 [WebRTC] STREAM_READY EVENT RECEIVED!`)
        console.log(`[WebRTC] Socket ID: ${socket.id}`)
        console.log(`[WebRTC] Socket User ID: ${socket.data.userId}`)
        console.log(`[WebRTC] Data received:`, JSON.stringify(data, null, 2))
        console.log(`[WebRTC] Active calls:`, Array.from(activeCalls.keys()))
        
        const call = activeCalls.get(data.callId)
        if (!call) {
          console.log(`[CALL] ❌ Call ${data.callId} not found when stream ready`)
          console.log(`[CALL] Available calls:`, Array.from(activeCalls.keys()))
          return
        }
        
        console.log(`[WebRTC] ✅ Call found - status: ${call.status}, participants: ${call.participants.size}`)
        console.log(`[WebRTC] Call participants:`, Array.from(call.participants))
        
        // Initialize readyParticipants set if it doesn't exist
        if (!call.readyParticipants) {
          call.readyParticipants = new Set()
        }
        
        // Mark this participant as ready
        call.readyParticipants.add(socket.data.userId)
        console.log(`[CALL] Participant ${socket.data.userId} marked as ready. Ready: ${call.readyParticipants.size}/${call.participants.size}`)
        console.log(`[CALL] Ready participants:`, Array.from(call.readyParticipants))
        console.log(`[CALL] Total participants:`, Array.from(call.participants))
        
        // FIXED: Only transition to connecting when enough participants are ready AND minimum ringing time has passed
        // For 1-on-1 calls: need 2 participants ready (caller + recipient)
        // For group calls: need at least 2 participants ready to start connecting
        // ENHANCED: Support single-participant testing mode for development
        const isTestMode = process.env.NODE_ENV !== 'production' 
        const baseMinParticipants = call.isGroupCall ? 2 : 2
        const minReadyParticipants = isTestMode ? 1 : baseMinParticipants; // Allow single participant in development
        const minRingingDuration = 2000; // Minimum 2 seconds of ringing for better UX
        const ringingDuration = Date.now() - (call.ringingStartTime || call.startTime);
        
        console.log(`[CALL] 🔍 Transition check: status=${call.status}, ready=${call.readyParticipants.size}/${call.participants.size}, required=${minReadyParticipants}, ringing=${ringingDuration}ms, testMode=${isTestMode}`)
        
        if (call.status === 'ringing' && 
            call.readyParticipants.size >= minReadyParticipants && 
            ringingDuration >= minRingingDuration) {
          // Enough participants ready and minimum ringing time passed - start WebRTC negotiation
          call.status = 'connecting'  
          call.connectingStartTime = Date.now() // Track when connecting started
          console.log(`[CALL] 🔄 ${call.readyParticipants.size}/${call.participants.size} participants ready after ${ringingDuration}ms ringing! Transitioning call ${data.callId} to CONNECTING state (test mode: ${isTestMode})`)
          
          // ENHANCED: Set timeout to prevent indefinite connecting state
          const connectingTimeout = setTimeout(() => {
            const currentCall = activeCalls.get(data.callId)
            if (currentCall && currentCall.status === 'connecting') {
              const connectingDuration = Date.now() - (currentCall.connectingStartTime || currentCall.startTime)
              console.log(`[CALL] ⚠️ Call ${data.callId} stuck in connecting for ${connectingDuration}ms, forcing timeout`)
              
              // End the call due to connection timeout
              const timeoutData = {
                conversationId: currentCall.conversationId,
                callId: data.callId,
                reason: 'connection_timeout'
              }
              
              // Clean up and broadcast call ended
              activeCalls.delete(data.callId)
              io.to(`call:${data.callId}`).emit('call_ended', timeoutData)
              io.to(`conversation:${currentCall.conversationId}`).emit('call_ended', timeoutData)
              
              currentCall.participants.forEach(participantId => {
                io.to(`user:${participantId}`).emit('call_ended', timeoutData)
              })
              
              console.log(`[CALL] ✅ Call ${data.callId} ended due to connection timeout`)
            }
          }, 30000) // 30 second timeout for connecting state
          
          // Store timeout reference for cleanup
          call.connectingTimeoutId = connectingTimeout
          
          // Broadcast connecting state
          const connectingStateData = {
            callId: data.callId,
            status: 'connecting',
            participantCount: call.participants.size
          }
          
          // Multi-channel broadcast of connecting state with enhanced synchronization
          io.to(`call:${data.callId}`).emit('call_state_update', connectingStateData)
          io.to(`conversation:${call.conversationId}`).emit('call_state_update', connectingStateData)
          
          call.participants.forEach(participantId => {
            io.to(`user:${participantId}`).emit('call_state_update', connectingStateData)
            
            // ENHANCED: Also send direct to all participant sockets for maximum reliability
            const participantSockets = Array.from(io.sockets.sockets.values())
              .filter(s => s.data.userId === participantId)
            participantSockets.forEach(ps => {
              ps.emit('call_state_update', connectingStateData)
              console.log(`[CALL] 📡 Sent CONNECTING state direct to socket ${ps.id} for user ${participantId}`)
            })
          })
          
          console.log(`[CALL] ✅ CONNECTING state broadcasted to all participants via multiple channels`)
          
          // ENHANCED: Initialize participant states to connecting
          if (!call.participantStates) {
            call.participantStates = new Map()
          }
          
          call.participants.forEach(participantId => {
            const participantStateData = {
              callId: data.callId,
              participantId: participantId,
              state: 'connecting' as const
            }
            
            // Update internal state
            call.participantStates.set(participantId, 'connecting')
            
            // Broadcast participant state
            io.to(`call:${data.callId}`).emit('participant_state_update', participantStateData)
            io.to(`conversation:${call.conversationId}`).emit('participant_state_update', participantStateData)
            io.to(`user:${participantId}`).emit('participant_state_update', participantStateData)
            
            console.log(`[CALL] ✅ Participant state initialized: ${participantId} -> connecting`)
          })
          
          // ENHANCED: Add a redundant broadcast after a short delay to catch any missed updates
          setTimeout(() => {
            console.log(`[CALL] 🔄 Redundant CONNECTING state broadcast for maximum reliability`)
            io.to(`call:${data.callId}`).emit('call_state_update', connectingStateData)
            call.participants.forEach(participantId => {
              const participantSockets = Array.from(io.sockets.sockets.values())
                .filter(s => s.data.userId === participantId)
              participantSockets.forEach(ps => ps.emit('call_state_update', connectingStateData))
            })
          }, 500)
        }
        
        // Check if we can transition to connected (when we have enough participants ready)
        // For 1-on-1 calls: need both participants ready (or 1 in test mode)
        // For group calls: need at least 2 participants ready
        let shouldConnect = false
        if (call.participants.size === 2) {
          // 1-on-1 call - need both participants ready (or 1 in test mode)
          shouldConnect = isTestMode ? call.readyParticipants.size >= 1 : call.readyParticipants.size >= 2
        } else if (call.participants.size > 2) {
          // Group call - need at least 2 participants ready
          shouldConnect = call.readyParticipants.size >= 2
        } else {
          // Edge case - single participant (shouldn't happen in normal flow)
          shouldConnect = call.readyParticipants.size >= 1
        }
        
        const isConnectingState = call.status === 'connecting'
        
        console.log(`[CALL] Connection check - Ready: ${call.readyParticipants.size}/${call.participants.size}, Should connect: ${shouldConnect}, Is connecting: ${isConnectingState}`)
        
        if (isConnectingState && shouldConnect) {
          // Add a small delay to ensure users see the "connecting" state
          setTimeout(() => {
            if (call.status === 'connecting') { // Double-check state hasn't changed
              call.status = 'connected'
              call.connectedTime = Date.now()
              console.log(`[CALL] 🚀 Call ${data.callId} PROPERLY updated to CONNECTED after delay - ALL ${call.participants.size} participants ready`)
              
              // Immediately broadcast connected state via all channels
              const connectedStateData = {
                callId: data.callId,
                status: 'connected',
                participantCount: call.participants.size
              }
              
              console.log(`[CALL] 📡 BROADCASTING CONNECTED STATE:`, connectedStateData)
              
              // Multi-channel broadcast for maximum reliability
              io.to(`call:${data.callId}`).emit('call_state_update', connectedStateData)
              io.to(`conversation:${call.conversationId}`).emit('call_state_update', connectedStateData)
              
              // Direct notification to each participant via multiple methods
              call.participants.forEach(participantId => {
                // Method 1: User room
                io.to(`user:${participantId}`).emit('call_state_update', connectedStateData)
                
                // Method 2: Direct socket emission
                const participantSockets = Array.from(io.sockets.sockets.values())
                  .filter(s => s.data.userId === participantId)
                participantSockets.forEach(ps => {
                  ps.emit('call_state_update', connectedStateData)
                  console.log(`[CALL] 📡 Sent CONNECTED state direct to socket ${ps.id} for user ${participantId}`)
                })
              })
              
              console.log(`[CALL] ✅ CONNECTED state broadcasted to ALL channels properly`)
              
              // CRITICAL: Also update individual participant states to connected
              if (!call.participantStates) {
                call.participantStates = new Map()
              }
              
              call.participants.forEach(participantId => {
                const participantStateData = {
                  callId: data.callId,
                  participantId: participantId,
                  state: 'connected' as const
                }
                
                // Update internal state
                call.participantStates.set(participantId, 'connected')
                
                console.log(`[CALL] 📡 EMITTING participant_state_update for ${participantId} -> connected`)
                // Broadcast to all channels
                io.to(`call:${data.callId}`).emit('participant_state_update', participantStateData)
                io.to(`conversation:${call.conversationId}`).emit('participant_state_update', participantStateData)
                io.to(`user:${participantId}`).emit('participant_state_update', participantStateData)
                
                console.log(`[CALL] ✅ Participant state update broadcasted: ${participantId} -> connected`)
              })
            }
          }, 500) // Reduced delay for faster connection
        } else {
          console.log(`[CALL] ⚠️ Not transitioning to connected - Status: ${call.status}, Ready: ${call.readyParticipants.size}/${call.participants.size}`)
        }
        
        // CRITICAL FIX: For 1-on-1 calls, force transition to connected when both participants have sent webrtc_stream_ready
        if (call.participants.size === 2 && call.readyParticipants.size >= 2 && call.status === 'connecting') {
          console.log(`[CALL] 🔥 BOTH PARTICIPANTS READY - Force transitioning to connected immediately`)
          call.status = 'connected'
          call.connectedTime = Date.now()
          
          const connectedStateData = {
            callId: data.callId,
            status: 'connected',
            participantCount: call.participants.size
          }
          
          // Immediate broadcast to all participants
          io.to(`call:${data.callId}`).emit('call_state_update', connectedStateData)
          io.to(`conversation:${call.conversationId}`).emit('call_state_update', connectedStateData)
          
          // ENHANCED: Initialize participant states map if needed
          if (!call.participantStates) {
            call.participantStates = new Map()
          }
          
          call.participants.forEach(participantId => {
            io.to(`user:${participantId}`).emit('call_state_update', connectedStateData)
            
            // ENHANCED: Also update individual participant states to connected
            const participantStateData = {
              callId: data.callId,
              participantId: participantId,
              state: 'connected' as const
            }
            
            // Update internal state
            call.participantStates.set(participantId, 'connected')
            
            console.log(`[CALL] 📡 EMITTING participant_state_update (force) for ${participantId} -> connected`)
            io.to(`call:${data.callId}`).emit('participant_state_update', participantStateData)
            io.to(`conversation:${call.conversationId}`).emit('participant_state_update', participantStateData)
            io.to(`user:${participantId}`).emit('participant_state_update', participantStateData)
          })
          
          console.log(`[CALL] 🚀 IMMEDIATE CONNECTED state broadcasted - both participants ready!`)
        }
        
        // Notify all participants via multiple channels that a stream is ready
        const streamReadyData = {
          callId: data.callId,
          participantId: socket.data.userId,
          streamId: data.streamId,
          hasAudio: data.hasAudio,
          hasVideo: data.hasVideo
        }
        
        // OPTIMIZED: Only broadcast to OTHER participants to avoid self-notification
        console.log(`[WebRTC] Broadcasting stream_ready to OTHER participants only`)
        console.log(`[WebRTC] Sender: ${socket.data.userId}`)
        console.log(`[WebRTC] Total participants: ${call?.participants ? Array.from(call.participants) : 'none'}`)
        
        // Direct notification to each OTHER participant only
        if (call) {
          const otherParticipants = Array.from(call.participants).filter(participantId => participantId !== socket.data.userId)
          console.log(`[WebRTC] Other participants to notify: ${otherParticipants}`)
          
          otherParticipants.forEach(participantId => {
            io.to(`user:${participantId}`).emit('webrtc_stream_ready', streamReadyData)
            console.log(`[WebRTC] ✅ Sent webrtc_stream_ready to participant: ${participantId}`)
          })
          
          // BACKUP: Also broadcast to call room but sender will ignore it in CallModal
          io.to(`call:${data.callId}`).emit('webrtc_stream_ready', streamReadyData)
          console.log(`[WebRTC] ✅ Sent webrtc_stream_ready to call room (sender will ignore)`)
        }
        
        console.log(`[WebRTC] Stream ready broadcasted via all channels:`, streamReadyData)
      })

      // Handle WebRTC connection failures to prevent stuck states
      socket.on('webrtc_connection_failed', (data: { callId: string; participantId: string }) => {
        console.log(`\n❌ [WebRTC] CONNECTION_FAILED for participant: ${data.participantId}`)
        
        const call = activeCalls.get(data.callId)
        if (call && call.status === 'connecting') {
          console.log(`[WebRTC] Call ${data.callId} stuck in connecting due to connection failure`)
          // Don't transition back to disconnected immediately - wait for recovery
        }
      })
      
      socket.on('webrtc_connection_disconnected', (data: { callId: string; participantId: string }) => {
        console.log(`\n🔌 [WebRTC] CONNECTION_DISCONNECTED for participant: ${data.participantId}`)
        
        const call = activeCalls.get(data.callId)
        if (call && call.status === 'connected') {
          console.log(`[WebRTC] Call ${data.callId} may need to transition back to connecting`)
          // Don't immediately change state - wait for reconnection attempt
        }
      })

      // Handle WebRTC peer connected (when individual peer connections are established)
      socket.on('webrtc_peer_connected', (data: { callId: string; participantId: string; verified?: boolean; hasMedia?: boolean }) => {
        console.log(`\n🔗 [WebRTC] PEER_CONNECTED RECEIVED!`)
        console.log(`[WebRTC] Call ID: ${data.callId}`)
        console.log(`[WebRTC] Participant: ${data.participantId}`)
        console.log(`[WebRTC] Verified: ${data.verified}`)
        console.log(`[WebRTC] Has Media: ${data.hasMedia}`)
        console.log(`[WebRTC] Socket User ID: ${socket.data.userId}`)
        
        const call = activeCalls.get(data.callId)
        if (!call) {
          console.log(`[WebRTC] Call ${data.callId} not found for peer_connected`)
          return
        }
        
        console.log(`[WebRTC] Current call status: ${call.status}`)
        
        // Only transition to connected if this is a verified stable connection
        if (call.status === 'connecting' && data.verified) {
          console.log(`[WebRTC] Verified stable peer connected! Transitioning call ${data.callId} to connected`)
          
          // Clear connecting timeout since we're now connected
          if (call.connectingTimeoutId) {
            clearTimeout(call.connectingTimeoutId)
            delete call.connectingTimeoutId
            console.log(`[WebRTC] Cleared connecting timeout for successful connection`)
          }
          
          // ENHANCED: Initialize participant states map if needed
          if (!call.participantStates) {
            call.participantStates = new Map()
          }
          
          call.status = 'connected'
          call.connectedTime = Date.now()
          
          const connectedStateData = {
            callId: data.callId,
            status: 'connected',
            participantCount: call.participants.size
          }
          
          // Multi-channel broadcast to ensure all participants get the update
          io.to(`call:${data.callId}`).emit('call_state_update', connectedStateData)
          io.to(`conversation:${call.conversationId}`).emit('call_state_update', connectedStateData)
          
          call.participants.forEach(participantId => {
            io.to(`user:${participantId}`).emit('call_state_update', connectedStateData)
            
            // Also send directly to participant sockets
            const participantSockets = Array.from(io.sockets.sockets.values())
              .filter(s => s.data.userId === participantId)
            participantSockets.forEach(ps => {
              ps.emit('call_state_update', connectedStateData)
            })
          })
          
          console.log(`[WebRTC] ✅ Connected state broadcast completed via webrtc_peer_connected`)
          
          // ENHANCED: Broadcast participant state updates for ALL participants
          // When one peer connects, both participants should show as connected
          console.log(`[WebRTC] 📡 Broadcasting connected state for ALL participants in call ${data.callId}`)
          call.participants.forEach(participantId => {
            const participantStateData = {
              callId: data.callId,
              participantId: participantId,
              state: 'connected' as const
            }
            
            // Update the internal state tracking
            call.participantStates.set(participantId, 'connected')
            
            console.log(`[WebRTC] 📡 EMITTING participant_state_update for ${participantId} -> connected`)
            // Broadcast to all channels
            io.to(`call:${data.callId}`).emit('participant_state_update', participantStateData)
            io.to(`conversation:${call.conversationId}`).emit('participant_state_update', participantStateData)
            io.to(`user:${participantId}`).emit('participant_state_update', participantStateData)
            
            console.log(`[WebRTC] ✅ Participant state update broadcasted: ${participantId} -> connected`)
          })
        } else if (call.status === 'ringing' && 
                   call.readyParticipants && call.readyParticipants.size >= 2) {
          // Participants are ready but minimum ringing time might not have passed - check and set timeout if needed
          const minRingingDuration = 2000; // Minimum 2 seconds of ringing for better UX
          const ringingDuration = Date.now() - (call.ringingStartTime || call.startTime);
          
          if (ringingDuration < minRingingDuration) {
            const remainingRingingTime = minRingingDuration - ringingDuration;
            console.log(`[CALL] Participants ready but need to ring for ${remainingRingingTime}ms more. Setting timeout.`);
          
          setTimeout(() => {
            const currentCall = activeCalls.get(data.callId);
            if (currentCall && currentCall.status === 'ringing' && currentCall.readyParticipants.size >= 2) {
              console.log(`[CALL] 🔄 Minimum ringing time passed, transitioning to connecting now`);
              currentCall.status = 'connecting';
              
              const connectingStateData = {
                callId: data.callId,
                status: 'connecting',
                participantCount: currentCall.participants.size
              };
              
              // Multi-channel broadcast of connecting state
              io.to(`call:${data.callId}`).emit('call_state_update', connectingStateData);
              io.to(`conversation:${currentCall.conversationId}`).emit('call_state_update', connectingStateData);
              
              currentCall.participants.forEach(participantId => {
                io.to(`user:${participantId}`).emit('call_state_update', connectingStateData);
              });
              
              console.log(`[CALL] ✅ Delayed transition to connecting completed`);
            }
          }, remainingRingingTime);
          }
        }
      })

      // Handle WebRTC call ready signal (when WebRTC connections are established)
      socket.on('webrtc_call_ready', (data: { callId: string; connectedPeers: number; peersWithStreams: number }) => {
        console.log(`\n🚀 [WebRTC] CALL_READY SIGNAL RECEIVED!`)
        console.log(`[WebRTC] Call ID: ${data.callId}`)
        console.log(`[WebRTC] Connected peers: ${data.connectedPeers}`)
        console.log(`[WebRTC] Peers with streams: ${data.peersWithStreams}`)
        console.log(`[WebRTC] Socket User ID: ${socket.data.userId}`)
        
        const call = activeCalls.get(data.callId)
        if (!call) {
          console.log(`[WebRTC] Call ${data.callId} not found for call_ready signal`)
          return
        }
        
        console.log(`[WebRTC] Current call status: ${call.status}`)
        console.log(`[WebRTC] Participants: ${call.participants.size}`)
        
        // Only transition to connected if we're still in connecting state and have WebRTC ready
        if (call.status === 'connecting' && data.connectedPeers > 0 && data.peersWithStreams > 0) {
          console.log(`[WebRTC] WebRTC ready! Transitioning call ${data.callId} to connected`)
          call.status = 'connected'
          call.connectedTime = Date.now()
          
          const connectedStateData = {
            callId: data.callId,
            status: 'connected',
            participantCount: call.participants.size
          }
          
          // Multi-channel broadcast
          io.to(`call:${data.callId}`).emit('call_state_update', connectedStateData)
          io.to(`conversation:${call.conversationId}`).emit('call_state_update', connectedStateData)
          
          call.participants.forEach(participantId => {
            io.to(`user:${participantId}`).emit('call_state_update', connectedStateData)
          })
          
          // ENHANCED: Also broadcast individual participant states
          if (!call.participantStates) {
            call.participantStates = new Map()
          }
          
          call.participants.forEach(participantId => {
            const participantStateData = {
              callId: data.callId,
              participantId: participantId,
              state: 'connected' as const
            }
            
            // Update the internal state tracking
            call.participantStates.set(participantId, 'connected')
            
            // Broadcast to all channels
            io.to(`call:${data.callId}`).emit('participant_state_update', participantStateData)
            io.to(`conversation:${call.conversationId}`).emit('participant_state_update', participantStateData)
            io.to(`user:${participantId}`).emit('participant_state_update', participantStateData)
            
            console.log(`[WebRTC] ✅ Participant state update broadcasted via call_ready: ${participantId} -> connected`)
          })
          
          console.log(`[WebRTC] ✅ Connected state broadcast completed via webrtc_call_ready`)
        } else {
          console.log(`[WebRTC] Not transitioning - status: ${call.status}, peers: ${data.connectedPeers}, streams: ${data.peersWithStreams}`)
        }
      })

      // Handle participant mute state changes
      socket.on('participant_mute_change', (data: { callId: string; participantId: string; isMuted: boolean }) => {
        console.log(`\n🔇 [CALL] PARTICIPANT_MUTE_CHANGE: ${data.participantId} muted: ${data.isMuted}`)
        
        const call = activeCalls.get(data.callId)
        if (!call) {
          console.log(`[CALL] Call ${data.callId} not found for mute change`)
          return
        }
        
        // Broadcast mute state change to all participants in the call
        const muteStateData = {
          callId: data.callId,
          participantId: data.participantId,
          isMuted: data.isMuted
        }
        
        console.log(`[CALL] Broadcasting mute change to all participants:`, muteStateData)
        
        // Send to call room and conversation
        io.to(`call:${data.callId}`).emit('participant_mute_change', muteStateData)
        io.to(`conversation:${call.conversationId}`).emit('participant_mute_change', muteStateData)
        
        // Also send to individual participants
        call.participants.forEach(participantId => {
          io.to(`user:${participantId}`).emit('participant_mute_change', muteStateData)
        })
        
        console.log(`[CALL] ✅ Mute state broadcasted to all participants`)
      })

      // Handle force call connected (fallback for stuck connecting states)
      socket.on('force_call_connected', (data: { callId: string }) => {
        console.log(`\n⚡ [CALL] FORCE_CALL_CONNECTED RECEIVED for call: ${data.callId}`)
        
        const call = activeCalls.get(data.callId)
        if (call) {
          console.log(`[CALL] Current call status: ${call.status}`)
          
          if (call.status === 'connecting') {
            console.log(`[CALL] Forcing call ${data.callId} to connected state`)
            call.status = 'connected'
            call.connectedTime = Date.now()
            
            const connectedStateData = {
              callId: data.callId,
              status: 'connected',
              participantCount: call.participants.size
            }
            
            // Multi-channel broadcast
            io.to(`call:${data.callId}`).emit('call_state_update', connectedStateData)
            io.to(`conversation:${call.conversationId}`).emit('call_state_update', connectedStateData)
            
            call.participants.forEach(participantId => {
              io.to(`user:${participantId}`).emit('call_state_update', connectedStateData)
            })
            
            console.log(`[CALL] ✅ Forced connected state broadcast completed`)
          } else {
            console.log(`[CALL] Call ${data.callId} is not in connecting state, ignoring force request`)
          }
        } else {
          console.log(`[CALL] Call ${data.callId} not found for force_call_connected`)
        }
      })

        socket.on('disconnect', async () => {
          console.log(`User disconnected: ${socket.id}`)
          
          // Handle active calls when user disconnects
          if (socket.data.userId) {
            // Find any active calls this user is in
            for (const [callId, call] of activeCalls.entries()) {
              if (call.participants.has(socket.data.userId)) {
                console.log(`[CALL] User ${socket.data.userId} disconnected during active call ${callId}`)
                
                // Remove user from call and ready list
                call.participants.delete(socket.data.userId)
                if (call.readyParticipants) {
                  call.readyParticipants.delete(socket.data.userId)
                }
                socket.leave(`call:${callId}`)
                
                // Check if call should end
                const shouldEndCall = call.participants.size < 2 || socket.data.userId === call.callerId
                console.log(`[CALL] DISCONNECT ANALYSIS - Call: ${callId}, Status: ${call.status}, Participants: ${call.participants.size}, Caller: ${call.callerId}, Disconnecting: ${socket.data.userId}, Should End: ${shouldEndCall}`)
                
                if (shouldEndCall) {
                  // Don't immediately end calls that are still in ringing/connecting state
                  // Give a grace period for reconnection or acceptance
                  if (call.status === 'ringing' || call.status === 'connecting') {
                    console.log(`[CALL] Call ${callId} participant disconnected during ${call.status} state - keeping call active for grace period`)
                    
                    // Set a longer grace period for calls that haven't fully connected yet
                    setTimeout(async () => {
                      const currentCall = activeCalls.get(callId)
                      if (currentCall && currentCall.participants.size < 2) {
                        console.log(`[CALL] Grace period expired, ending call ${callId} - participants: ${currentCall.participants.size}`)
                        
                        const endCallData = {
                          conversationId: currentCall.conversationId,
                          callId: callId,
                          reason: 'participant_disconnected_timeout'
                        }
                        
                        // Force end for all remaining participants
                        io.to(`call:${callId}`).emit('call_ended', endCallData)
                        io.to(`conversation:${currentCall.conversationId}`).emit('call_ended', endCallData)
                        
                        // Force cleanup call room
                        const callRoom = io.sockets.adapter.rooms.get(`call:${callId}`)
                        if (callRoom) {
                          callRoom.forEach(socketId => {
                            const participantSocket = io.sockets.sockets.get(socketId)
                            if (participantSocket) {
                              participantSocket.leave(`call:${callId}`)
                              participantSocket.emit('call_ended', endCallData)
                            }
                          })
                        }
                        
                        // CRITICAL FIX: Create call trace before deleting call
                        try {
                          await createCallTrace(currentCall, 'missed', 0, io)
                        } catch (error) {
                          console.error(`[CALL] Failed to create missed call trace for grace period timeout:`, error)
                        }
                        
                        activeCalls.delete(callId)
                      } else {
                        console.log(`[CALL] Grace period check - call ${callId} now has sufficient participants or was already cleaned up`)
                      }
                    }, 10000) // 10 second grace period
                  } else {
                    // For connected calls, end immediately as normal
                    console.log(`[CALL] Ending connected call ${callId} due to disconnect - participants: ${call.participants.size}`)
                    
                    const endCallData = {
                      conversationId: call.conversationId,
                      callId: callId,
                      reason: 'participant_disconnected'
                    }
                    
                    // Force end for all remaining participants
                    io.to(`call:${callId}`).emit('call_ended', endCallData)
                    io.to(`conversation:${call.conversationId}`).emit('call_ended', endCallData)
                    
                    // Force cleanup call room
                    const callRoom = io.sockets.adapter.rooms.get(`call:${callId}`)
                    if (callRoom) {
                      callRoom.forEach(socketId => {
                        const participantSocket = io.sockets.sockets.get(socketId)
                        if (participantSocket) {
                          participantSocket.leave(`call:${callId}`)
                          participantSocket.emit('call_ended', endCallData)
                        }
                      })
                    }
                    
                    // CRITICAL FIX: Create call trace before deleting call
                    ;(async () => {
                      try {
                        // Calculate duration if call was connected
                        let duration = 0
                        if (call.status === 'connected' && call.connectedTime) {
                          duration = Math.floor((Date.now() - call.connectedTime) / 1000)
                        }
                        
                        const traceStatus = call.status === 'connected' && duration > 0 ? 'completed' : 'cancelled'
                        await createCallTrace(call, traceStatus, duration, io)
                      } catch (error) {
                        console.error(`[CALL] Failed to create call trace for immediate end:`, error)
                      }
                    })()
                    
                    activeCalls.delete(callId)
                  }
                } else {
                  // Just notify remaining participants that someone left
                  io.to(`call:${callId}`).emit('participant_left', {
                    callId: callId,
                    participantId: socket.data.userId,
                    participantCount: call.participants.size
                  })
                }
              }
            }
            
            // Mark user as offline
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