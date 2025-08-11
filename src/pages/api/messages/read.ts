import { NextApiRequest } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]'
import { NextApiResponseServerIO } from '@/lib/socket'
import { z } from 'zod'

const markReadSchema = z.object({
  messageIds: z.array(z.string()),
  conversationId: z.string().optional(),
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
    const { messageIds, conversationId } = markReadSchema.parse(req.body)

    // Verify user has access to these messages
    const messages = await prisma.message.findMany({
      where: {
        id: { in: messageIds },
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
        senderId: true,
        conversationId: true,
        channelId: true,
      }
    })

    if (messages.length === 0) {
      return res.status(404).json({ error: 'No accessible messages found' })
    }

    // Update message status to 'read' for messages not sent by the current user
    const messagesToUpdate = messages.filter(msg => msg.senderId !== session.user.id)
    
    if (messagesToUpdate.length > 0) {
      await prisma.message.updateMany({
        where: {
          id: { in: messagesToUpdate.map(m => m.id) },
        },
        data: {
          status: 'read',
        }
      })

      // Update lastReadAt timestamp for conversation participant
      if (conversationId) {
        await prisma.conversationParticipant.update({
          where: {
            userId_conversationId: {
              userId: session.user.id,
              conversationId,
            }
          },
          data: {
            lastReadAt: new Date(),
          }
        })
      }

      // Mark related message notifications as read for this user
      if (conversationId) {
        // For specific conversation, mark notifications related to this conversation's messages
        const conversationParticipants = await prisma.conversationParticipant.findMany({
          where: { conversationId, userId: { not: session.user.id } },
          include: { user: { select: { username: true, name: true } } }
        })

        // Build content filters to match notifications from this conversation
        const contentFilters = conversationParticipants.map(p => [
          { content: { contains: `${p.user.name || p.user.username}:` } },
          { content: { contains: `${p.user.username}:` } }
        ]).flat()

        if (contentFilters.length > 0) {
          await prisma.notification.updateMany({
            where: {
              userId: session.user.id,
              isRead: false,
              type: 'new_message',
              OR: contentFilters
            },
            data: { isRead: true }
          })
        }
      } else {
        // For channels or when no conversationId, mark all new_message notifications as read
        await prisma.notification.updateMany({
          where: {
            userId: session.user.id,
            isRead: false,
            type: 'new_message',
          },
          data: {
            isRead: true,
          }
        })
      }

      // Emit read receipt and notification updates via WebSocket
      if (res.socket?.server?.io) {
        console.log(`Emitting message-read events for ${messagesToUpdate.length} messages`)
        
        messagesToUpdate.forEach(message => {
          const roomName = message.conversationId 
            ? `conversation:${message.conversationId}` 
            : `channel:${message.channelId}`
          
          console.log(`Emitting message-read for ${message.id} to room: ${roomName}`)
          
          // Emit to conversation room for participants
          res.socket.server.io.to(roomName).emit('message-read', {
            messageId: message.id,
            readBy: session.user.id,
            readAt: new Date().toISOString(),
          })
          
          // Also emit globally to ensure sender gets the update even if not in room
          res.socket.server.io.emit('message-read-global', {
            messageId: message.id,
            senderId: message.senderId,
            readBy: session.user.id,
            readAt: new Date().toISOString(),
          })
        })

        // Also emit a message status update for each message
        messagesToUpdate.forEach(message => {
          const roomName = message.conversationId 
            ? `conversation:${message.conversationId}` 
            : `channel:${message.channelId}`
          
          // Emit to conversation room
          res.socket.server.io.to(roomName).emit('message-status-updated', {
            messageId: message.id,
            status: 'read',
            updatedAt: new Date().toISOString(),
          })
          
          // Also emit globally for sender
          res.socket.server.io.emit('message-status-updated-global', {
            messageId: message.id,
            senderId: message.senderId,
            status: 'read',
            updatedAt: new Date().toISOString(),
          })
        })

        // Notify clients to clear unread counts for this conversation and update notification badges
        const totalUnread = await prisma.notification.count({
          where: { userId: session.user.id, isRead: false }
        })

        console.log(`Emitting conversation-read for ${conversationId} with ${messagesToUpdate.length} updated messages`)
        res.socket.server.io.emit('conversation-read', {
          userId: session.user.id,
          conversationId: conversationId || null,
          updatedCount: messagesToUpdate.length,
        })

        // Emit notifications update globally (clients will filter by userId)
        res.socket.server.io.emit('notifications-updated', {
          userId: session.user.id,
          totalUnread,
        })

        // Also emit to user-specific room if it exists
        res.socket.server.io.to(`user:${session.user.id}`).emit('notifications-updated', {
          userId: session.user.id,
          totalUnread,
        })

        console.log(`Emitting notifications-updated for user ${session.user.id} with totalUnread: ${totalUnread}`)
      }
    }

    return res.status(200).json({
      success: true,
      updatedCount: messagesToUpdate.length,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.issues })
    }
    console.error('Mark messages read error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}