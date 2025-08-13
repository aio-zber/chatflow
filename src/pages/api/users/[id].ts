import { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { id } = req.query

  if (req.method === 'GET') {
    try {
      const user = await prisma.user.findUnique({
        where: { id: id as string },
        select: {
          id: true,
          username: true,
          name: true,
          avatar: true,
          bio: true,
          status: true,
          lastSeen: true,
          isOnline: true,
          createdAt: true,
        }
      })

      if (!user) {
        return res.status(404).json({ error: 'User not found' })
      }

      res.json({ user })
    } catch (error) {
      console.error('Get user error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else if (req.method === 'PUT') {
    if (session.user?.id !== id) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    try {
      const { name, bio, status } = req.body

      const user = await prisma.user.update({
        where: { id: id as string },
        data: {
          ...(name && { name }),
          ...(bio !== undefined && { bio }),
          ...(status && { status }),
        },
        select: {
          id: true,
          username: true,
          name: true,
          avatar: true,
          bio: true,
          status: true,
          lastSeen: true,
          isOnline: true,
        }
      })

      // Emit socket event to broadcast profile update to all connected users
      const { getIO, getSocketInstance } = await import('@/lib/socket')
      let io = getIO()
      
      // If socket is not available, try to initialize it
      if (!io) {
        console.log('API: Socket IO not available for user update, attempting to initialize...')
        try {
          io = getSocketInstance(req, res)
          console.log('API: Socket IO initialized for user update')
        } catch (error) {
          console.error('API: Failed to initialize Socket IO for user update:', error)
        }
      }
      
      console.log(`API: Socket IO instance available for user update:`, !!io)
      if (io && (name || bio !== undefined || status)) {
        const profileUpdate = {
          userId: id as string,
          name: user.name,
          username: user.username,
          avatar: user.avatar
        }
        
        console.log(`API: Broadcasting user profile update for user ${id}:`, profileUpdate)
        console.log(`API: Socket.IO connected clients count:`, io.engine.clientsCount)
        
        // Emit globally to all connected clients
        io.emit('user-profile-updated', profileUpdate)
        console.log(`API: Emitted user-profile-updated globally`)
        
        // Also emit to user's specific room
        console.log(`API: Emitting profile update to user room: user:${id}`)
        io.to(`user:${id}`).emit('user-profile-updated', profileUpdate)
        
        // Log room members for debugging
        const userRoom = io.sockets.adapter.rooms.get(`user:${id}`)
        console.log(`API: User room members:`, userRoom ? Array.from(userRoom) : 'none')
        
        console.log(`API: User profile update broadcasted successfully`)
      } else {
        console.warn('API: Socket.IO instance not available for user profile update')
      }

      res.json({ user })
    } catch (error) {
      console.error('Update user error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}