import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const createGroupSchema = z.object({
  userIds: z.array(z.string()).min(1, 'At least one participant is required'),
  name: z.string().min(1, 'Group name is required').max(50, 'Group name must be less than 50 characters'),
  description: z.string().max(200, 'Description must be less than 200 characters').optional(),
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { userIds, name, description } = createGroupSchema.parse(req.body)

    // Validate that all user IDs are valid and not blocked
    const users = await prisma.user.findMany({
      where: {
        id: {
          in: userIds
        }
      },
      select: {
        id: true,
        username: true,
        name: true,
      }
    })

    if (users.length !== userIds.length) {
      return res.status(400).json({ error: 'One or more users not found' })
    }

    // Check for blocked relationships
    const allParticipantIds = [session.user.id, ...userIds]
    const blockedRelations = await prisma.userBlock.findMany({
      where: {
        OR: [
          {
            AND: [
              { blockerId: { in: allParticipantIds } },
              { blockedId: { in: allParticipantIds } }
            ]
          }
        ]
      }
    })

    if (blockedRelations.length > 0) {
      return res.status(400).json({ error: 'Cannot create group with blocked users' })
    }

    // Create the group conversation
    const conversation = await prisma.conversation.create({
      data: {
        name,
        description,
        isGroup: true,
        participants: {
          createMany: {
            data: [
              // Add the creator as admin
              {
                userId: session.user.id,
                role: 'admin'
              },
              // Add other participants as members
              ...userIds.map(userId => ({
                userId,
                role: 'member'
              }))
            ]
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
                isOnline: true,
                lastSeen: true
              }
            }
          }
        },
        messages: {
          include: {
            sender: {
              select: {
                username: true,
                name: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 1
        }
      }
    })

    // Format the conversation for the frontend
    const formattedConversation = {
      id: conversation.id,
      name: conversation.name,
      description: conversation.description,
      isGroup: conversation.isGroup,
      avatar: conversation.avatar,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      participants: conversation.participants,
      messages: conversation.messages,
      unreadCount: 0,
      otherParticipants: conversation.participants.filter(p => p.userId !== session.user.id)
    }

    // Emit socket events to notify all participants
    if (global.io) {
      // Emit to all participants
      allParticipantIds.forEach(participantId => {
        global.io.to(`user:${participantId}`).emit('new-conversation', formattedConversation)
      })
    }

    return res.status(201).json({ conversation: formattedConversation })
  } catch (error) {
    console.error('Error creating group conversation:', error)
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: error.errors[0]?.message || 'Invalid input data' 
      })
    }
    
    return res.status(500).json({ error: 'Failed to create group conversation' })
  }
}