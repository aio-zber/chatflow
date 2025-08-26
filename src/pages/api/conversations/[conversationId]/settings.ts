import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../../auth/[...nextauth]'
import { getIO } from '@/lib/socket'
import { z } from 'zod'

const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  avatar: z.string().url().optional(),
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

  if (req.method === 'GET') {
    try {
      // Get group settings - any member can view
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          isGroup: true,
          participants: {
            some: { userId: session.user.id }
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
                  isOnline: true,
                  lastSeen: true,
                }
              }
            },
            orderBy: [
              { role: 'desc' }, // Admins first
              { joinedAt: 'asc' }
            ]
          }
        }
      })

      if (!conversation) {
        return res.status(404).json({ error: 'Group not found' })
      }

      return res.status(200).json({ group: conversation })
    } catch (error) {
      console.error('Get group settings error:', error)
      return res.status(500).json({ error: 'Internal server error' })
    }
  } else if (req.method === 'PUT') {
    try {
      // Update group settings - only admins can update
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
        }
      })

      if (!conversation) {
        return res.status(403).json({ 
          error: 'Group not found or you do not have admin permissions' 
        })
      }

      const { name, description, avatar } = updateGroupSchema.parse(req.body)

      const updatedGroup = await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(avatar && { avatar }),
          updatedAt: new Date()
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
                  isOnline: true,
                  lastSeen: true,
                }
              }
            },
            orderBy: [
              { role: 'desc' }, // Admins first
              { joinedAt: 'asc' }
            ]
          }
        }
      })

      return res.status(200).json({
        success: true,
        group: updatedGroup,
        message: 'Group settings updated successfully'
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.issues })
      }
      console.error('Update group settings error:', error)
      return res.status(500).json({ error: 'Internal server error' })
    }
  } else if (req.method === 'DELETE') {
    try {
      // Delete group - only admins can delete
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
            select: {
              userId: true
            }
          }
        }
      })

      if (!conversation) {
        return res.status(403).json({ 
          error: 'Group not found or you do not have admin permissions' 
        })
      }

      // Emit group deletion event before deleting
      const io = getIO()
      if (io) {
        const groupDeletedEvent = {
          type: 'group_deleted',
          conversationId,
          deletedBy: {
            id: session.user.id,
            name: session.user.name,
            username: session.user.email
          },
          reason: 'Admin deleted group'
        }

        // Emit to all participants
        conversation.participants.forEach((participant) => {
          io.to(`user:${participant.userId}`).emit('group-deleted', groupDeletedEvent)
        })

        io.to(`conversation:${conversationId}`).emit('group-deleted', groupDeletedEvent)
        
        console.log(`Emitted group-deleted event for conversation ${conversationId}`)
      }

      // Delete the conversation (cascade will handle participants and messages)
      await prisma.conversation.delete({
        where: { id: conversationId }
      })

      return res.status(200).json({
        success: true,
        message: 'Group deleted successfully'
      })
    } catch (error) {
      console.error('Delete group error:', error)
      return res.status(500).json({ error: 'Internal server error' })
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' })
  }
}