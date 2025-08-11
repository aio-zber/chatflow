import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]'
import { getSocketInstance } from '@/lib/socket'
import { z } from 'zod'

const createConversationSchema = z.object({
  userId: z.string(),
  isGroup: z.boolean().default(false),
  name: z.string().optional(),
  description: z.string().optional(),
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method === 'GET') {
    try {
      // Get blocked users
      const blockedUsers = await prisma.userBlock.findMany({
        where: {
          OR: [
            { blockerId: session.user.id },
            { blockedId: session.user.id }
          ]
        },
        select: {
          blockerId: true,
          blockedId: true,
        }
      })

      const blockedUserIds = blockedUsers.flatMap(block => 
        block.blockerId === session.user.id ? [block.blockedId] : [block.blockerId]
      )

      const conversations = await prisma.conversation.findMany({
        where: {
          participants: {
            some: { userId: session.user.id }
          },
          // For direct messages, exclude conversations with blocked users
          ...(blockedUserIds.length > 0 && {
            NOT: {
              AND: [
                { isGroup: false },
                {
                  participants: {
                    some: {
                      userId: { in: blockedUserIds }
                    }
                  }
                }
              ]
            }
          })
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
            }
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              sender: {
                select: {
                  username: true,
                  name: true,
                }
              }
            }
          }
        },
        orderBy: { updatedAt: 'desc' }
      })

      const conversationsWithUnread = await Promise.all(
        conversations.map(async (conversation) => {
          const participant = conversation.participants.find(p => p.userId === session.user.id)
          const unreadCount = await prisma.message.count({
            where: {
              conversationId: conversation.id,
              createdAt: {
                gt: participant?.lastReadAt || new Date(0)
              },
              senderId: { not: session.user.id }
            }
          })

          return {
            ...conversation,
            unreadCount,
            otherParticipants: conversation.participants.filter(p => p.userId !== session.user.id)
          }
        })
      )

      res.json({ conversations: conversationsWithUnread })
    } catch (error) {
      console.error('Get conversations error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else if (req.method === 'POST') {
    try {
      const { userId, isGroup, name, description } = createConversationSchema.parse(req.body)

      if (!isGroup) {
        // Check if either user has blocked the other
        const blockExists = await prisma.userBlock.findFirst({
          where: {
            OR: [
              {
                blockerId: session.user.id,
                blockedId: userId,
              },
              {
                blockerId: userId,
                blockedId: session.user.id,
              }
            ]
          }
        })

        if (blockExists) {
          return res.status(403).json({ 
            error: 'Cannot create conversation. User relationship blocked.',
            blocked: true
          })
        }

        const existingConversation = await prisma.conversation.findFirst({
          where: {
            isGroup: false,
            participants: {
              every: {
                userId: { in: [session.user.id, userId] }
              }
            }
          },
          include: {
            participants: true
          }
        })

        if (existingConversation && existingConversation.participants.length === 2) {
          return res.json({ conversation: existingConversation })
        }
      }

      const conversation = await prisma.conversation.create({
        data: {
          name,
          description,
          isGroup,
          participants: {
            create: [
              { userId: session.user.id, role: isGroup ? 'admin' : 'member' },
              { userId, role: 'member' }
            ]
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
            }
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          }
        }
      })

      // Emit socket event to all participants
      try {
        const io = getSocketInstance(req, res)
        const conversationWithExtras = {
          ...conversation,
          unreadCount: 0,
          otherParticipants: conversation.participants.filter(p => p.userId !== session.user.id)
        }

        // Emit to each participant
        conversation.participants.forEach(participant => {
          if (participant.userId !== session.user.id) {
            io.emit('new-conversation', {
              ...conversationWithExtras,
              otherParticipants: conversation.participants.filter(p => p.userId !== participant.userId)
            })
          }
        })
      } catch (socketError) {
        console.error('Socket emission error:', socketError)
        // Don't fail the API call if socket emission fails
      }

      res.status(201).json({ conversation })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.issues })
      }
      console.error('Create conversation error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}