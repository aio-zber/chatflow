import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../../auth/[...nextauth]'
import { getIO, getSocketInstance } from '@/lib/socket'
import { z } from 'zod'

const addMemberSchema = z.object({
  userId: z.string(),
  role: z.enum(['admin', 'member']).default('member'),
})

const updateMemberSchema = z.object({
  userId: z.string(),
  role: z.enum(['admin', 'member']),
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { conversationId } = req.query

  if (!conversationId || typeof conversationId !== 'string') {
    return res.status(400).json({ error: 'Invalid conversation ID' })
  }

  try {
    // Verify the conversation exists and user has admin access
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        isGroup: true,
        participants: {
          some: {
            userId: session.user.id,
            role: 'admin'
          }
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
              }
            }
          }
        }
      }
    })

    if (!conversation) {
      return res.status(403).json({ 
        error: 'Conversation not found or you do not have admin permissions' 
      })
    }

    if (req.method === 'POST') {
      // Add member
      const { userId, role } = addMemberSchema.parse(req.body)

      // Check if user is already a member
      const existingMember = conversation.participants.find(p => p.userId === userId)
      if (existingMember) {
        return res.status(400).json({ error: 'User is already a member of this group' })
      }

      // Verify the user exists
      const userToAdd = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, name: true, avatar: true }
      })

      if (!userToAdd) {
        return res.status(404).json({ error: 'User not found' })
      }

      // Add the user to the conversation
      const newMember = await prisma.conversationParticipant.create({
        data: {
          userId,
          conversationId,
          role,
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

      // Create system message for member addition
      const adminUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { name: true, username: true }
      })

      const systemMessage = await prisma.message.create({
        data: {
          content: `${adminUser?.name || adminUser?.username || 'Admin'} added ${userToAdd.name || userToAdd.username} to the group`,
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

      // Emit socket event for real-time updates - ensure socket is initialized
      let io = getIO()
      if (!io) {
        console.log('👥 CRITICAL: Socket not initialized, attempting to initialize...')
        io = getSocketInstance(req, res)
      }
      console.log('👥 CRITICAL: Group member add API - Socket instance available:', !!io)
      if (io) {
        const memberAddedEvent = {
          type: 'member_added',
          conversationId,
          member: {
            id: newMember.id,
            userId: newMember.userId,
            role: newMember.role,
            joinedAt: newMember.joinedAt,
            user: newMember.user
          },
          addedBy: {
            id: session.user.id,
            name: session.user.name,
            username: session.user.email // or username if available
          }
        }

        console.log('👥 CRITICAL: About to emit group-member-added event:', memberAddedEvent)

        // Emit to all existing participants
        conversation.participants.forEach((participant) => {
          console.log(`👥 CRITICAL: Emitting to user:${participant.userId}`)
          io.to(`user:${participant.userId}`).emit('group-member-added', memberAddedEvent)
        })

        // Also emit to the conversation room
        console.log(`👥 CRITICAL: Emitting to conversation:${conversationId}`)
        io.to(`conversation:${conversationId}`).emit('group-member-added', memberAddedEvent)

        // Emit to the newly added member
        console.log(`👥 CRITICAL: Emitting to newly added user:${userId}`)
        io.to(`user:${userId}`).emit('group-member-added', memberAddedEvent)

        // Emit system message for real-time chat updates
        console.log(`👥 CRITICAL: Emitting system message to conversation:${conversationId}`)
        io.to(`conversation:${conversationId}`).emit('new-message', systemMessage)
        
        console.log(`👥 CRITICAL: Successfully emitted group-member-added event for conversation ${conversationId}`)
      } else {
        console.error('👥 CRITICAL: Socket.IO instance not available for group-member-added event!')
      }

      return res.status(201).json({
        success: true,
        member: newMember,
        message: `${userToAdd.name || userToAdd.username} has been added to the group`
      })

    } else if (req.method === 'PUT') {
      // Update member role
      const { userId, role } = updateMemberSchema.parse(req.body)

      if (userId === session.user.id) {
        return res.status(400).json({ error: 'Cannot change your own role' })
      }

      const member = conversation.participants.find(p => p.userId === userId)
      if (!member) {
        return res.status(404).json({ error: 'User is not a member of this group' })
      }

      const updatedMember = await prisma.conversationParticipant.update({
        where: {
          userId_conversationId: {
            userId,
            conversationId,
          }
        },
        data: { role },
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

      // Emit socket event for role update
      const io = getIO()
      if (io) {
        const roleUpdateEvent = {
          type: 'member_role_updated',
          conversationId,
          member: {
            id: updatedMember.id,
            userId: updatedMember.userId,
            role: updatedMember.role,
            user: updatedMember.user
          },
          updatedBy: {
            id: session.user.id,
            name: session.user.name,
            username: session.user.email
          },
          oldRole: member.role,
          newRole: role
        }

        // Emit to all participants
        conversation.participants.forEach((participant) => {
          io.to(`user:${participant.userId}`).emit('group-member-role-updated', roleUpdateEvent)
        })

        io.to(`conversation:${conversationId}`).emit('group-member-role-updated', roleUpdateEvent)
        
        console.log(`Emitted group-member-role-updated event for conversation ${conversationId}`)
      }

      return res.status(200).json({
        success: true,
        member: updatedMember,
        message: `${member.user.name || member.user.username} has been ${role === 'admin' ? 'promoted to admin' : 'demoted to member'}`
      })

    } else if (req.method === 'DELETE') {
      // Remove member
      const { userId } = req.query

      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ error: 'User ID is required' })
      }

      if (userId === session.user.id) {
        return res.status(400).json({ error: 'Cannot remove yourself from the group' })
      }

      const member = conversation.participants.find(p => p.userId === userId)
      if (!member) {
        return res.status(404).json({ error: 'User is not a member of this group' })
      }

      await prisma.conversationParticipant.delete({
        where: {
          userId_conversationId: {
            userId,
            conversationId,
          }
        }
      })

      // Create system message for member removal
      const adminUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { name: true, username: true }
      })

      const systemMessage = await prisma.message.create({
        data: {
          content: `${adminUser?.name || adminUser?.username || 'Admin'} removed ${member.user.name || member.user.username} from the group`,
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

      // Emit socket event for member removal - ensure socket is initialized
      let io = getIO()
      if (!io) {
        console.log('🗑️ CRITICAL: Socket not initialized, attempting to initialize...')
        io = getSocketInstance(req, res)
      }
      console.log('🗑️ CRITICAL: Group member remove API - Socket instance available:', !!io)
      if (io) {
        const memberRemovedEvent = {
          type: 'member_removed',
          conversationId,
          removedMember: {
            userId: member.userId,
            user: member.user
          },
          removedBy: {
            id: session.user.id,
            name: session.user.name,
            username: session.user.email
          }
        }

        console.log('🗑️ CRITICAL: About to emit group-member-removed event:', memberRemovedEvent)

        // Emit to all remaining participants
        conversation.participants.forEach((participant) => {
          if (participant.userId !== userId) { // Don't emit to removed member
            console.log(`🗑️ CRITICAL: Emitting to user:${participant.userId}`)
            io.to(`user:${participant.userId}`).emit('group-member-removed', memberRemovedEvent)
          }
        })

        console.log(`🗑️ CRITICAL: Emitting to conversation:${conversationId}`)
        io.to(`conversation:${conversationId}`).emit('group-member-removed', memberRemovedEvent)

        // Emit to the removed member so they know they were removed
        console.log(`🗑️ CRITICAL: Emitting to removed user:${userId}`)
        io.to(`user:${userId}`).emit('group-member-removed', memberRemovedEvent)

        // Emit system message for real-time chat updates
        console.log(`🗑️ CRITICAL: Emitting system message to conversation:${conversationId}`)
        io.to(`conversation:${conversationId}`).emit('new-message', systemMessage)
        
        console.log(`🗑️ CRITICAL: Successfully emitted group-member-removed event for conversation ${conversationId}`)
      } else {
        console.error('🗑️ CRITICAL: Socket.IO instance not available for group-member-removed event!')
      }

      return res.status(200).json({
        success: true,
        message: `${member.user.name || member.user.username} has been removed from the group`
      })

    } else {
      return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.issues })
    }
    console.error('Group member management error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}