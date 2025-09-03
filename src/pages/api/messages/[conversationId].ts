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
  const { cursor, limit = '50', bulkLoad } = req.query
  
  // Allow larger batches for bulk loading scenarios (e.g., scrollToMessage)
  // but cap at reasonable limits for performance
  let parsedLimit = parseInt(limit as string)
  if (bulkLoad === 'true') {
    parsedLimit = Math.min(parsedLimit, 200) // Max 200 for bulk loads
  } else {
    parsedLimit = Math.min(parsedLimit, 100) // Max 100 for regular loads
  }

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
      where: { 
        conversationId: conversationId as string,
        NOT: {
          hiddenBy: {
            some: {
              userId: session.user.id
            }
          }
        }
      },
      select: {
        id: true,
        content: true,
        type: true,
        status: true,
        senderId: true,
        conversationId: true,
        channelId: true,
        replyToId: true,
        createdAt: true,
        updatedAt: true,
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            avatar: true,
          }
        },
        replyTo: {
          select: {
            id: true,
            content: true,
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
        poll: {
          include: {
            options: {
              orderBy: { order: 'asc' },
              include: {
                votes: {
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
                _count: {
                  select: { votes: true }
                }
              }
            },
            createdBy: {
              select: {
                id: true,
                username: true,
                name: true,
                avatar: true,
              }
            },
            _count: {
              select: { votes: true }
            }
          }
        },
      },
      orderBy: { createdAt: 'desc' },
      take: parsedLimit,
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

    // Process messages to format poll data correctly
    const processedMessages = messages.map(msg => {
      if (msg.poll) {
        return {
          ...msg,
          poll: {
            id: msg.poll.id,
            question: msg.poll.question,
            allowMultiple: msg.poll.allowMultiple,
            isAnonymous: msg.poll.isAnonymous,
            expiresAt: msg.poll.expiresAt,
            createdAt: msg.poll.createdAt,
            createdBy: msg.poll.createdBy,
            options: msg.poll.options.map(option => ({
              id: option.id,
              text: option.text,
              order: option.order,
              voteCount: option._count.votes,
              hasVoted: option.votes.some(vote => vote.user.id === session.user.id),
              voters: msg.poll.isAnonymous ? [] : option.votes.map(vote => vote.user)
            })),
            totalVotes: msg.poll._count.votes,
            messageId: msg.id
          }
        }
      }
      return msg
    })

    res.json({
      messages: processedMessages.reverse(),
      nextCursor: messages.length === parsedLimit ? messages[0]?.id : null,
    })
  } catch (error) {
    console.error('Get messages error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}