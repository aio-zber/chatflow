import { NextApiRequest } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]'
import { NextApiResponseServerIO } from '@/lib/socket'
import { z } from 'zod'

const reactionSchema = z.object({
  messageId: z.string(),
  emoji: z.string().min(1).max(4),
})

export default async function handler(req: NextApiRequest, res: NextApiResponseServerIO) {
  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { messageId, emoji } = reactionSchema.parse(req.body)

    // Verify user has access to the message
    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        OR: [
          // User is in the conversation
          {
            conversation: {
              participants: {
                some: { userId: session.user.id }
              }
            }
          },
          // User is in the channel
          {
            channel: {
              members: {
                some: { userId: session.user.id }
              }
            }
          }
        ]
      },
      select: {
        id: true,
        conversationId: true,
        channelId: true,
      }
    })

    if (!message) {
      return res.status(404).json({ error: 'Message not found' })
    }

    if (req.method === 'POST') {
      // Add or update reaction
      const reaction = await prisma.messageReaction.upsert({
        where: {
          messageId_userId_emoji: {
            messageId,
            userId: session.user.id,
            emoji,
          }
        },
        update: {
          createdAt: new Date(),
        },
        create: {
          messageId,
          userId: session.user.id,
          emoji,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              name: true,
              avatar: true,
            }
          }
        }
      })

      // Get all reactions for this message to send updated counts
      const allReactions = await prisma.messageReaction.findMany({
        where: { messageId },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              name: true,
              avatar: true,
            }
          }
        }
      })

      // Group reactions by emoji
      const reactionCounts = allReactions.reduce((acc, reaction) => {
        if (!acc[reaction.emoji]) {
          acc[reaction.emoji] = {
            emoji: reaction.emoji,
            count: 0,
            users: [] as any[],
          }
        }
        acc[reaction.emoji].count++
        acc[reaction.emoji].users.push(reaction.user)
        return acc
      }, {} as Record<string, { emoji: string; count: number; users: any[] }>)

      // Emit real-time update
      if (res.socket?.server?.io) {
        const roomName = message.conversationId 
          ? `conversation:${message.conversationId}` 
          : `channel:${message.channelId}`
        
        res.socket.server.io.to(roomName).emit('message-reaction-updated', {
          messageId,
          reactions: Object.values(reactionCounts),
        })
      }

      return res.status(201).json({ 
        reaction,
        reactions: Object.values(reactionCounts),
      })

    } else if (req.method === 'DELETE') {
      // Remove reaction
      const deleted = await prisma.messageReaction.deleteMany({
        where: {
          messageId,
          userId: session.user.id,
          emoji,
        }
      })

      if (deleted.count === 0) {
        return res.status(404).json({ error: 'Reaction not found' })
      }

      // Get remaining reactions for this message
      const remainingReactions = await prisma.messageReaction.findMany({
        where: { messageId },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              name: true,
              avatar: true,
            }
          }
        }
      })

      // Group reactions by emoji
      const reactionCounts = remainingReactions.reduce((acc, reaction) => {
        if (!acc[reaction.emoji]) {
          acc[reaction.emoji] = {
            emoji: reaction.emoji,
            count: 0,
            users: [] as any[],
          }
        }
        acc[reaction.emoji].count++
        acc[reaction.emoji].users.push(reaction.user)
        return acc
      }, {} as Record<string, { emoji: string; count: number; users: any[] }>)

      // Emit real-time update
      if (res.socket?.server?.io) {
        const roomName = message.conversationId 
          ? `conversation:${message.conversationId}` 
          : `channel:${message.channelId}`
        
        res.socket.server.io.to(roomName).emit('message-reaction-updated', {
          messageId,
          reactions: Object.values(reactionCounts),
        })
      }

      return res.status(200).json({ 
        success: true,
        reactions: Object.values(reactionCounts),
      })

    } else {
      return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.issues })
    }
    console.error('Reaction error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}