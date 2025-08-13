'use client'

import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
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

  // Update document title with unread count
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const baseTitle = 'ChatFlow'
      document.title = unreadCount > 0 ? `(${unreadCount}) ${baseTitle}` : baseTitle
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
    if (!notificationEnabled) return

    // Don't show notifications if user is in the current tab and focused
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      return
    }

    const notification = new Notification(title, {
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      ...options,
    })

    // Close notification after 5 seconds
    setTimeout(() => {
      notification.close()
    }, 5000)

    // Focus window when notification is clicked
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  }

  const playNotificationSound = () => {
    if (soundEnabled) {
      // Try to play the audio file first
      if (audioRef.current) {
        audioRef.current.play().catch(() => {
          // If audio file fails, create a simple beep using Web Audio API
          createSimpleNotificationBeep()
        })
      } else {
        // If no audio file, create a simple beep using Web Audio API
        createSimpleNotificationBeep()
      }
    }
  }

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