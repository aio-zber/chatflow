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

  // PHASE 3 FIX: Removed adaptive polling state (was causing detection gaps)

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

    // PHASE 3 FIX: Enhanced track validation to handle muted-but-enabled tracks
    const usableAudioTracks = audioTracks.filter(track => {
      // Accept tracks that are enabled, even if marked as muted
      // Remote tracks often show as muted:true but still transmit audio
      return track.enabled && track.readyState !== 'ended'
    })

    // If no enabled tracks but stream is active, still try to use available tracks
    const tracksToUse = usableAudioTracks.length > 0 ? usableAudioTracks :
                       (stream.active ? audioTracks : [])

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

        // PHASE 3 FIX: Enhanced stream validation (ignore muted state for remote tracks)
        const streamStillActive = stream?.active && stream.getAudioTracks().some(t => t.enabled && t.readyState !== 'ended')
        const finalSpeaking = speaking && streamStillActive

        // Update speaking state when it changes
        if (finalSpeaking !== isSpeaking) {
          setIsSpeaking(finalSpeaking)
        }

        // PHASE 3 FIX: Consistent polling interval (remove adaptive polling that caused gaps)
        // Use consistent 100ms interval for reliable voice activity detection
        const VOICE_ACTIVITY_POLLING_INTERVAL = 100

        // Debug logging (throttled for performance)
        if (Math.random() < 0.01) { // Only log ~1% of the time
          console.log('[VoiceActivity] Volume analysis:', {
            average: average.toFixed(1),
            volume: volume.toFixed(1),
            threshold,
            speaking,
            finalSpeaking,
            streamActive: stream?.active,
            tracksEnabled: stream?.getAudioTracks().filter(t => t.enabled).length,
            tracksMuted: stream?.getAudioTracks().filter(t => t.muted).length,
            tracksLive: stream?.getAudioTracks().filter(t => t.readyState === 'live').length
          })
        }

        // Schedule next check with consistent interval
        animationFrameRef.current = setTimeout(monitorVolume, VOICE_ACTIVITY_POLLING_INTERVAL) as any
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
