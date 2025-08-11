import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { conversationId } = req.query
  const { cursor, limit = '50' } = req.query

  try {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId as string,
        participants: {
          some: { userId: session.user.id }
        }
      }
    })

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: conversationId as string },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            avatar: true,
          }
        },
        replyTo: {
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                name: true,
              }
            }
          }
        },
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
              }
            }
          }
        },
        attachments: true,
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string),
      ...(cursor && {
        skip: 1,
        cursor: {
          id: cursor as string,
        },
      }),
    })

    await prisma.conversationParticipant.update({
      where: {
        userId_conversationId: {
          userId: session.user.id,
          conversationId: conversationId as string,
        }
      },
      data: {
        lastReadAt: new Date(),
      }
    })

    res.json({
      messages: messages.reverse(),
      nextCursor: messages.length === parseInt(limit as string) ? messages[0]?.id : null,
    })
  } catch (error) {
    console.error('Get messages error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}