import { NextApiRequest, NextApiResponse } from 'next'

/**
 * Proxy API route to serve files with proper CORS headers
 * This helps bypass COEP issues with external file resources
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { path } = req.query
  
  if (!path || !Array.isArray(path)) {
    return res.status(400).json({ error: 'Invalid path' })
  }

  // Reconstruct the file URL
  const filePath = path.join('/')
  
  // Only allow Cloudinary URLs for security
  if (!filePath.includes('res.cloudinary.com')) {
    return res.status(400).json({ error: 'Only Cloudinary URLs are allowed' })
  }

  const fileUrl = `https://${filePath}`
  
  try {
    // Set CORS headers before fetching
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
    
    // Fetch the file from Cloudinary
    const response = await fetch(fileUrl)
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'File not found' })
    }

    // Get the file content type
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    
    // Set appropriate headers
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=31536000') // Cache for 1 year
    
    // Stream the file content
    const buffer = await response.arrayBuffer()
    res.send(Buffer.from(buffer))
    
  } catch (error) {
    console.error('Error proxying file:', error)
    res.status(500).json({ error: 'Failed to fetch file' })
  }
}