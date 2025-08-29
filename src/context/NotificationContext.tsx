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
  const [soundEnabled, setSoundEnabled] = useState(true)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPageVisible, setIsPageVisible] = useState(true)
  const [isWindowFocused, setIsWindowFocused] = useState(true)
  const queuedNotifications = useRef<Array<{ title: string; options?: NotificationOptions }>>([])

  const notificationEnabled = permission === 'granted'

  // Initialize notification permission status
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission)
    }
  }, [])

  // Initialize audio for notification sounds
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        audioRef.current = new Audio('/sounds/notification.mp3')
        audioRef.current.volume = 0.5
        audioRef.current.preload = 'none' // Don't preload to avoid 404 errors
        
        // Handle audio load errors gracefully
        audioRef.current.onerror = () => {
          console.warn('Notification sound file not found, continuing without audio notifications')
          audioRef.current = null
        }
        
        // Test if the file exists by attempting to load metadata
        audioRef.current.addEventListener('loadstart', () => {
          // File exists and is loading
        }, { once: true })
      } catch (error) {
        console.warn('Could not initialize notification audio:', error)
        audioRef.current = null
      }
    }
  }, [])

  // Load sound preference from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedSoundPreference = localStorage.getItem('notificationSoundEnabled')
      if (savedSoundPreference !== null) {
        setSoundEnabled(JSON.parse(savedSoundPreference))
      }
    }
  }, [])

  // Save sound preference to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('notificationSoundEnabled', JSON.stringify(soundEnabled))
    }
  }, [soundEnabled])

  const createSimpleNotificationBeep = () => {
    if (typeof window !== 'undefined' && window.AudioContext) {
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
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
        
        // Clean up
        setTimeout(() => {
          audioContext.close().catch(() => {})
        }, 300)
      } catch (error) {
        console.warn('Could not create notification beep:', error)
      }
    }
  }

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
    // Only show notifications if user has granted permission and page is not visible
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
    if (soundEnabled) {
      console.log('NotificationContext: Attempting to play notification sound, page visible:', isPageVisible, 'window focused:', isWindowFocused)
      
      // If page is not visible or window is not focused, queue the notification for later
      if (!isPageVisible || !isWindowFocused) {
        console.log('NotificationContext: Page not visible or window not focused, queuing notification')
        queuedNotifications.current.push({ title: 'New message' })
        // Still try to play sound for background notifications
      }
      
      // Always try to play sound, even when not focused (browsers allow this)
      try {
        // Try to play the audio file first
        if (audioRef.current) {
          // Reset audio to beginning for multiple rapid notifications
          audioRef.current.currentTime = 0
          audioRef.current.play().catch((error) => {
            console.warn('Audio file playback failed:', error)
            // If audio file fails, create a simple beep using Web Audio API
            createSimpleNotificationBeep()
          })
        } else {
          // If no audio file, create a simple beep using Web Audio API
          createSimpleNotificationBeep()
        }
      } catch (error) {
        console.warn('Notification sound failed:', error)
        // Fallback to simple beep
        createSimpleNotificationBeep()
      }
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
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}