'use client'

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'

interface NotificationContextType {
  permission: NotificationPermission
  requestPermission: () => Promise<NotificationPermission>
  showNotification: (title: string, options?: NotificationOptions) => void
  unreadCount: number
  setUnreadCount: (count: number) => void
  playNotificationSound: () => void
  notificationEnabled: boolean
  soundEnabled: boolean
  setSoundEnabled: (enabled: boolean) => void
  audioEnabled: boolean
  enableAudio: () => void
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined)

export const useNotifications = () => {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider')
  }
  return context
}

interface NotificationProviderProps {
  children: React.ReactNode
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
  const { data: session } = useSession()
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [unreadCount, setUnreadCount] = useState(0)
  const [soundEnabled, setSoundEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('notificationSoundEnabled')
      return saved !== null ? JSON.parse(saved) : true
    }
    return true
  })
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const [isPageVisible, setIsPageVisible] = useState(true)
  const [isWindowFocused, setIsWindowFocused] = useState(true)
  const [audioEnabled, setAudioEnabled] = useState(false)
  const queuedNotifications = useRef<Array<{ title: string; options?: NotificationOptions }>>([])

  const notificationEnabled = permission === 'granted'

  // Initialize notification permission status
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission)
    }
  }, [])

  // Initialize audio context on user interaction to avoid autoplay blocking
  const enableAudio = useCallback(() => {
    console.log('🎵 enableAudio called, current state:', { audioEnabled, hasAudioContext: !!audioContextRef.current })
    
    if (typeof window !== 'undefined' && !audioEnabled) {
      try {
        // Initialize audio context
        if (!audioContextRef.current) {
          console.log('🎵 Creating new AudioContext...')
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
        }
        
        // Resume audio context if suspended
        if (audioContextRef.current.state === 'suspended') {
          console.log('🎵 AudioContext is suspended, attempting to resume...')
          audioContextRef.current.resume().then(() => {
            console.log('🎵 Audio context resumed successfully')
            setAudioEnabled(true)
          }).catch(error => {
            console.error('🎵 Failed to resume audio context:', error)
          })
        } else {
          console.log('🎵 AudioContext is ready, enabling audio')
          setAudioEnabled(true)
        }
        
        // Initialize audio file
        if (!audioRef.current) {
          console.log('🎵 Initializing notification audio file...')
          audioRef.current = new Audio('/sounds/notification.mp3')
          audioRef.current.volume = 0.5
          audioRef.current.preload = 'auto'
          
          audioRef.current.onerror = () => {
            console.warn('Notification sound file not found, will use fallback beep sound')
            audioRef.current = null
          }
          
          audioRef.current.oncanplaythrough = () => {
            console.log('Notification audio loaded successfully')
          }
        }
      } catch (error) {
        console.warn('Could not enable audio:', error)
      }
    } else {
      console.log('🎵 enableAudio: Audio already enabled or window not available')
    }
  }, [audioEnabled])
  
  // Initialize audio for notification sounds
  useEffect(() => {
    if (typeof window !== 'undefined' && !audioEnabled) {
      console.log('🎵 Setting up user interaction listeners for audio enablement...')
      // Add event listeners for user interaction to enable audio
      const events = ['click', 'touchstart', 'keydown', 'mousedown']
      
      const handleUserInteraction = (event: Event) => {
        console.log('🎵 User interaction detected:', event.type)
        enableAudio()
        
        // Remove listeners after first successful interaction
        events.forEach(eventType => {
          document.removeEventListener(eventType, handleUserInteraction)
        })
      }
      
      // Add listeners to document to catch any user interaction
      events.forEach(event => {
        document.addEventListener(event, handleUserInteraction, { passive: true })
      })
      
      console.log('🎵 User interaction listeners added for:', events.join(', '))
      
      return () => {
        console.log('🎵 Cleaning up user interaction listeners')
        events.forEach(event => {
          document.removeEventListener(event, handleUserInteraction)
        })
      }
    }
  }, [enableAudio, audioEnabled])


  // Save sound preference to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('notificationSoundEnabled', JSON.stringify(soundEnabled))
    }
  }, [soundEnabled])

  const createSimpleNotificationBeep = useCallback(() => {
    if (!audioContextRef.current || !audioEnabled) {
      console.warn('🔇 Audio context not available or not enabled for notification beep')
      return
    }
    
    try {
      const audioContext = audioContextRef.current
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()
      
      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)
      
      oscillator.frequency.value = 800 // 800Hz tone
      oscillator.type = 'sine'
      
      gainNode.gain.setValueAtTime(0, audioContext.currentTime)
      gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.01)
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2)
      
      oscillator.start(audioContext.currentTime)
      oscillator.stop(audioContext.currentTime + 0.2)
      
      console.log('🔔 Simple notification beep played successfully')
    } catch (error) {
      console.warn('Could not create notification beep:', error)
    }
  }, [audioEnabled])

  // Track page visibility and window focus for better idle notification handling
  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible'
      setIsPageVisible(visible)
      console.log('NotificationContext: Page visibility changed to:', visible)
      
      // If page becomes visible, process any queued notifications
      if (visible && queuedNotifications.current.length > 0) {
        console.log('NotificationContext: Processing queued notifications:', queuedNotifications.current.length)
        queuedNotifications.current.forEach(({ title, options }) => {
          // Play sound for queued notifications when user returns
          if (soundEnabled && audioRef.current) {
            audioRef.current.currentTime = 0
            audioRef.current.play().catch(() => {
              // Fallback to simple beep if audio fails
              createSimpleNotificationBeep()
            })
          }
        })
        queuedNotifications.current = [] // Clear queue
      }
    }

    const handleFocus = () => {
      setIsWindowFocused(true)
      console.log('NotificationContext: Window focused')
    }

    const handleBlur = () => {
      setIsWindowFocused(false)
      console.log('NotificationContext: Window blurred')
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)

    // Set initial states
    setIsPageVisible(document.visibilityState === 'visible')
    setIsWindowFocused(document.hasFocus())

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [soundEnabled])

  // Update document title with unread count (disabled to remove notification badges)
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const baseTitle = 'ChatFlow'
      // Keep title clean without unread count
      document.title = baseTitle
    }
  }, [unreadCount])

  const requestPermission = async (): Promise<NotificationPermission> => {
    if (!('Notification' in window)) {
      console.warn('This browser does not support notifications')
      return 'denied'
    }

    const result = await Notification.requestPermission()
    setPermission(result)
    return result
  }

  const showNotification = (title: string, options: NotificationOptions = {}) => {
    // Only show notifications if sound is enabled, user has granted permission and page is not visible
    if (!soundEnabled) {
      console.log('NotificationContext: Notifications disabled by user, not showing browser notification')
      return
    }
    
    if (permission !== 'granted') {
      console.log('NotificationContext: Notifications not permitted')
      return
    }

    // Only show browser notifications when page is not visible or window is not focused
    if (!isPageVisible || !isWindowFocused) {
      try {
        const notification = new Notification(title, {
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: 'chatflow-message', // Reuse tag to replace previous notifications
          requireInteraction: false, // Don't require user interaction to dismiss
          silent: !soundEnabled, // Respect user's sound preference
          ...options
        })

        // Auto-dismiss notification after 5 seconds
        setTimeout(() => {
          notification.close()
        }, 5000)

        console.log('NotificationContext: Browser notification shown:', title)
      } catch (error) {
        console.warn('NotificationContext: Failed to show browser notification:', error)
      }
    }
  }

  const playNotificationSound = () => {
    console.log('🔊 NotificationContext: playNotificationSound called, soundEnabled:', soundEnabled, 'audioEnabled:', audioEnabled)
    
    if (!soundEnabled) {
      console.log('🔇 NotificationContext: Sound disabled, not playing notification sound')
      return
    }
    
    if (!audioEnabled) {
      console.log('🔇 NotificationContext: Audio not enabled by user interaction yet, attempting to enable...')
      // Try to enable audio immediately
      enableAudio()
      // Don't return - continue with sound attempt in case it enables quickly
    }
    
    console.log('NotificationContext: Attempting to play notification sound, page visible:', isPageVisible, 'window focused:', isWindowFocused)
    
    // If page is not visible or window is not focused, queue the notification for later
    if (!isPageVisible || !isWindowFocused) {
      console.log('NotificationContext: Page not visible or window not focused, queuing notification')
      queuedNotifications.current.push({ title: 'New message' })
      // Still try to play sound for background notifications
    }
    
    // Always try to play sound, even when not focused (browsers allow this once enabled)
    try {
      // Try to play the audio file first
      if (audioRef.current) {
        console.log('🎵 NotificationContext: Playing notification.mp3')
        // Reset audio to beginning for multiple rapid notifications
        audioRef.current.currentTime = 0
        audioRef.current.play().then(() => {
          console.log('✅ NotificationContext: Audio played successfully')
        }).catch((error) => {
          console.warn('❌ Audio file playback failed, trying fallback beep:', error)
          // If audio file fails, create a simple beep using Web Audio API
          createSimpleNotificationBeep()
        })
      } else {
        console.log('🎵 NotificationContext: Audio file not available, using fallback beep')
        // If no audio file, create a simple beep using Web Audio API
        createSimpleNotificationBeep()
      }
    } catch (error) {
      console.warn('❌ Notification sound failed, trying fallback beep:', error)
      // Fallback to simple beep
      createSimpleNotificationBeep()
    }
  }

  return (
    <NotificationContext.Provider
      value={{
        permission,
        requestPermission,
        showNotification,
        unreadCount,
        setUnreadCount,
        playNotificationSound,
        notificationEnabled,
        soundEnabled,
        setSoundEnabled,
        audioEnabled,
        enableAudio,
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}