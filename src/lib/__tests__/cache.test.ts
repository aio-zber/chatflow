import { clientCache, CACHE_KEYS, CACHE_TTL } from '../cache'

describe('ClientCache', () => {
  beforeEach(() => {
    clientCache.clear()
  })

  it('stores and retrieves data', () => {
    const testData = { id: 1, name: 'Test' }
    
    clientCache.set('test-key', testData)
    const retrieved = clientCache.get('test-key')
    
    expect(retrieved).toEqual(testData)
  })

  it('returns null for non-existent keys', () => {
    const result = clientCache.get('non-existent')
    expect(result).toBeNull()
  })

  it('respects TTL (time to live)', () => {
    const testData = { id: 1, name: 'Test' }
    const shortTTL = 100 // 100ms
    
    clientCache.set('test-key', testData, shortTTL)
    
    // Should be available immediately
    expect(clientCache.get('test-key')).toEqual(testData)
    
    // Should expire after TTL
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(clientCache.get('test-key')).toBeNull()
        resolve(void 0)
      }, shortTTL + 50)
    })
  })

  it('checks if key exists', () => {
    const testData = { id: 1, name: 'Test' }
    
    expect(clientCache.has('test-key')).toBe(false)
    
    clientCache.set('test-key', testData)
    expect(clientCache.has('test-key')).toBe(true)
  })

  it('deletes keys', () => {
    const testData = { id: 1, name: 'Test' }
    
    clientCache.set('test-key', testData)
    expect(clientCache.has('test-key')).toBe(true)
    
    const deleted = clientCache.delete('test-key')
    expect(deleted).toBe(true)
    expect(clientCache.has('test-key')).toBe(false)
  })

  it('clears all data', () => {
    clientCache.set('key1', 'data1')
    clientCache.set('key2', 'data2')
    
    expect(clientCache.has('key1')).toBe(true)
    expect(clientCache.has('key2')).toBe(true)
    
    clientCache.clear()
    
    expect(clientCache.has('key1')).toBe(false)
    expect(clientCache.has('key2')).toBe(false)
  })

  it('clears expired entries', () => {
    const shortTTL = 50
    const longTTL = 10000
    
    clientCache.set('short-key', 'data1', shortTTL)
    clientCache.set('long-key', 'data2', longTTL)
    
    return new Promise((resolve) => {
      setTimeout(() => {
        clientCache.clearExpired()
        
        expect(clientCache.has('short-key')).toBe(false)
        expect(clientCache.has('long-key')).toBe(true)
        resolve(void 0)
      }, shortTTL + 25)
    })
  })

  it('provides cache statistics', () => {
    clientCache.set('key1', 'data1')
    clientCache.set('key2', 'data2')
    
    const stats = clientCache.getStats()
    
    expect(stats.size).toBe(2)
    expect(stats.maxSize).toBeGreaterThan(0)
    expect(stats.usage).toBeGreaterThan(0)
  })

  it('handles cache size limits', () => {
    // This test would require setting a very small maxSize
    // or adding a lot of entries to test the eviction behavior
    const originalMaxSize = (clientCache as any).maxSize
    ;(clientCache as any).maxSize = 2
    
    clientCache.set('key1', 'data1')
    clientCache.set('key2', 'data2')
    clientCache.set('key3', 'data3') // Should evict key1
    
    expect(clientCache.has('key1')).toBe(false)
    expect(clientCache.has('key2')).toBe(true)
    expect(clientCache.has('key3')).toBe(true)
    
    // Restore original maxSize
    ;(clientCache as any).maxSize = originalMaxSize
  })
})

describe('Cache constants', () => {
  it('has defined cache keys', () => {
    expect(CACHE_KEYS.CONVERSATIONS).toBe('conversations')
    expect(CACHE_KEYS.MESSAGES).toBe('messages')
    expect(CACHE_KEYS.USERS).toBe('users')
    expect(CACHE_KEYS.CHANNELS).toBe('channels')
    expect(CACHE_KEYS.NOTIFICATIONS).toBe('notifications')
  })

  it('has defined TTL values', () => {
    expect(CACHE_TTL.SHORT).toBe(1 * 60 * 1000)
    expect(CACHE_TTL.MEDIUM).toBe(5 * 60 * 1000)
    expect(CACHE_TTL.LONG).toBe(30 * 60 * 1000)
    expect(CACHE_TTL.VERY_LONG).toBe(2 * 60 * 60 * 1000)
  })
})
