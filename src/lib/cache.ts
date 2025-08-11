/**
 * Client-side caching utility for ChatFlow
 * Provides memory-based caching with TTL support
 */

import { useState, useEffect, useCallback } from 'react'

interface CacheItem<T> {
  data: T
  timestamp: number
  ttl: number
}

class ClientCache {
  private cache: Map<string, CacheItem<any>> = new Map()
  private maxSize: number = 1000 // Maximum number of items to cache

  /**
   * Set an item in the cache with TTL (time to live)
   * @param key Cache key
   * @param data Data to cache
   * @param ttl Time to live in milliseconds (default: 5 minutes)
   */
  set<T>(key: string, data: T, ttl: number = 5 * 60 * 1000): void {
    // Remove oldest items if cache is full
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value || '';
      this.cache.delete(oldestKey)
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    })
  }

  /**
   * Get an item from the cache
   * @param key Cache key
   * @returns Cached data or null if not found/expired
   */
  get<T>(key: string): T | null {
    const item = this.cache.get(key)
    
    if (!item) {
      return null
    }

    // Check if item has expired
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key)
      return null
    }

    return item.data as T
  }

  /**
   * Check if a key exists and is not expired
   * @param key Cache key
   * @returns True if key exists and is valid
   */
  has(key: string): boolean {
    return this.get(key) !== null
  }

  /**
   * Remove an item from the cache
   * @param key Cache key
   */
  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Clear expired entries
   */
  clearExpired(): void {
    const now = Date.now()
    for (const [key, item] of Array.from(this.cache.entries())) {
      if (now - item.timestamp > item.ttl) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number
    maxSize: number
    usage: number
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      usage: Math.round((this.cache.size / this.maxSize) * 100),
    }
  }
}

// Create singleton instance
export const clientCache = new ClientCache()

// Clear expired entries every 5 minutes
if (typeof window !== 'undefined') {
  setInterval(() => {
    clientCache.clearExpired()
  }, 5 * 60 * 1000)
}

/**
 * Cache decorator for async functions
 * @param key Cache key
 * @param ttl Time to live in milliseconds
 */
export function cached<T extends any[], R>(
  key: string,
  ttl: number = 5 * 60 * 1000
) {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor
  ) {
    const method = descriptor.value

    descriptor.value = async function (...args: T): Promise<R> {
      const cacheKey = `${key}:${JSON.stringify(args)}`
      const cachedResult = clientCache.get<R>(cacheKey)

      if (cachedResult !== null) {
        return cachedResult
      }

      const result = await method.apply(this, args)
      clientCache.set(cacheKey, result, ttl)
      return result
    }

    return descriptor
  }
}

/**
 * React hook for cached data fetching
 * @param key Cache key
 * @param fetcher Function to fetch data
 * @param ttl Time to live in milliseconds
 */
export function useCachedData<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = 5 * 60 * 1000
): {
  data: T | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // Check cache first
      const cachedData = clientCache.get<T>(key)
      if (cachedData !== null) {
        setData(cachedData)
        setLoading(false)
        return
      }

      // Fetch fresh data
      const freshData = await fetcher()
      clientCache.set(key, freshData, ttl)
      setData(freshData)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setLoading(false)
    }
  }, [key, fetcher, ttl])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return {
    data,
    loading,
    error,
    refetch: fetchData,
  }
}

// Cache keys constants
export const CACHE_KEYS = {
  CONVERSATIONS: 'conversations',
  MESSAGES: 'messages',
  USERS: 'users',
  CHANNELS: 'channels',
  NOTIFICATIONS: 'notifications',
  USER_PROFILE: 'user_profile',
  SEARCH_RESULTS: 'search_results',
} as const

// Cache TTL constants (in milliseconds)
export const CACHE_TTL = {
  SHORT: 1 * 60 * 1000, // 1 minute
  MEDIUM: 5 * 60 * 1000, // 5 minutes
  LONG: 30 * 60 * 1000, // 30 minutes
  VERY_LONG: 2 * 60 * 60 * 1000, // 2 hours
} as const
