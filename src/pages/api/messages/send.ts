import { NextApiRequest } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]'
import { NextApiResponseServerIO } from '@/lib/socket'
import { z } from 'zod'

const attachmentSchema = z.object({
  fileName: z.string(),
  fileSize: z.number().int().nonnegative(),
  fileType: z.string(),
  fileUrl: z.string(),
  duration: z.number().int().nonnegative().optional(),
})

const sendMessageSchema = z.object({
  content: z.string().max(2000).optional(),
  type: z.enum(['text', 'image', 'file', 'voice', 'system', 'call']).default('text'),
  conversationId: z.string().optional(),
  channelId: z.string().optional(),
  replyToId: z.string().optional(),
  attachments: z.array(attachmentSchema).optional(),
}).refine((data) => {
  // Require either content or attachments
  return (data.content && data.content.trim().length > 0) || (data.attachments && data.attachments.length > 0)
}, {
  path: ['content'],
  message: 'Either content or attachments is required'
})

export default async function handler(req: NextApiRequest, res: NextApiResponseServerIO) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { content, type, conversationId, channelId, replyToId, attachments } = sendMessageSchema.parse(req.body)

    if (!conversationId && !channelId) {
      return res.status(400).json({ error: 'Either conversationId or channelId is required' })
    }

    let receiverId: string | undefined

    if (conversationId) {
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          participants: {
            some: { userId: session.user.id }
          }
        },
        include: {
          participants: {
            where: { userId: { not: session.user.id } },
            take: 1
          }
        }
      })

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' })
      }

      if (!conversation.isGroup && conversation.participants.length > 0) {
        receiverId = conversation.participants[0].userId

        // Check if either user has blocked the other
        const blockExists = await prisma.userBlock.findFirst({
          where: {
            OR: [
              {
                blockerId: session.user.id,
                blockedId: receiverId,
              },
              {
                blockerId: receiverId,
                blockedId: session.user.id,
              }
            ]
          }
        })

        if (blockExists) {
          return res.status(403).json({ 
            error: 'Cannot send message. User relationship blocked.',
            blocked: true
          })
        }
      }
    }

    if (channelId) {
      const channel = await prisma.channel.findFirst({
        where: {
          id: channelId,
          members: {
            some: { userId: session.user.id }
          }
        }
      })

      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' })
      }
    }

    const message = await prisma.message.create({
      data: {
        content: content || '',
        type,
        status: 'unread', // Status for recipients; sender sees 'sent' initially, then 'read' when recipients read it
        senderId: session.user.id,
        receiverId,
        conversationId,
        channelId,
        replyToId,
        ...(attachments && attachments.length > 0
          ? {
              attachments: {
                create: attachments.map((att) => ({
                  fileName: att.fileName,
                  fileSize: att.fileSize,
                  fileType: att.fileType,
                  fileUrl: att.fileUrl,
                })),
              },
            }
          : {}),
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            avatar: true,
          }
        },
        replyTo: {
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                name: true,
              }
            }
          }
        },
        attachments: true,
      }
    })

    if (conversationId) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() }
      })
    }

    // Create notification for receivers
    if (receiverId) {
      await prisma.notification.create({
        data: {
          userId: receiverId,
          type: 'new_message',
          title: 'New Message',
          content: `${message.sender.name || message.sender.username}: ${
            (content || (attachments?.length ? (type === 'voice' ? 'Sent a voice message' : 'Sent an attachment') : '')).toString().substring(0, 100)
          }${(content || '').length > 100 ? '...' : ''}`,
        }
      })
    }

    // Ensure Socket.IO server is available for real-time updates
    let io = res.socket?.server?.io
    if (!io) {
      console.log('Socket.IO server not found, initializing...')
      const { getSocketInstance } = require('@/lib/socket')
      io = getSocketInstance(req, res)
    }

    if (io) {
      const roomName = conversationId ? `conversation:${conversationId}` : `channel:${channelId}`
      console.log(`Emitting new-message to room: ${roomName}`, message.id)
      io.to(roomName).emit('new-message', message)
      
      // Emit notification to specific user if direct message
      if (receiverId) {
        console.log(`Emitting new-notification to user: ${receiverId}`)
        io.emit('new-notification', {
          userId: receiverId,
          type: 'new_message',
          title: 'New Message',
          content: `${message.sender.name || message.sender.username}: ${
            (content || (attachments?.length ? (type === 'voice' ? 'Sent a voice message' : 'Sent an attachment') : '')).toString().substring(0, 100)
          }${(content || '').length > 100 ? '...' : ''}`,
          messageId: message.id,
          conversationId,
        })
      }
    } else {
      console.error('Failed to get Socket.IO instance for real-time updates')
    }

    res.status(201).json({ message })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.issues })
    }
    console.error('Send message error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}