import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]'
import { prisma } from '@/lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { messageId } = req.query
    if (!messageId || typeof messageId !== 'string') {
      return res.status(400).json({ error: 'Message ID is required' })
    }

    // Verify the message exists and user has access to it
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: {
          include: {
            participants: true
          }
        }
      }
    })

    if (!message) {
      return res.status(404).json({ error: 'Message not found' })
    }

    // Check if user is a participant in the conversation
    const isParticipant = message.conversation?.participants.some(
      (p) => p.userId === session.user.id
    )

    if (!isParticipant) {
      return res.status(403).json({ error: 'Not authorized to access this message' })
    }

    // Don't allow hiding own messages (they should use delete instead)
    if (message.senderId === session.user.id) {
      return res.status(400).json({ error: 'Cannot hide your own messages. Use delete instead.' })
    }

    // Check if message is already hidden for this user
    const existingHidden = await prisma.messageHidden.findUnique({
      where: {
        messageId_userId: {
          messageId,
          userId: session.user.id
        }
      }
    })

    if (existingHidden) {
      return res.status(400).json({ error: 'Message is already hidden for you' })
    }

    // Hide the message for this user
    await prisma.messageHidden.create({
      data: {
        messageId,
        userId: session.user.id
      }
    })

    return res.status(200).json({ success: true, message: 'Message hidden from your view' })
  } catch (error) {
    console.error('Error hiding message:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}