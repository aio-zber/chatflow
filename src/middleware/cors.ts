import { NextApiRequest, NextApiResponse } from 'next'

export function corsMiddleware(req: NextApiRequest, res: NextApiResponse) {
  console.log(`🌐 CORS: Processing ${req.method} request with origin: ${req.headers.origin || 'undefined'}`)
  
  try {
    // Set CORS headers for Railway deployment
    const allowedOrigins = [
      'https://chatflow-staging.up.railway.app',
      'https://chatflow.up.railway.app',
      'http://localhost:3000'
    ]

    const origin = req.headers.origin
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      console.log(`🌐 CORS: Set origin header for: ${origin}`)
    } else {
      console.log(`🌐 CORS: No origin header set (origin: ${origin || 'undefined'})`)
    }

    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,DELETE,PATCH,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, Set-Cookie')

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      console.log(`🌐 CORS: Handling OPTIONS preflight request`)
      res.status(200).end()
      return true // Indicates request was handled
    }

    console.log(`🌐 CORS: Headers set successfully for ${req.method} request`)
    return false
  } catch (corsError: any) {
    console.error(`🌐 CORS: Error in middleware:`, corsError)
    return false
  }
}