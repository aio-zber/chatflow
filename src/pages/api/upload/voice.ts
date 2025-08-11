import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]'
import formidable, { File as FormidableFile } from 'formidable'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

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

    // Validate file type
    const allowedTypes = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav']
    if (!allowedTypes.includes(voiceFile.mimetype || '')) {
      return res.status(400).json({ error: 'Invalid file type. Only audio files are allowed.' })
    }

    // Create uploads directory if it doesn't exist
    const uploadsDir = join(process.cwd(), 'public', 'uploads', 'voice')
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true })
    }

    // Generate unique filename
    const timestamp = Date.now()
    const userId = session.user.id
    const fileExtension = voiceFile.originalFilename?.split('.').pop() || 'webm'
    const filename = `voice_${userId}_${timestamp}.${fileExtension}`
    const filePath = join(uploadsDir, filename)

    // Save file
    const fileBuffer = await readFileAsBuffer(voiceFile)
    await writeFile(filePath, fileBuffer)

    // Return file URL
    const fileUrl = `/uploads/voice/${filename}`
    
    res.status(200).json({
      success: true,
      fileUrl,
      filename,
      size: voiceFile.size,
      duration: fields.duration ? parseInt(fields.duration as string) : 0,
    })

  } catch (error) {
    console.error('Voice upload error:', error)
    res.status(500).json({ error: 'Failed to upload voice message' })
  }
}

async function readFileAsBuffer(file: FormidableFile): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const fs = require('fs')
    fs.readFile(file.filepath, (err: any, data: Buffer) => {
      if (err) reject(err)
      else resolve(data)
    })
  })
}
