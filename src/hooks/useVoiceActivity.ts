'use client'

import { useEffect, useRef, useState } from 'react'

interface UseVoiceActivityProps {
  stream: MediaStream | null
  threshold?: number
  smoothingTimeConstant?: number
}

export function useVoiceActivity({
  stream,
  threshold = -50,
  smoothingTimeConstant = 0.8
}: UseVoiceActivityProps) {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationFrameRef = useRef<number>()

  // ENHANCED: Adaptive polling for performance optimization
  const pollingStateRef = useRef({
    isStable: false,
    lastChangeTime: Date.now(),
    consecutiveStableChecks: 0,
    pollingInterval: 100, // Start with 100ms
    maxInterval: 500, // Max 500ms for stable calls
    minInterval: 50  // Min 50ms during active speech
  })

  useEffect(() => {
    // ENHANCED: Throttled logging to reduce console spam
    if (Math.random() < 0.1) { // Only log 10% of the time for debugging
      console.log('[VoiceActivity] Effect triggered:', {
        hasStream: !!stream,
        streamId: stream?.id,
        audioTracks: stream?.getAudioTracks().length || 0,
        streamActive: stream?.active,
        threshold
      })
    }

    if (!stream) {
      if (Math.random() < 0.05) { // Reduced logging
        console.log('[VoiceActivity] No stream provided, cleaning up')
      }
      cleanup()
      return
    }

    // ENHANCED: More lenient stream validation for group calls
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) {
      if (Math.random() < 0.1) {
        console.log('[VoiceActivity] No audio tracks in stream, cleaning up')
      }
      cleanup()
      return
    }

    // ENHANCED: Be more lenient with track states - allow 'live' or other valid states
    const validAudioTracks = audioTracks.filter(track => {
      // Accept tracks that are live, or that have valid readyState and are enabled
      const isValidState = track.readyState === 'live' || track.readyState === 'ended'
      const isUsable = track.enabled && stream.active
      return isValidState && isUsable
    })

    // FALLBACK: If stream is active but tracks aren't "live", still try to use it
    const tracksToUse = validAudioTracks.length > 0 ? validAudioTracks : (stream.active ? audioTracks : [])

    if (tracksToUse.length === 0) {
      if (Math.random() < 0.1) {
        console.log('[VoiceActivity] No usable audio tracks, cleaning up', {
          streamActive: stream.active,
          totalTracks: audioTracks.length,
          trackStates: audioTracks.map(t => ({ readyState: t.readyState, enabled: t.enabled }))
        })
      }
      cleanup()
      return
    }
    
    console.log('[VoiceActivity] Initializing for stream:', stream.id, 'with', audioTracks.length, 'audio tracks')

    try {
      // Create audio context and analyser
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const analyser = audioContext.createAnalyser()
      const microphone = audioContext.createMediaStreamSource(stream)
      
      analyser.smoothingTimeConstant = smoothingTimeConstant
      analyser.fftSize = 512
      
      microphone.connect(analyser)
      
      audioContextRef.current = audioContext
      analyserRef.current = analyser

      // ENHANCED: Adaptive monitoring with performance optimization
      const monitorVolume = () => {
        if (!analyserRef.current) return

        const bufferLength = analyserRef.current.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)
        analyserRef.current.getByteFrequencyData(dataArray)

        // Calculate average volume
        let sum = 0
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i]
        }
        const average = sum / bufferLength

        // Convert to decibels (handle case where average is 0 to avoid -Infinity)
        const volume = average > 0 ? 20 * Math.log10(average / 255) : -100

        // ENHANCED: More robust speaking detection with multiple checks
        const hasSignificantAverage = average > 15 // Minimum average signal strength
        const isAboveThreshold = volume > threshold
        const hasConsistentSignal = average > 0 && volume > -100 // Avoid -Infinity cases

        // Combine all conditions for more accurate detection
        const speaking = hasSignificantAverage && isAboveThreshold && hasConsistentSignal

        // Additional check: ensure stream and tracks are still active
        const streamStillActive = stream?.active && stream.getAudioTracks().some(t => t.readyState === 'live' && t.enabled)
        const finalSpeaking = speaking && streamStillActive

        // ENHANCED: Adaptive polling optimization
        const pollingState = pollingStateRef.current
        const now = Date.now()

        // Check if speaking state changed
        if (finalSpeaking !== isSpeaking) {
          setIsSpeaking(finalSpeaking)
          pollingState.lastChangeTime = now
          pollingState.consecutiveStableChecks = 0
          pollingState.isStable = false

          // Use minimum interval during state changes
          pollingState.pollingInterval = pollingState.minInterval
        } else {
          // State unchanged, potentially entering stable period
          pollingState.consecutiveStableChecks++

          // If stable for a while, reduce polling frequency
          if (pollingState.consecutiveStableChecks > 10) { // 10 stable checks
            pollingState.isStable = true
            pollingState.pollingInterval = Math.min(
              pollingState.pollingInterval * 1.1, // Gradually increase interval
              pollingState.maxInterval
            )
          }
        }

        // Debug logging (throttled for performance)
        if (Math.random() < 0.005) { // Only log ~0.5% of the time
          console.log('[VoiceActivity] Volume analysis:', {
            average: average.toFixed(1),
            volume: volume.toFixed(1),
            threshold,
            speaking,
            finalSpeaking,
            pollingInterval: pollingState.pollingInterval,
            isStable: pollingState.isStable,
            trackStates: stream?.getAudioTracks().map(t => ({ enabled: t.enabled, readyState: t.readyState }))
          })
        }

        // ENHANCED: Use adaptive timing instead of requestAnimationFrame for better performance
        const nextCheck = () => {
          animationFrameRef.current = setTimeout(monitorVolume, pollingState.pollingInterval) as any
        }

        nextCheck()
      }

      monitorVolume()
    } catch (error) {
      console.warn('[VoiceActivity] Failed to initialize voice detection:', error)
      cleanup()
    }

    return cleanup
  }, [stream, threshold, smoothingTimeConstant])

  const cleanup = () => {
    if (animationFrameRef.current) {
      clearTimeout(animationFrameRef.current)
      animationFrameRef.current = undefined
    }
    
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.warn)
      audioContextRef.current = null
    }
    
    analyserRef.current = null
    setIsSpeaking(false)
  }

  useEffect(() => {
    return cleanup
  }, [])

  return { isSpeaking }
}
