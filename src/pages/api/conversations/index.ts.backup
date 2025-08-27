import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]'
import { corsMiddleware } from '@/middleware/cors'
// Dynamic import to avoid issues during build
let getSocketInstance: any
import { z } from 'zod'

const createConversationSchema = z.object({
  userId: z.string(),
  isGroup: z.boolean().default(false),
  name: z.string().optional(),
  description: z.string().optional(),
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CRITICAL: Immediate logging before ANY processing
  console.log(`🚨🚨🚨 HANDLER ENTRY: ${req.method} ${req.url} AT ${new Date().toISOString()}`)
  
  try {
    // CRITICAL: Log every single request that reaches this handler
    console.log(`🚨 CONVERSATIONS API CALLED: ${req.method} ${req.url}`)
    console.log(`🚨 REQUEST BODY:`, req.body)
    console.log(`🚨 REQUEST HEADERS:`, {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']?.substring(0, 50),
      'origin': req.headers.origin,
      'cookie': req.headers.cookie ? 'Present' : 'Missing'
    })
    console.log(`🚨 TIMESTAMP:`, new Date().toISOString())
    
    // Handle CORS
    if (corsMiddleware(req, res)) {
      console.log(`🚨 CORS PREFLIGHT HANDLED`)
      return // CORS preflight handled
    }
  } catch (topLevelError: any) {
    console.error('🚨 CRITICAL ERROR AT API ENTRY POINT:', topLevelError)
    return res.status(500).json({ 
      error: 'Critical API entry error',
      details: topLevelError?.message,
      timestamp: new Date().toISOString()
    })
  }

  try {
    let session: any
    let user: any

    try {
    session = await getServerSession(req, res, authOptions)
    
    // Enhanced session debugging for Railway
    console.log('Session check:', {
      hasSession: !!session,
      hasUser: !!session?.user,
      userId: session?.user?.id || 'undefined',
      userEmail: session?.user?.email || 'undefined',
      method: req.method,
      cookies: Object.keys(req.cookies || {}),
      hasAuthCookie: !!(req.cookies['next-auth.session-token'] || req.cookies['__Secure-next-auth.session-token'])
    })
    
    if (!session?.user?.id) {
      console.error('Authentication failed - no valid session or user ID', {
        sessionExists: !!session,
        userExists: !!session?.user,
        userIdExists: !!session?.user?.id,
        cookies: Object.keys(req.cookies || {}),
        userAgent: req.headers['user-agent']?.substring(0, 50)
      })
      return res.status(401).json({ 
        error: 'Unauthorized', 
        details: process.env.NODE_ENV !== 'production' ? 'No valid session found' : undefined 
      })
    }

    user = session.user
  } catch (sessionError: any) {
    console.error('Session retrieval error:', {
      error: sessionError?.message,
      stack: sessionError?.stack,
      type: sessionError?.constructor?.name,
      cookies: Object.keys(req.cookies || {})
    })
    return res.status(401).json({ 
      error: 'Session retrieval failed', 
      details: process.env.NODE_ENV !== 'production' ? sessionError?.message : undefined 
    })
  }

  if (req.method === 'GET') {
    try {
      // Get blocked users
      const blockedUsers = await prisma.userBlock.findMany({
        where: {
          OR: [
            { blockerId: user.id },
            { blockedId: user.id }
          ]
        },
        select: {
          blockerId: true,
          blockedId: true,
        }
      })

      const blockedUserIds = blockedUsers.flatMap(block => 
        block.blockerId === user.id ? [block.blockedId] : [block.blockerId]
      )

      const conversations = await prisma.conversation.findMany({
        where: {
          participants: {
            some: { userId: user.id }
          },
          // For direct messages, exclude conversations with blocked users
          ...(blockedUserIds.length > 0 && {
            NOT: {
              AND: [
                { isGroup: false },
                {
                  participants: {
                    some: {
                      userId: { in: blockedUserIds }
                    }
                  }
                }
              ]
            }
          })
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  name: true,
                  avatar: true,
                  isOnline: true,
                  lastSeen: true,
                }
              }
            }
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              sender: {
                select: {
                  username: true,
                  name: true,
                }
              }
            }
          }
        },
        orderBy: { updatedAt: 'desc' }
      })

      const conversationsWithUnread = await Promise.all(
        conversations.map(async (conversation) => {
          const participant = conversation.participants.find(p => p.userId === user.id)
          const unreadCount = await prisma.message.count({
            where: {
              conversationId: conversation.id,
              createdAt: {
                gt: participant?.lastReadAt || new Date(0)
              },
              senderId: { not: user.id }
            }
          })

          return {
            ...conversation,
            unreadCount,
            otherParticipants: conversation.participants.filter(p => p.userId !== user.id)
          }
        })
      )

      res.json({ conversations: conversationsWithUnread })
    } catch (error: any) {
      console.error('Get conversations error:', error)
      
      // Enhanced error logging for Railway debugging
      console.error('GET Error details:', {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
        code: error?.code,
        meta: error?.meta
      })
      
      // Return more specific error information in development
      if (process.env.NODE_ENV !== 'production') {
        return res.status(500).json({ 
          error: 'Internal server error', 
          details: error?.message,
          type: error?.constructor?.name
        })
      }
      
      res.status(500).json({ error: 'Internal server error' })
    }
  } else if (req.method === 'POST') {
    try {
      // Enhanced request validation logging for Railway
      console.log('POST request data:', {
        body: req.body,
        headers: req.headers['content-type'],
        method: req.method
      })
      
      const validationResult = createConversationSchema.safeParse(req.body)
      
      if (!validationResult.success) {
        console.error('Validation failed:', validationResult.error.issues)
        return res.status(400).json({ 
          error: 'Invalid input', 
          details: validationResult.error.issues 
        })
      }

      const { userId, isGroup, name, description } = validationResult.data
      
      console.log('Parsed data:', { userId, isGroup, name, description, currentUserId: user.id })
      
      // Prevent users from creating conversations with themselves
      if (!isGroup && userId === user.id) {
        console.error('User attempting to create conversation with themselves:', user.id)
        return res.status(400).json({ error: 'Cannot create conversation with yourself' })
      }
      
      // Check if target user exists
      try {
        console.log('Checking if target user exists:', userId)
        const targetUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, username: true, name: true }
        })
        
        if (!targetUser) {
          console.error('Target user not found:', userId)
          return res.status(404).json({ error: 'User not found' })
        }
        
        console.log('Target user found:', targetUser)
      } catch (dbError: any) {
        console.error('Database error while finding target user:', {
          error: dbError?.message,
          userId,
          timestamp: new Date().toISOString()
        })
        throw dbError
      }

      if (!isGroup) {
        // Check if either user has blocked the other
        const blockExists = await prisma.userBlock.findFirst({
          where: {
            OR: [
              {
                blockerId: user.id,
                blockedId: userId,
              },
              {
                blockerId: userId,
                blockedId: user.id,
              }
            ]
          }
        })

        if (blockExists) {
          return res.status(403).json({ 
            error: 'Cannot create conversation. User relationship blocked.',
            blocked: true
          })
        }

        const existingConversation = await prisma.conversation.findFirst({
          where: {
            isGroup: false,
            AND: [
              {
                participants: {
                  some: { userId: user.id }
                }
              },
              {
                participants: {
                  some: { userId: userId }
                }
              }
            ]
          },
          include: {
            participants: true
          }
        })

        if (existingConversation && existingConversation.participants.length === 2) {
          return res.json({ conversation: existingConversation })
        }
      }

      console.log('Creating new conversation between users:', { currentUserId: user.id, targetUserId: userId, isGroup })
      
      let conversation
      try {
        conversation = await prisma.conversation.create({
          data: {
            name,
            description,
            isGroup,
            participants: {
              create: [
                { 
                  userId: user.id, 
                  role: isGroup ? 'admin' : 'member',
                  lastReadAt: new Date()
                },
                { 
                  userId, 
                  role: 'member',
                  lastReadAt: new Date()
                }
              ]
            }
          },
          include: {
            participants: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    name: true,
                    avatar: true,
                    isOnline: true,
                    lastSeen: true,
                  }
                }
              }
            },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            }
          }
        })
        
        console.log('Conversation created successfully:', { 
          conversationId: conversation.id, 
          participantCount: conversation.participants.length 
        })
      } catch (dbError: any) {
        console.error('Database error during conversation creation:', {
          error: dbError?.message,
          code: dbError?.code,
          meta: dbError?.meta,
          currentUserId: user.id,
          targetUserId: userId,
          isGroup,
          timestamp: new Date().toISOString()
        })
        throw dbError
      }

      // Emit socket event to all participants
      try {
        console.log('Attempting to initialize socket for conversation broadcast')
        if (!getSocketInstance) {
          const { getSocketInstance: socketFn } = await import('@/lib/socket')
          getSocketInstance = socketFn
        }
        const io = getSocketInstance(req, res)
        console.log('Socket instance obtained successfully')
        
        const conversationWithExtras = {
          ...conversation,
          unreadCount: 0,
          otherParticipants: conversation.participants.filter(p => p.userId !== user.id)
        }

        // Emit to each participant using their user room
        conversation.participants.forEach(participant => {
          if (participant.userId !== user.id) {
            console.log(`Emitting new-conversation to participant room: user:${participant.userId}`)
            io.to(`user:${participant.userId}`).emit('new-conversation', {
              ...conversationWithExtras,
              otherParticipants: conversation.participants.filter(p => p.userId !== participant.userId)
            })
          }
        })
        console.log('Socket emission completed successfully')
      } catch (socketError: any) {
        console.error('Socket emission error:', {
          error: socketError?.message,
          stack: socketError?.stack,
          type: socketError?.constructor?.name
        })
        // Don't fail the API call if socket emission fails
      }

      res.status(201).json({ conversation })
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.issues })
      }
      console.error('Create conversation error:', error)
      
      // Enhanced error logging for production debugging
      console.error('POST Error details:', {
        name: error?.name,
        message: error?.message,
        stack: error?.stack?.substring(0, 500), // Truncate stack trace
        code: error?.code,
        meta: error?.meta,
        userId: user?.id,
        requestBody: req.body,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV
      })
      
      // Return error details in all environments for debugging production issues
      return res.status(500).json({ 
        error: 'Internal server error', 
        details: process.env.NODE_ENV !== 'production' ? error?.message : 'Conversation creation failed',
        type: error?.constructor?.name,
        timestamp: new Date().toISOString()
      })
    }
  } else {
    console.log(`🚨 METHOD NOT ALLOWED: ${req.method}`)
    res.status(405).json({ error: 'Method not allowed' })
  }

  } catch (handlerError: any) {
    console.error('🚨 UNHANDLED ERROR IN CONVERSATIONS API:', {
      error: handlerError?.message,
      stack: handlerError?.stack,
      method: req.method,
      url: req.url,
      timestamp: new Date().toISOString()
    })
    
    // Ensure we always send a response
    if (!res.headersSent) {
      return res.status(500).json({ 
        error: 'Unhandled server error',
        details: process.env.NODE_ENV !== 'production' ? handlerError?.message : 'Internal server error',
        timestamp: new Date().toISOString()
      })
    }
  }
}