import { v2 as cloudinary } from 'cloudinary'

// Configure Cloudinary
const isConfigured = process.env.CLOUDINARY_CLOUD_NAME && 
                     process.env.CLOUDINARY_API_KEY && 
                     process.env.CLOUDINARY_API_SECRET

if (isConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  })
}

export default cloudinary

// Upload options for different file types
export const uploadOptions = {
  image: {
    folder: 'chatflow/images',
    resource_type: 'image' as const,
    transformation: [
      { quality: 'auto', fetch_format: 'auto' },
      { width: 1200, height: 1200, crop: 'limit' }
    ]
  },
  avatar: {
    folder: 'chatflow/avatars',
    resource_type: 'image' as const,
    transformation: [
      { quality: 'auto', fetch_format: 'auto' },
      { width: 200, height: 200, crop: 'fill', gravity: 'face' }
    ]
  },
  voice: {
    folder: 'chatflow/voice',
    resource_type: 'video' as const, // Audio files use video resource type
    format: 'mp3' // Convert to mp3 for better compatibility
  },
  file: {
    folder: 'chatflow/files',
    resource_type: 'raw' as const
  }
}

/**
 * Upload a buffer to Cloudinary
 */
export async function uploadToCloudinary(
  buffer: Buffer, 
  filename: string,
  type: keyof typeof uploadOptions = 'file'
): Promise<{
  publicId: string
  url: string
  secureUrl: string
  format: string
  resourceType: string
  bytes: number
}> {
  if (!isConfigured) {
    throw new Error('Cloudinary is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET environment variables.')
  }

  try {
    const options = uploadOptions[type]
    
    return new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          ...options,
          public_id: `${Date.now()}-${filename.replace(/\.[^/.]+$/, '')}`, // Remove extension as Cloudinary handles it
          overwrite: false
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary upload error:', error)
            reject(error)
          } else if (result) {
            resolve({
              publicId: result.public_id,
              url: result.url,
              secureUrl: result.secure_url,
              format: result.format,
              resourceType: result.resource_type,
              bytes: result.bytes
            })
          } else {
            reject(new Error('Unknown error occurred during upload'))
          }
        }
      ).end(buffer)
    })
  } catch (error) {
    console.error('Error uploading to Cloudinary:', error)
    throw error
  }
}

/**
 * Delete a file from Cloudinary
 */
export async function deleteFromCloudinary(
  publicId: string, 
  resourceType: 'image' | 'video' | 'raw' = 'image'
): Promise<void> {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType })
  } catch (error) {
    console.error('Error deleting from Cloudinary:', error)
    throw error
  }
}

/**
 * Get optimized image URL
 */
export function getOptimizedImageUrl(
  publicId: string,
  options?: {
    width?: number
    height?: number
    quality?: string | number
    format?: string
    crop?: string
    gravity?: string
  }
): string {
  return cloudinary.url(publicId, {
    secure: true,
    quality: options?.quality || 'auto',
    fetch_format: options?.format || 'auto',
    width: options?.width,
    height: options?.height,
    crop: options?.crop || 'limit',
    gravity: options?.gravity
  })
}