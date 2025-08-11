import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../../auth/[...nextauth]'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { conversationId } = req.query

  if (!conversationId || typeof conversationId !== 'string') {
    return res.status(400).json({ error: 'Invalid conversation ID' })
  }

  try {
    // Verify the user is a member of the group
    const participant = await prisma.conversationParticipant.findUnique({
      where: {
        userId_conversationId: {
          userId: session.user.id,
          conversationId,
        }
      },
      include: {
        conversation: {
          select: {
            isGroup: true,
            name: true,
            participants: {
              where: { role: 'admin' },
              select: { userId: true }
            }
          }
        }
      }
    })

    if (!participant) {
      return res.status(404).json({ error: 'You are not a member of this group' })
    }

    if (!participant.conversation.isGroup) {
      return res.status(400).json({ error: 'Cannot leave a direct message conversation' })
    }

    // Check if user is the last admin
    const adminCount = participant.conversation.participants.length
    const isLastAdmin = participant.role === 'admin' && adminCount === 1

    if (isLastAdmin) {
      // Get total participant count
      const totalParticipants = await prisma.conversationParticipant.count({
        where: { conversationId }
      })

      if (totalParticipants > 1) {
        return res.status(400).json({ 
          error: 'Cannot leave group as the only admin. Please promote another member to admin first or delete the group.' 
        })
      }
    }

    // Remove the user from the group
    await prisma.conversationParticipant.delete({
      where: {
        userId_conversationId: {
          userId: session.user.id,
          conversationId,
        }
      }
    })

    // Check if group is now empty and delete if so
    const remainingParticipants = await prisma.conversationParticipant.count({
      where: { conversationId }
    })

    if (remainingParticipants === 0) {
      await prisma.conversation.delete({
        where: { id: conversationId }
      })
    }

    return res.status(200).json({
      success: true,
      message: `You have left the group ${participant.conversation.name || 'Untitled Group'}`
    })
  } catch (error) {
    console.error('Leave group error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}