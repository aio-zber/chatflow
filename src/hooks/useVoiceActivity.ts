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

  useEffect(() => {
    console.log('[VoiceActivity] Effect triggered:', { 
      hasStream: !!stream, 
      streamId: stream?.id,
      audioTracks: stream?.getAudioTracks().length || 0,
      threshold 
    })
    
    if (!stream) {
      console.log('[VoiceActivity] No stream provided, cleaning up')
      cleanup()
      return
    }

    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) {
      console.log('[VoiceActivity] No audio tracks in stream, cleaning up')
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

      // Start monitoring
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
        
        // Check if speaking (only if volume is significantly above threshold)
        const speaking = average > 0 && volume > threshold && average > 10 // Add minimum average threshold
        
        // Debug logging (throttled)
        if (Math.random() < 0.01) { // Only log ~1% of the time to avoid spam
          console.log('[VoiceActivity] Volume analysis:', { 
            average: average.toFixed(1), 
            volume: volume.toFixed(1), 
            threshold, 
            speaking,
            streamActive: stream?.active,
            trackStates: stream?.getAudioTracks().map(t => ({ enabled: t.enabled, readyState: t.readyState }))
          })
        }
        
        setIsSpeaking(speaking)

        animationFrameRef.current = requestAnimationFrame(monitorVolume)
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
      cancelAnimationFrame(animationFrameRef.current)
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
