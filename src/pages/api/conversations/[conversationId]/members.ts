import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../../auth/[...nextauth]'
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