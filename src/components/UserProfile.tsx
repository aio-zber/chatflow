'use client'

import { useState, useMemo } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { Settings, LogOut, ChevronDown } from 'lucide-react'
import { useRouter } from 'next/navigation'

export function UserProfile() {
  const { data: session } = useSession()
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()
  
  // Memoize avatar URL with cache busting to avoid regenerating on every render
  const avatarUrl = useMemo(() => {
    return session?.user?.avatar ? `${session.user.avatar}?v=${Date.now()}` : null
  }, [session?.user?.avatar])

  if (!session?.user) {
    return null
  }

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/auth/signin' })
  }

  const getInitials = (name: string | null | undefined) => {
    if (!name) return 'U'
    return name
      .split(' ')
      .map(word => word.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('')
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
              src={avatarUrl!}
              alt={session.user.name || 'User'}
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
              {getInitials(session.user.name)}
            </span>
          </div>
          {/* Online indicator */}
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full" />
        </div>

        {/* Name and chevron - hidden on small screens */}
        <div className="hidden sm:flex items-center space-x-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate max-w-24">
            {session.user.name || 'User'}
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
                    src={avatarUrl!}
                    alt={session.user.name || 'User'}
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
                    {getInitials(session.user.name)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {session.user.name || 'User'}
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