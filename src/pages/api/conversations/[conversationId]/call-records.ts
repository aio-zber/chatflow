import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { prisma } from '../../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { conversationId } = req.query

  if (!conversationId || typeof conversationId !== 'string') {
    return res.status(400).json({ error: 'Invalid conversation ID' })
  }

  switch (req.method) {
    case 'GET':
      return getCallRecords(req, res, conversationId, session.user.id)
    case 'POST':
      return createCallRecord(req, res, conversationId, session.user.id)
    default:
      return res.status(405).json({ error: 'Method not allowed' })
  }
}

async function getCallRecords(req: NextApiRequest, res: NextApiResponse, conversationId: string, userId: string) {
  try {
    // Verify user has access to this conversation
    const participation = await prisma.conversationParticipant.findUnique({
      where: {
        userId_conversationId: {
          userId,
          conversationId
        }
      }
    })

    if (!participation) {
      return res.status(403).json({ error: 'Access denied' })
    }

    const callRecords = await prisma.callRecord.findMany({
      where: {
        conversationId
      },
      include: {
        caller: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true
          }
        }
      },
      orderBy: {
        startedAt: 'desc'
      },
      take: 50 // Limit to last 50 call records
    })

    // Get participant details for each call
    const callRecordsWithParticipants = await Promise.all(
      callRecords.map(async (record) => {
        const participantUsers = await prisma.user.findMany({
          where: {
            id: {
              in: record.participants
            }
          },
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true
          }
        })

        return {
          id: record.id,
          callType: record.callType,
          status: record.status,
          duration: record.duration,
          startedAt: record.startedAt,
          endedAt: record.endedAt,
          caller: record.caller,
          participants: participantUsers,
          isOutgoing: record.callerId === userId
        }
      })
    )

    res.status(200).json({ callRecords: callRecordsWithParticipants })
  } catch (error) {
    console.error('Error fetching call records:', error)
    res.status(500).json({ error: 'Failed to fetch call records' })
  }
}

async function createCallRecord(req: NextApiRequest, res: NextApiResponse, conversationId: string, userId: string) {
  try {
    const { callType, status, duration, participants, endedAt } = req.body

    // Validate required fields
    if (!callType || !status || !Array.isArray(participants)) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Verify user has access to this conversation
    const participation = await prisma.conversationParticipant.findUnique({
      where: {
        userId_conversationId: {
          userId,
          conversationId
        }
      }
    })

    if (!participation) {
      return res.status(403).json({ error: 'Access denied' })
    }

    const callRecord = await prisma.callRecord.create({
      data: {
        conversationId,
        callerId: userId,
        callType,
        status,
        duration: duration || 0,
        participants,
        endedAt: endedAt ? new Date(endedAt) : null
      },
      include: {
        caller: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true
          }
        }
      }
    })

    // Get participant details
    const participantUsers = await prisma.user.findMany({
      where: {
        id: {
          in: participants
        }
      },
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true
      }
    })

    const responseData = {
      id: callRecord.id,
      callType: callRecord.callType,
      status: callRecord.status,
      duration: callRecord.duration,
      startedAt: callRecord.startedAt,
      endedAt: callRecord.endedAt,
      caller: callRecord.caller,
      participants: participantUsers,
      isOutgoing: callRecord.callerId === userId
    }

    res.status(201).json({ callRecord: responseData })
  } catch (error) {
    console.error('Error creating call record:', error)
    res.status(500).json({ error: 'Failed to create call record' })
  }
}