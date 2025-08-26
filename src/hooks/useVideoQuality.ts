'use client'

import { useState, useCallback } from 'react'

export interface VideoQualitySettings {
  resolution: '480p' | '720p' | '1080p'
  frameRate: 15 | 30 | 60
  bitrate: 'auto' | 'low' | 'medium' | 'high'
}

export interface VideoQualityConstraints {
  width: { ideal: number; max: number }
  height: { ideal: number; max: number }
  frameRate: { ideal: number }
}

const qualityPresets: Record<VideoQualitySettings['resolution'], VideoQualityConstraints> = {
  '480p': {
    width: { ideal: 640, max: 854 },
    height: { ideal: 480, max: 480 },
    frameRate: { ideal: 30 }
  },
  '720p': {
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30 }
  },
  '1080p': {
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
    frameRate: { ideal: 30 }
  }
}

export function useVideoQuality() {
  const [settings, setSettings] = useState<VideoQualitySettings>({
    resolution: '720p',
    frameRate: 30,
    bitrate: 'auto'
  })

  const [networkQuality, setNetworkQuality] = useState<'excellent' | 'good' | 'fair' | 'poor'>('good')

  const getVideoConstraints = useCallback((customSettings?: Partial<VideoQualitySettings>): VideoQualityConstraints => {
    const currentSettings = { ...settings, ...customSettings }
    const baseConstraints = qualityPresets[currentSettings.resolution]
    
    return {
      ...baseConstraints,
      frameRate: { ideal: currentSettings.frameRate }
    }
  }, [settings])

  const adaptQualityForNetwork = useCallback((quality: typeof networkQuality) => {
    setNetworkQuality(quality)
    
    switch (quality) {
      case 'poor':
        setSettings(prev => ({ ...prev, resolution: '480p', frameRate: 15, bitrate: 'low' }))
        break
      case 'fair':
        setSettings(prev => ({ ...prev, resolution: '480p', frameRate: 30, bitrate: 'medium' }))
        break
      case 'good':
        setSettings(prev => ({ ...prev, resolution: '720p', frameRate: 30, bitrate: 'medium' }))
        break
      case 'excellent':
        setSettings(prev => ({ ...prev, resolution: '720p', frameRate: 30, bitrate: 'high' }))
        break
    }
  }, [])

  const updateSettings = useCallback((newSettings: Partial<VideoQualitySettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }))
  }, [])

  return {
    settings,
    networkQuality,
    getVideoConstraints,
    adaptQualityForNetwork,
    updateSettings
  }
}

export function detectNetworkQuality(peerConnection: RTCPeerConnection): Promise<'excellent' | 'good' | 'fair' | 'poor'> {
  return new Promise((resolve) => {
    let resolved = false
    
    const checkStats = async () => {
      if (resolved) return
      
      try {
        const stats = await peerConnection.getStats()
        let bytesReceived = 0
        let packetsLost = 0
        let totalPackets = 0
        
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
            bytesReceived = report.bytesReceived || 0
            packetsLost = report.packetsLost || 0
            totalPackets = report.packetsReceived || 0
          }
        })
        
        const packetLossRate = totalPackets > 0 ? packetsLost / totalPackets : 0
        
        let quality: 'excellent' | 'good' | 'fair' | 'poor'
        
        if (packetLossRate < 0.01) {
          quality = 'excellent'
        } else if (packetLossRate < 0.03) {
          quality = 'good'
        } else if (packetLossRate < 0.08) {
          quality = 'fair'
        } else {
          quality = 'poor'
        }
        
        resolved = true
        resolve(quality)
      } catch (error) {
        console.warn('Failed to get network stats:', error)
        resolved = true
        resolve('good') // Default to good if we can't measure
      }
    }
    
    // Check after a few seconds to allow connection to stabilize
    setTimeout(checkStats, 3000)
    
    // Fallback timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true
        resolve('good')
      }
    }, 10000)
  })
}
