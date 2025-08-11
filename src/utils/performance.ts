/**
 * Performance utilities for ChatFlow
 */

import * as React from 'react'

// Lazy loading utility for dynamic imports
export function createLazyComponent<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>
) {
  return React.lazy(importFn)
}

// Memoization helper for expensive calculations
export function memoize<Args extends any[], Return>(
  fn: (...args: Args) => Return
): (...args: Args) => Return {
  const cache = new Map<string, Return>()
  
  return (...args: Args): Return => {
    const key = JSON.stringify(args)
    
    if (cache.has(key)) {
      return cache.get(key)!
    }
    
    const result = fn(...args)
    cache.set(key, result)
    
    return result
  }
}

// Debounce function for search and input handlers
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

// Throttle function for scroll and resize handlers
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

// Image optimization helpers
export function getOptimizedImageUrl(
  src: string,
  width?: number,
  height?: number,
  quality: number = 80
): string {
  // This would integrate with your image optimization service
  // For Next.js, you'd typically use next/image
  const params = new URLSearchParams()
  
  if (width) params.set('w', width.toString())
  if (height) params.set('h', height.toString())
  params.set('q', quality.toString())
  
  return `${src}?${params.toString()}`
}

// Bundle size optimization - lazy load heavy dependencies
export const LazyEmojiPicker = createLazyComponent(
  () => import('@emoji-mart/react')
)

export const LazyMarkdownRenderer = createLazyComponent(
  () => import('react-markdown')
)

// Memory management
export function cleanupMemory() {
  // Force garbage collection if available (development only)
  if (typeof window !== 'undefined' && 'gc' in window) {
    ;(window as any).gc()
  }
}

// Performance monitoring
export function measurePerformance<T>(
  name: string,
  fn: () => T
): T {
  const start = performance.now()
  const result = fn()
  const end = performance.now()
  
  console.log(`${name} took ${end - start} milliseconds`)
  
  return result
}

// Async performance monitoring
export async function measureAsyncPerformance<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now()
  const result = await fn()
  const end = performance.now()
  
  console.log(`${name} took ${end - start} milliseconds`)
  
  return result
}

// Resource preloading
export function preloadResource(url: string, type: 'script' | 'style' | 'image' = 'script') {
  const link = document.createElement('link')
  link.rel = 'preload'
  link.href = url
  
  switch (type) {
    case 'script':
      link.as = 'script'
      break
    case 'style':
      link.as = 'style'
      break
    case 'image':
      link.as = 'image'
      break
  }
  
  document.head.appendChild(link)
}

// Web Workers for heavy computations
export function createWorker(workerFunction: Function): Worker {
  const blob = new Blob(
    [`(${workerFunction.toString()})()`],
    { type: 'application/javascript' }
  )
  
  return new Worker(URL.createObjectURL(blob))
}

// Service Worker registration
export async function registerServiceWorker(path: string = '/sw.js') {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register(path)
      console.log('Service Worker registered:', registration)
      return registration
    } catch (error) {
      console.error('Service Worker registration failed:', error)
    }
  }
}

// Critical CSS inlining
export function inlineCriticalCSS(css: string) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
}


