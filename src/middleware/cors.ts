import { NextApiRequest, NextApiResponse } from 'next'

export function corsMiddleware(req: NextApiRequest, res: NextApiResponse) {
  // Set CORS headers for Railway deployment
  const allowedOrigins = [
    'https://chatflow-staging.up.railway.app',
    'https://chatflow.up.railway.app',
    'http://localhost:3000'
  ]

  const origin = req.headers.origin
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,DELETE,PATCH,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, Set-Cookie')

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return true // Indicates request was handled
  }

  return false
}