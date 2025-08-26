'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface PerformanceMetrics {
  videoFrameRate: number
  audioPacketLoss: number
  videoPacketLoss: number
  bandwidth: number
  latency: number
  connectionState: RTCPeerConnectionState
  networkQuality: 'excellent' | 'good' | 'fair' | 'poor'
}

export interface CallPerformanceState {
  localMetrics: PerformanceMetrics | null
  remoteMetrics: Map<string, PerformanceMetrics>
  recommendations: string[]
}

export function useCallPerformance(peerConnections: Map<string, RTCPeerConnection>, callType?: 'voice' | 'video') {
  const [performanceState, setPerformanceState] = useState<CallPerformanceState>({
    localMetrics: null,
    remoteMetrics: new Map(),
    recommendations: []
  })
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastStatsRef = useRef<Map<string, any>>(new Map())

  const calculateNetworkQuality = (metrics: Partial<PerformanceMetrics>, callType?: 'voice' | 'video'): 'excellent' | 'good' | 'fair' | 'poor' => {
    const { videoPacketLoss = 0, audioPacketLoss = 0, videoFrameRate = 30, latency = 0 } = metrics
    
    // If no meaningful data available, assume good quality
    const hasValidData = videoPacketLoss > 0 || audioPacketLoss > 0 || latency > 0
    if (!hasValidData) {
      console.log('[useCallPerformance] No valid network data yet, assuming good quality')
      return 'good'
    }
    
    console.log('[useCallPerformance] Network metrics:', {
      audioPacketLoss,
      videoPacketLoss,
      videoFrameRate, 
      latency,
      callType
    })
    
    // For voice calls, ignore video metrics completely
    if (callType === 'voice') {
      if (audioPacketLoss < 0.02 && latency < 150) {
        return 'excellent'
      } else if (audioPacketLoss < 0.05 && latency < 300) {
        return 'good'
      } else if (audioPacketLoss < 0.10 && latency < 600) {
        return 'fair'
      } else {
        return 'poor'
      }
    }
    
    // For video calls, consider both audio and video metrics
    const avgPacketLoss = (videoPacketLoss + audioPacketLoss) / 2
    
    // More lenient quality thresholds for video calls
    if (avgPacketLoss < 0.02 && videoFrameRate >= 20 && latency < 150) {
      return 'excellent'
    } else if (avgPacketLoss < 0.05 && videoFrameRate >= 15 && latency < 300) {
      return 'good'
    } else if (avgPacketLoss < 0.10 && videoFrameRate >= 10 && latency < 600) {
      return 'fair'
    } else {
      return 'poor'
    }
  }

  const generateRecommendations = (metrics: PerformanceMetrics, callType?: 'voice' | 'video'): string[] => {
    const recommendations: string[] = []
    
    // Only show video recommendations for video calls
    if (callType === 'video') {
      if (metrics.videoPacketLoss > 0.05) {
        recommendations.push('High video packet loss detected. Consider lowering video quality.')
      }
      
      if (metrics.videoFrameRate < 15) {
        recommendations.push('Low frame rate detected. Consider reducing video resolution.')
      }
      
      if (metrics.bandwidth < 500000) { // Less than 500 kbps
        recommendations.push('Low bandwidth detected. Consider switching to voice-only call.')
      }
    }
    
    // Audio recommendations for both voice and video calls
    if (metrics.audioPacketLoss > 0.03) {
      recommendations.push('Audio quality issues detected. Check your network connection.')
    }
    
    if (metrics.latency > 300) {
      recommendations.push('High latency detected. Close other network-intensive applications.')
    }
    
    // For voice calls, different bandwidth threshold
    if (callType === 'voice' && metrics.bandwidth < 100000) { // Less than 100 kbps for voice
      recommendations.push('Low bandwidth detected for voice call. Check your connection.')
    }
    
    if (metrics.connectionState === 'failed' || metrics.connectionState === 'disconnected') {
      recommendations.push('Connection issues detected. Trying to reconnect...')
    }
    
    return recommendations
  }

  const collectMetrics = useCallback(async () => {
    const newRemoteMetrics = new Map<string, PerformanceMetrics>()
    const allRecommendations: string[] = []

    for (const [participantId, peerConnection] of peerConnections) {
      try {
        // Check if peerConnection and getStats are available
        if (!peerConnection || typeof peerConnection.getStats !== 'function') {
          console.warn(`[useCallPerformance] Invalid peerConnection for participant ${participantId}:`, {
            hasConnection: !!peerConnection,
            hasGetStats: peerConnection && typeof peerConnection.getStats === 'function',
            connectionState: peerConnection?.connectionState
          })
          continue
        }

        // Check connection state before trying to get stats
        if (peerConnection.connectionState === 'closed' || peerConnection.connectionState === 'failed') {
          console.warn(`[useCallPerformance] Skipping stats for ${participantId} - connection state: ${peerConnection.connectionState}`)
          continue
        }

        const stats = await peerConnection.getStats()
        let videoFrameRate = 0
        let videoPacketLoss = 0
        let audioPacketLoss = 0
        let bandwidth = 0
        let latency = 0

        const lastStats = lastStatsRef.current.get(participantId) || {}
        const currentTime = Date.now()

        stats.forEach((report) => {
          if (report.type === 'inbound-rtp') {
            if (report.mediaType === 'video') {
              videoFrameRate = report.framesPerSecond || 0
              const packetsLost = report.packetsLost || 0
              const packetsReceived = report.packetsReceived || 0
              videoPacketLoss = packetsReceived > 0 ? packetsLost / packetsReceived : 0
              
              // Calculate bandwidth
              const bytesReceived = report.bytesReceived || 0
              const lastBytesReceived = lastStats.videoBytesReceived || 0
              const lastTime = lastStats.videoTime || currentTime
              const timeDiff = (currentTime - lastTime) / 1000
              
              if (timeDiff > 0) {
                bandwidth = ((bytesReceived - lastBytesReceived) * 8) / timeDiff // bits per second
              }
              
              lastStats.videoBytesReceived = bytesReceived
              lastStats.videoTime = currentTime
            } else if (report.mediaType === 'audio') {
              const packetsLost = report.packetsLost || 0
              const packetsReceived = report.packetsReceived || 0
              audioPacketLoss = packetsReceived > 0 ? packetsLost / packetsReceived : 0
            }
          } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            latency = report.currentRoundTripTime * 1000 || 0 // Convert to ms
          }
        })

        const metrics: PerformanceMetrics = {
          videoFrameRate,
          audioPacketLoss,
          videoPacketLoss,
          bandwidth,
          latency,
          connectionState: peerConnection.connectionState,
          networkQuality: calculateNetworkQuality({
            videoFrameRate,
            audioPacketLoss,
            videoPacketLoss,
            latency
          }, callType)
        }

        newRemoteMetrics.set(participantId, metrics)
        allRecommendations.push(...generateRecommendations(metrics, callType))
        lastStatsRef.current.set(participantId, lastStats)

      } catch (error) {
        console.warn(`Failed to collect metrics for participant ${participantId}:`, error)
      }
    }

    setPerformanceState(prev => ({
      ...prev,
      remoteMetrics: newRemoteMetrics,
      recommendations: [...new Set(allRecommendations)] // Remove duplicates
    }))
  }, [peerConnections])

  const startMonitoring = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }
    
    intervalRef.current = setInterval(collectMetrics, 5000) // Collect every 5 seconds
    collectMetrics() // Initial collection
  }, [collectMetrics])

  const stopMonitoring = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    lastStatsRef.current.clear()
  }, [])

  // Auto-start monitoring when peer connections are available
  useEffect(() => {
    // Check if we have valid peer connections
    const validConnections = Array.from(peerConnections.values()).filter(conn => 
      conn && typeof conn.getStats === 'function' && 
      conn.connectionState !== 'closed' && conn.connectionState !== 'failed'
    )

    // More detailed connection state logging for debugging
    if (peerConnections.size > 0) {
      const connectionStates = Array.from(peerConnections.entries()).map(([id, conn]) => ({
        id: id.substring(0, 8),
        state: conn?.connectionState || 'unknown',
        hasGetStats: typeof conn?.getStats === 'function',
        signalState: conn?.signalingState || 'unknown'
      }))
      console.log(`[useCallPerformance] Connection states:`, connectionStates)
    }

    if (validConnections.length > 0) {
      console.log(`[useCallPerformance] Starting monitoring for ${validConnections.length} valid connections`)
      startMonitoring()
    } else if (peerConnections.size > 0) {
      // Don't immediately stop monitoring if we have connections in transitional states
      const transitioningConnections = Array.from(peerConnections.values()).filter(conn => 
        conn && (conn.connectionState === 'connecting' || conn.connectionState === 'new')
      )
      
      if (transitioningConnections.length > 0) {
        console.log(`[useCallPerformance] Keeping monitoring active - ${transitioningConnections.length} connections transitioning`)
        // Keep monitoring for transitioning connections, but with reduced frequency
      } else {
        console.log(`[useCallPerformance] Stopping monitoring - no valid connections (${peerConnections.size} total)`)
        stopMonitoring()
      }
    } else {
      console.log(`[useCallPerformance] Stopping monitoring - no peer connections`)
      stopMonitoring()
    }

    return () => stopMonitoring()
  }, [peerConnections.size, startMonitoring, stopMonitoring])

  const getOverallNetworkQuality = (): 'excellent' | 'good' | 'fair' | 'poor' => {
    // If we don't have metrics yet, assume good quality initially
    if (performanceState.remoteMetrics.size === 0) {
      console.log('[useCallPerformance] No remote metrics yet, defaulting to good quality')
      return 'good'
    }
    
    const qualities = Array.from(performanceState.remoteMetrics.values()).map(m => m.networkQuality)
    console.log('[useCallPerformance] Individual qualities:', qualities)
    
    const qualityScores = { excellent: 4, good: 3, fair: 2, poor: 1 }
    const avgScore = qualities.reduce((sum, q) => sum + qualityScores[q], 0) / qualities.length
    console.log('[useCallPerformance] Average quality score:', avgScore)
    
    if (avgScore >= 3.5) return 'excellent'
    if (avgScore >= 2.5) return 'good'
    if (avgScore >= 1.5) return 'fair'
    return 'poor'
  }

  const shouldReduceQuality = (): boolean => {
    const overallQuality = getOverallNetworkQuality()
    return overallQuality === 'poor' || overallQuality === 'fair'
  }

  return {
    performanceState,
    getOverallNetworkQuality,
    shouldReduceQuality,
    startMonitoring,
    stopMonitoring
  }
}
