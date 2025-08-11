/**
 * Server-side caching utility for ChatFlow
 * Note: This is a simple in-memory cache for development
 * In production, you would use Redis or similar
 */

interface ServerCacheItem<T> {
  data: T
  timestamp: number
  ttl: number
}

class ServerCache {
  private cache: Map<string, ServerCacheItem<any>> = new Map()
  private maxSize: number = 10000

  set<T>(key: string, data: T, ttl: number = 5 * 60 * 1000): void {
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      this.cache.delete(oldestKey)
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    })
  }

  get<T>(key: string): T | null {
    const item = this.cache.get(key)
    
    if (!item) {
      return null
    }

    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key)
      return null
    }

    return item.data as T
  }

  has(key: string): boolean {
    return this.get(key) !== null
  }

  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  clearExpired(): void {
    const now = Date.now()
    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > item.ttl) {
        this.cache.delete(key)
      }
    }
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      usage: Math.round((this.cache.size / this.maxSize) * 100),
    }
  }
}

export const serverCache = new ServerCache()

// Clear expired entries every 10 minutes
setInterval(() => {
  serverCache.clearExpired()
}, 10 * 60 * 1000)

/**
 * Cache wrapper for API responses
 */
export function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = 5 * 60 * 1000
): Promise<T> {
  return new Promise(async (resolve, reject) => {
    try {
      // Check cache first
      const cached = serverCache.get<T>(key)
      if (cached !== null) {
        resolve(cached)
        return
      }

      // Fetch fresh data
      const data = await fetcher()
      serverCache.set(key, data, ttl)
      resolve(data)
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * Cache invalidation helper
 */
export function invalidateCache(pattern: string): void {
  const keys = Array.from(serverCache['cache'].keys())
  keys.forEach(key => {
    if (key.includes(pattern)) {
      serverCache.delete(key)
    }
  })
}

/**
 * Generate cache key with user context
 */
export function generateCacheKey(base: string, userId?: string, ...params: string[]): string {
  const parts = [base]
  if (userId) parts.push(`user:${userId}`)
  parts.push(...params)
  return parts.join(':')
}
