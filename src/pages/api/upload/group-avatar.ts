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
    const { imageBase64, conversationId } = req.body as { 
      imageBase64?: string
      conversationId?: string
    }
    
    if (!imageBase64) {
      return res.status(400).json({ error: 'Missing image' })
    }
    
    if (!conversationId) {
      return res.status(400).json({ error: 'Missing conversation ID' })
    }

    // Verify user is an admin in this conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        isGroup: true,
        participants: {
          some: {
            userId: session.user.id,
            role: 'admin'
          }
        }
      }
    })

    if (!conversation) {
      return res.status(403).json({ error: 'Not authorized to update this group avatar' })
    }

    // Ensure data URL format for upload
    const isDataUrl = imageBase64.startsWith('data:')
    const dataUri = isDataUrl ? imageBase64 : `data:image/png;base64,${imageBase64}`

    const uploadResult = await cloudinary.uploader.upload(dataUri, {
      ...uploadOptions.avatar,
      public_id: `group_avatar_${conversationId}_${Date.now()}`,
      overwrite: true,
      invalidate: true,
    })

    // Return the uploaded avatar URL without updating user profile
    return res.status(200).json({ 
      success: true,
      avatar: {
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        version: uploadResult.version
      }
    })
  } catch (error) {
    console.error('Group avatar upload error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}