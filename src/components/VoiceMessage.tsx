'use client'

import { useState, useRef, useEffect } from 'react'
import { Mic, MicOff, Play, Pause, Send, X, Volume2 } from 'lucide-react'

interface VoiceMessageProps {
  onSend: (audioBlob: Blob, duration: number) => void
  onCancel: () => void
  maxDuration?: number // in seconds
}

export function VoiceMessageRecorder({ 
  onSend, 
  onCancel, 
  maxDuration = 300 // 5 minutes max
}: VoiceMessageProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [duration, setDuration] = useState(0)
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [permissionError, setPermissionError] = useState<string>('')
  const [isPlaying, setIsPlaying] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    checkMicrophonePermission()
    return () => {
      cleanup()
    }
  }, [])

  const checkMicrophonePermission = async () => {
    try {
      // Check if mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setHasPermission(false)
        setPermissionError('Your browser does not support audio recording. Please use a modern browser like Chrome, Firefox, or Safari.')
        return
      }

      // First try to check existing permission state using Permissions API
      try {
        const micPermission = await navigator.permissions.query({ name: 'microphone' as PermissionName })
        console.log('🎤 Current microphone permission state:', micPermission.state)
        
        if (micPermission.state === 'granted') {
          // Permission already granted, test it quickly
          const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          })
          
          setHasPermission(true)
          setPermissionError('')
          console.log('🎤 Microphone access confirmed')
          
          // Stop the test stream immediately
          stream.getTracks().forEach(track => track.stop())
          return
        } else if (micPermission.state === 'denied') {
          setHasPermission(false)
          setPermissionError('Microphone access was denied. Please click the microphone icon in your browser\'s address bar and allow access.')
          return
        }
        // If state is 'prompt', continue to request permission below
      } catch {
        console.log('🎤 Permissions API not available, proceeding with direct request')
      }

      // Request permission directly
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      
      setHasPermission(true)
      setPermissionError('')
      console.log('🎤 Microphone access granted successfully')
      
      // Stop the test stream immediately
      stream.getTracks().forEach(track => {
        track.stop()
      })
    } catch (error: unknown) {
      console.error('Microphone permission check failed:', error)
      setHasPermission(false)
      
      // Provide specific error messages based on error type
      if (error.name === 'NotAllowedError') {
        setPermissionError('Microphone access was denied. Please click the microphone icon in your browser\'s address bar and select "Allow".')
      } else if (error.name === 'NotFoundError') {
        setPermissionError('No microphone found. Please connect a microphone and try again.')
      } else if (error.name === 'NotReadableError') {
        setPermissionError('Microphone is being used by another application. Please close other apps and try again.')
      } else if (error.name === 'OverconstrainedError') {
        setPermissionError('Microphone does not meet the required specifications. Please try with a different microphone.')
      } else if (error.name === 'SecurityError') {
        setPermissionError('Microphone access blocked due to security settings. Please check your browser settings.')
      } else {
        setPermissionError(`Microphone access failed: ${error.message || 'Unknown error'}. Please refresh the page and try again.`)
      }
    }
  }

  const cleanup = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
    }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        }
      })
      
      streamRef.current = stream
      audioChunksRef.current = []

      // Try to use the best available format
      let mimeType = 'audio/webm;codecs=opus'
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm'
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/mp4'
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = '' // Use default
          }
        }
      }

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {})
      
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' })
        setAudioBlob(audioBlob)
        
        // Create audio URL for playback
        const audioUrl = URL.createObjectURL(audioBlob)
        audioRef.current = new Audio(audioUrl)
      }

      mediaRecorder.start(100) // Collect data every 100ms
      setIsRecording(true)
      setDuration(0)

      // Start timer
      timerRef.current = setInterval(() => {
        setDuration(prev => {
          const newDuration = prev + 1
          if (newDuration >= maxDuration) {
            stopRecording()
          }
          return newDuration
        })
      }, 1000)

    } catch (error: unknown) {
      console.error('Failed to start recording:', error)
      setHasPermission(false)
      
      // Provide specific error messages
      if (error.name === 'NotAllowedError') {
        setPermissionError('Microphone access was denied during recording. Please refresh and allow permissions.')
      } else if (error.name === 'NotFoundError') {
        setPermissionError('Microphone was disconnected. Please reconnect your microphone.')
      } else if (error.name === 'NotReadableError') {
        setPermissionError('Microphone became unavailable. Please check if another app is using it.')
      } else {
        setPermissionError(`Recording failed: ${error.message || 'Unknown error'}`)
      }
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      setIsPaused(false)
      
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.pause()
      setIsPaused(true)
      
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }

  const resumeRecording = () => {
    if (mediaRecorderRef.current && isPaused) {
      mediaRecorderRef.current.resume()
      setIsPaused(false)
      
      // Resume timer
      timerRef.current = setInterval(() => {
        setDuration(prev => {
          const newDuration = prev + 1
          if (newDuration >= maxDuration) {
            stopRecording()
          }
          return newDuration
        })
      }, 1000)
    }
  }

  const playRecording = () => {
    if (audioRef.current) {
      audioRef.current.play()
      setIsPlaying(true)
      
      audioRef.current.onended = () => setIsPlaying(false)
      audioRef.current.onerror = () => setIsPlaying(false)
    }
  }

  const pausePlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      setIsPlaying(false)
    }
  }

  const handleSend = () => {
    if (audioBlob && duration > 0) {
      console.log('Sending voice message:', { 
        blobSize: audioBlob.size, 
        blobType: audioBlob.type, 
        duration 
      })
      onSend(audioBlob, duration)
    } else {
      console.error('Cannot send voice message:', { 
        hasBlob: !!audioBlob, 
        duration,
        blobSize: audioBlob?.size 
      })
    }
  }

  const handleCancel = () => {
    cleanup()
    onCancel()
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (hasPermission === false) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <div className="flex items-center space-x-2 text-red-800 dark:text-red-400">
          <MicOff className="w-5 h-5" />
          <h3 className="font-medium">Microphone Access Required</h3>
        </div>
        <p className="mt-2 text-sm text-red-600 dark:text-red-300">
          {permissionError || 'Please allow microphone access to record voice messages.'}
        </p>
        <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
          <p className="text-xs text-red-700 dark:text-red-300 font-medium mb-2">How to enable microphone access:</p>
          <ul className="text-xs text-red-600 dark:text-red-400 space-y-1">
            <li>• Click the microphone icon in your browser&apos;s address bar</li>
            <li>• Select &quot;Allow&quot; when prompted for microphone permission</li>
            <li>• If you previously denied access, click the lock icon next to the URL</li>
            <li>• Refresh the page after changing permissions</li>
          </ul>
        </div>
        <div className="mt-3 flex space-x-2">
          <button
            onClick={() => {
              setPermissionError('')
              checkMicrophonePermission()
            }}
            className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
          >
            🔄 Try Again
          </button>
          <button
            onClick={() => {
              // Open browser settings help
              window.open('https://support.google.com/chrome/answer/2693767', '_blank')
            }}
            className="px-3 py-1.5 text-sm text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            📖 Help
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 border border-gray-600 dark:border-gray-400 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Volume2 className="w-5 h-5 text-blue-600" />
          <h3 className="font-medium text-gray-900 dark:text-white">
            Voice Message
          </h3>
        </div>
        <button
          onClick={handleCancel}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Recording Status */}
      <div className="text-center mb-4">
        <div className="text-2xl font-mono text-gray-900 dark:text-white mb-2">
          {formatDuration(duration)}
        </div>
        
        {isRecording && (
          <div className="flex items-center justify-center space-x-2 text-red-600">
            <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium">
              {isPaused ? 'Recording Paused' : 'Recording...'}
            </span>
          </div>
        )}
        
        {audioBlob && !isRecording && (
          <div className="text-sm text-green-600 dark:text-green-400">
            ✓ Recording completed
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center space-x-4">
        {!isRecording && !audioBlob && (
          <button
            onClick={startRecording}
            disabled={hasPermission === null || hasPermission === false}
            className="flex items-center justify-center w-16 h-16 bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Mic className="w-8 h-8" />
          </button>
        )}

        {isRecording && (
          <>
            <button
              onClick={isPaused ? resumeRecording : pauseRecording}
              className="flex items-center justify-center w-12 h-12 bg-yellow-600 hover:bg-yellow-700 text-white rounded-full transition-colors"
            >
              {isPaused ? <Play className="w-6 h-6" /> : <Pause className="w-6 h-6" />}
            </button>
            
            <button
              onClick={stopRecording}
              className="flex items-center justify-center w-16 h-16 bg-gray-600 hover:bg-gray-700 text-white rounded-full transition-colors"
            >
              <div className="w-6 h-6 bg-white rounded-sm"></div>
            </button>
          </>
        )}

        {audioBlob && !isRecording && (
          <>
            <button
              onClick={isPlaying ? pausePlayback : playRecording}
              className="flex items-center justify-center w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-full transition-colors"
            >
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            </button>
            
            <button
              onClick={() => {
                setAudioBlob(null)
                setDuration(0)
                if (audioRef.current) {
                  URL.revokeObjectURL(audioRef.current.src)
                }
              }}
              className="flex items-center justify-center w-10 h-10 bg-gray-600 hover:bg-gray-700 text-white rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            
            <button
              onClick={handleSend}
              className="flex items-center justify-center w-12 h-12 bg-green-600 hover:bg-green-700 text-white rounded-full transition-colors"
            >
              <Send className="w-6 h-6" />
            </button>
          </>
        )}
      </div>

      {/* Instructions */}
      <div className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
        {!isRecording && !audioBlob && 'Tap the microphone to start recording'}
        {isRecording && !isPaused && 'Recording... Tap pause to pause or stop to finish'}
        {isRecording && isPaused && 'Recording paused. Tap play to resume or stop to finish'}
        {audioBlob && !isRecording && 'Tap play to preview or send to share your voice message'}
      </div>

      {/* Progress bar for max duration */}
      {maxDuration && duration > 0 && (
        <div className="mt-3">
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1">
            <div 
              className="bg-red-600 h-1 rounded-full transition-all duration-1000"
              style={{ width: `${(duration / maxDuration) * 100}%` }}
            ></div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 text-center mt-1">
            {formatDuration(maxDuration - duration)} remaining
          </div>
        </div>
      )}
    </div>
  )
}
