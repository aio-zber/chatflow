import { NextApiRequest, NextApiResponse } from 'next'

interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  reset: number
}

// Simple in-memory rate limiter for demo purposes
// In production, use Redis or similar
const requests = new Map<string, { count: number; reset: number }>()

export function rateLimit(options: {
  interval: number // in milliseconds
  uniqueTokenPerInterval: number
}) {
  return {
    check: (req: NextApiRequest, limit: number, token?: string): RateLimitResult => {
      const identifier = token || getClientIP(req) || 'anonymous'
      const now = Date.now()
      const windowStart = now - options.interval

      // Clean up old entries
      for (const [key, value] of requests.entries()) {
        if (value.reset < now) {
          requests.delete(key)
        }
      }

      const requestData = requests.get(identifier)
      const reset = windowStart + options.interval

      if (!requestData || requestData.reset < now) {
        // New window or first request
        requests.set(identifier, { count: 1, reset })
        return {
          success: true,
          limit,
          remaining: limit - 1,
          reset
        }
      }

      if (requestData.count >= limit) {
        return {
          success: false,
          limit,
          remaining: 0,
          reset: requestData.reset
        }
      }

      requestData.count++
      return {
        success: true,
        limit,
        remaining: limit - requestData.count,
        reset: requestData.reset
      }
    }
  }
}

function getClientIP(req: NextApiRequest): string | null {
  const forwarded = req.headers['x-forwarded-for']
  const realIP = req.headers['x-real-ip']
  
  if (forwarded) {
    return Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim()
  }
  
  if (realIP) {
    return Array.isArray(realIP) ? realIP[0] : realIP
  }
  
  return req.connection.remoteAddress || req.socket.remoteAddress || null
}

// Rate limiter instances
export const authLimiter = rateLimit({
  interval: 60 * 1000 * 60, // 60 minutes
  uniqueTokenPerInterval: 500,
})

export const messageLimiter = rateLimit({
  interval: 60 * 1000, // 1 minute
  uniqueTokenPerInterval: 500,
})

export const generalLimiter = rateLimit({
  interval: 60 * 1000, // 1 minute
  uniqueTokenPerInterval: 500,
})