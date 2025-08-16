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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      setHasPermission(true)
      stream.getTracks().forEach(track => track.stop()) // Stop the test stream
    } catch (error) {
      console.error('Microphone permission denied:', error)
      setHasPermission(false)
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

    } catch (error) {
      console.error('Failed to start recording:', error)
      setHasPermission(false)
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
          Please allow microphone access to record voice messages.
        </p>
        <div className="mt-3 flex space-x-2">
          <button
            onClick={checkMicrophonePermission}
            className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700"
          >
            Try Again
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-red-600 border border-red-600 rounded-md hover:bg-red-50"
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
            disabled={hasPermission === null}
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
