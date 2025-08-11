/**
 * Comprehensive error handling utilities for ChatFlow
 */

import { logger } from './logger'

// Error types
export enum ErrorTypes {
  NETWORK = 'NETWORK',
  VALIDATION = 'VALIDATION',
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  NOT_FOUND = 'NOT_FOUND',
  RATE_LIMIT = 'RATE_LIMIT',
  SERVER = 'SERVER',
  CLIENT = 'CLIENT',
  WEBSOCKET = 'WEBSOCKET',
  DATABASE = 'DATABASE',
}

export interface ErrorContext {
  userId?: string
  sessionId?: string
  action?: string
  component?: string
  url?: string
  timestamp?: string
  metadata?: Record<string, any>
}

export class ApplicationError extends Error {
  public readonly type: ErrorTypes
  public readonly code: string
  public readonly statusCode: number
  public readonly isRetryable: boolean
  public readonly context: ErrorContext

  constructor(
    message: string,
    type: ErrorTypes,
    code: string,
    statusCode: number = 500,
    isRetryable: boolean = false,
    context: ErrorContext = {}
  ) {
    super(message)
    this.name = 'ApplicationError'
    this.type = type
    this.code = code
    this.statusCode = statusCode
    this.isRetryable = isRetryable
    this.context = {
      ...context,
      timestamp: new Date().toISOString(),
    }

    Error.captureStackTrace(this, this.constructor)
  }
}

// Network error handling
export class NetworkError extends ApplicationError {
  constructor(message: string, statusCode: number = 0, context: ErrorContext = {}) {
    super(
      message,
      ErrorTypes.NETWORK,
      `NETWORK_${statusCode}`,
      statusCode,
      statusCode >= 500 || statusCode === 0, // Retry on 5xx or connection errors
      context
    )
  }
}

// API error factory
export function createApiError(
  response: Response,
  context: ErrorContext = {}
): ApplicationError {
  const { status, statusText } = response

  switch (status) {
    case 400:
      return new ApplicationError(
        'Invalid request data',
        ErrorTypes.VALIDATION,
        'BAD_REQUEST',
        400,
        false,
        context
      )
    case 401:
      return new ApplicationError(
        'Authentication required',
        ErrorTypes.AUTHENTICATION,
        'UNAUTHORIZED',
        401,
        false,
        context
      )
    case 403:
      return new ApplicationError(
        'Access denied',
        ErrorTypes.AUTHORIZATION,
        'FORBIDDEN',
        403,
        false,
        context
      )
    case 404:
      return new ApplicationError(
        'Resource not found',
        ErrorTypes.NOT_FOUND,
        'NOT_FOUND',
        404,
        false,
        context
      )
    case 429:
      return new ApplicationError(
        'Too many requests',
        ErrorTypes.RATE_LIMIT,
        'RATE_LIMIT',
        429,
        true,
        context
      )
    case 500:
    case 502:
    case 503:
    case 504:
      return new ApplicationError(
        statusText || 'Server error',
        ErrorTypes.SERVER,
        `SERVER_${status}`,
        status,
        true,
        context
      )
    default:
      return new ApplicationError(
        statusText || 'Unknown error',
        ErrorTypes.CLIENT,
        `HTTP_${status}`,
        status,
        false,
        context
      )
  }
}

// Retry configuration
interface RetryConfig {
  maxAttempts: number
  baseDelay: number
  maxDelay: number
  backoffFactor: number
  retryCondition?: (error: Error) => boolean
}

const defaultRetryConfig: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffFactor: 2,
  retryCondition: (error) => {
    if (error instanceof ApplicationError) {
      return error.isRetryable
    }
    return error instanceof NetworkError
  },
}

// Exponential backoff retry wrapper
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  context: ErrorContext = {}
): Promise<T> {
  const finalConfig = { ...defaultRetryConfig, ...config }
  let lastError: Error

  for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error
      
      const shouldRetry = finalConfig.retryCondition!(lastError) && attempt < finalConfig.maxAttempts
      
      logger.warn(`Operation failed (attempt ${attempt}/${finalConfig.maxAttempts})`, {
        error: lastError.message,
        shouldRetry,
        context,
      })

      if (!shouldRetry) {
        break
      }

      const delay = Math.min(
        finalConfig.baseDelay * Math.pow(finalConfig.backoffFactor, attempt - 1),
        finalConfig.maxDelay
      )

      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError!
}

// Circuit breaker pattern
export class CircuitBreaker {
  private failures = 0
  private nextAttempt = Date.now()
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'

  constructor(
    private threshold: number = 5,
    private timeout: number = 60000,
    private resetTimeout: number = 30000
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new ApplicationError(
          'Circuit breaker is OPEN',
          ErrorTypes.SERVER,
          'CIRCUIT_BREAKER_OPEN',
          503,
          true
        )
      }
      this.state = 'HALF_OPEN'
    }

    try {
      const result = await operation()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onSuccess() {
    this.failures = 0
    this.state = 'CLOSED'
  }

  private onFailure() {
    this.failures++
    if (this.failures >= this.threshold) {
      this.state = 'OPEN'
      this.nextAttempt = Date.now() + this.timeout
    }
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      nextAttempt: this.nextAttempt,
    }
  }
}

// Global error handler for unhandled errors
export function setupGlobalErrorHandlers() {
  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    logger.error('Unhandled promise rejection:', event.reason, {
      url: window.location.href,
      userAgent: navigator.userAgent,
    })
    
    // Prevent default browser behavior
    event.preventDefault()
  })

  // Global error handler
  window.addEventListener('error', (event) => {
    logger.error('Global error:', event.error || event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      url: window.location.href,
      userAgent: navigator.userAgent,
    })
  })

  // Resource loading errors
  window.addEventListener('error', (event) => {
    if (event.target !== window) {
      const target = event.target as HTMLElement
      logger.error('Resource loading error:', {
        tagName: target.tagName,
        src: (target as any).src || (target as any).href,
        url: window.location.href,
      })
    }
  }, true)
}

// Error reporting utilities
export function reportError(
  error: Error,
  context: ErrorContext = {},
  severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
) {
  const errorReport = {
    message: error.message,
    stack: error.stack,
    name: error.name,
    context,
    severity,
    timestamp: new Date().toISOString(),
    url: typeof window !== 'undefined' ? window.location.href : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  }

  logger.error('Error reported:', errorReport)

  // In production, send to error tracking service
  if (process.env.NODE_ENV === 'production') {
    // Example: Sentry, Bugsnag, or custom service
    // sendToErrorTrackingService(errorReport)
  }
}

// React error boundary hook
export function useErrorHandler() {
  return (error: Error, errorInfo?: any) => {
    reportError(error, {
      component: errorInfo?.componentStack,
    }, 'high')
  }
}

// API wrapper with error handling
export async function apiCall<T>(
  url: string,
  options: RequestInit = {},
  context: ErrorContext = {}
): Promise<T> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      throw createApiError(response, { ...context, url })
    }

    return await response.json()
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error
    }

    // Network or parsing error
    throw new NetworkError(
      error instanceof Error ? error.message : 'Network request failed',
      0,
      { ...context, url }
    )
  }
}

// WebSocket error handling
export function handleWebSocketError(error: Event, context: ErrorContext = {}) {
  logger.error('WebSocket error:', error, {
    ...context,
    type: 'websocket',
  })

  return new ApplicationError(
    'WebSocket connection error',
    ErrorTypes.WEBSOCKET,
    'WS_ERROR',
    0,
    true,
    context
  )
}

// Export singleton instances
export const apiCircuitBreaker = new CircuitBreaker(5, 60000, 30000)
export const wsCircuitBreaker = new CircuitBreaker(3, 30000, 15000)
