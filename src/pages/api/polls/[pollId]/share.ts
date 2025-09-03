import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { prisma } from '@/lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { pollId } = req.query
  if (!pollId || typeof pollId !== 'string') {
    return res.status(400).json({ error: 'Invalid poll ID' })
  }

  if (req.method === 'GET') {
    return handleGetShareableData(req, res, pollId, session.user.id)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

async function handleGetShareableData(req: NextApiRequest, res: NextApiResponse, pollId: string, userId: string) {
  try {
    // Get poll with verification that user has access
    const poll = await prisma.poll.findFirst({
      where: {
        id: pollId,
        conversation: {
          participants: {
            some: { userId }
          }
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
            avatar: true
          }
        },
        conversation: {
          select: {
            id: true,
            name: true,
            isGroup: true
          }
        },
        _count: {
          select: { votes: true }
        }
      }
    })

    if (!poll) {
      return res.status(404).json({ error: 'Poll not found or access denied' })
    }

    // Create shareable poll data (without sensitive information)
    const shareableData = {
      id: poll.id,
      question: poll.question,
      allowMultiple: poll.allowMultiple,
      isAnonymous: poll.isAnonymous,
      expiresAt: poll.expiresAt,
      createdAt: poll.createdAt,
      expired: poll.expiresAt ? new Date() > poll.expiresAt : false,
      createdBy: {
        name: poll.createdBy.name || poll.createdBy.username,
        username: poll.createdBy.username
      },
      conversation: {
        name: poll.conversation.name || 'Private Chat',
        isGroup: poll.conversation.isGroup
      },
      options: poll.options.map(option => ({
        id: option.id,
        text: option.text,
        voteCount: option._count.votes
      })),
      totalVotes: poll._count.votes,
      shareUrl: `${req.headers.origin || 'https://yourapp.com'}/polls/${poll.id}`
    }

    return res.status(200).json({
      success: true,
      poll: shareableData
    })

  } catch (error) {
    console.error('Get shareable poll data error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}