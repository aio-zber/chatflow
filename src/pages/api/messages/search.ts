import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]'
import { z } from 'zod'

const searchSchema = z.object({
  query: z.string().min(1).max(200),
  conversationId: z.string().optional(),
  channelId: z.string().optional(),
  limit: z.number().min(1).max(50).default(20),
  offset: z.number().min(0).default(0),
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { query, conversationId, channelId, limit, offset } = searchSchema.parse({
      query: req.query.query,
      conversationId: req.query.conversationId,
      channelId: req.query.channelId,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    })

    if (!conversationId && !channelId) {
      return res.status(400).json({ error: 'Either conversationId or channelId is required' })
    }

    // Build search conditions
    const searchConditions: any = {
      content: {
        contains: query,
        mode: 'insensitive',
      },
    }

    if (conversationId) {
      // Verify user has access to the conversation
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          participants: {
            some: { userId: session.user.id }
          }
        },
      })

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' })
      }

      searchConditions.conversationId = conversationId
    }

    if (channelId) {
      // Verify user has access to the channel
      const channel = await prisma.channel.findFirst({
        where: {
          id: channelId,
          members: {
            some: { userId: session.user.id }
          }
        },
      })

      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' })
      }

      searchConditions.channelId = channelId
    }

    // Search messages
    const [messages, totalCount] = await Promise.all([
      prisma.message.findMany({
        where: searchConditions,
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
                  name: true,
                  avatar: true,
                }
              }
            }
          },
          attachments: true,
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip: offset,
        take: limit,
      }),
      prisma.message.count({
        where: searchConditions,
      })
    ])

    // Transform messages to include reaction counts
    const transformedMessages = messages.map(message => ({
      ...message,
      reactions: message.reactions.reduce((acc, reaction) => {
        const existing = acc.find(r => r.emoji === reaction.emoji)
        if (existing) {
          existing.count++
          existing.users.push(reaction.user)
          if (reaction.userId === session.user.id) {
            existing.hasReacted = true
          }
        } else {
          acc.push({
            emoji: reaction.emoji,
            count: 1,
            users: [reaction.user],
            hasReacted: reaction.userId === session.user.id,
          })
        }
        return acc
      }, [] as any[]),
    }))

    res.status(200).json({
      messages: transformedMessages,
      totalCount,
      hasMore: offset + messages.length < totalCount,
      nextOffset: offset + messages.length < totalCount ? offset + limit : null,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.issues })
    }
    console.error('Search messages error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}