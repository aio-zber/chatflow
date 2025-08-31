'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { Settings, LogOut, ChevronDown, Sun, Moon, Monitor } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useSocketContext } from '@/context/SocketContext'
import { useTheme } from '@/context/ThemeContext'
import { getCompatibleFileUrl } from '@/utils/fileProxy'

export function UserProfile() {
  const { data: session, update } = useSession()
  const { socket } = useSocketContext()
  const { theme, setTheme } = useTheme()
  const [isOpen, setIsOpen] = useState(false)
  const [showAppearanceSubmenu, setShowAppearanceSubmenu] = useState(false)
  const [avatarTimestamp, setAvatarTimestamp] = useState(Date.now())
  const [localAvatarUrl, setLocalAvatarUrl] = useState<string | null>(null)
  const [localDisplayName, setLocalDisplayName] = useState<string | null>(null)
  const router = useRouter()

  // Use refs to prevent callback recreation
  const sessionRef = useRef(session)
  const updateRef = useRef(update)

  // Update refs when session or update changes
  useEffect(() => {
    sessionRef.current = session
    updateRef.current = update
  }, [session, update])

  // Stable callback for handling profile updates - NO dependencies to prevent recreation
  const handleUserProfileUpdated = useCallback(async (data: { userId: string; avatar?: string; name?: string; username?: string }) => {
    console.log('UserProfile: Received profile update event:', data)
    console.log('UserProfile: Current session user ID:', sessionRef.current?.user?.id)
    
    const currentSession = sessionRef.current
    const updateFunction = updateRef.current
    
    if (!currentSession?.user?.id) {
      console.log('UserProfile: No current session available')
      return
    }
    
    if (data.userId === currentSession.user.id) {
      console.log('UserProfile: Profile update is for current user, updating local state immediately')
      
      try {
        // Update local state immediately for instant UI feedback - this is the primary mechanism
        if (data.avatar !== undefined) {
          setLocalAvatarUrl(data.avatar)
          console.log('UserProfile: Local avatar URL updated immediately to:', data.avatar)
        }
        
        // Update name in local state if available
        if (data.name !== undefined) {
          setLocalDisplayName(data.name)
          console.log('UserProfile: Local display name updated immediately to:', data.name)
        }
        
        // Update timestamp for cache busting
        setAvatarTimestamp(Date.now())
        console.log('UserProfile: Avatar timestamp updated immediately')
        
        // Force a session refresh to get the latest data from the server
        console.log('UserProfile: Refreshing session to get latest data')
        try {
          const refreshedSession = await updateFunction()
          console.log('UserProfile: Session refresh completed, new session:', refreshedSession?.user)
          
          // Update local state with refreshed session data to ensure consistency
          if (refreshedSession?.user?.avatar) {
            setLocalAvatarUrl(refreshedSession.user.avatar)
          }
          if (refreshedSession?.user?.name) {
            setLocalDisplayName(refreshedSession.user.name)
          }
        } catch (refreshError) {
          console.error('UserProfile: Session refresh failed:', refreshError)
        }
      } catch (error) {
        console.error('UserProfile: Error refreshing session:', error)
      }
    } else {
      console.log('UserProfile: Profile update is for different user:', data.userId, 'vs', currentSession.user.id)
    }
  }, []) // EMPTY dependencies - callback is stable

  // Listen for profile updates via socket - ONLY depend on socket to prevent churn
  useEffect(() => {
    if (!socket) {
      console.log('UserProfile: Socket not available')
      return
    }

    console.log('UserProfile: Setting up socket listener for profile updates')
    socket.on('user-profile-updated', handleUserProfileUpdated)
    console.log('UserProfile: Socket listener registered')

    return () => {
      console.log('UserProfile: Cleaning up socket listener')
      socket.off('user-profile-updated', handleUserProfileUpdated)
    }
  }, [socket]) // ONLY socket dependency - prevents constant recreation
  
  // Listen for custom profile update events as a backup mechanism
  useEffect(() => {
    const handleProfileUpdated = (event: CustomEvent) => {
      console.log('UserProfile: Received custom profile update event:', event.detail)
      
      if (event.detail.userId === session?.user?.id) {
        console.log('UserProfile: Custom profile update is for current user')
        
        const userData = event.detail.userData
        if (userData.avatar !== undefined) {
          setLocalAvatarUrl(userData.avatar)
          setAvatarTimestamp(Date.now())
        }
        if (userData.name !== undefined) {
          setLocalDisplayName(userData.name)
        }
      }
    }

    window.addEventListener('profileUpdated', handleProfileUpdated as EventListener)
    
    return () => {
      window.removeEventListener('profileUpdated', handleProfileUpdated as EventListener)
    }
  }, [session?.user?.id])
  
  // COEP FIX: Memoize avatar URL with cache busting and COEP-compatible proxy
  const avatarUrl = useMemo(() => {
    const currentAvatar = localAvatarUrl || session?.user?.avatar
    if (!currentAvatar) return null
    
    // Apply proxy for COEP compatibility, then add cache busting
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

  // Early return if no session
  if (!session?.user) {
    return null
  }

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/auth/signin' })
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 p-1 rounded-lg hover:bg-viber-surface-variant dark:hover:bg-viber-surface-bright focus:outline-none focus:ring-2 focus:ring-viber-primary transition-all duration-200"
        aria-label="User menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {/* User icon (simplified) */}
        <div className="w-8 h-8 bg-viber-text-secondary dark:bg-viber-text-secondary rounded-full flex items-center justify-center">
          <svg className="w-5 h-5 text-viber-text-inverse" fill="currentColor" viewBox="0 0 24 24">
            <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
          </svg>
        </div>

        {/* Chevron down */}
        <ChevronDown className="w-4 h-4 text-viber-text-secondary dark:text-viber-text-secondary" />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => {
              setIsOpen(false)
              setShowAppearanceSubmenu(false)
            }}
            aria-hidden="true"
          />
          
          {/* Dropdown */}
          <div className="absolute left-0 mt-2 w-72 bg-viber-surface dark:bg-viber-surface rounded-2xl shadow-viber-lg border border-viber-border dark:border-viber-border z-20">
            {/* User info header */}
            <div className="px-4 py-4 border-b border-viber-border dark:border-viber-border">
              <div className="flex items-center space-x-3">
                {session.user.avatar ? (
                  <img
                    key={`avatar-dropdown-${avatarTimestamp}`}
                    src={avatarUrl || session.user.avatar}
                    alt={displayName}
                    className="w-12 h-12 rounded-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                      target.nextElementSibling?.classList.remove('hidden')
                    }}
                  />
                ) : null}
                <div className={`w-12 h-12 rounded-full bg-viber-primary flex items-center justify-center ${session.user.avatar ? 'hidden' : ''}`}>
                  <span className="text-viber-text-inverse text-base font-medium">
                    {displayInitials}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-viber-text-primary dark:text-viber-text-primary truncate">
                    {displayName}
                  </p>
                  <p className="text-sm text-viber-text-secondary dark:text-viber-text-secondary truncate">
                    @{session.user.username || session.user.email}
                  </p>
                </div>
              </div>
            </div>

            {/* Menu items */}
            <div className="py-2" role="menu" aria-orientation="vertical">
              {/* Appearance with theme options */}
              <div className="relative">
                <button
                  onClick={() => setShowAppearanceSubmenu(!showAppearanceSubmenu)}
                  className="flex items-center justify-between w-full px-4 py-3 text-sm text-viber-text-primary dark:text-viber-text-primary hover:bg-viber-surface-variant dark:hover:bg-viber-surface-bright transition-colors"
                  role="menuitem"
                >
                  <div className="flex items-center">
                    {theme === 'light' ? (
                      <Sun className="w-5 h-5 mr-3 text-viber-text-secondary" />
                    ) : theme === 'dark' ? (
                      <Moon className="w-5 h-5 mr-3 text-viber-text-secondary" />
                    ) : (
                      <Monitor className="w-5 h-5 mr-3 text-viber-text-secondary" />
                    )}
                    Appearance
                  </div>
                  <ChevronDown className={`w-4 h-4 text-viber-text-secondary transition-transform ${showAppearanceSubmenu ? 'rotate-0' : '-rotate-90'}`} />
                </button>
                
                {/* Theme submenu */}
                {showAppearanceSubmenu && (
                  <div className="bg-viber-surface-variant dark:bg-viber-surface-variant ml-4 mr-2 my-1 rounded-xl">
                    {[
                      { value: 'light' as const, label: 'Light', icon: Sun },
                      { value: 'dark' as const, label: 'Dark', icon: Moon },
                      { value: 'system' as const, label: 'System', icon: Monitor }
                    ].map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => {
                          setTheme(value)
                          setShowAppearanceSubmenu(false)
                        }}
                        className={`
                          flex items-center justify-between w-full px-4 py-2 text-sm hover:bg-viber-surface-bright dark:hover:bg-viber-surface-bright transition-colors first:rounded-t-xl last:rounded-b-xl
                          ${theme === value ? 'text-viber-primary bg-viber-accent dark:bg-viber-accent' : 'text-viber-text-primary dark:text-viber-text-primary'}
                        `}
                        role="menuitem"
                      >
                        <div className="flex items-center">
                          <Icon className="w-4 h-4 mr-3" />
                          {label}
                        </div>
                        {theme === value && (
                          <div className="w-2 h-2 bg-viber-primary rounded-full" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  setIsOpen(false)
                  setShowAppearanceSubmenu(false)
                  router.push('/profile')
                }}
                className="flex items-center w-full px-4 py-3 text-sm text-viber-text-primary dark:text-viber-text-primary hover:bg-viber-surface-variant dark:hover:bg-viber-surface-bright transition-colors"
                role="menuitem"
              >
                <Settings className="w-5 h-5 mr-3 text-viber-text-secondary" />
                Profile Settings
              </button>

              {/* Notifications with indicator */}
              <button
                className="flex items-center justify-between w-full px-4 py-3 text-sm text-viber-text-primary dark:text-viber-text-primary hover:bg-viber-surface-variant dark:hover:bg-viber-surface-bright transition-colors"
                role="menuitem"
              >
                <div className="flex items-center">
                  <svg className="w-5 h-5 mr-3 text-viber-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-5-5-5 5h5z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 12v7a2 2 0 01-2 2H7a2 2 0 01-2-2v-7" />
                  </svg>
                  Notifications
                </div>
                <div className="w-2 h-2 bg-viber-primary rounded-full"></div>
              </button>

              <div className="border-t border-viber-border dark:border-viber-border my-1" />
              
              <button
                onClick={() => {
                  setIsOpen(false)
                  setShowAppearanceSubmenu(false)
                  handleSignOut()
                }}
                className="flex items-center w-full px-4 py-3 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                role="menuitem"
              >
                <LogOut className="w-5 h-5 mr-3" />
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}