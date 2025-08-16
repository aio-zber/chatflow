import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]'
import { prisma } from '@/lib/prisma'
import cloudinary, { uploadOptions } from '@/lib/cloudinary'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { imageBase64 } = req.body as { imageBase64?: string }
    if (!imageBase64) {
      return res.status(400).json({ error: 'Missing image' })
    }

    // Ensure data URL format for upload
    const isDataUrl = imageBase64.startsWith('data:')
    const dataUri = isDataUrl ? imageBase64 : `data:image/png;base64,${imageBase64}`

    const uploadResult = await cloudinary.uploader.upload(dataUri, {
      ...uploadOptions.avatar,
      public_id: `avatar_${session.user.id}_${Date.now()}`,
      overwrite: true,
      invalidate: true,
    })

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: { avatar: uploadResult.secure_url },
      select: { id: true, avatar: true, name: true, username: true, email: true },
    })

    // Emit socket event to broadcast profile update to all connected users
    const { getIO, getSocketInstance } = await import('@/lib/socket')
    let io = getIO()
    
    // If socket is not available, try to initialize it
    if (!io) {
      console.log('API: Socket IO not available, attempting to initialize...')
      try {
        io = getSocketInstance(req, res)
        console.log('API: Socket IO initialized for avatar upload')
      } catch (error) {
        console.error('API: Failed to initialize Socket IO:', error)
      }
    }
    
    console.log(`API: Socket IO instance available for profile update:`, !!io)
    if (io) {
      const profileUpdate = {
        userId: session.user.id,
        avatar: uploadResult.secure_url,
        name: user.name,
        username: user.username
      }
      
      console.log(`API: Broadcasting profile update for user ${session.user.id}:`, profileUpdate)
      console.log(`API: Socket.IO connected clients count:`, io.engine.clientsCount)
      
      // Emit globally to all connected clients
      io.emit('user-profile-updated', profileUpdate)
      console.log(`API: Emitted user-profile-updated globally`)
      
      // Also emit to user's specific room
      console.log(`API: Emitting profile update to user room: user:${session.user.id}`)
      io.to(`user:${session.user.id}`).emit('user-profile-updated', profileUpdate)
      
      // Log room members for debugging
      const userRoom = io.sockets.adapter.rooms.get(`user:${session.user.id}`)
      console.log(`API: User room members:`, userRoom ? Array.from(userRoom) : 'none')
      
      console.log(`API: Profile update broadcasted successfully`)
    } else {
      console.warn('API: Socket.IO instance not available for profile update')
    }

    return res.status(200).json({ user, upload: { publicId: uploadResult.public_id, version: uploadResult.version } })
  } catch (error) {
    console.error('Avatar upload error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}


