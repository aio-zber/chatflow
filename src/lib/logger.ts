type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  data?: any
  userId?: string
  sessionId?: string
  url?: string
  userAgent?: string
}

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development'
  private logBuffer: LogEntry[] = []
  private maxBufferSize = 1000
  
  // Performance optimizations: reduce logging in production and allow runtime control
  private minLogLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || (this.isDevelopment ? 'debug' : 'warn')
  private enabledModules: string[] = this.getEnabledModules()
  
  private readonly logLevels: Record<LogLevel, number> = {
    debug: 0,
    info: 1, 
    warn: 2,
    error: 3
  }

  private getEnabledModules(): string[] {
    const modules: string[] = ['ERROR'] // Always allow errors
    
    // Check environment variables for module-specific controls
    if (process.env.ENABLE_SOCKET_LOGGING === 'true') modules.push('SOCKET')
    if (process.env.ENABLE_CALL_LOGGING === 'true') modules.push('CALL') 
    if (process.env.ENABLE_WEBRTC_LOGGING === 'true') modules.push('WebRTC')
    
    // Default fallback for development
    if (modules.length === 1 && this.isDevelopment) {
      return ['CALL', 'SOCKET', 'WebRTC', 'ERROR']
    }
    
    return modules
  }

  private createLogEntry(
    level: LogLevel,
    message: string,
    data?: any,
    context?: { userId?: string; sessionId?: string; url?: string; userAgent?: string }
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: data ? this.sanitizeData(data) : undefined,
      ...context,
    }
  }

  private sanitizeData(data: any): any {
    if (typeof data !== 'object' || data === null) return data

    const sanitized = { ...data }
    
    // Remove sensitive fields
    const sensitiveKeys = [
      'password', 'token', 'secret', 'key', 'auth', 'credential',
      'ssn', 'social', 'credit', 'card', 'cvv', 'pin'
    ]
    
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]'
      }
    }
    
    return sanitized
  }

  private shouldLog(level: LogLevel, module?: string): boolean {
    // Check log level
    if (this.logLevels[level] < this.logLevels[this.minLogLevel]) {
      return false
    }
    
    // Check module filtering
    if (module && this.enabledModules.length > 0 && !this.enabledModules.includes(module)) {
      return false
    }
    
    return true
  }

  // Public method for external use
  public canLog(level: LogLevel, module?: string): boolean {
    return this.shouldLog(level, module)
  }

  private addToBuffer(entry: LogEntry) {
    this.logBuffer.push(entry)
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift()
    }
  }

  private consoleLog(entry: LogEntry) {
    const { timestamp, level, message, data } = entry
    const logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`
    
    switch (level) {
      case 'debug':
        if (this.isDevelopment) {
          console.debug(logMessage, data)
        }
        break
      case 'info':
        console.info(logMessage, data)
        break
      case 'warn':
        console.warn(logMessage, data)
        break
      case 'error':
        console.error(logMessage, data)
        break
    }
  }

  debug(message: string, data?: any, context?: any) {
    if (!this.shouldLog('debug')) return
    const entry = this.createLogEntry('debug', message, data, context)
    this.addToBuffer(entry)
    this.consoleLog(entry)
  }

  info(message: string, data?: any, context?: any) {
    if (!this.shouldLog('info')) return
    const entry = this.createLogEntry('info', message, data, context)
    this.addToBuffer(entry)
    this.consoleLog(entry)
  }

  warn(message: string, data?: any, context?: any) {
    if (!this.shouldLog('warn')) return
    const entry = this.createLogEntry('warn', message, data, context)
    this.addToBuffer(entry)
    this.consoleLog(entry)
  }

  error(message: string, error?: Error | any, context?: any) {
    if (!this.shouldLog('error')) return
    const data = error instanceof Error 
      ? { message: error.message, stack: error.stack, name: error.name }
      : error

    const entry = this.createLogEntry('error', message, data, context)
    this.addToBuffer(entry)
    this.consoleLog(entry)

    // In production, you might want to send errors to an external service
    if (!this.isDevelopment) {
      this.sendToExternalService(entry)
    }
  }

  private async sendToExternalService(entry: LogEntry) {
    try {
      // Example: Send to your logging service (Sentry, LogRocket, etc.)
      // await fetch('/api/logs', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(entry),
      // })
    } catch (err) {
      console.error('Failed to send log to external service:', err)
    }
  }

  getRecentLogs(limit = 100): LogEntry[] {
    return this.logBuffer.slice(-limit)
  }

  clearLogs() {
    this.logBuffer = []
  }
}

export const logger = new Logger()

// Error boundary utilities
export class AppError extends Error {
  public readonly statusCode: number
  public readonly isOperational: boolean

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = isOperational

    Error.captureStackTrace(this, this.constructor)
  }
}

export const handleApiError = (error: any, context?: string) => {
  if (error instanceof AppError) {
    logger.error(`API Error in ${context}:`, error)
    return {
      status: error.statusCode,
      error: error.message,
    }
  }

  if (error.code === 'P2002') {
    logger.warn('Database constraint violation:', error, { context })
    return {
      status: 400,
      error: 'Resource already exists',
    }
  }

  if (error.code === 'P2025') {
    logger.warn('Database record not found:', error, { context })
    return {
      status: 404,
      error: 'Resource not found',
    }
  }

  logger.error(`Unexpected error in ${context}:`, error)
  return {
    status: 500,
    error: 'Internal server error',
  }
}

// Module-specific loggers with performance optimizations
export const callLogger = {
  debug: (message: string, data?: any) => {
    if (!logger.canLog('debug', 'CALL')) return
    logger.debug(`[CALL] ${message}`, data)
  },
  info: (message: string, data?: any) => {
    if (!logger.canLog('info', 'CALL')) return  
    logger.info(`[CALL] ${message}`, data)
  },
  warn: (message: string, data?: any) => {
    if (!logger.canLog('warn', 'CALL')) return
    logger.warn(`[CALL] ${message}`, data)
  },
  error: (message: string, error?: any) => {
    if (!logger.canLog('error', 'CALL')) return
    logger.error(`[CALL] ${message}`, error)
  },
}

export const socketLogger = {
  debug: (message: string, data?: any) => {
    if (!logger.canLog('debug', 'SOCKET')) return
    logger.debug(`[SOCKET] ${message}`, data)
  },
  info: (message: string, data?: any) => {
    if (!logger.canLog('info', 'SOCKET')) return
    logger.info(`[SOCKET] ${message}`, data)
  },
  warn: (message: string, data?: any) => {
    if (!logger.canLog('warn', 'SOCKET')) return
    logger.warn(`[SOCKET] ${message}`, data)
  },
  error: (message: string, error?: any) => {
    if (!logger.canLog('error', 'SOCKET')) return
    logger.error(`[SOCKET] ${message}`, error)
  },
}

export const webrtcLogger = {
  debug: (message: string, data?: any) => {
    if (!logger.canLog('debug', 'WebRTC')) return
    logger.debug(`[WebRTC] ${message}`, data)
  },
  info: (message: string, data?: any) => {
    if (!logger.canLog('info', 'WebRTC')) return
    logger.info(`[WebRTC] ${message}`, data)
  },
  warn: (message: string, data?: any) => {
    if (!logger.canLog('warn', 'WebRTC')) return
    logger.warn(`[WebRTC] ${message}`, data)
  },
  error: (message: string, error?: any) => {
    if (!logger.canLog('error', 'WebRTC')) return
    logger.error(`[WebRTC] ${message}`, error)
  },
}