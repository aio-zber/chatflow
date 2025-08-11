import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from './auth/[...nextauth]'
import formidable from 'formidable'
import fs from 'fs'
import path from 'path'

export const config = {
  api: {
    bodyParser: false,
  },
}

const uploadDir = path.join(process.cwd(), 'public/uploads')

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

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
      uploadDir,
      keepExtensions: true,
      maxFileSize: MAX_FILE_SIZE,
      filename: (name, ext, part, form) => {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`
      },
    })

    const [fields, files] = await form.parse(req)
    const uploadedFiles = Array.isArray(files.files) ? files.files : [files.files].filter(Boolean)

    if (!uploadedFiles.length) {
      return res.status(400).json({ error: 'No files uploaded' })
    }

    const processedFiles = uploadedFiles.map(file => {
      const filename = path.basename(file.filepath)
      const fileUrl = `/uploads/${filename}`
      
      return {
        id: filename,
        name: file.originalFilename || filename,
        url: fileUrl,
        size: file.size,
        type: file.mimetype?.startsWith('image/') ? 'image' : 'file',
        mimetype: file.mimetype,
      }
    })

    res.status(200).json({ files: processedFiles })
  } catch (error) {
    console.error('Upload error:', error)
    
    if (error instanceof Error) {
      if (error.message.includes('maxFileSize')) {
        return res.status(413).json({ error: 'File too large. Maximum size is 10MB.' })
      }
    }
    
    res.status(500).json({ error: 'Failed to upload files' })
  }
}