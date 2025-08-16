'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, X, Users, MessageCircle, Check, Plus, Loader2 } from 'lucide-react'
import { useConversations } from '@/hooks/useConversations'
import { UserPresenceIndicator } from '@/components/UserPresenceIndicator'

interface User {
  id: string
  username: string
  name: string | null
  avatar: string | null
  isOnline: boolean
  lastSeen: Date
}

interface UserSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  onConversationCreated?: (conversationId: string) => void
}

export function UserSelectionModal({ isOpen, onClose, onConversationCreated }: UserSelectionModalProps) {
  
  const { createConversation, createGroupConversation } = useConversations()
  
  const [mode, setMode] = useState<'direct' | 'group'>('direct')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<User[]>([])
  const [selectedUsers, setSelectedUsers] = useState<User[]>([])
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Debounced search
  const debouncedSearch = useCallback(
    debounce(async (query: string) => {
      if (!query.trim()) {
        setSearchResults([])
        return
      }

      setIsSearching(true)
      setError(null)

      try {
        const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}&limit=20`)
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Network error' }))
          throw new Error(errorData.error || 'Failed to search users')
        }
        
        const data = await response.json()
        setSearchResults(data.users || [])
      } catch (err) {
        console.error('User search error:', err)
        const errorMessage = err instanceof Error ? err.message : 'Failed to search users. Please try again.'
        setError(errorMessage)
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300),
    []
  )

  useEffect(() => {
    if (searchQuery) {
      debouncedSearch(searchQuery)
    } else {
      setSearchResults([])
    }
  }, [searchQuery, debouncedSearch])

  const handleUserSelect = (user: User) => {
    if (mode === 'direct') {
      // Start direct conversation immediately
      handleDirectChat(user)
    } else {
      // Add/remove from group selection
      setSelectedUsers(prev => {
        const isSelected = prev.some(u => u.id === user.id)
        if (isSelected) {
          return prev.filter(u => u.id !== user.id)
        } else {
          return [...prev, user]
        }
      })
    }
  }

  const handleDirectChat = async (user: User) => {
    setIsCreating(true)
    setError(null)

    try {
      const conversation = await createConversation(user.id)
      
      if (conversation) {
        onConversationCreated?.(conversation.id)
        resetAndClose()
      } else {
        setError('Failed to create conversation. Please try again.')
      }
    } catch (err) {
      console.error('Direct chat creation error:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to create conversation. Please try again.'
      setError(errorMessage)
    } finally {
      setIsCreating(false)
    }
  }

  const handleGroupCreate = async () => {
    if (!groupName.trim()) {
      setError('Group name is required')
      return
    }

    if (selectedUsers.length === 0) {
      setError('Please select at least one member')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      const userIds = selectedUsers.map(user => user.id)
      const conversation = await createGroupConversation(
        userIds,
        groupName.trim(),
        groupDescription.trim() || undefined
      )

      if (conversation) {
        onConversationCreated?.(conversation.id)
        resetAndClose()
      } else {
        setError('Failed to create group. Please try again.')
      }
    } catch (err) {
      console.error('Group creation error:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to create group. Please try again.'
      setError(errorMessage)
    } finally {
      setIsCreating(false)
    }
  }

  const resetAndClose = () => {
    setSearchQuery('')
    setSearchResults([])
    setSelectedUsers([])
    setGroupName('')
    setGroupDescription('')
    setError(null)
    setMode('direct')
    onClose()
  }

  const formatLastSeen = (lastSeen: Date | string) => {
    const date = new Date(lastSeen)
    const now = new Date()
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60))
    
    if (diffInMinutes < 1) return 'Just now'
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`
    
    const diffInHours = Math.floor(diffInMinutes / 60)
    if (diffInHours < 24) return `${diffInHours}h ago`
    
    const diffInDays = Math.floor(diffInHours / 24)
    return `${diffInDays}d ago`
  }

  const getUserAvatar = (user: User) => {
    if (user.avatar) {
      return (
        <img
          src={user.avatar}
          alt={user.name || user.username}
          className="w-10 h-10 rounded-full object-cover"
        />
      )
    }
    
    const displayName = user.name || user.username || 'U'
    return (
      <div className="w-10 h-10 bg-gray-500 rounded-full flex items-center justify-center">
        <span className="text-white text-sm font-medium">
          {displayName.charAt(0).toUpperCase()}
        </span>
      </div>
    )
  }

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              {mode === 'direct' ? 'Start New Chat' : 'Create Group'}
            </h2>
            <button
              onClick={resetAndClose}
              className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Mode Toggle */}
          <div className="flex items-center space-x-1 bg-gray-100 dark:bg-gray-700 rounded-md p-1">
            <button
              onClick={() => setMode('direct')}
              className={`flex items-center space-x-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
                mode === 'direct'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <MessageCircle className="w-4 h-4" />
              <span>Direct Chat</span>
            </button>
            <button
              onClick={() => setMode('group')}
              className={`flex items-center space-x-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
                mode === 'group'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Group</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {mode === 'group' && (
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Group Name *
                  </label>
                  <input
                    type="text"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="Enter group name"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                    maxLength={50}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Description (optional)
                  </label>
                  <textarea
                    value={groupDescription}
                    onChange={(e) => setGroupDescription(e.target.value)}
                    placeholder="Describe what this group is about"
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 resize-none"
                    maxLength={200}
                  />
                </div>

                {/* Selected Members */}
                {selectedUsers.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Selected Members ({selectedUsers.length})
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {selectedUsers.map((user) => (
                        <span
                          key={user.id}
                          className="inline-flex items-center space-x-1 px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm"
                        >
                          <span>{user.name || user.username}</span>
                          <button
                            onClick={() => setSelectedUsers(prev => prev.filter(u => u.id !== user.id))}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Search Section */}
          <div className="p-6 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder={mode === 'direct' ? 'Search for users to chat with...' : 'Search for users to add...'}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                </div>
              )}
            </div>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto px-6">
            {error && (
              <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-200 dark:border-red-800 rounded-md">
                <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
              </div>
            )}

            {!searchQuery && !isSearching && (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Start typing to search for users</p>
              </div>
            )}

            {searchQuery && !isSearching && searchResults.length === 0 && (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p>No users found matching "{searchQuery}"</p>
                <p className="text-xs mt-1">Try a different search term</p>
              </div>
            )}

            {isSearching && (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin" />
                <p className="text-sm">Searching users...</p>
              </div>
            )}

            <div className="space-y-2 pb-6">
              {searchResults.map((user) => {
                const isSelected = selectedUsers.some(u => u.id === user.id)
                return (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-md transition-colors"
                  >
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <div className="relative flex-shrink-0">
                        {getUserAvatar(user)}
                        <div className="absolute bottom-0 right-0">
                          <UserPresenceIndicator 
                            userId={user.id}
                            userIsOnline={user.isOnline}
                            userLastSeen={user.lastSeen}
                            size="md"
                          />
                        </div>
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {user.name || user.username}
                          </h3>
                          {user.name && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              @{user.username}
                            </span>
                          )}
                        </div>
                        <UserPresenceIndicator 
                          userId={user.id}
                          userIsOnline={user.isOnline}
                          userLastSeen={user.lastSeen}
                          showText={true}
                          size="sm"
                          className="text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex-shrink-0 ml-3">
                      {mode === 'direct' ? (
                        <button
                          onClick={() => handleUserSelect(user)}
                          disabled={isCreating}
                          className="flex items-center space-x-1 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isCreating ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <MessageCircle className="w-4 h-4" />
                              <span>Chat</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleUserSelect(user)}
                          className={`p-2 rounded-md transition-colors ${
                            isSelected
                              ? 'bg-green-600 text-white'
                              : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                          }`}
                        >
                          {isSelected ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Group Creation Footer */}
          {mode === 'group' && (
            <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
              <button
                onClick={handleGroupCreate}
                disabled={isCreating || !groupName.trim() || selectedUsers.length === 0}
                className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Users className="w-4 h-4" />
                    <span>Create Group</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Utility function for debouncing
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}