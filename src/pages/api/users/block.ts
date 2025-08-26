import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]'
import { getIO, getSocketInstance } from '@/lib/socket'
import { z } from 'zod'

const blockUserSchema = z.object({
  userId: z.string(),
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { userId } = blockUserSchema.parse(req.body)

    if (userId === session.user.id) {
      return res.status(400).json({ error: 'Cannot block yourself' })
    }

    // Verify the user exists
    const userToBlock = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, name: true }
    })

    if (!userToBlock) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (req.method === 'POST') {
      // Block user
      const block = await prisma.userBlock.create({
        data: {
          blockerId: session.user.id,
          blockedId: userId,
        },
        include: {
          blocked: {
            select: {
              id: true,
              username: true,
              name: true,
              avatar: true,
            }
          }
        }
      })

      // Emit socket event for user blocked - ensure socket is initialized
      let io = getIO()
      if (!io) {
        console.log('🚫 CRITICAL: Socket not initialized, attempting to initialize...')
        io = getSocketInstance(req, res)
      }
      console.log('🚫 CRITICAL: Block API - Socket instance available:', !!io)
      if (io) {
        const userBlockedEvent = {
          type: 'user_blocked',
          blocker: {
            id: session.user.id,
            name: session.user.name,
            username: session.user.email
          },
          blocked: {
            id: userId,
            username: userToBlock.username,
            name: userToBlock.name
          },
          blockedAt: block.createdAt
        }

        console.log('🚫 CRITICAL: About to emit user-blocked event:', userBlockedEvent)

        // Notify the blocker (for real-time UI updates)
        console.log(`🚫 CRITICAL: Emitting to user:${session.user.id}`)
        io.to(`user:${session.user.id}`).emit('user-blocked', userBlockedEvent)

        // Notify the blocked user (so they know they've been blocked)
        console.log(`🚫 CRITICAL: Emitting to user:${userId}`)
        io.to(`user:${userId}`).emit('user-blocked', userBlockedEvent)
        
        // Broadcast to all connected clients for real-time sidebar updates
        console.log('🚫 CRITICAL: Broadcasting to all clients')
        io.emit('user-blocked', userBlockedEvent)
        
        console.log(`🚫 CRITICAL: Successfully emitted user-blocked event: ${session.user.id} blocked ${userId}`)
      } else {
        console.error('🚫 CRITICAL: Socket.IO instance not available for user-blocked event!')
      }

      return res.status(201).json({ 
        success: true,
        block,
        message: `${userToBlock.name || userToBlock.username} has been blocked`
      })

    } else if (req.method === 'DELETE') {
      // Unblock user
      const deleted = await prisma.userBlock.deleteMany({
        where: {
          blockerId: session.user.id,
          blockedId: userId,
        }
      })

      if (deleted.count === 0) {
        return res.status(404).json({ error: 'User is not blocked' })
      }

      // Emit socket event for user unblocked - ensure socket is initialized
      let io = getIO()
      if (!io) {
        console.log('✅ CRITICAL: Socket not initialized, attempting to initialize...')
        io = getSocketInstance(req, res)
      }
      console.log('✅ CRITICAL: Unblock API - Socket instance available:', !!io)
      if (io) {
        const userUnblockedEvent = {
          type: 'user_unblocked',
          unblocker: {
            id: session.user.id,
            name: session.user.name,
            username: session.user.email
          },
          unblocked: {
            id: userId,
            username: userToBlock.username,
            name: userToBlock.name
          },
          unblockedAt: new Date()
        }

        console.log('✅ CRITICAL: About to emit user-unblocked event:', userUnblockedEvent)

        // Notify the unblocker (for real-time UI updates)
        console.log(`✅ CRITICAL: Emitting to user:${session.user.id}`)
        io.to(`user:${session.user.id}`).emit('user-unblocked', userUnblockedEvent)

        // Notify the unblocked user (so they know they've been unblocked)
        console.log(`✅ CRITICAL: Emitting to user:${userId}`)
        io.to(`user:${userId}`).emit('user-unblocked', userUnblockedEvent)
        
        // Broadcast to all connected clients for real-time sidebar updates
        console.log('✅ CRITICAL: Broadcasting to all clients')
        io.emit('user-unblocked', userUnblockedEvent)
        
        console.log(`✅ CRITICAL: Successfully emitted user-unblocked event: ${session.user.id} unblocked ${userId}`)
      } else {
        console.error('✅ CRITICAL: Socket.IO instance not available for user-unblocked event!')
      }

      return res.status(200).json({ 
        success: true,
        message: `${userToBlock.name || userToBlock.username} has been unblocked`
      })

    } else {
      return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.issues })
    }
    console.error('Block user error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}