'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { Settings, LogOut, ChevronDown, User, Sun, Moon, Monitor } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useSocketContext } from '@/context/SocketContext'
import { useTheme } from '@/context/ThemeContext'
import { getCompatibleFileUrl } from '@/utils/fileProxy'
import { createPortal } from 'react-dom'

export function UserSettings() {
  const { data: session, update } = useSession()
  const { socket } = useSocketContext()
  const { theme, setTheme, actualTheme } = useTheme()
  const [isOpen, setIsOpen] = useState(false)
  const [avatarTimestamp, setAvatarTimestamp] = useState(Date.now())
  const [localAvatarUrl, setLocalAvatarUrl] = useState<string | null>(null)
  const [localDisplayName, setLocalDisplayName] = useState<string | null>(null)
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [dropdownPosition, setDropdownPosition] = useState({ left: 0, top: 0 })
  const [isClient, setIsClient] = useState(false)
  const router = useRouter()
  const dropdownRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Use refs to prevent callback recreation
  const sessionRef = useRef(session)
  const updateRef = useRef(update)

  // Update refs when session or update changes
  useEffect(() => {
    sessionRef.current = session
    updateRef.current = update
  }, [session, update])

  // Client-side hydration check
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Stable callback for handling profile updates
  const handleUserProfileUpdated = useCallback(async (data: { userId: string; avatar?: string; name?: string; username?: string }) => {
    console.log('UserSettings: Received profile update event:', data)
    
    const currentSession = sessionRef.current
    const updateFunction = updateRef.current
    
    if (!currentSession?.user?.id || data.userId !== currentSession.user.id) return

    try {
      // Update local state immediately for instant UI feedback
      if (data.avatar !== undefined) {
        setLocalAvatarUrl(data.avatar)
      }
      if (data.name !== undefined) {
        setLocalDisplayName(data.name)
      }
      
      // Update timestamp for cache busting
      setAvatarTimestamp(Date.now())
      
      // Force a session refresh
      try {
        const refreshedSession = await updateFunction()
        if (refreshedSession?.user?.avatar) {
          setLocalAvatarUrl(refreshedSession.user.avatar)
        }
        if (refreshedSession?.user?.name) {
          setLocalDisplayName(refreshedSession.user.name)
        }
      } catch (refreshError) {
        console.error('UserSettings: Session refresh failed:', refreshError)
      }
    } catch (error) {
      console.error('UserSettings: Error updating profile:', error)
    }
  }, [])

  // Listen for profile updates via socket
  useEffect(() => {
    if (!socket) return

    socket.on('user-profile-updated', handleUserProfileUpdated)
    return () => {
      socket.off('user-profile-updated', handleUserProfileUpdated)
    }
  }, [socket])

  // Calculate dropdown position to prevent overflow using fixed positioning with portal
  useEffect(() => {
    if (!isOpen || !buttonRef.current || !isClient) return

    const calculatePosition = () => {
      const button = buttonRef.current
      if (!button) return

      const rect = button.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const dropdownWidth = 256 // 16rem
      const dropdownHeight = 400 // estimated height
      const margin = 12 // Safe margin from viewport edges
      
      let left = rect.left
      let top = rect.bottom + 8 // 8px below button

      // Horizontal boundary check and adjustment
      if (left + dropdownWidth > viewportWidth - margin) {
        // If dropdown would overflow right, align to right edge of button
        left = rect.right - dropdownWidth
      }
      
      // Ensure we don't overflow left
      if (left < margin) {
        left = margin
      }

      // Vertical boundary check and adjustment
      if (top + dropdownHeight > viewportHeight - margin) {
        // Not enough space below, try positioning above
        const topPosition = rect.top - dropdownHeight - 8
        if (topPosition > margin) {
          top = topPosition
        } else {
          // Not enough space above either, keep below but constrain height
          top = rect.bottom + 8
        }
      }

      setDropdownPosition({ left, top })
    }

    // Initial calculation
    calculatePosition()
    
    // Recalculate on window events
    const handleResize = () => {
      calculatePosition()
    }
    
    const handleScroll = () => {
      calculatePosition()
    }
    
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true })
    
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleScroll, { capture: true })
    }
  }, [isOpen, isClient])

  // COEP FIX: Memoize avatar URL with cache busting and COEP-compatible proxy
  const avatarUrl = useMemo(() => {
    const currentAvatar = localAvatarUrl || session?.user?.avatar
    if (!currentAvatar) return null
    
    const proxiedUrl = getCompatibleFileUrl(currentAvatar)
    return `${proxiedUrl}?v=${avatarTimestamp}`
  }, [localAvatarUrl, session?.user?.avatar, avatarTimestamp])

  // Sync local state with session when session changes
  useEffect(() => {
    if (session?.user?.avatar && !localAvatarUrl) {
      setLocalAvatarUrl(session.user.avatar)
    }
    if (session?.user?.name && !localDisplayName) {
      setLocalDisplayName(session.user.name)
    }
  }, [session?.user?.avatar, session?.user?.name, localAvatarUrl, localDisplayName])

  const getInitials = (name: string | null | undefined) => {
    if (!name) return 'U'
    return name
      .split(' ')
      .map(word => word.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('')
  }

  // Compute display values prioritizing local state
  const displayName = localDisplayName || session?.user?.name || 'User'
  const displayInitials = getInitials(displayName)

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/auth/signin' })
  }

  const getThemeIcon = () => {
    switch (theme) {
      case 'light':
        return <Sun className="w-4 h-4" />
      case 'dark':
        return <Moon className="w-4 h-4" />
      default:
        return <Monitor className="w-4 h-4" />
    }
  }

  const getThemeLabel = () => {
    switch (theme) {
      case 'light':
        return 'Light mode'
      case 'dark':
        return 'Dark mode'
      default:
        return 'System theme'
    }
  }

  // Early return if no session
  if (!session?.user) {
    return null
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center w-10 h-10 bg-viber-surface-variant dark:bg-viber-surface-variant hover:bg-viber-surface-bright dark:hover:bg-viber-surface-bright rounded-full transition-colors"
        title="User settings"
        aria-label="User menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <div className="flex items-center justify-center">
          <ChevronDown className="w-4 h-4 text-viber-text-tertiary dark:text-viber-text-tertiary" />
        </div>
      </button>

{isOpen && isClient && createPortal(
        <div>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-[9998] bg-black/10" 
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
          
          {/* Dropdown with portal-based positioning */}
          <div 
            ref={dropdownRef}
            className="fixed bg-viber-surface dark:bg-viber-surface rounded-xl shadow-viber-lg border border-viber-border dark:border-viber-border z-[9999]" 
            style={{
              left: dropdownPosition.left,
              top: dropdownPosition.top,
              width: 'min(16rem, calc(100vw - 24px))',
              maxHeight: 'min(25rem, calc(100vh - 24px))',
              overflowY: 'auto'
            }}
          >
            {/* User info header */}
            <div className="px-4 py-3 border-b border-viber-border dark:border-viber-border">
              <div className="flex items-center space-x-3">
                {session.user.avatar ? (
                  <img
                    key={`avatar-dropdown-${avatarTimestamp}`}
                    src={avatarUrl || session.user.avatar}
                    alt={displayName}
                    className="w-10 h-10 rounded-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                      target.nextElementSibling?.classList.remove('hidden')
                    }}
                  />
                ) : null}
                <div className={`w-10 h-10 rounded-full bg-viber-primary flex items-center justify-center ${session.user.avatar ? 'hidden' : ''}`}>
                  <span className="text-viber-text-inverse text-sm font-medium">
                    {displayInitials}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-viber-text-primary dark:text-viber-text-primary truncate">
                    {displayName}
                  </p>
                  <p className="text-xs text-viber-text-secondary dark:text-viber-text-secondary truncate">
                    {session.user.email}
                  </p>
                </div>
              </div>
            </div>

            {/* Menu items */}
            <div className="py-2" role="menu" aria-orientation="vertical">
              {/* Appearance as dropdown menu */}
              <div className="px-4 py-2">
                <div className="relative">
                  <div className="flex items-center w-full px-3 py-2 text-sm rounded-lg text-viber-text-secondary dark:text-viber-text-secondary hover:bg-viber-surface-variant dark:hover:bg-viber-surface-variant">
                    {getThemeIcon()}
                    <span className="ml-3 flex-1">Appearance</span>
                    <span className="text-xs text-viber-text-tertiary dark:text-viber-text-tertiary">{getThemeLabel()}</span>
                  </div>
                  {/* Theme submenu can be expanded here later if needed */}
                </div>
              </div>

              <div className="border-t border-viber-border dark:border-viber-border my-2" />

              {/* Profile Settings */}
              <button
                onClick={() => {
                  setIsOpen(false)
                  router.push('/settings')
                }}
                className="flex items-center w-full px-4 py-2 text-sm text-viber-text-secondary dark:text-viber-text-secondary hover:bg-viber-surface-variant dark:hover:bg-viber-surface-variant transition-colors"
                role="menuitem"
              >
                <User className="w-4 h-4 mr-3" />
                Profile Settings
              </button>

              {/* Notifications */}
              <button
                onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                className="flex items-center w-full px-4 py-2 text-sm text-viber-text-secondary dark:text-viber-text-secondary hover:bg-viber-surface-variant dark:hover:bg-viber-surface-variant transition-colors"
                role="menuitem"
              >
                <div className="w-4 h-4 mr-3 flex items-center justify-center">
                  <span className="text-viber-primary">🔔</span>
                </div>
                <span className="flex-1">Notifications</span>
                <span className={`text-xs font-medium ${
                  notificationsEnabled 
                    ? 'text-viber-green' 
                    : 'text-viber-text-tertiary dark:text-viber-text-tertiary'
                }`}>
                  {notificationsEnabled ? 'ON' : 'OFF'}
                </span>
              </button>

              <div className="border-t border-viber-border dark:border-viber-border my-2" />
              
              {/* Sign out */}
              <button
                onClick={handleSignOut}
                className="flex items-center w-full px-4 py-2 text-sm text-viber-orange hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                role="menuitem"
              >
                <LogOut className="w-4 h-4 mr-3" />
                Sign out
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}