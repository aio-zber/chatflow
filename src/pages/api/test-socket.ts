import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from './auth/[...nextauth]'
import { getIO } from '@/lib/socket'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { eventType, data } = req.body

  try {
    const io = getIO()
    if (!io) {
      return res.status(500).json({ error: 'Socket.IO not available' })
    }

    console.log('Test socket API: Emitting event:', eventType, data)
    
    // Emit the test event
    io.emit(eventType, data)
    
    // Also emit to user-specific room
    io.to(`user:${session.user.id}`).emit(eventType, data)
    
    console.log('Test socket API: Event emitted successfully')
    
    return res.status(200).json({ 
      success: true, 
      message: `Event ${eventType} emitted successfully`,
      data 
    })
  } catch (error) {
    console.error('Test socket API error:', error)
    return res.status(500).json({ error: 'Failed to emit socket event' })
  }
}