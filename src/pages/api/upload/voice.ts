import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]'
import formidable from 'formidable'
import { readFile, unlink } from 'fs/promises'
import { uploadToCloudinary } from '../../../lib/cloudinary'

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const form = formidable({
      maxFileSize: 50 * 1024 * 1024, // 50MB max for voice messages
      keepExtensions: true,
    })

    const [fields, files] = await form.parse(req)
    const voiceFile = Array.isArray(files.voice) ? files.voice[0] : files.voice

    if (!voiceFile) {
      return res.status(400).json({ error: 'No voice file provided' })
    }

    // Validate file type - be more permissive with audio types
    const allowedTypes = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/x-wav', '']
    const mimeType = voiceFile.mimetype || ''
    const isAudioType = mimeType.startsWith('audio/') || allowedTypes.includes(mimeType)
    
    if (!isAudioType) {
      console.log('Rejected voice upload - mimetype:', mimeType)
      return res.status(400).json({ error: 'Invalid file type. Only audio files are allowed.' })
    }
    
    console.log('Voice upload - mimetype:', mimeType, 'size:', voiceFile.size)

    try {
      // Read file content
      const fileBuffer = await readFile(voiceFile.filepath)
      
      // Generate filename
      const timestamp = Date.now()
      const userId = session.user.id
      const originalName = voiceFile.originalFilename || 'voice-message'
      const filename = `voice_${userId}_${timestamp}_${originalName}`
      
      // Upload to Cloudinary
      const result = await uploadToCloudinary(
        fileBuffer,
        filename,
        'voice'
      )
      
      // Clean up temp file
      try {
        await unlink(voiceFile.filepath)
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp voice file:', cleanupError)
      }
      
      res.status(200).json({
        success: true,
        fileUrl: result.secureUrl,
        filename: result.publicId,
        size: result.bytes,
        duration: fields.duration ? parseInt(fields.duration as string) : 0,
        cloudinaryPublicId: result.publicId,
        format: result.format
      })
    } catch (uploadError) {
      console.error('Error uploading voice message to Cloudinary:', uploadError)
      
      // Clean up temp file on error
      try {
        await unlink(voiceFile.filepath)
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp voice file:', cleanupError)
      }
      
      throw uploadError
    }

  } catch (error) {
    console.error('Voice upload error:', error)
    res.status(500).json({ error: 'Failed to upload voice message' })
  }
}

