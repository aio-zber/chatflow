import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from './auth/[...nextauth]'
import formidable from 'formidable'
import fs from 'fs'
import path from 'path'
import { uploadToCloudinary } from '../../lib/cloudinary'

export const config = {
  api: {
    bodyParser: false,
  },
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
      keepExtensions: true,
      maxFileSize: MAX_FILE_SIZE,
      // Use temporary files, we'll read and delete them
    })

    const [, files] = await form.parse(req)
    
    console.log('Upload API - Parsed files:', Object.keys(files), files)
    
    // Handle both single file and multiple files
    let uploadedFiles: formidable.File[] = []
    
    // Check for 'file' field (single file) or 'files' field (multiple files)
    if (files.file) {
      uploadedFiles = Array.isArray(files.file) ? files.file : [files.file]
    } else if (files.files) {
      uploadedFiles = Array.isArray(files.files) ? files.files : [files.files]
    }
    
    // Filter out any undefined/null files
    uploadedFiles = uploadedFiles.filter(Boolean)

    console.log('Upload API - Processed files count:', uploadedFiles.length)

    if (!uploadedFiles.length) {
      return res.status(400).json({ error: 'No files uploaded' })
    }

    // Check if Cloudinary is configured
    const isCloudinaryConfigured = process.env.CLOUDINARY_CLOUD_NAME && 
                                   process.env.CLOUDINARY_API_KEY && 
                                   process.env.CLOUDINARY_API_SECRET

    console.log('Upload API - Cloudinary configured:', isCloudinaryConfigured)

    // Process each file and upload to Cloudinary
    const processedFiles = await Promise.all(
      uploadedFiles.map(async (file) => {
        try {
          // Read file content
          const fileContent = await fs.promises.readFile(file.filepath)
          
          console.log('Upload API - Processing file:', {
            originalName: file.originalFilename,
            size: file.size,
            mimetype: file.mimetype
          })

          if (isCloudinaryConfigured) {
            // Determine upload type based on mimetype
            const isImage = file.mimetype?.startsWith('image/')
            const uploadType = isImage ? 'image' : 'file'
            
            // Upload to Cloudinary
            const result = await uploadToCloudinary(
              fileContent,
              file.originalFilename || 'unknown',
              uploadType
            )

            // Clean up temp file
            try {
              await fs.promises.unlink(file.filepath)
            } catch (cleanupError) {
              console.warn('Failed to cleanup temp file:', cleanupError)
            }
            
            return {
              id: result.publicId,
              name: file.originalFilename || result.publicId,
              url: result.secureUrl,
              size: result.bytes,
              type: isImage ? 'image' : 'file',
              mimetype: file.mimetype,
              cloudinaryPublicId: result.publicId,
              format: result.format
            }
          } else {
            console.warn('Cloudinary not configured, falling back to local storage')
            
            // Fallback to local storage
            const uploadDir = path.join(process.cwd(), 'public/uploads')
            if (!fs.existsSync(uploadDir)) {
              fs.mkdirSync(uploadDir, { recursive: true })
            }

            const filename = `${Date.now()}-${file.originalFilename || 'unknown'}`
            const targetPath = path.join(uploadDir, filename)
            
            await fs.promises.copyFile(file.filepath, targetPath)
            await fs.promises.unlink(file.filepath) // cleanup temp file
            
            return {
              id: filename,
              name: file.originalFilename || filename,
              url: `/uploads/${filename}`,
              size: file.size,
              type: file.mimetype?.startsWith('image/') ? 'image' : 'file',
              mimetype: file.mimetype,
            }
          }
        } catch (uploadError) {
          console.error('Error processing file:', uploadError)
          
          // Clean up temp file on error
          try {
            await fs.promises.unlink(file.filepath)
          } catch (cleanupError) {
            console.warn('Failed to cleanup temp file:', cleanupError)
          }
          
          throw uploadError
        }
      })
    )

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