import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { prisma } from '@/lib/prisma'
import { getIO, getSocketInstance } from '@/lib/socket'
import { z } from 'zod'

const voteSchema = z.object({
  optionIds: z.array(z.string()).min(1)
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { pollId } = req.query
  if (!pollId || typeof pollId !== 'string') {
    return res.status(400).json({ error: 'Invalid poll ID' })
  }

  if (req.method === 'POST') {
    return handleVote(req, res, pollId, session.user.id)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

async function handleVote(req: NextApiRequest, res: NextApiResponse, pollId: string, userId: string) {
  try {
    const { optionIds } = voteSchema.parse(req.body)

    // Get poll with verification
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
        options: true,
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
        }
      }
    })

    if (!poll) {
      return res.status(404).json({ error: 'Poll not found or access denied' })
    }

    // Check if poll has expired
    if (poll.expiresAt && new Date() > poll.expiresAt) {
      return res.status(400).json({ error: 'Poll has expired' })
    }

    // Validate option IDs belong to this poll
    const validOptionIds = poll.options.map(option => option.id)
    const invalidOptions = optionIds.filter(id => !validOptionIds.includes(id))
    if (invalidOptions.length > 0) {
      return res.status(400).json({ error: 'Invalid option IDs' })
    }

    // Check multiple choice restriction
    if (optionIds.length > 1 && !poll.allowMultiple) {
      return res.status(400).json({ error: 'Multiple votes not allowed for this poll' })
    }

    // Update votes in transaction
    const updatedPoll = await prisma.$transaction(async (tx) => {
      // Remove existing votes for this user
      await tx.pollVote.deleteMany({
        where: {
          pollId,
          userId
        }
      })

      // Add new votes
      await tx.pollVote.createMany({
        data: optionIds.map(optionId => ({
          pollId,
          optionId,
          userId
        }))
      })

      // Get updated poll data
      return await tx.poll.findUnique({
        where: { id: pollId },
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
          _count: {
            select: { votes: true }
          }
        }
      })
    })

    if (!updatedPoll) {
      throw new Error('Failed to update poll')
    }

    // Update conversation timestamp to move it to top of sidebar
    await prisma.conversation.update({
      where: { id: poll.conversationId },
      data: { updatedAt: new Date() }
    })


    // Emit socket event for real-time updates - ensure socket instance is available
    let io = getIO()
    if (!io) {
      console.log('Socket IO not available for vote, attempting to get instance...')
      io = getSocketInstance(req, res)
    }
    console.log('Socket IO instance for vote:', io ? 'Available' : 'Not available')
    
    if (io) {
      const pollData = {
        id: updatedPoll.id,
        question: updatedPoll.question,
        allowMultiple: updatedPoll.allowMultiple,
        isAnonymous: updatedPoll.isAnonymous,
        expiresAt: updatedPoll.expiresAt,
        createdAt: updatedPoll.createdAt,
        createdBy: updatedPoll.createdBy,
        options: updatedPoll.options.map(option => ({
          id: option.id,
          text: option.text,
          order: option.order,
          voteCount: option._count.votes,
          hasVoted: option.votes.some(vote => vote.userId === userId),
          voters: option.votes.map(vote => vote.user)
        })),
        totalVotes: updatedPoll._count.votes,
        messageId: updatedPoll.messageId
      }

      console.log('Emitting poll vote update to participants:', poll.conversation.participants.map(p => p.userId))
      console.log('Poll ID:', updatedPoll.id)
      console.log('Voter ID:', userId)
      
      // Check room status before emitting
      const conversationRoom = io.sockets.adapter.rooms.get(`conversation:${poll.conversationId}`)
      console.log(`Conversation room size: ${conversationRoom?.size || 0}`)
      if (conversationRoom) {
        console.log('Sockets in conversation room:')
        conversationRoom.forEach(socketId => {
          const connectedSocket = io.sockets.sockets.get(socketId)
          if (connectedSocket) {
            console.log(`  - ${socketId} (User: ${connectedSocket.data.userId || 'unknown'})`)
          }
        })
      }

      // Emit to all participants in the conversation with personalized data
      poll.conversation.participants.forEach(participant => {
        const personalizedPollData = {
          ...pollData,
          options: updatedPoll.options.map(option => ({
            id: option.id,
            text: option.text,
            order: option.order,
            voteCount: option._count.votes,
            hasVoted: option.votes.some(vote => vote.userId === participant.userId),
            voters: option.votes.map(vote => vote.user)
          }))
        }
        
        console.log(`Emitting poll-updated to user:${participant.userId}`)
        io.to(`user:${participant.userId}`).emit('poll-updated', {
          pollId: updatedPoll.id,
          poll: personalizedPollData
        })
 
      })

      console.log(`Emitting poll-updated to conversation:${poll.conversationId}`)
      io.to(`conversation:${poll.conversationId}`).emit('poll-updated', {
        pollId: updatedPoll.id,
        poll: pollData
      })
    } else {
      console.error('Socket IO not available for poll voting')
    }

    return res.status(200).json({
      success: true,
      poll: updatedPoll
    })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.issues })
    }
    console.error('Vote poll error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}