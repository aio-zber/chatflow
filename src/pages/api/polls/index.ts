import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]'
import { prisma } from '@/lib/prisma'
import { getIO, getSocketInstance } from '@/lib/socket'
import { z } from 'zod'

const createPollSchema = z.object({
  question: z.string().min(1).max(500),
  options: z.array(z.string().min(1).max(200)).min(2).max(10),
  conversationId: z.string(),
  allowMultiple: z.boolean().optional().default(false),
  isAnonymous: z.boolean().optional().default(false),
  expiresInMinutes: z.number().min(1).max(10080).optional() // max 1 week
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method === 'POST') {
    return handleCreatePoll(req, res, session.user.id)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

async function handleCreatePoll(req: NextApiRequest, res: NextApiResponse, userId: string) {
  try {
    const { question, options, conversationId, allowMultiple, isAnonymous, expiresInMinutes } = 
      createPollSchema.parse(req.body)

    // Verify user is a participant in the conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        participants: {
          some: { userId }
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
                avatar: true
              }
            }
          }
        }
      }
    })

    if (!conversation) {
      return res.status(403).json({ error: 'Not a participant in this conversation' })
    }

    // Calculate expiration date
    const expiresAt = expiresInMinutes 
      ? new Date(Date.now() + expiresInMinutes * 60 * 1000)
      : null

    // Create poll in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the message for the poll
      const message = await tx.message.create({
        data: {
          content: `📊 ${question}`,
          type: 'poll',
          senderId: userId,
          conversationId: conversationId,
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              name: true,
              avatar: true
            }
          }
        }
      })

      // Create the poll
      const poll = await tx.poll.create({
        data: {
          question,
          allowMultiple,
          isAnonymous,
          expiresAt,
          createdById: userId,
          conversationId,
          messageId: message.id,
          options: {
            create: options.map((text, index) => ({
              text,
              order: index
            }))
          }
        },
        include: {
          options: {
            orderBy: { order: 'asc' },
            include: {
              _count: {
                select: { votes: true }
              }
            }
          },
          createdBy: {
            select: {
              id: true,
              username: true,
              name: true,
              avatar: true
            }
          },
          _count: {
            select: { votes: true }
          }
        }
      })

      return { message, poll }
    })

    // Emit socket event for real-time updates - ensure socket instance is available
    let io = getIO()
    if (!io) {
      console.log('Socket IO not available, attempting to get instance...')
      io = getSocketInstance(req, res)
    }
    console.log('Socket IO instance:', io ? 'Available' : 'Not available')
    console.log('Socket IO connected sockets:', io ? io.sockets.sockets.size : 0)
    console.log('Socket IO rooms:', io ? Array.from(io.sockets.adapter.rooms.keys()).slice(0, 10) : 'None')
    
    if (io) {
      const pollData = {
        id: result.poll.id,
        question: result.poll.question,
        allowMultiple: result.poll.allowMultiple,
        isAnonymous: result.poll.isAnonymous,
        expiresAt: result.poll.expiresAt,
        createdAt: result.poll.createdAt,
        createdBy: result.poll.createdBy,
        options: result.poll.options.map(option => ({
          id: option.id,
          text: option.text,
          order: option.order,
          voteCount: option._count.votes,
          hasVoted: false // User hasn't voted yet
        })),
        totalVotes: result.poll._count.votes,
        messageId: result.message.id
      }

      const messageData = {
        id: result.message.id,
        content: result.message.content,
        type: result.message.type,
        status: 'sent',
        senderId: result.message.senderId,
        conversationId: result.message.conversationId,
        channelId: null,
        replyToId: null,
        createdAt: result.message.createdAt,
        updatedAt: result.message.updatedAt,
        sender: result.message.sender,
        reactions: [],
        attachments: [],
        poll: pollData
      }

      console.log('Emitting poll creation to participants:', conversation.participants.map(p => p.userId))
      console.log('Conversation ID:', conversationId)
      console.log('Message data type:', messageData.type)
      
      // Check if conversation room exists and has members
      const conversationRoom = io.sockets.adapter.rooms.get(`conversation:${conversationId}`)
      console.log(`Conversation room size: ${conversationRoom?.size || 0}`)
      if (conversationRoom) {
        console.log('Sockets in conversation room:')
        conversationRoom.forEach(socketId => {
          const connectedSocket = io.sockets.sockets.get(socketId)
          if (connectedSocket) {
            console.log(`  - ${socketId} (User: ${connectedSocket.data.userId || 'unknown'})`)
          }
        })
      }

      // Emit to all participants
      conversation.participants.forEach(participant => {
        console.log(`Emitting to user:${participant.userId}`)
        
        // Check if user room exists
        const userRoom = io.sockets.adapter.rooms.get(`user:${participant.userId}`)
        console.log(`User room user:${participant.userId} size: ${userRoom?.size || 0}`)
        
        io.to(`user:${participant.userId}`).emit('new-message', messageData)
      })

      console.log(`Emitting to conversation:${conversationId}`)
      io.to(`conversation:${conversationId}`).emit('new-message', messageData)
      
      console.log('All poll creation socket events emitted')
    } else {
      console.error('Socket IO not available for poll creation')
    }

    return res.status(201).json({
      success: true,
      poll: result.poll,
      message: result.message
    })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.issues })
    }
    console.error('Create poll error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}