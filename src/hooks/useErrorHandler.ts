'use client'

import { useCallback, useState } from 'react'
import { ApplicationError, reportError, ErrorContext } from '@/lib/errorHandler'
import { logger } from '@/lib/logger'

interface ErrorState {
  error: Error | null
  isError: boolean
  errorId: string | null
}

interface UseErrorHandlerReturn {
  error: Error | null
  isError: boolean
  errorId: string | null
  handleError: (error: Error, context?: ErrorContext) => void
  clearError: () => void
  retry: (() => void) | null
}

export function useErrorHandler(
  onError?: (error: Error) => void
): UseErrorHandlerReturn {
  const [errorState, setErrorState] = useState<ErrorState>({
    error: null,
    isError: false,
    errorId: null,
  })
  const [retryCallback, setRetryCallback] = useState<(() => void) | null>(null)

  const handleError = useCallback((error: Error, context: ErrorContext = {}) => {
    const errorId = `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    logger.error('Error handled by useErrorHandler:', error, {
      ...context,
      errorId,
    })

    setErrorState({
      error,
      isError: true,
      errorId,
    })

    // Report error for tracking
    reportError(error, { ...context, errorId }, 'medium')

    // Call custom error handler if provided
    onError?.(error)
  }, [onError])

  const clearError = useCallback(() => {
    setErrorState({
      error: null,
      isError: false,
      errorId: null,
    })
    setRetryCallback(null)
  }, [])

  return {
    error: errorState.error,
    isError: errorState.isError,
    errorId: errorState.errorId,
    handleError,
    clearError,
    retry: retryCallback,
  }
}

// Hook for handling async operations with automatic error handling
export function useAsyncError() {
  const { handleError } = useErrorHandler()

  const executeAsync = useCallback(async <T>(
    operation: () => Promise<T>,
    context?: ErrorContext
  ): Promise<T | null> => {
    try {
      return await operation()
    } catch (error) {
      handleError(error as Error, context)
      return null
    }
  }, [handleError])

  return executeAsync
}

// Hook for handling API calls with retry logic
export function useApiCall() {
  const { handleError } = useErrorHandler()
  const [loading, setLoading] = useState(false)

  const callApi = useCallback(async <T>(
    apiCall: () => Promise<T>,
    options: {
      retries?: number
      retryDelay?: number
      context?: ErrorContext
      onSuccess?: (data: T) => void
      onError?: (error: Error) => void
    } = {}
  ): Promise<T | null> => {
    const {
      retries = 1,
      retryDelay = 1000,
      context = {},
      onSuccess,
      onError,
    } = options

    setLoading(true)

    let lastError: Error
    
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const result = await apiCall()
        onSuccess?.(result)
        setLoading(false)
        return result
      } catch (error) {
        lastError = error as Error
        
        // If it's the last attempt or error is not retryable
        if (
          attempt === retries - 1 ||
          (error instanceof ApplicationError && !error.isRetryable)
        ) {
          break
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)))
      }
    }

    setLoading(false)
    handleError(lastError!, context)
    onError?.(lastError!)
    return null
  }, [handleError])

  return { callApi, loading }
}

// Hook for displaying user-friendly error messages
export function useErrorToast() {
  const showErrorToast = useCallback((error: Error, duration: number = 5000) => {
    let message = 'An unexpected error occurred'
    
    if (error instanceof ApplicationError) {
      switch (error.type) {
        case 'NETWORK':
          message = 'Network connection error. Please check your internet connection.'
          break
        case 'AUTHENTICATION':
          message = 'Please sign in to continue.'
          break
        case 'AUTHORIZATION':
          message = 'You do not have permission to perform this action.'
          break
        case 'NOT_FOUND':
          message = 'The requested resource was not found.'
          break
        case 'RATE_LIMIT':
          message = 'Too many requests. Please wait a moment and try again.'
          break
        case 'VALIDATION':
          message = 'Please check your input and try again.'
          break
        default:
          message = error.message
      }
    } else {
      message = error.message
    }

    // In a real app, you'd use your toast/notification system
    // For now, we'll use a simple console log
    console.log(`Error Toast: ${message}`)
    
    // You could also dispatch to a toast context or use a library like react-hot-toast
  }, [])

  return showErrorToast
}
