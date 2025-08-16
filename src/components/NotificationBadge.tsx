'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useNotifications } from '@/context/NotificationContext'
import { useSocketContext } from '@/context/SocketContext'
import { Bell, BellOff, Volume2, VolumeX } from 'lucide-react'

interface Notification {
  id: string
  type: string
  title: string
  content: string
  isRead: boolean
  createdAt: string
}

export function NotificationBadge() {
  const { data: session } = useSession()
  const { socket, isFullyInitialized } = useSocketContext()
  const {
    permission,
    requestPermission,
    showNotification,
    playNotificationSound,
    notificationEnabled,
    soundEnabled,
    setSoundEnabled,
    setUnreadCount,
  } = useNotifications()

  const [showPanel, setShowPanel] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)

  // Use local state for unread count to ensure it's displayed properly
  const [localUnreadCount, setLocalUnreadCount] = useState(0)
  
  // Use local unread count for display, fallback to context count
  const totalUnread = localUnreadCount

  // Fetch initial unread count and notifications
  useEffect(() => {
    if (session?.user?.id) {
      fetchNotifications()
    }
  }, [session?.user?.id])

  // Initialize unread count from notifications API
  const initializeUnreadCount = async () => {
    try {
      const response = await fetch('/api/notifications')
      if (response.ok) {
        const data = await response.json()
        const count = data.totalUnread || 0
        console.log('Initialized unread count from API:', count)
        setLocalUnreadCount(count)
        setUnreadCount(count) // Also update context
        return count
      }
    } catch (error) {
      console.error('Error fetching unread count:', error)
    }
    return 0
  }

  useEffect(() => {
    if (session?.user?.id) {
      initializeUnreadCount()
    }
  }, [session?.user?.id])

  // Refresh unread count when socket becomes fully initialized
  useEffect(() => {
    if (isFullyInitialized && session?.user?.id) {
      console.log('NotificationBadge: Socket fully initialized, refreshing unread count')
      setTimeout(() => {
        initializeUnreadCount()
      }, 500)
    }
  }, [isFullyInitialized, session?.user?.id])

  // Listen for new notifications via socket
  useEffect(() => {
    if (!socket || !session?.user?.id || !isFullyInitialized) {
      console.log('NotificationBadge: Waiting for socket to be fully initialized', { socket: !!socket, session: !!session?.user?.id, isFullyInitialized })
      return
    }
    
    console.log('NotificationBadge: Setting up socket listeners')

    // Refresh unread count when socket reconnects
    const handleConnect = () => {
      console.log('NotificationBadge: Socket reconnected, refreshing unread count')
      setTimeout(() => {
        initializeUnreadCount()
      }, 1000)
    }

    socket.on('connect', handleConnect)

    const handleNewNotification = (data: { userId: string; title: string; content: string; type: string; messageId?: string }) => {
      if (data.userId === session.user.id) {
        // Show browser notification
        showNotification(data.title, {
          body: data.content,
          tag: data.messageId,
        })

        // Play sound
        playNotificationSound()

        // Add to local notifications list (messages badge is derived from conversations)
        setNotifications(prev => [
          {
            id: Date.now().toString(),
            type: data.type,
            title: data.title,
            content: data.content,
            isRead: false,
            createdAt: new Date().toISOString(),
          },
          ...prev
        ])

        // Increment unread count
        setLocalUnreadCount(prev => prev + 1)
        setUnreadCount(prev => prev + 1)
      }
    }

    const handleNotificationsUpdated = (data: { userId: string; totalUnread: number }) => {
      console.log('Notifications updated event received:', data)
      if (data.userId === session.user.id) {
        console.log('Updating unread count from', localUnreadCount, 'to:', data.totalUnread)
        // Update both local and context unread count
        setLocalUnreadCount(data.totalUnread)
        setUnreadCount(data.totalUnread)
        // Also refresh the notifications list
        fetchNotifications()
      }
    }

    // Additional handler for conversation-read events that affect notifications
    const handleConversationRead = (data: { userId: string; conversationId: string | null; updatedCount: number }) => {
      console.log('NotificationBadge: Conversation read event received:', data)
      if (data.userId === session.user.id) {
        console.log('NotificationBadge: Refreshing unread count due to conversation read')
        // Refresh the unread count when messages are marked as read
        initializeUnreadCount()
      }
    }

    socket.on('new-notification', handleNewNotification)
    socket.on('notifications-updated', handleNotificationsUpdated)
    socket.on('conversation-read', handleConversationRead)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('new-notification', handleNewNotification)
      socket.off('notifications-updated', handleNotificationsUpdated)
      socket.off('conversation-read', handleConversationRead)
    }
  }, [socket, session?.user?.id, isFullyInitialized, showNotification, playNotificationSound])

  const fetchNotifications = async () => {
    if (loading) return

    setLoading(true)
    try {
      const response = await fetch('/api/notifications')
      if (response.ok) {
        const data = await response.json()
        setNotifications(data.notifications)
      }
    } catch (error) {
      console.error('Error fetching notifications:', error)
    } finally {
      setLoading(false)
    }
  }

  const markAllAsRead = async () => {
    try {
      const response = await fetch('/api/notifications', {
        method: 'DELETE',
      })

      if (response.ok) {
        setNotifications(prev => 
          prev.map(notif => ({ ...notif, isRead: true }))
        )
        // Update unread count to 0
        setLocalUnreadCount(0)
        setUnreadCount(0)
      }
    } catch (error) {
      console.error('Error marking notifications as read:', error)
    }
  }

  const handleEnableNotifications = async () => {
    const result = await requestPermission()
    if (result === 'granted') {
      // Notification permission granted
    }
  }

  if (!session?.user?.id) return null

  return (
    <div className="relative">
      {/* Notification Bell Button */}
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="relative p-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="Notifications"
      >
        {notificationEnabled ? (
          <Bell className="w-6 h-6" />
        ) : (
          <BellOff className="w-6 h-6" />
        )}
        
        {totalUnread > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </button>

      {/* Notification Panel */}
      {showPanel && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setShowPanel(false)}
            aria-hidden="true"
          />
          
          {/* Panel */}
          <div className="fixed right-4 top-14 w-80 max-w-[min(90vw,20rem)] bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Notifications
              </h3>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  title={soundEnabled ? 'Disable sounds' : 'Enable sounds'}
                >
                  {soundEnabled ? (
                    <Volume2 className="w-4 h-4" />
                  ) : (
                    <VolumeX className="w-4 h-4" />
                  )}
                </button>
                {totalUnread > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    Mark all read
                  </button>
                )}
              </div>
            </div>

            {/* Enable Notifications Banner */}
            {permission !== 'granted' && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border-b border-gray-200 dark:border-gray-700">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Enable notifications to stay updated
                </p>
                <button
                  onClick={handleEnableNotifications}
                  className="mt-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                >
                  Enable Notifications
                </button>
              </div>
            )}

            {/* Notifications List */}
            <div className="max-h-[min(24rem,calc(100vh-10rem))] overflow-y-auto overscroll-contain">
              {loading ? (
                <div className="p-4 text-center">
                  <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin mx-auto"></div>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading...</p>
                </div>
              ) : notifications.length === 0 ? (
                <div className="p-4 text-center">
                  <Bell className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">No notifications yet</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-3 hover:bg-gray-50 dark:hover:bg-gray-700 ${
                        !notification.isRead ? 'bg-blue-50 dark:bg-blue-900/10' : ''
                      }`}
                    >
                      <div className="flex items-start space-x-3">
                        <div className={`w-2 h-2 rounded-full mt-2 ${
                          notification.isRead ? 'bg-gray-300' : 'bg-blue-500'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {notification.title}
                          </p>
                          <p className="text-sm text-gray-600 dark:text-gray-300 break-words line-clamp-2">
                            {notification.content}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {new Date(notification.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}