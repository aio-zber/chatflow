// OPTIMIZATION MARK START: Dedicated poll details endpoint for on-demand loading
// This allows polls to load their full data (including voters) separately from messages
import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../../auth/[...nextauth]'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { pollId } = req.query

  try {
    const poll = await prisma.poll.findFirst({
      where: {
        id: pollId as string,
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
    })

    if (!poll) {
      return res.status(404).json({ error: 'Poll not found' })
    }

    // Format poll data with detailed voter information
    const formattedPoll = {
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
        hasVoted: option.votes.some(vote => vote.user.id === session.user.id),
        voters: poll.isAnonymous ? [] : option.votes.map(vote => vote.user)
      })),
      totalVotes: poll._count.votes,
      messageId: poll.messageId
    }

    res.json(formattedPoll)
  } catch (error) {
    console.error('Get poll details error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
// OPTIMIZATION MARK END