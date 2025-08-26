import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]'
import { z } from 'zod'

const searchSchema = z.object({
  query: z.string().min(1).max(200),
  conversationId: z.string().optional(),
  channelId: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
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

  let searchConditions: any = {}
  let query: string = ''
  let conversationId: string | undefined
  let channelId: string | undefined
  let limit: number = 50
  let offset: number = 0

  try {
    const parsed = searchSchema.parse({
      query: req.query.query,
      conversationId: req.query.conversationId,
      channelId: req.query.channelId,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    })
    
    query = parsed.query
    conversationId = parsed.conversationId
    channelId = parsed.channelId
    limit = parsed.limit
    offset = parsed.offset

    if (!conversationId && !channelId) {
      return res.status(400).json({ error: 'Either conversationId or channelId is required' })
    }

    // Build search conditions for both plain text and potentially encrypted content
    searchConditions = {
      AND: [
        // Conversation/channel filter
        conversationId ? { conversationId } : { channelId },
        // Search approach:
        // 1. Include plain text messages that match (for immediate results)
        // 2. Include system/call messages that match
        // 3. Include encrypted messages for client-side decryption and filtering
        {
          OR: [
            // Plain text messages that match search query (case insensitive)
            {
              AND: [
                {
                  content: {
                    contains: query,
                    mode: 'insensitive' as const,
                  }
                },
                // Exclude encrypted messages from this condition
                {
                  content: {
                    not: {
                      startsWith: '🔐'
                    }
                  }
                },
                // Also exclude likely legacy encrypted patterns
                {
                  NOT: {
                    AND: [
                      { content: { contains: ':' } },
                      { content: { not: { contains: ' ' } } }
                    ]
                  }
                }
              ]
            },
            // System and call messages that match
            {
              AND: [
                {
                  OR: [
                    { type: 'system' },
                    { type: 'call' }
                  ]
                },
                {
                  content: {
                    contains: query,
                    mode: 'insensitive' as const,
                  }
                }
              ]
            },
            // All encrypted messages for client-side filtering
            {
              content: {
                startsWith: '🔐'
              }
            }
          ]
        }
      ],
      // Exclude messages hidden by the user
      hiddenBy: {
        none: {
          userId: session.user.id
        }
      }
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
    console.error('Search conditions:', JSON.stringify(searchConditions, null, 2))
    console.error('Query params:', { query, conversationId, channelId, limit, offset })
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack available')
    res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}