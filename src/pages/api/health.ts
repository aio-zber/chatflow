import { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '@/lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CRITICAL: Test if POST requests reach this handler
  console.log(`🧪 HEALTH HANDLER: ${req.method} ${req.url} AT ${new Date().toISOString()}`)
  console.log(`🧪 REQUEST BODY:`, req.body)
  console.log(`🧪 REQUEST HEADERS:`, {
    'content-type': req.headers['content-type'],
    'user-agent': req.headers['user-agent']?.substring(0, 50),
    'origin': req.headers.origin,
    'cookie': req.headers.cookie ? 'Present' : 'Missing'
  })

  if (req.method === 'POST') {
    console.log(`🧪 POST REQUEST TO HEALTH ENDPOINT SUCCESSFUL!`)
    return res.status(200).json({ 
      success: true,
      message: 'POST request to health endpoint successful',
      timestamp: new Date().toISOString(),
      method: req.method,
      body: req.body
    })
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    console.log(`🧪 METHOD NOT ALLOWED: ${req.method}`)
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Check database connection
    const dbStart = Date.now()
    await prisma.$queryRaw`SELECT 1`
    const dbTime = Date.now() - dbStart

    // Check system health
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {
        database: {
          status: 'healthy',
          responseTime: dbTime,
        },
        memory: process.memoryUsage(),
        uptime: process.uptime(),
      },
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV,
    }

    // For HEAD requests, just return status
    if (req.method === 'HEAD') {
      return res.status(200).end()
    }

    res.status(200).json(health)
  } catch (error) {
    console.error('Health check failed:', error)
    
    const unhealthyResponse = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    }

    res.status(503).json(unhealthyResponse)
  }
}
