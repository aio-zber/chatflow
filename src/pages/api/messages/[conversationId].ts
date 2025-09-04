import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Add comprehensive request logging for debugging
  console.log('📨 Messages API called:', {
    method: req.method,
    conversationId: req.query.conversationId,
    cursor: req.query.cursor,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
  })

  if (req.method !== 'GET') {
    console.error('❌ Method not allowed:', req.method)
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Validate conversationId parameter
  const { conversationId } = req.query
  if (!conversationId || typeof conversationId !== 'string') {
    console.error('❌ Invalid conversationId:', conversationId)
    return res.status(400).json({ error: 'Invalid conversation ID' })
  }

  // Enhanced session validation with detailed logging
  let session
  try {
    session = await getServerSession(req, res, authOptions)
    if (!session) {
      console.error('❌ No session found')
      return res.status(401).json({ error: 'No session found' })
    }
    if (!session.user) {
      console.error('❌ No user in session')
      return res.status(401).json({ error: 'No user in session' })
    }
    if (!session.user.id) {
      console.error('❌ No user ID in session')
      return res.status(401).json({ error: 'No user ID in session' })
    }
    console.log('✅ Session validated for user:', session.user.id)
  } catch (sessionError) {
    console.error('❌ Session validation error:', sessionError)
    return res.status(401).json({ error: 'Session validation failed' })
  }

  const { cursor, limit = '50', bulkLoad } = req.query
  
  // Allow larger batches for bulk loading scenarios (e.g., scrollToMessage)
  // but cap at reasonable limits for performance
  let parsedLimit = parseInt(limit as string)
  if (isNaN(parsedLimit) || parsedLimit < 1) {
    parsedLimit = 50
  }
  if (bulkLoad === 'true') {
    parsedLimit = Math.min(parsedLimit, 200) // Max 200 for bulk loads
  } else {
    parsedLimit = Math.min(parsedLimit, 100) // Max 100 for regular loads
  }

  // Test database connectivity first
  try {
    await prisma.$queryRaw`SELECT 1`
    console.log('✅ Database connection verified')
  } catch (dbError) {
    console.error('❌ Database connection failed:', dbError)
    return res.status(503).json({ error: 'Database connection failed' })
  }

  try {
    console.log('🔍 Checking conversation access for user:', session.user.id, 'conversation:', conversationId)
    
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId as string,
        participants: {
          some: { userId: session.user.id }
        }
      }
    })

    if (!conversation) {
      console.error('❌ Conversation not found or access denied:', {
        conversationId,
        userId: session.user.id
      })
      return res.status(404).json({ error: 'Conversation not found or access denied' })
    }
    
    console.log('✅ Conversation access verified')

    // OPTIMIZATION MARK START: Separate main message query from poll data
    // This fixes the 1-message loading issue caused by complex poll queries
    console.log('🔍 Fetching messages with params:', {
      conversationId,
      cursor,
      limit: parsedLimit,
      userId: session.user.id
    })
    
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
    console.log('✅ Messages fetched successfully:', messages.length, 'messages')
    
    let pollsData = []
    if (messageIds.length > 0) {
      try {
        console.log('🔍 Fetching poll data for', messageIds.length, 'messages')
        pollsData = await prisma.poll.findMany({
          where: {
            messageId: {
              in: messageIds
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
                avatar: true,
              }
            },
            _count: {
              select: { votes: true }
            }
          }
        })
        console.log('✅ Poll data fetched successfully:', pollsData.length, 'polls')
      } catch (pollError) {
        console.error('⚠️ Error fetching poll data (continuing without polls):', pollError)
        pollsData = [] // Continue without poll data rather than failing completely
      }
    }

    // OPTIMIZATION: Get user votes separately for better performance
    let userVotes = []
    if (pollsData.length > 0) {
      try {
        console.log('🔍 Fetching user votes for', pollsData.length, 'polls')
        userVotes = await prisma.pollVote.findMany({
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
        })
        console.log('✅ User votes fetched successfully:', userVotes.length, 'votes')
      } catch (voteError) {
        console.error('⚠️ Error fetching user votes (continuing without vote info):', voteError)
        userVotes = [] // Continue without user vote data
      }
    }

    // Create efficient lookup maps
    const pollsMap = new Map(pollsData.map(poll => [poll.messageId, poll]))
    const userVotesMap = new Map(userVotes.map(vote => [`${vote.pollId}-${vote.optionId}`, true]))
    // OPTIMIZATION MARK END

    // Update lastReadAt (non-critical, continue if this fails)
    try {
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
      console.log('✅ LastReadAt updated successfully')
    } catch (updateError) {
      console.error('⚠️ Error updating lastReadAt (non-critical):', updateError)
      // Don't fail the request if lastReadAt update fails
    }

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
              voters: pollData.isAnonymous ? [] : option.votes.map(vote => vote.user)
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
    console.error('❌ Critical error in messages API:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      conversationId,
      userId: session?.user?.id,
      timestamp: new Date().toISOString()
    })
    
    // Provide more specific error responses based on error type
    if (error instanceof Error) {
      // Database connection errors
      if (error.message.includes('connect') || error.message.includes('connection')) {
        return res.status(503).json({ 
          error: 'Database connection error',
          details: process.env.NODE_ENV === 'development' ? error.message : 'Service temporarily unavailable'
        })
      }
      
      // Query timeout errors
      if (error.message.includes('timeout') || error.message.includes('cancelled')) {
        return res.status(408).json({ 
          error: 'Request timeout',
          details: 'The request took too long to process'
        })
      }
      
      // Permission/access errors
      if (error.message.includes('permission') || error.message.includes('access')) {
        return res.status(403).json({ 
          error: 'Access denied',
          details: 'Insufficient permissions to access this resource'
        })
      }
      
      // Validation errors
      if (error.message.includes('validation') || error.message.includes('constraint')) {
        return res.status(400).json({ 
          error: 'Invalid request data',
          details: process.env.NODE_ENV === 'development' ? error.message : 'Request validation failed'
        })
      }
    }
    
    // Generic error response with environment-specific details
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' 
        ? (error instanceof Error ? error.message : String(error))
        : 'An unexpected error occurred'
    })
  }
}