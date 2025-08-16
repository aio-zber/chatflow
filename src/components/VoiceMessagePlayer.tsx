'use client'

import { useState, useRef, useEffect } from 'react'
import { Play, Pause, Volume2, Download } from 'lucide-react'

interface VoiceMessagePlayerProps {
  audioUrl: string
  duration: number
  isOwn?: boolean
  senderName?: string
  timestamp?: Date
  className?: string
}

export function VoiceMessagePlayer({
  audioUrl,
  duration,
  isOwn = false,
  senderName,
  timestamp,
  className = ''
}: VoiceMessagePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [isLoaded, setIsLoaded] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [totalDuration, setTotalDuration] = useState(duration)
  
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleLoadedData = () => {
      setIsLoaded(true)
      if (!duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setTotalDuration(audio.duration)
      }
    }
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }
    const handleError = () => {
      console.error('Error loading audio file')
      setIsLoaded(false)
    }

    audio.addEventListener('loadeddata', handleLoadedData)
    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('loadeddata', handleLoadedData)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
    }
  }, [])

  const togglePlayback = () => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.play()
      setIsPlaying(true)
    }
  }

  const handleSeek = (event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio) return

    const rect = event.currentTarget.getBoundingClientRect()
    const percent = (event.clientX - rect.left) / rect.width
    const newTime = percent * duration
    
    audio.currentTime = newTime
    setCurrentTime(newTime)
  }

  const togglePlaybackRate = () => {
    const audio = audioRef.current
    if (!audio) return

    const rates = [1, 1.25, 1.5, 2]
    const currentIndex = rates.indexOf(playbackRate)
    const nextRate = rates[(currentIndex + 1) % rates.length]
    
    setPlaybackRate(nextRate)
    audio.playbackRate = nextRate
  }

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = audioUrl
    link.download = `voice-message-${Date.now()}.webm`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0

  return (
    <div className={`
      relative max-w-sm p-3 rounded-lg
      ${isOwn 
        ? 'bg-blue-600 text-white ml-auto' 
        : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
      }
      ${className}
    `}>
      <audio ref={audioRef} src={audioUrl} preload="metadata" />
      
      {/* Header */}
      {!isOwn && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
            {senderName}
          </span>
          {timestamp && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}

      {/* Voice message content */}
      <div className="flex items-center space-x-3">
        {/* Play/Pause button */}
        <button
          onClick={togglePlayback}
          disabled={!isLoaded}
          className={`
            flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors
            ${isOwn 
              ? 'bg-blue-500 hover:bg-blue-400 text-white' 
              : 'bg-blue-600 hover:bg-blue-700 text-white'
            }
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
        >
          {!isLoaded ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-5 h-5" />
          ) : (
            <Play className="w-5 h-5 ml-0.5" />
          )}
        </button>

        {/* Waveform/Progress area */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2 mb-1">
            <Volume2 className="w-4 h-4 opacity-70" />
            <span className="text-sm opacity-90">Voice message</span>
          </div>
          
          {/* Progress bar */}
          <div 
            className="relative h-6 cursor-pointer group"
            onClick={handleSeek}
          >
            {/* Background waveform (static) */}
            <div className="absolute inset-0 flex items-center space-x-0.5">
              {Array.from({ length: 30 }, (_, i) => {
                const height = Math.random() * 16 + 4 // Random height between 4-20px
                return (
                  <div
                    key={`waveform-bg-${i}`}
                    className={`
                      w-1 rounded-full transition-colors
                      ${isOwn ? 'bg-blue-300' : 'bg-gray-300 dark:bg-gray-500'}
                    `}
                    style={{ height: `${height}px` }}
                  />
                )
              })}
            </div>

            {/* Progress overlay */}
            <div 
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${progress}%` }}
            >
              <div className="flex items-center space-x-0.5 h-full">
                {Array.from({ length: 30 }, (_, i) => {
                  const height = Math.random() * 16 + 4
                  return (
                    <div
                      key={`waveform-progress-${i}`}
                      className={`
                        w-1 rounded-full
                        ${isOwn ? 'bg-white' : 'bg-blue-600'}
                      `}
                      style={{ height: `${height}px` }}
                    />
                  )
                })}
              </div>
            </div>

            {/* Current time indicator */}
            <div 
              className={`
                absolute top-0 bottom-0 w-0.5 transition-all
                ${isOwn ? 'bg-white' : 'bg-blue-600'}
              `}
              style={{ left: `${progress}%` }}
            />
          </div>

          {/* Time and controls */}
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs opacity-75">
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </span>
            
            <div className="flex items-center space-x-2">
              {/* Playback speed */}
              <button
                onClick={togglePlaybackRate}
                className="text-xs opacity-75 hover:opacity-100 transition-opacity"
              >
                {playbackRate}x
              </button>
              
              {/* Download */}
              <button
                onClick={handleDownload}
                className="opacity-75 hover:opacity-100 transition-opacity"
              >
                <Download className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Timestamp for own messages */}
      {isOwn && timestamp && (
        <div className="text-right mt-2">
          <span className="text-xs opacity-75">
            {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}
    </div>
  )
}
