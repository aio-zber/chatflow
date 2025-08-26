import { NextApiRequest } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../../../auth/[...nextauth]'
import { NextApiResponseServerIO } from '@/lib/socket'

export default async function handler(req: NextApiRequest, res: NextApiResponseServerIO) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { messageId } = req.query

  try {
    // Find the message and verify the user is the recipient
    const message = await prisma.message.findFirst({
      where: {
        id: messageId as string,
        OR: [
          { receiverId: session.user.id }, // Direct message
          { 
            conversationId: { not: null },
            conversation: {
              participants: {
                some: { userId: session.user.id }
              }
            }
          }, // Group conversation
          {
            channelId: { not: null },
            channel: {
              members: {
                some: { userId: session.user.id }
              }
            }
          } // Channel message
        ]
      },
      include: {
        sender: {
          select: { id: true }
        }
      }
    })

    if (!message) {
      return res.status(404).json({ error: 'Message not found or not authorized' })
    }

    // Don't update status for own messages
    if (message.senderId === session.user.id) {
      return res.status(200).json({ message: 'Cannot mark own message as delivered' })
    }

    // Update message status to delivered (only if currently unread)
    if (message.status === 'unread') {
      await prisma.message.update({
        where: { id: messageId as string },
        data: { status: 'delivered' }
      })

      // Emit status update to sender
      if (res.socket?.server?.io) {
        res.socket.server.io.emit('message-status-updated', {
          messageId: messageId as string,
          status: 'delivered',
          userId: message.senderId
        })
      }
    }

    return res.status(200).json({ status: 'delivered' })
  } catch (error) {
    console.error('Error marking message as delivered:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}