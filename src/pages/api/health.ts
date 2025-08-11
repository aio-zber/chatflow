import { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '@/lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
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
