import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { CallLimitsManager } from '../lib/call-limits'
import { CallCircuitBreaker, CircuitState } from '../lib/circuit-breaker'
import { CallQualityMonitor } from '../lib/call-quality-monitor'
import { CallCleanupManager } from '../lib/socket-cleanup'
import { ConnectionRecoveryManager } from '../lib/connection-recovery-manager'
import { BandwidthOptimizer } from '../lib/bandwidth-optimizer'

// Mock global objects  
const mockConsole = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}
global.console = { ...console, ...mockConsole }

describe('Call System Integration Tests', () => {
  describe('Call Limits Manager', () => {
    it('should enforce participant limits for basic users', () => {
      const result = CallLimitsManager.validateCallParticipants(
        ['user1', 'user2', 'user3'], // 3 participants
        true, // is group call
        'basic' // user tier
      )
      
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Group calls not supported')
      expect(result.maxAllowed).toBe(2)
    })

    it('should allow 1-on-1 calls for basic users', () => {
      const result = CallLimitsManager.validateCallParticipants(
        ['user1', 'user2'], // 2 participants
        false, // not group call
        'basic'
      )
      
      expect(result.allowed).toBe(true)
      expect(result.maxAllowed).toBe(2)
    })

    it('should allow group calls for beta users', () => {
      const result = CallLimitsManager.validateCallParticipants(
        ['user1', 'user2', 'user3', 'user4'], // 4 participants
        true, // is group call
        'beta'
      )
      
      expect(result.allowed).toBe(true)
      expect(result.maxAllowed).toBe(4)
    })

    it('should provide upgrade messages', () => {
      const message = CallLimitsManager.getUpgradeMessage(4)
      expect(message).toContain('Beta')
      
      const premiumMessage = CallLimitsManager.getUpgradeMessage(8)
      expect(premiumMessage).toContain('Premium')
    })

    it('should recommend appropriate actions', () => {
      expect(CallLimitsManager.getRecommendedAction(2)).toBe('direct_call')
      expect(CallLimitsManager.getRecommendedAction(4)).toBe('small_group_beta')
      expect(CallLimitsManager.getRecommendedAction(8)).toBe('medium_group_premium')
      expect(CallLimitsManager.getRecommendedAction(15)).toBe('enterprise_solution_required')
    })
  })

  describe('Circuit Breaker', () => {
    let circuitBreaker: CallCircuitBreaker

    beforeEach(() => {
      circuitBreaker = new CallCircuitBreaker({
        failureThreshold: 3,
        recoveryTimeout: 1000,
        monitoringWindow: 5000
      })
    })

    it('should open circuit after failure threshold', async () => {
      const failingOperation = () => Promise.reject(new Error('Connection failed'))
      
      // First 3 failures should be allowed
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.executeCall(failingOperation)
        } catch (e) {
          // Expected failures
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN)
      expect(circuitBreaker.getFailureCount()).toBe(3)
    })

    it('should transition to half-open after recovery timeout', async () => {
      const failingOperation = () => Promise.reject(new Error('Connection failed'))
      
      // Trigger circuit to open
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.executeCall(failingOperation)
        } catch (e) {
          // Expected failures
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN)
      
      // Wait for recovery timeout and try again
      await new Promise(resolve => setTimeout(resolve, 1100))
      
      try {
        await circuitBreaker.executeCall(failingOperation)
      } catch (e) {
        // Expected failure
      }
      
      // Should have attempted half-open state
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN)
    })

    it('should reset on successful operation', async () => {
      const successOperation = () => Promise.resolve('success')
      
      // First cause some failures
      const failingOperation = () => Promise.reject(new Error('Connection failed'))
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.executeCall(failingOperation)
        } catch (e) {
          // Expected failures
        }
      }
      
      // Then succeed
      const result = await circuitBreaker.executeCall(successOperation)
      expect(result).toBe('success')
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED)
      expect(circuitBreaker.getFailureCount()).toBe(0)
    })

    it('should provide manual reset functionality', () => {
      // Force circuit open
      circuitBreaker.forceOpen(5000)
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN)
      
      // Reset manually
      circuitBreaker.reset()
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED)
      expect(circuitBreaker.getFailureCount()).toBe(0)
    })
  })

  describe('Memory Management', () => {
    let cleanup: CallCleanupManager
    let activeCalls: Map<string, any>
    let callTraces: Set<string>

    beforeEach(() => {
      activeCalls = new Map()
      callTraces = new Set()
      cleanup = new CallCleanupManager(activeCalls, callTraces)
    })

    afterEach(() => {
      cleanup.destroy()
    })

    it('should clean up stale calls', () => {
      // Add mock stale calls
      const staleCall = {
        startTime: Date.now() - 7200000, // 2 hours old
        participants: new Set()
      }
      
      activeCalls.set('stale-call-1', staleCall)
      
      cleanup.cleanupStaleActiveCalls()
      
      expect(activeCalls.has('stale-call-1')).toBe(false)
    })

    it('should monitor memory usage', () => {
      // Add many calls to trigger memory alert
      for (let i = 0; i < 101; i++) {
        activeCalls.set(`call-${i}`, {
          startTime: Date.now(),
          participants: new Set(['user1'])
        })
      }
      
      cleanup.monitorMemoryUsage()
      
      // Should log memory alert
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL: Active calls exceeding safe limits')
      )
    })

    it('should clean up call traces when limit exceeded', () => {
      // Add many call traces
      for (let i = 0; i < 1001; i++) {
        callTraces.add(`trace-${i}`)
      }
      
      cleanup.cleanupCallTraces()
      
      expect(callTraces.size).toBe(0)
    })
  })

  describe('Call Quality Monitoring', () => {
    let qualityMonitor: CallQualityMonitor
    let mockPeerConnection: any

    beforeEach(() => {
      qualityMonitor = new CallQualityMonitor()
      
      // Mock RTCPeerConnection
      mockPeerConnection = {
        connectionState: 'connected' as RTCPeerConnectionState,
        iceConnectionState: 'connected' as RTCIceConnectionState,
        getStats: jest.fn().mockResolvedValue(new Map([
          ['inbound-rtp', {
            type: 'inbound-rtp',
            mediaType: 'video',
            packetsReceived: 1000,
            packetsLost: 5,
            jitter: 10
          }],
          ['candidate-pair', {
            type: 'candidate-pair',
            state: 'succeeded',
            currentRoundTripTime: 0.05 // 50ms
          }]
        ]))
      }
    })

    it('should collect quality metrics', async () => {
      const peerConnections = new Map([['user1', mockPeerConnection]])
      
      const metrics = await qualityMonitor.collectMetrics('call-123', peerConnections)
      
      expect(metrics).toHaveLength(1)
      expect(metrics[0]).toMatchObject({
        callId: 'call-123',
        participantId: 'user1',
        connectionState: 'connected',
        packetLoss: expect.any(Number),
        roundTripTime: expect.any(Number)
      })
    })

    it('should store and retrieve metrics history', async () => {
      const peerConnections = new Map([['user1', mockPeerConnection]])
      
      await qualityMonitor.collectMetrics('call-123', peerConnections)
      
      const history = qualityMonitor.getMetricsHistory('user1')
      expect(history).toHaveLength(1)
      
      const latest = qualityMonitor.getLatestMetrics()
      expect(latest.has('user1')).toBe(true)
    })

    it('should calculate average quality over time', async () => {
      const peerConnections = new Map([['user1', mockPeerConnection]])
      
      // Collect multiple metrics
      for (let i = 0; i < 5; i++) {
        await qualityMonitor.collectMetrics('call-123', peerConnections)
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      
      const average = qualityMonitor.getAverageQuality('user1', 5)
      expect(average).toBeTruthy()
      expect(average?.avgPacketLoss).toBeGreaterThanOrEqual(0)
      expect(average?.avgRoundTripTime).toBeGreaterThan(0)
    })

    it('should clean up old metrics', async () => {
      const peerConnections = new Map([['user1', mockPeerConnection]])
      
      await qualityMonitor.collectMetrics('call-123', peerConnections)
      
      // Cleanup metrics older than 0 minutes (should clean everything)
      qualityMonitor.cleanup(0)
      
      const history = qualityMonitor.getMetricsHistory('user1')
      expect(history).toHaveLength(0)
    })
  })

  describe('Connection Recovery', () => {
    let recoveryManager: ConnectionRecoveryManager
    let mockPeerConnection: any
    let mockWebRTCService: any

    beforeEach(() => {
      recoveryManager = new ConnectionRecoveryManager({
        maxRetries: 3,
        baseDelay: 100, // Faster for testing
        maxDelay: 1000
      })

      mockPeerConnection = {
        connectionState: 'failed' as RTCPeerConnectionState,
        iceConnectionState: 'failed' as RTCIceConnectionState,
        createOffer: jest.fn().mockResolvedValue({ sdp: 'mock-offer' }),
        setLocalDescription: jest.fn(),
        setConfiguration: jest.fn()
      }

      mockWebRTCService = {
        closePeerConnection: jest.fn(),
        createOffer: jest.fn().mockResolvedValue(undefined)
      }
    })

    it('should attempt recovery within retry limits', async () => {
      const result = await recoveryManager.recoverConnection(
        'user1', 
        mockPeerConnection, 
        mockWebRTCService
      )
      
      // Should attempt recovery
      expect(mockPeerConnection.createOffer).toHaveBeenCalled()
      
      const status = recoveryManager.getRecoveryStatus('user1')
      expect(status).toBeTruthy()
      expect(status?.retryCount).toBeGreaterThan(0)
    })

    it('should respect max retry limits', async () => {
      // Exhaust all retries
      for (let i = 0; i < 4; i++) {
        await recoveryManager.recoverConnection('user1', mockPeerConnection, mockWebRTCService)
      }
      
      const status = recoveryManager.getRecoveryStatus('user1')
      expect(status?.retryCount).toBe(3) // Should stop at max
    })

    it('should clean up old recovery states', () => {
      // Create a recovery state
      recoveryManager.recoverConnection('user1', mockPeerConnection, mockWebRTCService)
      
      // Cleanup states older than 0 minutes
      recoveryManager.cleanup(0)
      
      const status = recoveryManager.getRecoveryStatus('user1')
      expect(status).toBeNull()
    })
  })

  describe('Bandwidth Optimization', () => {
    let mockPeerConnection: any

    beforeEach(() => {
      mockPeerConnection = {
        getSenders: jest.fn().mockReturnValue([
          {
            track: { 
              kind: 'video',
              applyConstraints: jest.fn().mockResolvedValue(undefined)
            },
            getParameters: jest.fn().mockReturnValue({
              encodings: [{ maxBitrate: 1000000 }]
            }),
            setParameters: jest.fn().mockResolvedValue(undefined)
          },
          {
            track: { 
              kind: 'audio',
              applyConstraints: jest.fn().mockResolvedValue(undefined)
            },
            getParameters: jest.fn().mockReturnValue({
              encodings: [{ maxBitrate: 64000 }]
            }),
            setParameters: jest.fn().mockResolvedValue(undefined)
          }
        ])
      }
    })

    it('should optimize for different network qualities', async () => {
      const networkQuality = {
        bandwidth: 1000000,
        latency: 100,
        packetLoss: 0.01,
        quality: 'good' as const
      }
      
      await BandwidthOptimizer.optimizeForNetworkConditions(
        mockPeerConnection,
        networkQuality,
        3 // 3 participants
      )
      
      const senders = mockPeerConnection.getSenders()
      expect(senders[0].setParameters).toHaveBeenCalled()
      expect(senders[1].setParameters).toHaveBeenCalled()
    })

    it('should adapt bitrate based on metrics', async () => {
      const metrics = {
        packetLoss: 0.05, // High packet loss
        roundTripTime: 250, // High RTT
        jitter: 30
      }
      
      await BandwidthOptimizer.adaptBitrate(
        mockPeerConnection,
        'user1',
        metrics
      )
      
      const videoSender = mockPeerConnection.getSenders()[0]
      expect(videoSender.setParameters).toHaveBeenCalled()
    })

    it('should optimize for screen sharing', async () => {
      await BandwidthOptimizer.optimizeForScreenSharing(
        mockPeerConnection,
        true // is screen share
      )
      
      const videoSender = mockPeerConnection.getSenders()[0]
      expect(videoSender.setParameters).toHaveBeenCalled()
    })

    it('should measure network quality', async () => {
      // Mock fetch for ping test
      global.fetch = jest.fn().mockResolvedValue({ ok: true })
      
      const quality = await BandwidthOptimizer.measureNetworkQuality()
      
      expect(quality).toHaveProperty('bandwidth')
      expect(quality).toHaveProperty('latency')
      expect(quality).toHaveProperty('quality')
      expect(['poor', 'fair', 'good', 'excellent']).toContain(quality.quality)
    })
  })

  describe('Integration Scenarios', () => {
    it('should handle call lifecycle with all systems', async () => {
      // Validate call limits
      const validation = CallLimitsManager.validateCallParticipants(['user1', 'user2'], false, 'basic')
      expect(validation.allowed).toBe(true)
      
      // Initialize systems
      const cleanup = new CallCleanupManager(new Map(), new Set())
      const circuitBreaker = new CallCircuitBreaker({
        failureThreshold: 5,
        recoveryTimeout: 30000,
        monitoringWindow: 60000
      })
      
      // Simulate successful call setup
      const callSetup = async () => {
        // Mock call setup success
        return Promise.resolve('call-established')
      }
      
      const result = await circuitBreaker.executeCall(callSetup)
      expect(result).toBe('call-established')
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED)
      
      cleanup.destroy()
    })
  })
})