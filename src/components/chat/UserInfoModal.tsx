'use client'

import { useState, useEffect } from 'react'
import { X, MessageCircle, UserX, UserCheck, Search, Calendar, Clock, Image } from 'lucide-react'
import { MediaHistory } from './MediaHistory'

interface User {
  id: string
  username: string
  name: string | null
  avatar: string | null
  bio: string | null
  status: string
  lastSeen: Date
  isOnline: boolean
  createdAt: Date
}

interface UserInfoModalProps {
  isOpen: boolean
  onClose: () => void
  userId: string
  conversationId: string
  isBlocked?: boolean
  onBlockToggle?: () => void
  onSearchConversation?: () => void
  isBlockLoading?: boolean
}

export function UserInfoModal({
  isOpen,
  onClose,
  userId,
  conversationId,
  isBlocked = false,
  onBlockToggle,
  onSearchConversation,
  isBlockLoading = false,
}: UserInfoModalProps) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showMediaHistory, setShowMediaHistory] = useState(false)

  useEffect(() => {
    if (isOpen && userId) {
      fetchUserInfo()
    }
  }, [isOpen, userId])

  const fetchUserInfo = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch(`/api/users/${userId}`)
      if (!response.ok) {
        throw new Error('Failed to fetch user info')
      }
      
      const data = await response.json()
      setUser(data.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user info')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const formatLastSeen = (date: Date, isOnline: boolean) => {
    if (isOnline) return 'Online now'
    
    const now = new Date()
    const lastSeen = new Date(date)
    const diffInMinutes = Math.floor((now.getTime() - lastSeen.getTime()) / (1000 * 60))
    
    if (diffInMinutes < 1) return 'Just now'
    if (diffInMinutes < 60) return `${diffInMinutes} minutes ago`
    
    const diffInHours = Math.floor(diffInMinutes / 60)
    if (diffInHours < 24) return `${diffInHours} hours ago`
    
    const diffInDays = Math.floor(diffInHours / 24)
    if (diffInDays < 7) return `${diffInDays} days ago`
    
    return formatDate(lastSeen)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div 
          className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75 dark:bg-gray-900 dark:bg-opacity-75"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white dark:bg-gray-800 shadow-xl rounded-lg">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              User Information
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md p-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-red-600 dark:text-red-400">{error}</p>
              <button
                onClick={fetchUserInfo}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Retry
              </button>
            </div>
          ) : user ? (
            <div className="space-y-6">
              {/* Profile Section */}
              <div className="flex items-center space-x-4">
                <div className="relative">
                  {user.avatar ? (
                    <img
                      src={user.avatar}
                      alt={user.name || user.username}
                      className="w-16 h-16 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center">
                      <span className="text-white text-xl font-medium">
                        {(user.name || user.username).charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  {user.isOnline && (
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full" />
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <h4 className="text-xl font-semibold text-gray-900 dark:text-white truncate">
                    {user.name || user.username}
                  </h4>
                  <p className="text-gray-600 dark:text-gray-400">@{user.username}</p>
                  <div className="flex items-center mt-1">
                    <Clock className="w-4 h-4 text-gray-400 mr-1" />
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {formatLastSeen(user.lastSeen, user.isOnline)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Bio Section */}
              {user.bio && (
                <div>
                  <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Bio
                  </h5>
                  <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
                    {user.bio}
                  </p>
                </div>
              )}

              {/* Member Since */}
              <div>
                <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Member since
                </h5>
                <div className="flex items-center text-gray-600 dark:text-gray-400 text-sm">
                  <Calendar className="w-4 h-4 mr-2" />
                  {formatDate(user.createdAt)}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                {/* Media History Button */}
                <button
                  onClick={() => setShowMediaHistory(true)}
                  className="w-full flex items-center justify-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
                >
                  <Image className="w-4 h-4 mr-2" />
                  View Media History
                </button>

                <div className="flex space-x-3">
                  {/* Search Conversation */}
                  {onSearchConversation && (
                    <button
                      onClick={() => {
                        onSearchConversation()
                        onClose()
                      }}
                      className="flex-1 flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <Search className="w-4 h-4 mr-2" />
                      Search Messages
                    </button>
                  )}

                  {/* Block/Unblock */}
                  {onBlockToggle && (
                    <button
                      onClick={onBlockToggle}
                      disabled={isBlockLoading}
                      className={`flex-1 flex items-center justify-center px-4 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        isBlocked
                          ? 'bg-green-600 text-white hover:bg-green-700'
                          : 'bg-red-600 text-white hover:bg-red-700'
                      } ${isBlockLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {isBlockLoading ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                      ) : isBlocked ? (
                        <UserCheck className="w-4 h-4 mr-2" />
                      ) : (
                        <UserX className="w-4 h-4 mr-2" />
                      )}
                      {isBlocked ? 'Unblock' : 'Block'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Media History Modal */}
        <MediaHistory
          isOpen={showMediaHistory}
          onClose={() => setShowMediaHistory(false)}
          conversationId={conversationId}
          title="Shared Media"
        />
      </div>
    </div>
  )
}