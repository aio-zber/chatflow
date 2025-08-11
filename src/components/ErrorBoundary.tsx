'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react'
import { logger } from '@/lib/logger'
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
  errorInfo?: ErrorInfo
  eventId?: string
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error with context
    logger.error('React Error Boundary caught an error:', error, {
      componentStack: errorInfo.componentStack,
      errorBoundary: true,
    })

    this.setState({
      error,
      errorInfo,
      eventId: `error-${Date.now()}`,
    })
  }

  handleReload = () => {
    window.location.reload()
  }

  handleGoHome = () => {
    window.location.href = '/chat'
  }

  handleReportIssue = () => {
    const { error, errorInfo, eventId } = this.state
    
    const issueData = {
      eventId,
      error: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    }

    // In a real app, you'd send this to your issue tracker
    console.log('Issue report data:', issueData)
    
    // Example: Create GitHub issue, send to support, etc.
    const subject = encodeURIComponent(`Bug Report: ${error?.message || 'Application Error'}`)
    const body = encodeURIComponent(`
**Error Details:**
- Event ID: ${eventId}
- Error: ${error?.message}
- URL: ${window.location.href}
- Timestamp: ${issueData.timestamp}

**Stack Trace:**
\`\`\`
${error?.stack}
\`\`\`

**Component Stack:**
\`\`\`
${errorInfo?.componentStack}
\`\`\`

**Environment:**
- User Agent: ${navigator.userAgent}
    `)

    // Open mailto or redirect to issue tracker
    window.open(`mailto:support@chatflow.com?subject=${subject}&body=${body}`)
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8 text-center">
            <div className="mb-6">
              <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Oops! Something went wrong
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                We apologize for the inconvenience. The application encountered an unexpected error.
              </p>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 rounded-md text-left">
                <h3 className="text-sm font-medium text-red-800 dark:text-red-400 mb-2">
                  Error Details (Development)
                </h3>
                <pre className="text-xs text-red-700 dark:text-red-300 overflow-auto max-h-32">
                  {this.state.error.message}
                </pre>
                {this.state.error.stack && (
                  <pre className="text-xs text-red-600 dark:text-red-400 overflow-auto max-h-32 mt-2">
                    {this.state.error.stack}
                  </pre>
                )}
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={this.handleReload}
                className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              >
                <RefreshCw className="w-5 h-5" />
                <span>Reload Page</span>
              </button>

              <button
                onClick={this.handleGoHome}
                className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors"
              >
                <Home className="w-5 h-5" />
                <span>Go to Home</span>
              </button>

              <button
                onClick={this.handleReportIssue}
                className="w-full flex items-center justify-center space-x-2 px-4 py-3 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors"
              >
                <Bug className="w-5 h-5" />
                <span>Report Issue</span>
              </button>
            </div>

            {this.state.eventId && (
              <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">
                Error ID: <code className="font-mono">{this.state.eventId}</code>
              </p>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

// Simple error fallback component
export function SimpleErrorFallback({ error }: { error: Error }) {
  return (
    <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
      <div className="flex items-center space-x-2 text-red-800 dark:text-red-400">
        <AlertTriangle className="w-5 h-5" />
        <h3 className="font-medium">Something went wrong</h3>
      </div>
      <p className="mt-2 text-sm text-red-600 dark:text-red-300">
        {error.message || 'An unexpected error occurred'}
      </p>
    </div>
  )
}