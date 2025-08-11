import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]'
import { prisma } from '@/lib/prisma'
import { v2 as cloudinary } from 'cloudinary'

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

    // Configure Cloudinary (expects env vars set)
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    })

    // Ensure data URL format for upload
    const isDataUrl = imageBase64.startsWith('data:')
    const dataUri = isDataUrl ? imageBase64 : `data:image/png;base64,${imageBase64}`

    const uploadResult = await cloudinary.uploader.upload(dataUri, {
      folder: 'chatflow/avatars',
      public_id: `avatar_${session.user.id}_${Date.now()}`,
      transformation: [
        { width: 512, height: 512, crop: 'fill', gravity: 'auto' },
        { fetch_format: 'auto', quality: 'auto' },
      ],
      overwrite: true,
      invalidate: true,
    })

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: { avatar: uploadResult.secure_url },
      select: { id: true, avatar: true, name: true, username: true, email: true },
    })

    return res.status(200).json({ user, upload: { publicId: uploadResult.public_id, version: uploadResult.version } })
  } catch (error) {
    console.error('Avatar upload error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}


