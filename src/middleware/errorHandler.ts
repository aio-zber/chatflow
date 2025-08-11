/**
 * Next.js API middleware for error handling
 */

import { NextApiRequest, NextApiResponse } from 'next'
import { logger, handleApiError } from '@/lib/logger'

export interface ApiError extends Error {
  statusCode?: number
  code?: string
}

export function withErrorHandler(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void>
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      await handler(req, res)
    } catch (error) {
      const { status, error: errorMessage } = handleApiError(error, req.url)
      
      // Log additional request context
      logger.error('API endpoint error:', error, {
        method: req.method,
        url: req.url,
        query: req.query,
        headers: {
          'user-agent': req.headers['user-agent'],
          'x-forwarded-for': req.headers['x-forwarded-for'],
          'authorization': req.headers.authorization ? '[PRESENT]' : '[MISSING]',
        },
        body: req.method !== 'GET' ? '[REQUEST_BODY]' : undefined,
      })

      // Set appropriate headers
      res.status(status)
      
      if (status === 429) {
        res.setHeader('Retry-After', '60')
      }
      
      if (status >= 500) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
      }

      // Send error response
      res.json({
        error: errorMessage,
        ...(process.env.NODE_ENV === 'development' && {
          stack: error instanceof Error ? error.stack : undefined,
          details: error,
        }),
      })
    }
  }
}

// Validation error helper
export function createValidationError(issues: any[]) {
  const error = new Error('Validation failed') as ApiError
  error.statusCode = 400
  error.code = 'VALIDATION_ERROR'
  ;(error as any).issues = issues
  return error
}

// Rate limiting error
export function createRateLimitError() {
  const error = new Error('Too many requests') as ApiError
  error.statusCode = 429
  error.code = 'RATE_LIMIT_EXCEEDED'
  return error
}

// Authentication error
export function createAuthError() {
  const error = new Error('Authentication required') as ApiError
  error.statusCode = 401
  error.code = 'UNAUTHORIZED'
  return error
}

// Authorization error
export function createForbiddenError() {
  const error = new Error('Insufficient permissions') as ApiError
  error.statusCode = 403
  error.code = 'FORBIDDEN'
  return error
}

// Not found error
export function createNotFoundError(resource: string = 'Resource') {
  const error = new Error(`${resource} not found`) as ApiError
  error.statusCode = 404
  error.code = 'NOT_FOUND'
  return error
}

// Conflict error
export function createConflictError(message: string = 'Resource already exists') {
  const error = new Error(message) as ApiError
  error.statusCode = 409
  error.code = 'CONFLICT'
  return error
}

// Server error
export function createServerError(message: string = 'Internal server error') {
  const error = new Error(message) as ApiError
  error.statusCode = 500
  error.code = 'INTERNAL_ERROR'
  return error
}
