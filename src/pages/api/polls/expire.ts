import { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '@/lib/prisma'
import { getIO } from '@/lib/socket'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow internal/cron requests for security
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Find all expired polls that haven't been processed yet
    const expiredPolls = await prisma.poll.findMany({
      where: {
        expiresAt: {
          lte: new Date()
        }
      },
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
                    avatar: true
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
            avatar: true
          }
        },
        conversation: {
          include: {
            participants: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    name: true,
                    avatar: true
                  }
                }
              }
            }
          }
        },
        _count: {
          select: { votes: true }
        }
      }
    })

    const io = getIO()
    let processedCount = 0

    for (const poll of expiredPolls) {
      // Emit expiration event to all conversation participants
      if (io) {
        const pollData = {
          id: poll.id,
          question: poll.question,
          allowMultiple: poll.allowMultiple,
          isAnonymous: poll.isAnonymous,
          expiresAt: poll.expiresAt,
          createdAt: poll.createdAt,
          createdBy: poll.createdBy,
          options: poll.options.map(option => ({
            id: option.id,
            text: option.text,
            order: option.order,
            voteCount: option._count.votes,
            hasVoted: false, // Will be determined per user
            voters: poll.isAnonymous ? [] : option.votes.map(vote => vote.user)
          })),
          totalVotes: poll._count.votes,
          messageId: poll.messageId,
          expired: true
        }

        // Emit to all participants in the conversation
        poll.conversation.participants.forEach(participant => {
          // Update hasVoted status per user
          const userPollData = {
            ...pollData,
            options: pollData.options.map(option => ({
              ...option,
              hasVoted: option.voters.some((voter: any) => voter.id === participant.userId)
            }))
          }

          io.to(`user:${participant.userId}`).emit('poll-expired', {
            pollId: poll.id,
            poll: userPollData
          })
        })

        io.to(`conversation:${poll.conversationId}`).emit('poll-expired', {
          pollId: poll.id,
          poll: pollData
        })
      }

      processedCount++
    }

    return res.status(200).json({
      success: true,
      processed: processedCount,
      message: `Processed ${processedCount} expired polls`
    })

  } catch (error) {
    console.error('Poll expiration processing error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}