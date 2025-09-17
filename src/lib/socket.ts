import { Server as NetServer } from 'http'
import { NextApiRequest, NextApiResponse } from 'next'
import { Server as ServerIO } from 'socket.io'
import { prisma } from './prisma'
import { CallCleanupManager } from './socket-cleanup'
import { CallLimitsManager } from './call-limits'
import { callCircuitBreaker } from './circuit-breaker'
import { CallQualityMonitor } from './call-quality-monitor'
import { socketLogger, callLogger } from './logger'

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

// Initialize cleanup manager for memory leak prevention
let cleanupManager: CallCleanupManager | null = null

// Initialize quality monitor for call monitoring
let qualityMonitor: CallQualityMonitor | null = null

// ENHANCED: Participant heartbeat tracking for health monitoring
const participantHeartbeats = new Map<string, { lastSeen: number; callId: string; userId: string }>()
const HEARTBEAT_INTERVAL = 10000 // 10 seconds
const HEARTBEAT_TIMEOUT = 25000 // 25 seconds - participant considered disconnected

// Heartbeat cleanup function
function cleanupStaleParticipants(io: ServerIO) {
  const now = Date.now()
  const staleParticipants: Array<{ userId: string; callId: string }> = []

  // Find stale participants
  for (const [heartbeatId, heartbeat] of participantHeartbeats.entries()) {
    if (now - heartbeat.lastSeen > HEARTBEAT_TIMEOUT) {
      staleParticipants.push({ userId: heartbeat.userId, callId: heartbeat.callId })
      participantHeartbeats.delete(heartbeatId)
    }
  }

  // Process stale participants
  staleParticipants.forEach(({ userId, callId }) => {
    const call = activeCalls.get(callId)
    if (call && call.participants.has(userId)) {
      console.log(`[HEARTBEAT] Participant ${userId} timed out in call ${callId}`)

      // Emit participant_left event
      const participantCountAfterLeaving = call.participants.size - 1
      io.to(`call:${callId}`).emit('participant_left', {
        callId,
        participantId: userId,
        participantCount: participantCountAfterLeaving,
        reason: 'heartbeat_timeout'
      })

      // Remove from call state
      call.participants.delete(userId)
      call.participantStates.delete(userId)
      if (call.readyParticipants) {
        call.readyParticipants.delete(userId)
      }

      console.log(`[HEARTBEAT] Removed timed-out participant ${userId}, remaining: ${call.participants.size}`)
    }
  })
}

// Start heartbeat monitoring
let heartbeatInterval: NodeJS.Timeout | null = null

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
    
    // Create trace message as regular message from caller
    const traceMessage = await prisma.message.create({
      data: {
        conversationId: call.conversationId,
        senderId: call.callerId,
        content: traceContent,
        type: 'call_trace'
      }
    })
    console.log(`[CALL] Created ${status} call trace message: ${traceMessage.id}`)
    
    // CRITICAL FIX: Update conversation timestamp to ensure it moves to top of sidebar
    await prisma.conversation.update({
      where: { id: call.conversationId },
      data: { updatedAt: new Date() }
    })
    console.log(`[CALL] Updated conversation timestamp for call trace: ${call.conversationId}`)
    
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
      // Emit as 'new-message' to ensure it's handled by useConversations and moves conversation to top
      io.to(`conversation:${call.conversationId}`).emit('new-message', {
        ...messageWithSender,
        status: 'sent'
      })
      console.log(`[CALL] ✅ Broadcasted ${status} call trace message via new-message event`)
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

// Global sequence counter for state updates
let stateSequenceCounter = 0

// ENHANCED: Calculate authoritative participant state
const calculateAuthoritativeParticipantState = (call: any, callId: string, io: any) => {
  const currentCallRoom = io.sockets.adapter.rooms.get(`call:${callId}`)
  const actualSocketCount = currentCallRoom ? currentCallRoom.size : 0

  // Calculate connected participants based on multiple sources
  const connectedFromStates = Array.from(call.participantStates.entries())
    .filter(([, state]) => state === 'connecting' || state === 'connected').length

  // Server authoritative count: use the room size as primary source
  // This represents actual WebSocket connections in the call room
  const authoritativeConnectedCount = Math.max(actualSocketCount, connectedFromStates)

  // Ensure count doesn't exceed total participants
  const finalConnectedCount = Math.min(authoritativeConnectedCount, call.participants.size)

  const authoritativeState = {
    callId: callId,
    status: call.status,
    participantCount: call.participants.size,
    connectedParticipants: finalConnectedCount,
    participantStates: Object.fromEntries(call.participantStates.entries()),
    allParticipants: Array.from(call.participants),
    sequenceNumber: ++stateSequenceCounter, // Sequence number to prevent race conditions
    serverTimestamp: Date.now(),
    authoritative: true, // Mark as authoritative server state
    roomSocketCount: actualSocketCount, // Debug info
    stateBasedCount: connectedFromStates // Debug info
  }

  console.log(`[CALL] 🏛️ AUTHORITATIVE STATE CALCULATION: {sockets: ${actualSocketCount}, states: ${connectedFromStates}, final: ${finalConnectedCount}, total: ${call.participants.size}, seq: ${authoritativeState.sequenceNumber}}`)

  return authoritativeState
}

export const initializeSocketIO = (req: NextApiRequest, res: NextApiResponseServerIO) => {
  if (!res.socket.server.io) {
    console.log('Initializing Socket.IO server...')
    
    try {
      // Initialize cleanup manager for memory leak prevention
      if (!cleanupManager) {
        cleanupManager = new CallCleanupManager(activeCalls, createdCallTraces);
        console.log('[CLEANUP] Memory leak prevention manager initialized');
      }

      // Initialize heartbeat monitoring for participant health
      if (!heartbeatInterval) {
        heartbeatInterval = setInterval(() => {
          cleanupStaleParticipants(io)
        }, HEARTBEAT_INTERVAL)
        console.log('[HEARTBEAT] Participant health monitoring initialized');
      }
      
      // Initialize quality monitor
      if (!qualityMonitor) {
        qualityMonitor = new CallQualityMonitor();
        console.log('[QUALITY] Call quality monitoring initialized');
      }
      
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
        socketLogger.debug(`NEW CONNECTION: ${socket.id}`, {
          transport: socket.conn.transport.name,
          userAgent: socket.handshake.headers['user-agent']?.substring(0, 50),
          clientIP: socket.handshake.address,
          activeCalls: activeCalls.size
        })
        
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
        
        // Debug: List all sockets in this conversation room
        if (conversationRoom) {
          console.log(`[SOCKET] All sockets in conversation:${conversationId}:`)
          conversationRoom.forEach(socketId => {
            const connectedSocket = io.sockets.sockets.get(socketId)
            if (connectedSocket) {
              console.log(`[SOCKET]   - ${socketId} (User: ${connectedSocket.data.userId || 'unknown'})`)
            }
          })
        }
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
        // Verify room membership
        const userRoom = io.sockets.adapter.rooms.get(`user:${userId}`)
        socketLogger.debug(`JOIN-USER-ROOM: user:${userId}`, {
          socketId: socket.id,
          roomSize: userRoom?.size || 0,
          socketRooms: Array.from(socket.rooms)
        })
        
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
          // Verify room membership
          const userRoom = io.sockets.adapter.rooms.get(`user:${userId}`)
          socketLogger.debug(`USER-ONLINE: ${userId}`, {
            socketId: socket.id,
            roomSize: userRoom?.size || 0,
            socketRooms: Array.from(socket.rooms)
          })
          
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
        console.log(`[CALL] Participant Count: ${data.participantCount}`)
        
        // CRITICAL: Validate call participants using limits manager
        const participantIds = [socket.data.userId]; // Start with caller
        // In a real implementation, we'd get all participants from the conversation
        
        const validation = CallLimitsManager.validateCallParticipants(
          participantIds,
          data.isGroupCall,
          'basic' // For now, all users are basic tier
        );
        
        if (!validation.allowed) {
          console.log(`[CALL] ❌ Call rejected: ${validation.reason}`);
          socket.emit('call_rejected', {
            reason: validation.reason,
            maxAllowed: validation.maxAllowed,
            upgradeMessage: CallLimitsManager.getUpgradeMessage(data.participantCount)
          });
          return;
        }
        
        console.log(`[CALL] ✅ Call validation passed - proceeding with ${validation.maxAllowed} max participants`);
        
        // ENHANCED: Use circuit breaker to protect against system overload
        try {
          await callCircuitBreaker.executeCall(async () => {
            // Validate system can handle another call
            if (activeCalls.size >= 100) {
              throw new Error('System at capacity - too many active calls');
            }
            return Promise.resolve();
          });
        } catch (error) {
          console.log(`[CALL] ❌ Circuit breaker blocked call: ${error instanceof Error ? error.message : String(error)}`);
          socket.emit('call_rejected', {
            reason: 'System temporarily unavailable - please try again later',
            isTemporary: true
          });
          return;
        }
        
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
          // FIX: Caller should be marked as 'connecting' since they initiated the call
          participantStates: new Map([[socket.data.userId, 'connecting']])
        }
        
        // ENHANCED: Store call metadata for proper trace generation later
        console.log(`[CALL] Call initiated - trace will be created based on call outcome`)
        
        // Store call state
        activeCalls.set(callId, callData)
        
        // Join call room  
        socket.join(`call:${callId}`)
        console.log(`[CALL] Caller ${socket.data.userId} joined call room: call:${callId}`)

        // ENHANCED: Set timeout for non-responding participants in group calls
        if (data.isGroupCall) {
          const RINGING_TIMEOUT = 15000; // 15 seconds
          const timeoutId = setTimeout(() => {
            const currentCall = activeCalls.get(callId)
            if (currentCall && currentCall.status === 'ringing') {
              console.log(`[CALL] Removing non-responding participants from group call ${callId} after ${RINGING_TIMEOUT}ms`)
              
              // Remove participants who are still in 'ringing' state
              const participantsToRemove = Array.from(currentCall.participantStates.entries())
                .filter(([participantId, state]) => 
                  state === 'ringing' && 
                  participantId !== socket.data.userId && // Don't remove the caller
                  Date.now() - currentCall.ringingStartTime > RINGING_TIMEOUT
                )
              
              for (const [participantId] of participantsToRemove) {
                currentCall.participants.delete(participantId)
                currentCall.participantStates.delete(participantId)
                
                // Notify that participant was removed due to no response
                io.to(`call:${callId}`).emit('participant_left', {
                  callId,
                  participantId,
                  reason: 'no_response',
                  participantCount: currentCall.participants.size
                })
                
                // Notify the removed participant
                io.to(`user:${participantId}`).emit('call_timeout', {
                  callId,
                  reason: 'no_response'
                })
                
                console.log(`[CALL] Removed non-responding participant ${participantId} from call ${callId}`)
              }
              
              // Update call state
              // FIX: Use actual call room participants for accurate count
              const ringingCallRoom = io.sockets.adapter.rooms.get(`call:${callId}`)
              const ringingActiveParticipants = ringingCallRoom ? ringingCallRoom.size : 0
              
              io.to(`call:${callId}`).emit('call_state_update', {
                callId,
                status: currentCall.status,
                participantCount: currentCall.participants.size,
                connectedParticipants: ringingActiveParticipants
              })
            }
          }, RINGING_TIMEOUT)
          
          callData.ringingTimeoutId = timeoutId
        }
        
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
        
        // CRITICAL FIX: Use database isGroup flag instead of participant count
        // Fetch conversation from database to get the authoritative isGroup flag
        try {
          const conversation = await prisma.conversation.findUnique({
            where: { id: data.conversationId },
            select: { 
              isGroup: true,
              participants: {
                select: { userId: true }
              }
            }
          })
          
          if (conversation) {
            const databaseIsGroup = conversation.isGroup
            console.log(`[CALL] 🔍 Database conversation.isGroup: ${databaseIsGroup}, client sent: ${callData.isGroupCall}`)
            
            if (callData.isGroupCall !== databaseIsGroup) {
              console.log(`[CALL] 🔧 CORRECTING isGroupCall: client sent ${callData.isGroupCall}, database says ${databaseIsGroup}`)
              callData.isGroupCall = databaseIsGroup
            }
            
            // CRITICAL FIX: For group calls, initialize ALL conversation participants
            if (databaseIsGroup) {
              const allParticipantIds = conversation.participants.map(p => p.userId)
              console.log(`[CALL] 🔧 Initializing group call with ALL ${allParticipantIds.length} database participants:`, allParticipantIds)
              
              // Initialize all participants in ringing state
              callData.participants = new Set(allParticipantIds)
              callData.participantStates = new Map()
              allParticipantIds.forEach(participantId => {
                // FIX: Caller should remain in 'connecting' state, others start as 'ringing'
                if (participantId === callData.callerId) {
                  callData.participantStates.set(participantId, 'connecting')
                } else {
                  callData.participantStates.set(participantId, 'ringing')
                }
              })
            }
            
            console.log(`[CALL] Final Group Call Status: ${callData.isGroupCall} (database authoritative)`)
            console.log(`[CALL] Call initialized with ${callData.participants.size} participants:`, Array.from(callData.participants))
          } else {
            console.log(`[CALL] ⚠️ Conversation ${data.conversationId} not found in database, using client data`)
          }
        } catch (error) {
          console.error(`[CALL] ❌ Error fetching conversation from database:`, error)
          console.log(`[CALL] Falling back to client isGroupCall: ${callData.isGroupCall}`)
        }
        
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

        // ENHANCED: Comprehensive call monitoring
        console.log(`[CALL] 📊 CALL CREATED MONITORING:`, {
          callId: callId,
          callerId: socket.data.userId,
          conversationId: data.conversationId,
          isGroupCall: callData.isGroupCall,
          participantCount: callData.participants.size,
          participantIds: Array.from(callData.participants),
          status: callData.status,
          roomSize: roomSize,
          activeCallsTotal: activeCalls.size,
          socketRooms: Array.from(socket.rooms).length,
          timestamp: Date.now()
        })
      })

      socket.on('call_response', async (data: {
        conversationId: string
        callId: string
        accepted: boolean
        participantId: string
      }) => {
        callLogger.info(`Call response: ${data.accepted ? 'ACCEPTED' : 'DECLINED'} by ${data.participantId}`, {
          callId: data.callId,
          socketUserId: socket.data.userId,
          socketId: socket.id,
          activeCalls: activeCalls.size,
          socketRooms: Array.from(socket.rooms).length
        })
        
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
          
          // CRITICAL FIX: Don't transition entire call to connecting on first acceptance
          // Individual participants will be in 'connecting' state, but call remains 'ringing' until enough accept
          console.log(`[CALL] Call ${data.callId} accepted by ${data.participantId} - participant now in connecting state`)
          
          // Don't broadcast connecting state to all participants on single acceptance
          // Each participant manages their own state individually
          console.log(`[CALL] Participant ${data.participantId} accepted - not broadcasting call-wide connecting state yet`)
          
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

          // ENHANCED: Comprehensive call acceptance monitoring
          const participantStates = Array.from(call.participantStates.entries())
          const stateDistribution = {
            ringing: participantStates.filter(([, state]) => state === 'ringing').length,
            connecting: participantStates.filter(([, state]) => state === 'connecting').length,
            connected: participantStates.filter(([, state]) => state === 'connected').length,
            declined: participantStates.filter(([, state]) => state === 'declined').length
          }

          console.log(`[CALL] 📊 CALL ACCEPTANCE MONITORING:`, {
            callId: data.callId,
            acceptedBy: data.participantId,
            callStatus: call.status,
            totalParticipants: call.participants.size,
            callRoomSize: callRoomSize,
            participantStates: stateDistribution,
            isGroupCall: call.isGroupCall,
            activeCalls: activeCalls.size,
            timestamp: Date.now()
          })
          
        // ENHANCED: Fetch participant data and broadcast participant joined with complete data
        // ENHANCED: Fetch participant data with retry logic
        const fetchParticipantDataWithRetry = async (participantId: string, maxRetries = 3) => {
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              console.log(`[CALL] 🔍 Fetching participant data for ${participantId} (attempt ${attempt}/${maxRetries})`)

              const participantUser = await prisma.user.findUnique({
                where: { id: participantId },
                select: {
                  id: true,
                  username: true,
                  name: true,
                  avatar: true
                }
              })

              if (participantUser) {
                const participantData = {
                  id: participantUser.id,
                  name: participantUser.name || participantUser.username,
                  username: participantUser.username,
                  avatar: participantUser.avatar
                }
                console.log(`[CALL] ✅ Successfully fetched participant data: ${participantData.name} (${participantId})`)
                return participantData
              } else {
                console.warn(`[CALL] ⚠️ Participant not found in database: ${participantId}`)
                return null
              }
            } catch (error) {
              console.error(`[CALL] ❌ Attempt ${attempt} failed for participant ${participantId}:`, error)

              if (attempt === maxRetries) {
                throw error
              }

              // Wait before retry (exponential backoff)
              await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 100))
            }
          }
        }

        try {
          const participantData = await fetchParticipantDataWithRetry(data.participantId)

          // ENHANCED: Generate intelligent fallback name if data not found
          const generateIntelligentFallback = (userId: string) => {
            // Try to create a more user-friendly fallback name
            const shortId = userId.slice(-8)

            // Check if ID looks like a UUID (contains hyphens)
            if (userId.includes('-')) {
              const lastPart = userId.split('-').pop() || shortId
              return {
                name: `User-${lastPart.slice(-6).toUpperCase()}`,
                username: `user_${lastPart.slice(-6).toLowerCase()}`
              }
            }

            // For shorter IDs, use a different pattern
            if (userId.length <= 10) {
              return {
                name: `User-${userId.slice(-6).toUpperCase()}`,
                username: `user_${userId.slice(-6).toLowerCase()}`
              }
            }

            // Default pattern with better formatting
            return {
              name: `User-${shortId.toUpperCase()}`,
              username: `user_${shortId.toLowerCase()}`
            }
          }

          const finalParticipantData = participantData || (() => {
            const fallback = generateIntelligentFallback(data.participantId)
            console.log(`[CALL] 🔤 Generated intelligent fallback name: ${fallback.name} for ID: ${data.participantId}`)
            return {
              id: data.participantId,
              name: fallback.name,
              username: fallback.username,
              avatar: null
            }
          })()

          // Broadcast participant joined with complete data to all call participants
          io.to(`call:${data.callId}`).emit('participant_joined', {
            callId: data.callId,
            participantId: data.participantId,
            participantCount: call.participants.size,
            participantData: finalParticipantData
          })

          console.log(`[CALL] ✅ Participant joined broadcasted: ${finalParticipantData.name} (${data.participantId})`)

          // ENHANCED: Broadcast authoritative participant count state
          setTimeout(() => {
            const authoritativeState = calculateAuthoritativeParticipantState(call, data.callId, io)

            // Broadcast authoritative state to all participants
            io.to(`call:${data.callId}`).emit('call_state_update', authoritativeState)
            io.to(`conversation:${call.conversationId}`).emit('call_state_update', authoritativeState)

            console.log(`[CALL] 📊 Broadcasted AUTHORITATIVE state: ${authoritativeState.connectedParticipants} connected of ${authoritativeState.participantCount} total (sequence: ${authoritativeState.sequenceNumber})`)
          }, 100) // Small delay to allow participant_joined to be processed first

        } catch (error) {
          console.error(`[CALL] ❌ All retry attempts failed for participant ${data.participantId}:`, error)

          // ENHANCED: Ultimate fallback with intelligent naming
          const generateUltimateFallback = (userId: string) => {
            const shortId = userId.slice(-8)
            if (userId.includes('-')) {
              const lastPart = userId.split('-').pop() || shortId
              return {
                name: `User-${lastPart.slice(-6).toUpperCase()}`,
                username: `user_${lastPart.slice(-6).toLowerCase()}`
              }
            }
            return {
              name: `User-${shortId.toUpperCase()}`,
              username: `user_${shortId.toLowerCase()}`
            }
          }

          const fallback = generateUltimateFallback(data.participantId)
          const fallbackData = {
            id: data.participantId,
            name: fallback.name,
            username: fallback.username,
            avatar: null
          }
          console.log(`[CALL] 🆘 Using ultimate fallback name: ${fallbackData.name} for ID: ${data.participantId}`)

          io.to(`call:${data.callId}`).emit('participant_joined', {
            callId: data.callId,
            participantId: data.participantId,
            participantCount: call.participants.size,
            participantData: fallbackData
          })

          console.log(`[CALL] ⚠️ Participant joined with fallback data: ${fallbackData.name} (${data.participantId})`)
        }

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
          // Handle declined call - ENHANCED: Better group call logic
          console.log(`[CALL] Call declined by ${data.participantId}`)
          console.log(`[CALL] Current participants in call:`, Array.from(call.participants))
          
          // CRITICAL FIX: For group calls, only end if no remaining participants (excluding the one declining)
          // Count ALL participants who are still in valid states (not declined, not the one currently declining)
          const remainingParticipants = Array.from(call.participantStates.entries())
            .filter(([id, state]) => id !== data.participantId && state !== 'declined').length
          const pendingParticipants = Array.from(call.participantStates.entries())
            .filter(([id, state]) => state === 'ringing' && id !== data.participantId).length
          
          console.log(`[CALL] Remaining participants (excluding decliner): ${remainingParticipants}`)
          console.log(`[CALL] Pending participants still ringing: ${pendingParticipants}`)
          console.log(`[CALL] Current participant states:`, Object.fromEntries(call.participantStates))
          
          // Only end call if:
          // 1. It's a 1-on-1 call, OR
          // 2. It's a group call with less than 2 remaining participants (caller + at least 1 other)
          const shouldEndCall = !call.isGroupCall || remainingParticipants < 2
          
          if (shouldEndCall) {
            console.log(`[CALL] Ending call due to decline - isGroupCall: ${call.isGroupCall}, remaining: ${remainingParticipants}, pending: ${pendingParticipants}`)
            
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
          } else {
            // ENHANCED: Group call continues after one participant declines
            console.log(`[CALL] ✅ Group call continues - ${pendingParticipants} participants still ringing`)
            
            // Just remove the declining participant, call continues for others
            // (participant already removed from call.participants and call.participantStates above)
            
            // Notify remaining participants that someone declined but call continues
            const declineNotification = {
              callId: data.callId,
              participantId: data.participantId,
              action: 'declined',
              participantCount: call.participants.size,
              message: 'Participant declined but call continues'
            }
            
            io.to(`call:${data.callId}`).emit('participant_left', declineNotification)
            console.log(`[CALL] ✅ Notified remaining participants about decline`)
            
            // ENHANCED: Check if call should transition to connected after decline
            // FIX: Use actual call room participants instead of state counts
            const currentCallRoom = io.sockets.adapter.rooms.get(`call:${data.callId}`)
            const activeParticipantsInCall = currentCallRoom ? currentCallRoom.size : 0
            const remainingConnected = activeParticipantsInCall
            const remainingRinging = Array.from(call.participantStates.values())
              .filter(state => state === 'ringing').length
            
            if (call.isGroupCall && remainingConnected >= 2 && remainingRinging === 0) {
              call.status = 'connected'
              console.log(`[CALL] ✅ Group call transitioned to connected after decline - ${remainingConnected} participants connected`)
              
              // Broadcast the state update
              const stateUpdate = {
                callId: data.callId,
                status: call.status,
                participantCount: call.participants.size,
                connectedParticipants: activeParticipantsInCall
              }
              io.to(`call:${data.callId}`).emit('call_state_update', stateUpdate)
            }
          }
        }
        
        // CRITICAL FIX: Isolated state management for group calls
        if (data.accepted) {
          // FIXED: Only set the responding participant to 'accepted', not 'connecting'
          // This prevents automatic progression of other participants
          // CRITICAL FIX: Directly set to 'connecting' to prevent UI display issues
          call.participantStates.set(data.participantId, 'connecting')
          
          console.log(`[CALL] 📝 Participant ${data.participantId} ACCEPTED call - directly set to 'connecting'`)
          console.log(`[CALL] 📊 Current participant states:`, Object.fromEntries(call.participantStates))
          console.log(`[CALL] 📈 Call status: ${call.status}, Type: ${call.isGroupCall ? 'GROUP' : '1-ON-1'}`)
          console.log(`[CALL] 👥 Total participants: ${call.participants.size}, States breakdown:`, {
            accepted: Array.from(call.participantStates.values()).filter(s => s === 'accepted').length,
            connecting: Array.from(call.participantStates.values()).filter(s => s === 'connecting').length,
            connected: Array.from(call.participantStates.values()).filter(s => s === 'connected').length,
            ringing: Array.from(call.participantStates.values()).filter(s => s === 'ringing').length,
            declined: Array.from(call.participantStates.values()).filter(s => s === 'declined').length
          })
          
          // Clear ringing timeout for group calls if someone responds
          if (call.isGroupCall && call.ringingTimeoutId) {
            clearTimeout(call.ringingTimeoutId)
            delete call.ringingTimeoutId
            console.log(`[CALL] Cleared ringing timeout for group call`)
          }
          
          // CRITICAL: Count states properly for decision making
          // Since participants now go directly to 'connecting', count connecting + connected
          const acceptedCount = Array.from(call.participantStates.values())
            .filter(state => state === 'connecting' || state === 'connected').length
          const ringingCount = Array.from(call.participantStates.values())
            .filter(state => state === 'ringing').length
          const declinedCount = Array.from(call.participantStates.values())
            .filter(state => state === 'declined').length
          
          console.log(`[CALL] State check - Accepted: ${acceptedCount}, Ringing: ${ringingCount}, Declined: ${declinedCount}`)
          
          // SIMPLIFIED: Since participants go directly to 'connecting', just manage call status
          if (call.isGroupCall) {
            // For group calls: transition call to connecting when we have the first 2 connecting participants
            const connectingParticipants = Array.from(call.participantStates.entries())
              .filter(([, state]) => state === 'connecting' || state === 'connected')
              .map(([id]) => id)
            
            const shouldTransitionCall = connectingParticipants.length >= 2 && call.status === 'ringing'
            
            if (shouldTransitionCall) {
              // Only transition the call status once
              call.status = 'connecting'
              call.connectingStartTime = Date.now()
              console.log(`[CALL] 🔄 Group call transitioned to connecting with ${connectingParticipants.length} connecting participants`)
            }
          } else {
            // For 1-on-1 calls: transition when both participants are connecting
            const shouldStartConnecting = acceptedCount >= 2
            
            if (shouldStartConnecting && call.status === 'ringing') {
              call.status = 'connecting'
              call.connectingStartTime = Date.now()
              console.log(`[CALL] 🔄 1-on-1 call transitioned to connecting with ${acceptedCount} connecting participants`)
            }
          }
          
          // Broadcast state update for connecting participants
          if (call.status === 'connecting' || call.status === 'connected') {
            const connectingParticipants = Array.from(call.participantStates.entries())
              .filter(([, state]) => state === 'connecting')
              .map(([id]) => id)
            
            const connectingStateData = {
              callId: data.callId,
              status: call.status,
              participantCount: call.participants.size,
              connectingParticipants,
              participantStates: Object.fromEntries(call.participantStates.entries())
            }
            
            // Broadcast to connecting participants for WebRTC coordination
            connectingParticipants.forEach(participantId => {
              io.to(`user:${participantId}`).emit('call_state_update', connectingStateData)
            })
            
            console.log(`[CALL] 📡 Broadcasted connecting state to ${connectingParticipants.length} connecting participants`)
          }
        } else {
          // CRITICAL FIX: Isolated decline handling - only affect the declining participant
          call.participantStates.set(data.participantId, 'declined')
          
          console.log(`[CALL] 📝 Participant ${data.participantId} DECLINED call - marked as 'declined'`)
          console.log(`[CALL] 📊 Current participant states after decline:`, Object.fromEntries(call.participantStates))
          console.log(`[CALL] 📈 Call status: ${call.status}, Type: ${call.isGroupCall ? 'GROUP' : '1-ON-1'}`)
          console.log(`[CALL] 👥 Total participants: ${call.participants.size}, States breakdown:`, {
            accepted: Array.from(call.participantStates.values()).filter(s => s === 'accepted').length,
            connecting: Array.from(call.participantStates.values()).filter(s => s === 'connecting').length,
            connected: Array.from(call.participantStates.values()).filter(s => s === 'connected').length,
            ringing: Array.from(call.participantStates.values()).filter(s => s === 'ringing').length,
            declined: Array.from(call.participantStates.values()).filter(s => s === 'declined').length
          })
          
          // Check if we should end the call due to insufficient participants
          const acceptedCount = Array.from(call.participantStates.values())
            .filter(state => state === 'accepted' || state === 'connecting' || state === 'connected').length
          const ringingCount = Array.from(call.participantStates.values())
            .filter(state => state === 'ringing').length
          const declinedCount = Array.from(call.participantStates.values())
            .filter(state => state === 'declined').length
          
          console.log(`[CALL] After decline - Accepted: ${acceptedCount}, Ringing: ${ringingCount}, Declined: ${declinedCount}`)
          
          // NEW: Smarter call ending logic
          let shouldEndCall = false
          
          if (call.isGroupCall) {
            // For group calls: only end if impossible to have minimum participants
            const maxPossibleAccepted = acceptedCount + ringingCount
            shouldEndCall = maxPossibleAccepted < 2
            
            console.log(`[CALL] Group call end check: maxPossible=${maxPossibleAccepted}, shouldEnd=${shouldEndCall}`)
          } else {
            // For 1-on-1 calls: end if anyone declines
            shouldEndCall = true
            // Remove declining participant from 1-on-1 calls
            call.participants.delete(data.participantId)
            call.participantStates.delete(data.participantId)
            console.log(`[CALL] 🗑️ Removed declining participant ${data.participantId} from 1-on-1 call`)
          }
          
          if (shouldEndCall) {
            console.log(`[CALL] Ending call due to decline - insufficient participants possible`)
            // End call logic will be handled in the existing code below
          } else {
            console.log(`[CALL] Group call continues - ${ringingCount} participants still ringing, ${acceptedCount} accepted`)
            
            // Notify remaining participants about the decline without ending the call
            const declineNotification = {
              callId: data.callId,
              participantId: data.participantId,
              action: 'declined',
              participantCount: call.participants.size,
              remainingRinging: ringingCount,
              message: 'Participant declined but call continues'
            }
            
            // Only notify participants who are still in the call (ringing or accepted)
            const activeParticipants = Array.from(call.participantStates.entries())
              .filter(([, state]) => state === 'ringing' || state === 'accepted' || state === 'connecting' || state === 'connected')
              .map(([id]) => id)
            
            activeParticipants.forEach(participantId => {
              io.to(`user:${participantId}`).emit('participant_left', declineNotification)
            })
            
            console.log(`[CALL] ✅ Notified ${activeParticipants.length} remaining participants about decline`)
          }
        }

        // IMPROVED: Enhanced broadcast logic for better state synchronization
        const currentCallRoom = io.sockets.adapter.rooms.get(`call:${data.callId}`)
        const activeParticipantsInCall = currentCallRoom ? currentCallRoom.size : 0
        
        // Get list of all participants who should receive updates
        const allCallParticipants = Array.from(call.participants)
        const participantStatesList = Object.fromEntries(call.participantStates.entries())
        
        // CRITICAL FIX: Fetch participant metadata for better client-side display
        const participantMetadata = await Promise.all(
          allCallParticipants.map(async (participantId) => {
            try {
              const user = await prisma.user.findUnique({
                where: { id: participantId },
                select: {
                  id: true,
                  username: true,
                  name: true,
                  avatar: true
                }
              })
              return user ? {
                id: user.id,
                name: user.name || user.username,
                username: user.username,
                avatar: user.avatar
              } : null
            } catch (error) {
              console.error(`[CALL] Failed to fetch participant ${participantId}:`, error)
              return null
            }
          })
        ).then(results => results.filter(Boolean)) // Remove null entries
        
        // CRITICAL FIX: Flatten participant states into individual properties for client compatibility
        const responseData = {
          ...data,
          participantCount: call.participants.size,
          callStatus: call.status,
          connectedParticipants: activeParticipantsInCall,
          allParticipants: allCallParticipants,
          participants: participantMetadata, // Include full participant metadata
          participantStates: participantStatesList
          // REMOVED: Flattened participant states to prevent auto-connection bug
          // Individual participants will receive filtered states in customResponseData
        }
        
        console.log(`[CALL] 📡 Broadcasting call_response with enhanced data:`, {
          accepted: data.accepted,
          participantId: data.participantId,
          callStatus: call.status,
          allParticipants: allCallParticipants,
          participantStates: participantStatesList
        })
        
        // FIX: Selective broadcasting based on response type to prevent cross-contamination
        if (data.accepted) {
          // CRITICAL FIX: Only send "connecting" status to participants who have accepted
          // Non-accepting participants should maintain their current state (ringing)
          callLogger.debug('Broadcasting ACCEPT selectively based on participant state')
          
          allCallParticipants.forEach(participantId => {
            const participantState = call.participantStates.get(participantId)
            const isCallerId = participantId === call.callerId
            
            // Create customized response data based on participant state
            let customCallStatus = responseData.callStatus
            
            // CRITICAL FIX: Proper caller notification when participants accept
            if (isCallerId && call.status === 'connecting') {
              // CALLER PRIORITY: Caller should ALWAYS see 'connecting' when call transitions to connecting
              customCallStatus = 'connecting'
              console.log(`[CALL] 📞 CALLER ${participantId} gets connecting status (call status: ${call.status})`)
            } else if (isCallerId && call.status === 'connected') {
              // CALLER PRIORITY: Caller should see 'connected' when call is connected
              customCallStatus = 'connected'
              console.log(`[CALL] 📞 CALLER ${participantId} gets connected status (call status: ${call.status})`)
            } else if (participantState === 'connecting' || participantState === 'connected') {
              // Participants who accepted should see connecting/connected
              customCallStatus = responseData.callStatus
              console.log(`[CALL] 👤 ACCEPTED participant ${participantId} gets ${customCallStatus} status (state: ${participantState})`)
            } else if (participantState === 'ringing' || !participantState || participantState === undefined) {
              // CRITICAL FIX: Participants still ringing or without state should stay in ringing
              // This prevents non-accepting participants from getting 'connecting' status
              customCallStatus = 'ringing'
              console.log(`[CALL] 🔒 NON-ACCEPTING participant ${participantId} stays in ringing state (current state: ${participantState})`)
            } else {
              // Fallback: default to ringing for safety
              customCallStatus = 'ringing'
              console.log(`[CALL] 🔒 FALLBACK: Setting participant ${participantId} to ringing (unexpected state: ${participantState})`)
            }
            
            // CRITICAL FIX: Create participant-specific response data without flattened states
            // Only include participant states that the receiving participant should see
            const visibleParticipantStates: Record<string, string> = {}
            
            // Show the current participant's own state
            const currentParticipantState = call.participantStates.get(participantId)
            if (currentParticipantState) {
              visibleParticipantStates[participantId] = currentParticipantState
            }
            
            // Show states of participants who have accepted (for coordination)
            call.participantStates.forEach((state, pid) => {
              if (state === 'connecting' || state === 'connected') {
                visibleParticipantStates[pid] = state
              } else if (pid === call.callerId) {
                // Always show caller state
                visibleParticipantStates[pid] = state
              }
              // Don't show ringing states of other participants to prevent auto-connection
            })

            const customResponseData = {
              ...responseData,
              callStatus: customCallStatus,
              // Replace flattened states with filtered ones
              participantStates: visibleParticipantStates,
              // Remove the original flattened states by not spreading participantStatesList
              ...Object.fromEntries(Object.entries(visibleParticipantStates))
            }
            
            callLogger.debug(`Sending to ${participantId} (state: ${participantState}, isCaller: ${isCallerId}):`, {
              accepted: customResponseData.accepted,
              callStatus: customResponseData.callStatus,
              originalCallStatus: responseData.callStatus,
              participantState
            })
            
            // CRITICAL: Add event sequence number and small delay to prevent race conditions
            const sequencedResponseData = {
              ...customResponseData,
              eventSequence: Date.now(),
              eventType: 'call_response'
            }
            
            io.to(`user:${participantId}`).emit('call_response', sequencedResponseData)
          })
          
          // RACE CONDITION FIX: Small delay before sending state_update to ensure call_response processes first
          setTimeout(() => {
            broadcastStateUpdate()
          }, 50) // 50ms delay
          
        } else {
          // For declines: only send to the declining participant and caller for confirmation
          // Don't broadcast declines to other participants unless call should end
          const shouldEndCall = call.isGroupCall ? 
            (Array.from(call.participantStates.values()).filter(s => s === 'accepted' || s === 'connecting' || s === 'connected').length + 
             Array.from(call.participantStates.values()).filter(s => s === 'ringing').length) < 2 :
            true // Always end 1-on-1 calls on decline
            
          if (shouldEndCall) {
            // Broadcast decline to all if call should end
            console.log(`[CALL] 📡 Broadcasting DECLINE to all participants - call ending`)
            console.log(`[CALL] 📡 DECLINE broadcast recipients:`, allCallParticipants)
            console.log(`[CALL] 📡 DECLINE reason: Insufficient participants remaining`)
            allCallParticipants.forEach(participantId => {
              io.to(`user:${participantId}`).emit('call_response', responseData)
            })
          } else {
            // Only notify specific participants for group call declines that don't end the call
            const declineRecipients = [data.participantId]
            if (call.callerId !== data.participantId) {
              declineRecipients.push(call.callerId)
            }
            console.log(`[CALL] 📡 Sending DECLINE only to specific participants - call continues`)
            console.log(`[CALL] 📡 DECLINE recipients:`, declineRecipients)
            console.log(`[CALL] 📡 Remaining participants still ringing:`, 
              Array.from(call.participantStates.entries())
                .filter(([, state]) => state === 'ringing')
                .map(([id]) => id)
            )
            
            // Send to the declining participant
            io.to(`user:${data.participantId}`).emit('call_response', responseData)
            // Send to the caller (for UI updates)
            if (call.callerId !== data.participantId) {
              io.to(`user:${call.callerId}`).emit('call_response', responseData)
            }
          }
        }
        
        // Also broadcast to call room if it exists (for participants who are already connected)
        if (currentCallRoom && currentCallRoom.size > 0) {
          io.to(`call:${data.callId}`).emit('call_response', responseData)
        }
        
        console.log(`[CALL] 📡 Broadcasted call_response to ${allCallParticipants.length} participants`)
        
        // CRITICAL: Extract state broadcasting logic into function for proper sequencing
        const broadcastStateUpdate = () => {
          console.log('[CALL] 📡 Starting delayed state_update broadcast...')
          
          // ENHANCED: Send detailed state update for better UI synchronization
          // FIX: Use actual call room participants for accurate count
          const stateCallRoom = io.sockets.adapter.rooms.get(`call:${data.callId}`)
          const stateActiveParticipants = stateCallRoom ? stateCallRoom.size : 0
          
          const stateUpdate = {
            callId: data.callId,
            status: call.status,
            participantCount: call.participants.size,
            connectedParticipants: stateActiveParticipants,
            participantStates: Object.fromEntries(call.participantStates.entries()),
            eventSequence: Date.now(),
            eventType: 'call_state_update'
          }
          
          // CRITICAL FIX: Send individualized state updates to prevent cross-contamination
          // Don't send to conversation room for group calls to avoid affecting non-participants
          if (call.isGroupCall) {
            // For group calls: send individualized state to each participant based on their state
            allCallParticipants.forEach(participantId => {
              const participantState = call.participantStates.get(participantId)
              const isCallerId = participantId === call.callerId

              let individualStatus = 'ringing' // Default

              // CRITICAL FIX: Caller priority logic for state_update
              if (isCallerId && (call.status === 'connecting' || call.status === 'connected')) {
                // CALLER PRIORITY: Caller should ALWAYS follow main call status
                individualStatus = call.status
              } else if (participantState === 'connecting' || participantState === 'connected' || participantState === 'accepted') {
                // Participants who accepted should see main call status
                individualStatus = call.status
              } else {
                // Non-accepting participants stay in ringing
                individualStatus = 'ringing'
              }

              // CRITICAL FIX: Create ultra-strict personalized participant states to prevent auto-answer UI
              const personalizedParticipantStates: { [key: string]: string } = {}
              call.participantStates.forEach((state, pId) => {
                if (pId === participantId) {
                  // ENHANCED: Current user sees their actual state, with ultra-strict non-accepting protection
                  if (!isCallerId && (participantState === 'ringing' || !participantState)) {
                    // Non-caller who is ringing or has no state MUST stay ringing
                    personalizedParticipantStates[pId] = 'ringing'
                    console.log(`[CALL] 🛡️ ULTRA-STRICT: Protecting ${participantId} - forced to ringing (was: ${state})`)

                    // Log potential state contamination
                    if (state !== 'ringing') {
                      console.warn(`[CALL] ⚠️ STATE CONTAMINATION: Non-accepting user ${participantId} had state '${state}' but should be 'ringing'`)
                    }
                  } else {
                    // Caller or user who has accepted gets their actual state
                    personalizedParticipantStates[pId] = state
                    console.log(`[CALL] ✅ Allowing state '${state}' for ${isCallerId ? 'caller' : 'accepting user'} ${participantId}`)
                  }
                } else {
                  // ENHANCED: Other participants - ultra-strict filtering based on current user's acceptance status
                  if (!isCallerId && participantState === 'ringing') {
                    // If current user hasn't accepted, sanitize other participant states for cleaner UI
                    // This prevents confusing UI where others appear connected but current user is still ringing
                    if (state === 'connected') {
                      personalizedParticipantStates[pId] = 'connecting'
                      console.log(`[CALL] 🔄 Sanitizing other participant ${pId}: connected -> connecting (current user ringing)`)
                    } else {
                      personalizedParticipantStates[pId] = state
                    }
                  } else {
                    // Show actual states for caller or accepting users
                    personalizedParticipantStates[pId] = state
                  }
                }
              })

              // VALIDATION: Ensure current user state is consistent
              const currentUserFinalState = personalizedParticipantStates[participantId]
              if (!isCallerId && participantState === 'ringing' && currentUserFinalState !== 'ringing') {
                console.error(`[CALL] 🚨 CRITICAL ERROR: Non-accepting user ${participantId} final state is '${currentUserFinalState}' but should be 'ringing'`)
                personalizedParticipantStates[participantId] = 'ringing' // Force correction
              }

              const individualStateUpdate = {
                ...stateUpdate,
                status: individualStatus,
                participantStates: personalizedParticipantStates  // Use personalized states
              }

              console.log(`[CALL] 📡 Sending individualized state_update to ${participantId} (state: ${participantState}, isCaller: ${isCallerId}):`, {
                callStatus: individualStateUpdate.status,
                originalStatus: call.status,
                personalizedStates: personalizedParticipantStates,
                isCallerId
              })

              io.to(`user:${participantId}`).emit('call_state_update', individualStateUpdate)
            })
            
            console.log(`[CALL] 📡 Sent individualized call_state_update to ${allCallParticipants.length} participants`)
          } else {
            // For 1-on-1 calls: use original broadcasting (both participants should see same state)
            io.to(`call:${data.callId}`).emit('call_state_update', stateUpdate)
            io.to(`conversation:${data.conversationId}`).emit('call_state_update', stateUpdate)
          }
          
          console.log(`[CALL] Enhanced state_update broadcasted:`, { stateUpdate })
        } // End broadcastStateUpdate function
        
        // IMMEDIATE state broadcasting for accepts (no delay needed) to ensure caller gets proper state
        if (data.accepted) {
          // Use immediate call for accepted participants to prevent caller getting wrong state
          broadcastStateUpdate()
        }
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
          
          // FIXED: Better group call logic - only end if insufficient participants
          // For 1-on-1 calls: end if caller leaves OR <2 participants
          // For group calls: only end if <2 participants (call can continue without original caller)
          const shouldEndCall = call.isGroupCall 
            ? call.participants.size < 2  // Group calls: only end if <2 participants remain
            : (call.participants.size < 2 || data.participantId === call.callerId) // 1-on-1: end if caller leaves OR <2 participants
          
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
        
        // CRITICAL FIX: Only mark participant as ready if they have accepted the call
        // Check if participant is in connecting or connected state (not still ringing)
        const participantState = call.participantStates?.get(socket.data.userId)
        if (participantState === 'connecting' || participantState === 'connected') {
          call.readyParticipants.add(socket.data.userId)
          console.log(`[CALL] Participant ${socket.data.userId} marked as ready (state: ${participantState}). Ready: ${call.readyParticipants.size}/${call.participants.size}`)
          
          // CRITICAL FIX: Transition participant from 'connecting' to 'connected' when they send stream
          if (participantState === 'connecting') {
            call.participantStates.set(socket.data.userId, 'connected')
            console.log(`[CALL] ✅ Participant ${socket.data.userId} transitioned from 'connecting' to 'connected'`)
            
            // Broadcast participant state update
            const stateUpdate = {
              callId: data.callId,
              participantId: socket.data.userId,
              state: 'connected' as const,
              participantStates: Object.fromEntries(call.participantStates.entries())
            }
            
            io.to(`call:${data.callId}`).emit('participant_state_update', stateUpdate)
            console.log(`[CALL] 📡 Broadcasted participant state update: ${socket.data.userId} -> connected`)
          }
        } else {
          console.log(`[CALL] ⚠️ Participant ${socket.data.userId} sent stream but is still in '${participantState}' state - NOT marking as ready yet`)
          // Don't mark as ready until they accept the call
          return
        }
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
          socket.on('webrtc_stream_ready', async (data: { // <-- Added 'async' here
            callId: string
            participantId: string
            streamId: string
            hasAudio?: boolean
            hasVideo?: boolean
          }) => {
            // ... (lots of existing code) ...
    
            // CRITICAL: For group calls, send complete participant list to the newly joined participant
            if (call.isGroupCall) {
              const allParticipants = Array.from(call.participants)
              console.log(`[CALL] 📋 Sending complete participant list to new joiner ${data.participantId}:`, allParticipants)
    
              // ENHANCED: Send participant_joined event for each existing participant with retry logic
              for (const existingParticipantId of allParticipants) {
                if (existingParticipantId !== data.participantId) {
                  try {
                    // Enhanced participant data fetching with retry logic
                    const fetchParticipantDataWithRetry = async (participantId: string, maxRetries = 3) => {
                      for (let attempt = 1; attempt <= maxRetries; attempt++) {
                        try {
                          console.log(`[CALL] 🔍 Fetching existing participant data for ${participantId} (attempt ${attempt}/${maxRetries})`)

                          const participantUser = await prisma.user.findUnique({
                            where: { id: participantId },
                            select: { id: true, username: true, name: true, avatar: true }
                          })

                          if (participantUser) {
                            const fetchedData = {
                              id: participantUser.id,
                              name: participantUser.name || participantUser.username,
                              username: participantUser.username,
                              avatar: participantUser.avatar
                            }
                            console.log(`[CALL] ✅ Successfully fetched existing participant data: ${fetchedData.name} (${participantId})`)
                            return fetchedData
                          } else {
                            console.warn(`[CALL] ⚠️ Existing participant not found in database: ${participantId}`)
                            return null
                          }
                        } catch (error) {
                          console.error(`[CALL] ❌ Attempt ${attempt} failed for existing participant ${participantId}:`, error)

                          if (attempt === maxRetries) {
                            throw error
                          }

                          // Wait before retry (exponential backoff)
                          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 100))
                        }
                      }
                    }

                    const participantData = await fetchParticipantDataWithRetry(existingParticipantId)

                    if (participantData) {
                      socket.emit('participant_joined', {
                        callId: data.callId,
                        participantId: existingParticipantId,
                        participantCount: call.participants.size,
                        participantData: participantData
                      })
                      console.log(`[CALL] ✅ Notified new joiner ${data.participantId} about existing participant ${existingParticipantId} with enhanced data`)
                    } else {
                      throw new Error('Participant data not found after retries')
                    }
                  } catch (error) {
                    console.error(`[CALL] ❌ All retry attempts failed for existing participant ${existingParticipantId}:`, error)
                    // ENHANCED: Ultimate fallback with improved participant data structure
                    socket.emit('participant_joined', {
                      callId: data.callId,
                      participantId: existingParticipantId,
                      participantCount: call.participants.size,
                      participantData: {
                        id: existingParticipantId,
                        name: `User ${existingParticipantId.slice(-8)}`, // Use more chars for uniqueness
                        username: `user${existingParticipantId.slice(-8)}`,
                        avatar: null
                      }
                    })
                    console.log(`[CALL] ⚠️ Used fallback participant data for ${existingParticipantId}`)
                  }
                }
              }
              // ENHANCED: Also notify all existing participants about the new joiner with complete data
              try {
                const newJoinerUser = await prisma.user.findUnique({
                  where: { id: data.participantId },
                  select: {
                    id: true,
                    username: true,
                    name: true,
                    avatar: true
                  }
                })

                if (newJoinerUser) {
                  const newJoinerData = {
                    id: newJoinerUser.id,
                    name: newJoinerUser.name || newJoinerUser.username,
                    username: newJoinerUser.username,
                    avatar: newJoinerUser.avatar
                  }

                  // Notify all existing participants about the new joiner (excluding the new joiner themselves)
                  for (const existingParticipantId of allParticipants) {
                    if (existingParticipantId !== data.participantId) {
                      const existingParticipantSockets = Array.from(io.sockets.sockets.values())
                        .filter(s => s.data.userId === existingParticipantId)

                      existingParticipantSockets.forEach(ps => {
                        ps.emit('participant_joined', {
                          callId: data.callId,
                          participantId: data.participantId,
                          participantCount: call.participants.size,
                          participantData: newJoinerData
                        })
                        console.log(`[CALL] ✅ Notified existing participant ${existingParticipantId} about new joiner ${data.participantId} with complete data`)
                      })
                    }
                  }
                } else {
                  console.warn(`[CALL] ⚠️ Could not find user data for new joiner ${data.participantId}, using fallback`)
                  // Fallback notification to existing participants
                  const fallbackData = {
                    id: data.participantId,
                    name: `User ${data.participantId.slice(-8)}`,
                    username: `user${data.participantId.slice(-8)}`,
                    avatar: null
                  }

                  for (const existingParticipantId of allParticipants) {
                    if (existingParticipantId !== data.participantId) {
                      const existingParticipantSockets = Array.from(io.sockets.sockets.values())
                        .filter(s => s.data.userId === existingParticipantId)

                      existingParticipantSockets.forEach(ps => {
                        ps.emit('participant_joined', {
                          callId: data.callId,
                          participantId: data.participantId,
                          participantCount: call.participants.size,
                          participantData: fallbackData
                        })
                      })
                    }
                  }
                }
              } catch (error) {
                console.error(`[CALL] Error notifying existing participants about new joiner ${data.participantId}:`, error)
              }
            }

            // ... (rest of the 'webrtc_stream_ready' listener code) ...
          })
          
          // CRITICAL FIX: Only initialize connecting state for participants who have ACCEPTED
          // Don't force participants who are still ringing to connecting state
          if (!call.participantStates) {
            call.participantStates = new Map()
          }
          
          console.log(`[CALL] 🔍 Checking participant states before transitioning to connecting:`)
          call.participants.forEach(participantId => {
            const currentState = call.participantStates.get(participantId)
            console.log(`[CALL] - ${participantId}: ${currentState || 'unset'}`)
            
            // Only transition to connecting if participant has accepted (not still ringing)
            if (currentState === 'connecting' || currentState === 'connected') {
              const participantStateData = {
                callId: data.callId,
                participantId: participantId,
                state: 'connecting' as const
              }
              
              // Update internal state (keep it connecting if already connecting)
              call.participantStates.set(participantId, 'connecting')
              
              // Broadcast participant state
              io.to(`call:${data.callId}`).emit('participant_state_update', participantStateData)
              io.to(`conversation:${call.conversationId}`).emit('participant_state_update', participantStateData)
              io.to(`user:${participantId}`).emit('participant_state_update', participantStateData)
              
              console.log(`[CALL] ✅ Participant state maintained/updated: ${participantId} -> connecting`)
            } else {
              console.log(`[CALL] 🚫 NOT changing ${participantId} to connecting - current state: ${currentState} (should stay ringing until they accept)`)
            }
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
        // CRITICAL FIX: Group calls should wait for ALL participants who accepted to be ready
        let shouldConnect = false
        if (call.participants.size === 2) {
          // 1-on-1 call - need both participants ready (or 1 in test mode)
          shouldConnect = isTestMode ? call.readyParticipants.size >= 1 : call.readyParticipants.size >= 2
        } else if (call.participants.size > 2) {
          // Group call - count participants who have accepted (connecting/connected state)
          const acceptedParticipants = Array.from(call.participantStates.entries())
            .filter(([id, state]) => state === 'connecting' || state === 'connected').length
          // Need at least 2 participants ready (don't wait for ALL accepted participants)
          shouldConnect = call.readyParticipants.size >= 2 && acceptedParticipants >= 2
          console.log(`[CALL] Group call transition check: ${call.readyParticipants.size} ready, ${acceptedParticipants} accepted, shouldConnect: ${shouldConnect}`)
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
              
              // CRITICAL FIX: Only update participants who have actually accepted to connected state
              // Don't force participants who are still ringing or declined to connected state
              if (!call.participantStates) {
                call.participantStates = new Map()
              }
              
              // Only update participants who have previously accepted (in connecting state) to connected
              call.participants.forEach(participantId => {
                const currentState = call.participantStates.get(participantId)
                
                // Only transition to connected if participant has accepted (connecting state)
                // Don't force ringing or declined participants to connected
                if (currentState === 'connecting') {
                  const participantStateData = {
                    callId: data.callId,
                    participantId: participantId,
                    state: 'connected' as const
                  }
                  
                  // Update internal state
                  call.participantStates.set(participantId, 'connected')
                  
                  console.log(`[CALL] 📡 EMITTING participant_state_update for ${participantId} -> connected (was connecting)`)
                  // Broadcast to all channels
                  io.to(`call:${data.callId}`).emit('participant_state_update', participantStateData)
                  io.to(`conversation:${call.conversationId}`).emit('participant_state_update', participantStateData)
                  io.to(`user:${participantId}`).emit('participant_state_update', participantStateData)
                  
                  console.log(`[CALL] ✅ Participant state update broadcasted: ${participantId} -> connected`)
                } else {
                  console.log(`[CALL] 🚫 NOT updating ${participantId} to connected - current state: ${currentState} (should only transition connecting->connected)`)
                }
              })
            }
          }, 500) // Reduced delay for faster connection
        } else {
          console.log(`[CALL] ⚠️ Not transitioning to connected - Status: ${call.status}, Ready: ${call.readyParticipants.size}/${call.participants.size}`)
        }
        
        // CRITICAL FIX: For 1-on-1 calls ONLY, force transition to connected when both ACCEPTED participants have sent webrtc_stream_ready
        // Only count participants who have actually accepted (connecting or connected state)
        const acceptedParticipantsCount = Array.from(call.participantStates.entries())
          .filter(([id, state]) => state === 'connecting' || state === 'connected').length
        
        // Only apply 1-on-1 logic if it's actually a non-group call
        if (!call.isGroupCall && call.participants.size === 2 && call.readyParticipants.size >= acceptedParticipantsCount && acceptedParticipantsCount >= 2 && call.status === 'connecting') {
          console.log(`[CALL] 🔥 BOTH ACCEPTED PARTICIPANTS READY - Force transitioning to connected immediately`)
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
          
          // CRITICAL FIX: Only broadcast connected state for participants who have accepted
          // Don't force participants who are still ringing to connected state
          if (!call.participantStates) {
            call.participantStates = new Map()
          }
          
          console.log(`[CALL] 📡 Broadcasting connected state for ACCEPTED participants (1-on-1 force) in call ${data.callId}`)
          call.participants.forEach(participantId => {
            io.to(`user:${participantId}`).emit('call_state_update', connectedStateData)
            
            const currentState = call.participantStates.get(participantId)
            
            // Only update to connected if participant has accepted (connecting state)
            if (currentState === 'connecting') {
              const participantStateData = {
                callId: data.callId,
                participantId: participantId,
                state: 'connected' as const
              }
              
              // Update internal state
              call.participantStates.set(participantId, 'connected')
              
              console.log(`[CALL] 📡 EMITTING participant_state_update (force) for ${participantId} -> connected (was connecting)`)
              io.to(`call:${data.callId}`).emit('participant_state_update', participantStateData)
              io.to(`conversation:${call.conversationId}`).emit('participant_state_update', participantStateData)
              io.to(`user:${participantId}`).emit('participant_state_update', participantStateData)
            } else {
              console.log(`[CALL] 🚫 NOT force-updating ${participantId} to connected - current state: ${currentState}`)
            }
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
        
        // Only transition to connected if this is a verified stable connection AND participants are ready
        if (call.status === 'connecting' && data.verified) {
          // For group calls, transition when at least 2 participants are ready and have accepted
          const acceptedParticipants = Array.from(call.participantStates.entries())
            .filter(([id, state]) => state === 'connecting' || state === 'connected').length
          const readyCount = call.readyParticipants ? call.readyParticipants.size : 0
          
          const shouldTransitionToConnected = call.isGroupCall 
            ? (readyCount >= 2 && acceptedParticipants >= 2) // Group: at least 2 ready AND accepted
            : (readyCount >= 2) // 1-on-1 needs both participants ready
          
          if (shouldTransitionToConnected) {
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
          } else {
            console.log(`[WebRTC] Peer connected but not transitioning - Group: ${call.isGroupCall}, Ready: ${readyCount}, Accepted: ${acceptedParticipants}`)
            return // Don't proceed with connected state broadcasts
          }
          
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
          
          // CRITICAL FIX: Only broadcast connected state for participants who have accepted
          // Don't force participants who are still ringing to connected state
          console.log(`[WebRTC] 📡 Broadcasting connected state for ACCEPTED participants in call ${data.callId}`)
          call.participants.forEach(participantId => {
            const currentState = call.participantStates.get(participantId)
            
            // Only update to connected if participant has accepted (connecting state)
            if (currentState === 'connecting') {
              const participantStateData = {
                callId: data.callId,
                participantId: participantId,
                state: 'connected' as const
              }
              
              // Update the internal state tracking
              call.participantStates.set(participantId, 'connected')
            
              console.log(`[WebRTC] 📡 EMITTING participant_state_update for ${participantId} -> connected (was connecting)`)
              // Broadcast to all channels
              io.to(`call:${data.callId}`).emit('participant_state_update', participantStateData)
              io.to(`conversation:${call.conversationId}`).emit('participant_state_update', participantStateData)
              io.to(`user:${participantId}`).emit('participant_state_update', participantStateData)
            } else {
              console.log(`[WebRTC] 🚫 NOT updating ${participantId} to connected - current state: ${currentState}`)
            }
            
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
        
        // Only transition to connected if we're still in connecting state, have WebRTC ready, AND participants are ready
        if (call.status === 'connecting' && data.connectedPeers > 0 && data.peersWithStreams > 0) {
          // For group calls, transition when at least 2 participants are ready and have accepted
          const acceptedParticipants = Array.from(call.participantStates.entries())
            .filter(([id, state]) => state === 'connecting' || state === 'connected').length
          const readyCount = call.readyParticipants ? call.readyParticipants.size : 0
          
          const shouldTransitionToConnected = call.isGroupCall 
            ? (readyCount >= 2 && acceptedParticipants >= 2) // Group: at least 2 ready AND accepted
            : (readyCount >= 2) // 1-on-1 needs both participants ready
          
          if (shouldTransitionToConnected) {
            console.log(`[WebRTC] WebRTC ready! Transitioning call ${data.callId} to connected`)
            call.status = 'connected'
            call.connectedTime = Date.now()
          } else {
            console.log(`[WebRTC] WebRTC ready but not transitioning - Group: ${call.isGroupCall}, Ready: ${readyCount}, Accepted: ${acceptedParticipants}`)
            return // Don't proceed with connected state broadcasts
          }
          
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
          
          // CRITICAL FIX: Only broadcast connected state for participants who have accepted
          // Don't force participants who are still ringing to connected state
          if (!call.participantStates) {
            call.participantStates = new Map()
          }
          
          console.log(`[WebRTC] 📡 Broadcasting connected state for ACCEPTED participants via call_ready in call ${data.callId}`)
          call.participants.forEach(participantId => {
            const currentState = call.participantStates.get(participantId)
            
            // Only update to connected if participant has accepted (connecting state)
            if (currentState === 'connecting') {
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
              
              console.log(`[WebRTC] ✅ Participant state update broadcasted via call_ready: ${participantId} -> connected (was connecting)`)
            } else {
              console.log(`[WebRTC] 🚫 NOT updating ${participantId} to connected via call_ready - current state: ${currentState}`)
            }
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

      // Handle joining an ongoing group call
      socket.on('join_ongoing_call', async (data: {
        callId: string
        conversationId: string
      }) => {
        console.log(`[CALL] User ${socket.data.userId} attempting to join ongoing call: ${data.callId}`)
        
        const call = activeCalls.get(data.callId)
        if (!call) {
          console.log(`[CALL] Call ${data.callId} not found or already ended`)
          socket.emit('join_call_failed', { reason: 'Call not found or ended', callId: data.callId })
          return
        }

        // Check if it's a group call and still active
        if (call.status === 'ended' || call.status === 'cancelled') {
          console.log(`[CALL] Call ${data.callId} has already ended`)
          socket.emit('join_call_failed', { reason: 'Call has ended', callId: data.callId })
          return
        }

        // Prevent duplicate joins
        if (call.participants.has(socket.data.userId)) {
          console.log(`[CALL] User ${socket.data.userId} already in call ${data.callId}`)
          socket.emit('join_call_failed', { reason: 'Already in call', callId: data.callId })
          return
        }

        // Check participant limits using circuit breaker
        try {
          await callCircuitBreaker.executeCall(async () => {
            const participantCount = call.participants.size + 1
            const validation = CallLimitsManager.validateCallParticipants(
              Array.from(call.participants).concat(socket.data.userId),
              true, // is group call
              'basic' // TODO: Get actual user tier
            )

            if (!validation.allowed) {
              throw new Error(validation.reason)
            }
            return Promise.resolve()
          })
        } catch (error) {
          console.log(`[CALL] Join rejected: ${error instanceof Error ? error.message : String(error)}`)
          socket.emit('join_call_failed', { 
            reason: error instanceof Error ? error.message : 'Join failed'
          })
          return
        }

        // Add participant to call
        call.participants.add(socket.data.userId)
        call.participantStates.set(socket.data.userId, 'connecting')
        
        // Join call room
        socket.join(`call:${data.callId}`)
        console.log(`[CALL] User ${socket.data.userId} joined call room: call:${data.callId}`)

        // ENHANCED: Get participant data with retry logic and database fallback
        let participantData = {
          id: socket.data.userId,
          name: socket.data.name || 'Unknown User',
          username: socket.data.username || 'unknown',
          avatar: socket.data.avatar || null
        }

        // Enhanced participant data fetching with retry logic
        try {
          const fetchParticipantDataWithRetry = async (participantId: string, maxRetries = 3) => {
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              try {
                console.log(`[CALL] 🔍 Fetching participant data for ${participantId} (attempt ${attempt}/${maxRetries})`)

                const participantUser = await prisma.user.findUnique({
                  where: { id: participantId },
                  select: { id: true, username: true, name: true, avatar: true }
                })

                if (participantUser) {
                  const fetchedData = {
                    id: participantUser.id,
                    name: participantUser.name || participantUser.username,
                    username: participantUser.username,
                    avatar: participantUser.avatar
                  }
                  console.log(`[CALL] ✅ Successfully fetched participant data: ${fetchedData.name} (${participantId})`)
                  return fetchedData
                } else {
                  console.warn(`[CALL] ⚠️ Participant not found in database: ${participantId}`)
                  return null
                }
              } catch (error) {
                console.error(`[CALL] ❌ Attempt ${attempt} failed for participant ${participantId}:`, error)

                if (attempt === maxRetries) {
                  throw error
                }

                // Wait before retry (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 100))
              }
            }
          }

          const fetchedParticipantData = await fetchParticipantDataWithRetry(socket.data.userId)
          if (fetchedParticipantData) {
            participantData = fetchedParticipantData
            console.log(`[CALL] 🎯 Using enhanced participant data: ${participantData.name}`)
          } else {
            console.log(`[CALL] 🔄 Falling back to socket data for participant: ${socket.data.userId}`)
          }
        } catch (error) {
          console.error(`[CALL] ❌ Failed to fetch enhanced participant data for ${socket.data.userId}:`, error)
          console.log(`[CALL] 🔄 Using socket data as final fallback`)
        }

        // Notify all participants about the new joiner
        const participantJoinedData = {
          callId: data.callId,
          participantId: socket.data.userId,
          participantCount: call.participants.size,
          participantData,
          joinType: 'joined_ongoing'
        }

        io.to(`call:${data.callId}`).emit('participant_joined', participantJoinedData)
        console.log(`[CALL] Broadcasted participant_joined for user joining ongoing call:`, participantJoinedData)

        // ENHANCED: Broadcast authoritative state after ongoing call join
        setTimeout(() => {
          const authoritativeState = calculateAuthoritativeParticipantState(call, data.callId, io)

          // Broadcast to all call participants for state consistency
          io.to(`call:${data.callId}`).emit('call_state_update', authoritativeState)

          console.log(`[CALL] 📊 Broadcasted AUTHORITATIVE state after ongoing join: ${authoritativeState.connectedParticipants} connected of ${authoritativeState.participantCount} total (sequence: ${authoritativeState.sequenceNumber})`)
        }, 100)

        // Send current call state to the new joiner
        // FIX: Use actual call room participants for accurate count
        const joinerCallRoom = io.sockets.adapter.rooms.get(`call:${data.callId}`)
        const joinerActiveParticipants = joinerCallRoom ? joinerCallRoom.size : 0
        
        socket.emit('call_state_update', {
          callId: data.callId,
          status: call.status,
          participantCount: call.participants.size,
          connectedParticipants: joinerActiveParticipants
        })

        // ENHANCED: Send existing participants with complete data to the new joiner
        for (const [participantId, state] of call.participantStates.entries()) {
          if (participantId !== socket.data.userId) {
            try {
              // Reuse the same retry logic for existing participants
              const existingParticipantData = await (async () => {
                for (let attempt = 1; attempt <= 3; attempt++) {
                  try {
                    const participantUser = await prisma.user.findUnique({
                      where: { id: participantId },
                      select: { id: true, username: true, name: true, avatar: true }
                    })

                    if (participantUser) {
                      return {
                        id: participantUser.id,
                        name: participantUser.name || participantUser.username,
                        username: participantUser.username,
                        avatar: participantUser.avatar
                      }
                    }
                    return null
                  } catch (error) {
                    if (attempt === 3) throw error
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 100))
                  }
                }
              })()

              // Use intelligent fallback if data fetch failed
              const finalExistingParticipantData = existingParticipantData || (() => {
                const shortId = participantId.slice(-8)
                const fallbackName = participantId.includes('-')
                  ? `User-${participantId.split('-').pop()?.slice(-6).toUpperCase() || shortId.toUpperCase()}`
                  : `User-${shortId.toUpperCase()}`

                console.log(`[CALL] 🔤 Generated fallback for existing participant: ${fallbackName}`)
                return {
                  id: participantId,
                  name: fallbackName,
                  username: `user_${shortId.toLowerCase()}`,
                  avatar: null
                }
              })()

              socket.emit('participant_joined', {
                callId: data.callId,
                participantId,
                participantCount: call.participants.size,
                participantData: finalExistingParticipantData,
                joinType: 'existing'
              })

              console.log(`[CALL] ✅ Sent existing participant data: ${finalExistingParticipantData.name} to new joiner`)
            } catch (error) {
              console.error(`[CALL] ❌ Failed to fetch existing participant ${participantId}:`, error)
              // Ultimate fallback for existing participants
              const ultimateFallback = {
                id: participantId,
                name: `User-${participantId.slice(-6).toUpperCase()}`,
                username: `user_${participantId.slice(-6).toLowerCase()}`,
                avatar: null
              }

              socket.emit('participant_joined', {
                callId: data.callId,
                participantId,
                participantCount: call.participants.size,
                participantData: ultimateFallback,
                joinType: 'existing'
              })
            }
          }
        }

        console.log(`[CALL] User ${socket.data.userId} successfully joined ongoing call ${data.callId}`)
      })

      // Handle connection recovery for stuck participants
      socket.on('connection_recovery_needed', async (data: {
        callId: string
        participantId: string
        reason: string
      }) => {
        console.log(`[CALL] Connection recovery requested for ${data.participantId} in call ${data.callId}, reason: ${data.reason}`)
        
        const call = activeCalls.get(data.callId)
        if (!call) {
          console.log(`[CALL] Cannot recover - call ${data.callId} not found`)
          return
        }
        
        const currentState = call.participantStates.get(data.participantId)
        if (currentState === 'connecting') {
          console.log(`[CALL] Attempting to unstick participant ${data.participantId} from connecting state`)
          
          // Keep participant in connecting state for UI consistency
          call.participantStates.set(data.participantId, 'connecting')
          
          // Send recovery signal to allow WebRTC retry
          const recoveryData = {
            callId: data.callId,
            participantId: data.participantId,
            action: 'retry_connection',
            newState: 'connecting',
            participantStates: Object.fromEntries(call.participantStates.entries())
          }
          
          // Send to the specific participant for retry
          io.to(`user:${data.participantId}`).emit('connection_recovery', recoveryData)
          
          // Also notify other connecting participants about the state change
          const connectingParticipants = Array.from(call.participantStates.entries())
            .filter(([, state]) => state === 'connecting' || state === 'connected')
            .map(([id]) => id)
            .filter(id => id !== data.participantId)
          
          connectingParticipants.forEach(participantId => {
            io.to(`user:${participantId}`).emit('participant_state_update', {
              callId: data.callId,
              participantId: data.participantId,
              state: 'accepted',
              reason: 'connection_recovery'
            })
          })
          
          console.log(`[CALL] Recovery attempted for ${data.participantId} - moved back to accepted state`)
        }
      })

      // ENHANCED: Handle participant data refresh requests
      socket.on('refresh_participant_data', async (data: {
        callId: string
        participantId: string
      }) => {
        console.log(`[CALL] Participant data refresh requested for ${data.participantId} in call ${data.callId}`)

        const call = activeCalls.get(data.callId)
        if (!call) {
          console.log(`[CALL] Cannot refresh data - call ${data.callId} not found`)
          return
        }

        try {
          // Reuse the same retry logic for data refresh
          const refreshedParticipantData = await (async () => {
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                const participantUser = await prisma.user.findUnique({
                  where: { id: data.participantId },
                  select: { id: true, username: true, name: true, avatar: true }
                })

                if (participantUser) {
                  return {
                    id: participantUser.id,
                    name: participantUser.name || participantUser.username,
                    username: participantUser.username,
                    avatar: participantUser.avatar
                  }
                }
                return null
              } catch (error) {
                if (attempt === 3) throw error
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 100))
              }
            }
          })()

          if (refreshedParticipantData) {
            // Send updated participant data to all participants in the call
            io.to(`call:${data.callId}`).emit('participant_data_updated', {
              callId: data.callId,
              participantId: data.participantId,
              participantData: refreshedParticipantData
            })

            console.log(`[CALL] ✅ Refreshed participant data sent: ${refreshedParticipantData.name} (${data.participantId})`)
          } else {
            console.log(`[CALL] ⚠️ No updated data available for participant: ${data.participantId}`)
          }
        } catch (error) {
          console.error(`[CALL] ❌ Failed to refresh participant data for ${data.participantId}:`, error)
        }
      })

      // ENHANCED: Heartbeat mechanism for participant health monitoring
      socket.on('call_heartbeat', (data: { callId: string; timestamp: number }) => {
        if (socket.data.userId) {
          const heartbeatId = `${socket.data.userId}-${data.callId}`
          participantHeartbeats.set(heartbeatId, {
            lastSeen: Date.now(),
            callId: data.callId,
            userId: socket.data.userId
          })
        }
      })

      socket.on('disconnect', async () => {
          console.log(`User disconnected: ${socket.id}`)

          // Clean up heartbeats for disconnected user
          if (socket.data.userId) {
            const keysToDelete = Array.from(participantHeartbeats.keys())
              .filter(key => key.startsWith(`${socket.data.userId}-`))
            keysToDelete.forEach(key => participantHeartbeats.delete(key))
          }
          
          // Handle active calls when user disconnects
          if (socket.data.userId) {
            // Find any active calls this user is in
            for (const [callId, call] of activeCalls.entries()) {
              if (call.participants.has(socket.data.userId)) {
                console.log(`[CALL] User ${socket.data.userId} disconnected during active call ${callId}`)

                // FIRST: Emit participant_left event BEFORE modifying call state
                const participantCountAfterLeaving = call.participants.size - 1
                io.to(`call:${callId}`).emit('participant_left', {
                  callId: callId,
                  participantId: socket.data.userId,
                  participantCount: participantCountAfterLeaving,
                  reason: 'disconnected'
                })

                console.log(`[CALL] Emitted participant_left for ${socket.data.userId}, remaining count will be: ${participantCountAfterLeaving}`)

                // Remove user from call and ready list
                call.participants.delete(socket.data.userId)
                call.participantStates.delete(socket.data.userId)
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

      // ENHANCED: Start periodic group call monitoring
      setInterval(() => {
        if (activeCalls.size > 0) {
          console.log(`[CALL] 📊 PERIODIC MONITORING - Active calls: ${activeCalls.size}`)

          activeCalls.forEach((call, callId) => {
            if (call.isGroupCall) {
              const callRoom = io.sockets.adapter.rooms.get(`call:${callId}`)
              const roomSize = callRoom ? callRoom.size : 0
              const participantStates = Object.fromEntries(call.participantStates.entries())

              console.log(`[CALL] 📋 Group call ${callId}: {status: ${call.status}, participants: ${call.participants.size}, roomSize: ${roomSize}, states: ${JSON.stringify(participantStates)}}`)

              // Warning for mismatched counts
              if (roomSize !== call.participants.size && call.status === 'connected') {
                console.warn(`[CALL] ⚠️ COUNT MISMATCH in ${callId}: Room has ${roomSize} but participants map has ${call.participants.size}`)
              }
            }
          })
        }
      }, 30000) // Monitor every 30 seconds
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
  
  // Always update the global instance in case it was reset
  if (serverRes.socket?.server?.io) {
    setGlobalSocketIO(serverRes.socket.server.io)
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