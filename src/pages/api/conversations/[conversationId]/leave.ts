import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../../auth/[...nextauth]'
import { getIO, getSocketInstance } from '@/lib/socket'

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
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            avatar: true
          }
        },
        conversation: {
          select: {
            isGroup: true,
            name: true,
            participants: {
              select: { 
                userId: true,
                role: true 
              }
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
    const adminCount = participant.conversation.participants.filter(p => p.role === 'admin').length
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

    // Create system message for user leaving
    const systemMessage = await prisma.message.create({
      data: {
        content: `${participant.user.name || participant.user.username} left the group`,
        type: 'system',
        status: 'sent',
        senderId: session.user.id,
        conversationId,
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
        attachments: true,
      }
    })

    // Emit socket event for member leaving - ensure socket is initialized
    let io = getIO()
    if (!io) {
      console.log('🚪 CRITICAL: Socket not initialized, attempting to initialize...')
      io = getSocketInstance(req, res)
    }
    console.log('🚪 CRITICAL: Leave group API - Socket instance available:', !!io)
    if (io) {
      const memberLeftEvent = {
        conversationId,
        memberId: session.user.id
      }

      console.log('🚪 CRITICAL: About to emit group-member-left event:', memberLeftEvent)

      // Emit to all remaining participants before checking if group is empty
      participant.conversation.participants.forEach((p) => {
        if (p.userId !== session.user.id) { // Don't emit to the person who left
          console.log(`🚪 CRITICAL: Emitting to user:${p.userId}`)
          io.to(`user:${p.userId}`).emit('group-member-left', memberLeftEvent)
        }
      })

      console.log(`🚪 CRITICAL: Emitting to conversation:${conversationId}`)
      io.to(`conversation:${conversationId}`).emit('group-member-left', memberLeftEvent)

      // Emit to the user who left so their UI updates immediately  
      console.log(`🚪 CRITICAL: Emitting to leaving user:${session.user.id}`)
      io.to(`user:${session.user.id}`).emit('group-member-left', memberLeftEvent)

      // Emit system message for real-time chat updates
      console.log(`🚪 CRITICAL: Emitting system message to conversation:${conversationId}`)
      io.to(`conversation:${conversationId}`).emit('new-message', systemMessage)
      
      console.log(`🚪 CRITICAL: Successfully emitted group-member-left event for conversation ${conversationId}`)
    } else {
      console.error('🚪 CRITICAL: Socket.IO instance not available for group-member-left event!')
    }

    // Check if group is now empty and delete if so
    const remainingParticipants = await prisma.conversationParticipant.count({
      where: { conversationId }
    })

    if (remainingParticipants === 0) {
      await prisma.conversation.delete({
        where: { id: conversationId }
      })

      // Emit group deleted event
      if (io) {
        const groupDeletedEvent = {
          type: 'group_deleted',
          conversationId,
          deletedBy: {
            id: session.user.id,
            name: participant.user.name,
            username: participant.user.username
          },
          reason: 'Last member left'
        }

        // This will reach any clients still listening to this conversation
        io.to(`conversation:${conversationId}`).emit('group-deleted', groupDeletedEvent)
        
        console.log(`Emitted group-deleted event for conversation ${conversationId}`)
      }
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