'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Bell, BellOff, Check, CheckCheck, Trash2, Filter, X, Settings } from 'lucide-react'

interface Notification {
  id: string
  type: string
  title: string
  content: string
  isRead: boolean
  createdAt: string
}

interface NotificationCenterProps {
  onClose: () => void
}

export function NotificationCenter({ onClose }: NotificationCenterProps) {
  const { data: session } = useSession()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all')
  const [notificationSettings, setNotificationSettings] = useState({
    messages: true,
    mentions: true,
    reactions: true,
    groupUpdates: true,
    sounds: true,
  })

  useEffect(() => {
    fetchNotifications()
  }, [])

  const fetchNotifications = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/notifications')
      if (response.ok) {
        const data = await response.json()
        setNotifications(data.notifications)
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error)
    } finally {
      setLoading(false)
    }
  }

  const markAsRead = async (notificationId?: string) => {
    try {
      const url = notificationId 
        ? `/api/notifications/${notificationId}/read`
        : '/api/notifications/mark-all-read'
        
      const response = await fetch(url, { method: 'POST' })
      
      if (response.ok) {
        if (notificationId) {
          setNotifications(prev => prev.map(n => 
            n.id === notificationId ? { ...n, isRead: true } : n
          ))
        } else {
          setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
        }
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error)
    }
  }

  const deleteNotification = async (notificationId: string) => {
    try {
      const response = await fetch(`/api/notifications/${notificationId}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        setNotifications(prev => prev.filter(n => n.id !== notificationId))
      }
    } catch (error) {
      console.error('Failed to delete notification:', error)
    }
  }

  const clearAll = async () => {
    try {
      const response = await fetch('/api/notifications/clear', {
        method: 'POST'
      })
      
      if (response.ok) {
        setNotifications([])
      }
    } catch (error) {
      console.error('Failed to clear notifications:', error)
    }
  }

  const updateSettings = async (newSettings: typeof notificationSettings) => {
    try {
      const response = await fetch('/api/notifications/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      })
      
      if (response.ok) {
        setNotificationSettings(newSettings)
      }
    } catch (error) {
      console.error('Failed to update notification settings:', error)
    }
  }

  const filteredNotifications = notifications.filter(notification => {
    if (filter === 'unread') return !notification.isRead
    if (filter === 'read') return notification.isRead
    return true
  })

  const unreadCount = notifications.filter(n => !n.isRead).length

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))
    
    if (diffInHours < 1) {
      const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60))
      return diffInMinutes < 1 ? 'just now' : `${diffInMinutes}m ago`
    } else if (diffInHours < 24) {
      return `${diffInHours}h ago`
    } else {
      const diffInDays = Math.floor(diffInHours / 24)
      return `${diffInDays}d ago`
    }
  }

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'message':
        return '💬'
      case 'mention':
        return '📢'
      case 'reaction':
        return '❤️'
      case 'group':
        return '👥'
      default:
        return '📱'
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-auto">
      <div className="min-h-full flex items-start justify-center p-4 pt-16">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md max-w-[90vw] max-h-[calc(100vh-4rem)] overflow-hidden my-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <Bell className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Notifications
              {unreadCount > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs bg-blue-600 text-white rounded-full">
                  {unreadCount}
                </span>
              )}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters and Actions */}
        <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 space-y-2 sm:space-y-0">
            <div className="flex space-x-1 sm:space-x-2">
              {(['all', 'unread', 'read'] as const).map((filterOption) => (
                <button
                  key={filterOption}
                  onClick={() => setFilter(filterOption)}
                  className={`px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-md transition-colors flex-1 sm:flex-initial ${
                    filter === filterOption
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {filterOption.charAt(0).toUpperCase() + filterOption.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
            {unreadCount > 0 && (
              <button
                onClick={() => markAsRead()}
                className="flex items-center justify-center space-x-1 px-3 py-1.5 text-xs sm:text-sm bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-md hover:bg-green-200 dark:hover:bg-green-800 flex-1 sm:flex-initial"
              >
                <CheckCheck className="w-4 h-4" />
                <span className="hidden xs:inline sm:inline">Mark All Read</span>
                <span className="xs:hidden sm:hidden">Read All</span>
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={clearAll}
                className="flex items-center justify-center space-x-1 px-3 py-1.5 text-xs sm:text-sm bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded-md hover:bg-red-200 dark:hover:bg-red-800 flex-1 sm:flex-initial"
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden xs:inline sm:inline">Clear All</span>
                <span className="xs:hidden sm:hidden">Clear</span>
              </button>
            )}
          </div>
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto max-h-[min(60vh,24rem)] overscroll-contain">
          {loading ? (
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex space-x-3 animate-pulse">
                  <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="p-8 text-center">
              <BellOff className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400">
                {filter === 'all' 
                  ? 'No notifications yet' 
                  : `No ${filter} notifications`
                }
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`p-3 sm:p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                    !notification.isRead ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                  }`}
                >
                  <div className="flex space-x-3">
                    <div className="flex-shrink-0">
                      <span className="text-2xl">
                        {getNotificationIcon(notification.type)}
                      </span>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className={`text-sm font-medium ${
                          !notification.isRead 
                            ? 'text-gray-900 dark:text-white' 
                            : 'text-gray-600 dark:text-gray-400'
                        }`}>
                          {notification.title}
                        </p>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {formatTime(notification.createdAt)}
                        </span>
                      </div>
                      
                      <p className={`text-sm break-words ${
                        !notification.isRead 
                          ? 'text-gray-700 dark:text-gray-300' 
                          : 'text-gray-500 dark:text-gray-400'
                      }`}>
                        {notification.content}
                      </p>
                      
                      <div className="flex items-center space-x-1 sm:space-x-2 mt-2">
                        {!notification.isRead && (
                          <button
                            onClick={() => markAsRead(notification.id)}
                            className="flex items-center space-x-1 px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded"
                          >
                            <Check className="w-3 h-3" />
                            <span className="hidden xs:inline">Mark Read</span>
                            <span className="xs:hidden">Read</span>
                          </button>
                        )}
                        <button
                          onClick={() => deleteNotification(notification.id)}
                          className="flex items-center space-x-1 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 rounded"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span className="hidden xs:inline">Delete</span>
                          <span className="xs:hidden">Del</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Settings Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
          <details className="group">
            <summary className="flex items-center space-x-2 cursor-pointer text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
              <Settings className="w-4 h-4" />
              <span>Notification Settings</span>
              <span className="ml-auto group-open:rotate-180 transition-transform">▼</span>
            </summary>
            
            <div className="mt-3 space-y-2">
              {Object.entries(notificationSettings).map(([key, value]) => (
                <label key={key} className="flex items-center space-x-2 text-sm">
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) => updateSettings({
                      ...notificationSettings,
                      [key]: e.target.checked
                    })}
                    className="rounded focus:ring-blue-500"
                  />
                  <span className="text-gray-700 dark:text-gray-300 capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                </label>
              ))}
            </div>
          </details>
        </div>
        </div>
      </div>
    </div>
  )
}