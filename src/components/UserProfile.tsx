'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { Settings, LogOut, ChevronDown } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useSocketContext } from '@/context/SocketContext'

export function UserProfile() {
  const { data: session, update } = useSession()
  const { socket } = useSocketContext()
  const [isOpen, setIsOpen] = useState(false)
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
  
  // Memoize avatar URL with cache busting - prioritize local state for instant updates
  const avatarUrl = useMemo(() => {
    const currentAvatar = localAvatarUrl || session?.user?.avatar
    return currentAvatar ? `${currentAvatar}?v=${avatarTimestamp}` : null
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
        className="flex items-center space-x-2 p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
        aria-label="User menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {/* Avatar */}
        <div className="relative">
          {session.user.avatar ? (
            <img
              key={`avatar-main-${avatarTimestamp}`}
              src={avatarUrl || session.user.avatar}
              alt={displayName}
              className="w-8 h-8 rounded-full object-cover"
              onError={(e) => {
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                target.nextElementSibling?.classList.remove('hidden')
              }}
            />
          ) : null}
          <div className={`w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center ${session.user.avatar ? 'hidden' : ''}`}>
            <span className="text-white text-sm font-medium">
              {displayInitials}
            </span>
          </div>
          {/* Online indicator */}
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full" />
        </div>

        {/* Name and chevron - hidden on small screens */}
        <div className="hidden sm:flex items-center space-x-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate max-w-24">
            {displayName}
          </span>
          <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        </div>
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
          
          {/* Dropdown */}
          <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 z-20">
            {/* User info header */}
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
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
                <div className={`w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center ${session.user.avatar ? 'hidden' : ''}`}>
                  <span className="text-white text-sm font-medium">
                    {displayInitials}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {displayName}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {session.user.email}
                  </p>
                </div>
              </div>
            </div>

            {/* Menu items */}
            <div className="py-1" role="menu" aria-orientation="vertical">
              <button
                onClick={() => {
                  setIsOpen(false)
                  router.push('/settings')
                }}
                className="flex items-center w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                role="menuitem"
              >
                <Settings className="w-4 h-4 mr-3" />
                Settings
              </button>

              <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
              
              <button
                onClick={handleSignOut}
                className="flex items-center w-full px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                role="menuitem"
              >
                <LogOut className="w-4 h-4 mr-3" />
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}