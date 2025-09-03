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

    // OPTIMIZATION MARK START: Separate main message query from poll data
    // This fixes the 1-message loading issue caused by complex poll queries
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
        // OPTIMIZATION: Only get poll ID, not full poll data
        poll: {
          select: {
            id: true,
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
    // OPTIMIZATION MARK END

    // OPTIMIZATION MARK START: Efficient poll data loading
    // Load poll data separately to avoid query complexity issues
    const messageIds = messages.map(msg => msg.id)
    const pollsData = await prisma.poll.findMany({
      where: {
        messageId: {
          in: messageIds
        }
      },
      include: {
        options: {
          orderBy: { order: 'asc' },
          include: {
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
    })

    // OPTIMIZATION: Get user votes separately for better performance
    const userVotes = pollsData.length > 0 ? await prisma.pollVote.findMany({
      where: {
        userId: session.user.id,
        pollId: {
          in: pollsData.map(poll => poll.id)
        }
      },
      select: {
        pollId: true,
        optionId: true,
      }
    }) : []

    // Create efficient lookup maps
    const pollsMap = new Map(pollsData.map(poll => [poll.messageId, poll]))
    const userVotesMap = new Map(userVotes.map(vote => [`${vote.pollId}-${vote.optionId}`, true]))
    // OPTIMIZATION MARK END

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

    // OPTIMIZATION MARK START: Efficient poll processing using lookup maps
    // Process messages to format poll data correctly without expensive queries
    const processedMessages = messages.map(msg => {
      if (msg.poll && pollsMap.has(msg.id)) {
        const pollData = pollsMap.get(msg.id)!
        return {
          ...msg,
          poll: {
            id: pollData.id,
            question: pollData.question,
            allowMultiple: pollData.allowMultiple,
            isAnonymous: pollData.isAnonymous,
            expiresAt: pollData.expiresAt,
            createdAt: pollData.createdAt,
            createdBy: pollData.createdBy,
            options: pollData.options.map(option => ({
              id: option.id,
              text: option.text,
              order: option.order,
              voteCount: option._count.votes,
              // OPTIMIZATION: Use efficient map lookup instead of expensive .some() queries
              hasVoted: userVotesMap.has(`${pollData.id}-${option.id}`),
              voters: pollData.isAnonymous ? [] : [] // Skip voter details for performance
            })),
            totalVotes: pollData._count.votes,
            messageId: msg.id
          }
        }
      }
      return msg
    })
    // OPTIMIZATION MARK END

    res.json({
      messages: processedMessages.reverse(),
      nextCursor: processedMessages.length === parsedLimit ? processedMessages[0]?.id : null,
    })
  } catch (error) {
    console.error('Get messages error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}