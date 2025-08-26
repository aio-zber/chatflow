import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { prisma } from '@/lib/prisma'
import { getIO } from '@/lib/socket'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { messageId } = req.query
    if (!messageId || typeof messageId !== 'string') {
      return res.status(400).json({ error: 'Message ID is required' })
    }

    // Verify the message exists and user has permission
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            avatar: true,
          },
        },
        conversation: {
          include: {
            participants: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    })

    if (!message) {
      return res.status(404).json({ error: 'Message not found' })
    }

    // Check if user is a participant in the conversation
    const isParticipant = message.conversation.participants.some(
      (p) => p.userId === session.user.id
    )

    if (!isParticipant) {
      return res.status(403).json({ error: 'Not authorized to access this message' })
    }

    switch (req.method) {
      case 'PUT':
        return handleUpdateMessage(req, res, message, session.user.id)
      case 'DELETE':
        return handleDeleteMessage(req, res, message, session.user.id)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Error in message API:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function handleUpdateMessage(
  req: NextApiRequest,
  res: NextApiResponse,
  message: any,
  userId: string
) {
  // Only allow editing own messages
  if (message.senderId !== userId) {
    return res.status(403).json({ error: 'Can only edit your own messages' })
  }

  const { content } = req.body
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Content is required' })
  }

  try {
    const updatedMessage = await prisma.message.update({
      where: { id: message.id },
      data: {
        content: content.trim(),
        updatedAt: new Date(),
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            avatar: true,
          },
        },
        replyTo: {
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                name: true,
                avatar: true,
              },
            },
          },
        },
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                name: true,
              },
            },
          },
        },
        attachments: true,
      },
    })

    // Emit socket event for real-time updates
    const { getSocketInstance } = await import('@/lib/socket')
    let io = getIO()
    
    // If socket is not available, try to initialize it
    if (!io) {
      console.log('API: Socket IO not available for message update, attempting to initialize...')
      try {
        io = getSocketInstance(req, res)
        console.log('API: Socket IO initialized for message update')
      } catch (error) {
        console.error('API: Failed to initialize Socket IO for message update:', error)
      }
    }
    
    console.log('API: Socket IO instance available:', !!io)
    if (io) {
      console.log('API: Emitting message-updated event for message:', updatedMessage.id)
      console.log('API: Message conversation ID:', message.conversationId)
      console.log('API: Number of participants:', message.conversation.participants.length)
      console.log('API: Socket.IO connected clients count:', io.engine.clientsCount)
      
      // Transform the message to match frontend interface
      const transformedMessage = {
        id: updatedMessage.id,
        content: updatedMessage.content,
        type: updatedMessage.type,
        status: updatedMessage.status,
        senderId: updatedMessage.senderId,
        conversationId: updatedMessage.conversationId,
        channelId: updatedMessage.channelId,
        replyToId: updatedMessage.replyToId,
        createdAt: updatedMessage.createdAt,
        updatedAt: updatedMessage.updatedAt,
        sender: {
          id: updatedMessage.sender.id,
          username: updatedMessage.sender.username,
          name: updatedMessage.sender.name,
          avatar: updatedMessage.sender.avatar,
        },
        replyTo: updatedMessage.replyTo ? {
          id: updatedMessage.replyTo.id,
          content: updatedMessage.replyTo.content,
          sender: {
            id: updatedMessage.replyTo.sender.id,
            username: updatedMessage.replyTo.sender.username,
            name: updatedMessage.replyTo.sender.name,
          }
        } : undefined,
        reactions: updatedMessage.reactions.map((reaction: any) => ({
          id: reaction.id,
          emoji: reaction.emoji,
          userId: reaction.userId,
          user: {
            id: reaction.user.id,
            username: reaction.user.username,
          }
        })),
        attachments: updatedMessage.attachments.map((attachment: any) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          fileSize: attachment.fileSize,
          fileType: attachment.fileType,
          fileUrl: attachment.fileUrl,
          duration: attachment.duration,
        }))
      }
      
      // Emit to all participants in the conversation
      message.conversation.participants.forEach((participant: any) => {
        console.log(`API: Emitting message-updated to user room: user:${participant.userId}`)
        io.to(`user:${participant.userId}`).emit('message-updated', transformedMessage)
      })

      // Also emit to the conversation room
      console.log(`API: Emitting message-updated to conversation room: conversation:${message.conversationId}`)
      io.to(`conversation:${message.conversationId}`).emit('message-updated', transformedMessage)
      
      // Log room members for debugging
      const conversationRoom = io.sockets.adapter.rooms.get(`conversation:${message.conversationId}`)
      console.log(`API: Conversation room members:`, conversationRoom ? Array.from(conversationRoom) : 'none')
    } else {
      console.warn('Socket.IO instance not available for message-updated event')
    }

    return res.status(200).json({ message: updatedMessage })
  } catch (error) {
    console.error('Error updating message:', error)
    return res.status(500).json({ error: 'Failed to update message' })
  }
}

async function handleDeleteMessage(
  req: NextApiRequest,
  res: NextApiResponse,
  message: any,
  userId: string
) {
  // Only allow deleting own messages
  if (message.senderId !== userId) {
    return res.status(403).json({ error: 'Can only delete your own messages' })
  }

  try {
    // Instead of deleting, update the message to show it was deleted
    // Delete related data first (due to foreign key constraints)
    await prisma.messageReaction.deleteMany({
      where: { messageId: message.id },
    })

    await prisma.messageAttachment.deleteMany({
      where: { messageId: message.id },
    })

    // Update any messages that reply to this one to reference the deleted message
    await prisma.message.updateMany({
      where: { replyToId: message.id },
      data: { replyToId: null },
    })

    // Update the message to show it was deleted instead of removing it
    const updatedMessage = await prisma.message.update({
      where: { id: message.id },
      data: {
        content: '',
        type: 'deleted',
        status: 'sent',
        updatedAt: new Date(),
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            avatar: true,
          },
        },
        replyTo: {
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                name: true,
                avatar: true,
              },
            },
          },
        },
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                name: true,
              },
            },
          },
        },
        attachments: true,
      },
    })

    // Emit socket event for real-time updates
    let io = getIO()
    
    // If socket is not available, try to initialize it
    if (!io) {
      console.log('API: Socket IO not available for message delete, attempting to initialize...')
      try {
        const { getSocketInstance } = await import('@/lib/socket')
        io = getSocketInstance(req, res)
        console.log('API: Socket IO initialized for message delete')
      } catch (error) {
        console.error('API: Failed to initialize Socket IO for message delete:', error)
      }
    }
    
    console.log('API: Socket IO instance available for delete:', !!io)
    if (io) {
      console.log('API: Emitting message-updated event for deleted message:', updatedMessage.id)
      console.log('API: Delete conversation ID:', message.conversationId)
      console.log('API: Socket.IO connected clients count:', io.engine.clientsCount)
      
      // Transform the message to match frontend interface
      const transformedMessage = {
        id: updatedMessage.id,
        content: updatedMessage.content,
        type: updatedMessage.type,
        status: updatedMessage.status,
        senderId: updatedMessage.senderId,
        conversationId: updatedMessage.conversationId,
        channelId: updatedMessage.channelId,
        replyToId: updatedMessage.replyToId,
        createdAt: updatedMessage.createdAt,
        updatedAt: updatedMessage.updatedAt,
        sender: {
          id: updatedMessage.sender.id,
          username: updatedMessage.sender.username,
          name: updatedMessage.sender.name,
          avatar: updatedMessage.sender.avatar,
        },
        replyTo: updatedMessage.replyTo ? {
          id: updatedMessage.replyTo.id,
          content: updatedMessage.replyTo.content,
          sender: {
            id: updatedMessage.replyTo.sender.id,
            username: updatedMessage.replyTo.sender.username,
            name: updatedMessage.replyTo.sender.name,
          }
        } : undefined,
        reactions: updatedMessage.reactions.map((reaction: any) => ({
          id: reaction.id,
          emoji: reaction.emoji,
          userId: reaction.userId,
          user: {
            id: reaction.user.id,
            username: reaction.user.username,
          }
        })),
        attachments: updatedMessage.attachments.map((attachment: any) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          fileSize: attachment.fileSize,
          fileType: attachment.fileType,
          fileUrl: attachment.fileUrl,
          duration: attachment.duration,
        }))
      }
      
      // Emit to all participants in the conversation
      message.conversation.participants.forEach((participant: any) => {
        console.log(`API: Emitting message-updated to user room: user:${participant.userId}`)
        io.to(`user:${participant.userId}`).emit('message-updated', transformedMessage)
      })

      // Also emit to the conversation room
      console.log(`API: Emitting message-updated to conversation room: conversation:${message.conversationId}`)
      io.to(`conversation:${message.conversationId}`).emit('message-updated', transformedMessage)
      
      // Log room members for debugging
      const conversationRoom = io.sockets.adapter.rooms.get(`conversation:${message.conversationId}`)
      console.log(`API: Conversation room members for delete:`, conversationRoom ? Array.from(conversationRoom) : 'none')
    } else {
      console.warn('Socket.IO instance not available for message-updated event')
    }

    return res.status(200).json({ message: updatedMessage })
  } catch (error) {
    console.error('Error deleting message:', error)
    return res.status(500).json({ error: 'Failed to delete message' })
  }
}