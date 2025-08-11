/**
 * Monitoring and analytics setup for ChatFlow
 */

// Sentry error monitoring
export function initSentry() {
  if (typeof window === 'undefined' || !process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return
  }

  // In a real implementation, you would import and configure Sentry
  // import * as Sentry from '@sentry/nextjs'
  
  console.log('Sentry would be initialized here with DSN:', process.env.NEXT_PUBLIC_SENTRY_DSN)
  
  // Sentry.init({
  //   dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  //   environment: process.env.NODE_ENV,
  //   tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  //   beforeSend(event, hint) {
  //     // Filter out certain errors or add additional context
  //     return event
  //   },
  //   integrations: [
  //     new Sentry.BrowserTracing({
  //       tracingOrigins: [location.hostname],
  //     }),
  //   ],
  // })
}

// Vercel Analytics
export function initVercelAnalytics() {
  if (typeof window === 'undefined' || !process.env.NEXT_PUBLIC_VERCEL_ANALYTICS_ID) {
    return
  }

  // In a real implementation, you would use @vercel/analytics
  console.log('Vercel Analytics would be initialized here')
  
  // import { Analytics } from '@vercel/analytics/react'
  // The Analytics component would be added to your app layout
}

// Performance monitoring
export class PerformanceMonitor {
  private metrics: { [key: string]: number } = {}
  private observer: PerformanceObserver | null = null

  constructor() {
    if (typeof window === 'undefined') return

    this.setupPerformanceObserver()
    this.trackPageLoad()
  }

  private setupPerformanceObserver() {
    if (!('PerformanceObserver' in window)) return

    this.observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        this.handlePerformanceEntry(entry)
      })
    })

    try {
      this.observer.observe({ entryTypes: ['navigation', 'paint', 'largest-contentful-paint', 'layout-shift'] })
    } catch (e) {
      console.warn('Performance observer not fully supported:', e)
    }
  }

  private handlePerformanceEntry(entry: PerformanceEntry) {
    switch (entry.entryType) {
      case 'navigation':
        const navEntry = entry as PerformanceNavigationTiming
        this.metrics.pageLoadTime = navEntry.loadEventEnd - navEntry.loadEventStart
        this.metrics.domContentLoaded = navEntry.domContentLoadedEventEnd - navEntry.domContentLoadedEventStart
        this.metrics.firstByte = navEntry.responseStart - navEntry.requestStart
        break

      case 'paint':
        if (entry.name === 'first-contentful-paint') {
          this.metrics.firstContentfulPaint = entry.startTime
        } else if (entry.name === 'first-paint') {
          this.metrics.firstPaint = entry.startTime
        }
        break

      case 'largest-contentful-paint':
        this.metrics.largestContentfulPaint = entry.startTime
        break

      case 'layout-shift':
        const clsEntry = entry as any
        if (!clsEntry.hadRecentInput) {
          this.metrics.cumulativeLayoutShift = (this.metrics.cumulativeLayoutShift || 0) + clsEntry.value
        }
        break
    }

    this.reportMetrics()
  }

  private trackPageLoad() {
    window.addEventListener('load', () => {
      setTimeout(() => {
        this.reportMetrics()
      }, 0)
    })
  }

  private reportMetrics() {
    // In production, send metrics to your analytics service
    if (process.env.NODE_ENV === 'development') {
      console.log('Performance metrics:', this.metrics)
    }

    // Example: Send to analytics service
    // this.sendToAnalytics(this.metrics)
  }

  private sendToAnalytics(metrics: any) {
    // Implementation would depend on your analytics provider
    // fetch('/api/analytics/performance', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(metrics),
    // })
  }

  public trackCustomMetric(name: string, value: number) {
    this.metrics[name] = value
    this.reportMetrics()
  }

  public getMetrics() {
    return { ...this.metrics }
  }

  public destroy() {
    this.observer?.disconnect()
  }
}

// User behavior analytics
export class UserAnalytics {
  private sessionId: string
  private userId?: string
  private events: any[] = []

  constructor() {
    this.sessionId = this.generateSessionId()
    this.setupEventTracking()
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private setupEventTracking() {
    if (typeof window === 'undefined') return

    // Track page views
    this.trackEvent('page_view', {
      url: window.location.href,
      title: document.title,
      referrer: document.referrer,
    })

    // Track clicks on important elements
    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      
      if (target.closest('button, a, [role="button"]')) {
        this.trackEvent('click', {
          element: target.tagName.toLowerCase(),
          text: target.textContent?.trim().substring(0, 100),
          url: window.location.href,
        })
      }
    })

    // Track form submissions
    document.addEventListener('submit', (event) => {
      const form = event.target as HTMLFormElement
      this.trackEvent('form_submit', {
        formId: form.id,
        action: form.action,
        method: form.method,
      })
    })
  }

  public setUserId(userId: string) {
    this.userId = userId
  }

  public trackEvent(eventName: string, properties: any = {}) {
    const event = {
      eventName,
      properties: {
        ...properties,
        sessionId: this.sessionId,
        userId: this.userId,
        timestamp: new Date().toISOString(),
        url: typeof window !== 'undefined' ? window.location.href : undefined,
      },
    }

    this.events.push(event)

    // In production, send to analytics service
    if (process.env.NODE_ENV === 'development') {
      console.log('Analytics event:', event)
    }

    // Batch send events
    this.batchSendEvents()
  }

  private batchSendEvents() {
    // Send events in batches to reduce API calls
    if (this.events.length >= 10) {
      this.sendEvents([...this.events])
      this.events = []
    }
  }

  private sendEvents(events: any[]) {
    // Implementation would depend on your analytics provider
    // fetch('/api/analytics/events', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ events }),
    // })
  }

  public flushEvents() {
    if (this.events.length > 0) {
      this.sendEvents([...this.events])
      this.events = []
    }
  }
}

// Application health monitoring
export class HealthMonitor {
  private checkInterval: NodeJS.Timeout | null = null
  private lastCheck: number = Date.now()

  constructor() {
    this.startHealthChecks()
  }

  private startHealthChecks() {
    this.checkInterval = setInterval(() => {
      this.performHealthCheck()
    }, 60000) // Check every minute
  }

  private async performHealthCheck() {
    const healthStatus = {
      timestamp: new Date().toISOString(),
      memory: this.getMemoryUsage(),
      connection: await this.checkConnection(),
      errors: this.getRecentErrors(),
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('Health check:', healthStatus)
    }

    // Send to monitoring service
    this.reportHealth(healthStatus)
  }

  private getMemoryUsage() {
    if (typeof window === 'undefined') return null

    return {
      usedJSHeapSize: (performance as any).memory?.usedJSHeapSize,
      totalJSHeapSize: (performance as any).memory?.totalJSHeapSize,
      jsHeapSizeLimit: (performance as any).memory?.jsHeapSizeLimit,
    }
  }

  private async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch('/api/health', { 
        method: 'HEAD',
        cache: 'no-cache' 
      })
      return response.ok
    } catch {
      return false
    }
  }

  private getRecentErrors() {
    // This would integrate with your error tracking system
    return []
  }

  private reportHealth(status: any) {
    // Send to monitoring service
    // fetch('/api/monitoring/health', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(status),
    // })
  }

  public destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
    }
  }
}

// Initialize monitoring
export function initMonitoring() {
  if (typeof window === 'undefined') return

  initSentry()
  initVercelAnalytics()

  return {
    performance: new PerformanceMonitor(),
    analytics: new UserAnalytics(),
    health: new HealthMonitor(),
  }
}
