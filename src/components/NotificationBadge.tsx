'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useNotifications } from '@/context/NotificationContext'
import { useSocketContext } from '@/context/SocketContext'
import { Volume2, VolumeX } from 'lucide-react'

export function NotificationBadge() {
  const { data: session } = useSession()
  const { socket, isFullyInitialized } = useSocketContext()
  const {
    playNotificationSound,
    soundEnabled,
    setSoundEnabled,
  } = useNotifications()


  // Listen for new notifications via socket
  useEffect(() => {
    if (!socket || !session?.user?.id || !isFullyInitialized) {
      console.log('NotificationBadge: Waiting for socket to be fully initialized', { socket: !!socket, session: !!session?.user?.id, isFullyInitialized })
      return
    }
    
    console.log('NotificationBadge: Setting up socket listeners')


    const handleNewNotification = (data: { userId: string; title: string; content: string; type: string; messageId?: string; conversationId?: string }) => {
      if (data.userId === session.user.id) {
        console.log('🔊 New notification received from multiple users scenario, playing sound...', data)
        // Play sound notification
        playNotificationSound()

        // Mark message as delivered when user receives notification (user is online)
        if (data.messageId) {
          fetch(`/api/messages/message/${data.messageId}/delivered`, {
            method: 'PATCH',
            credentials: 'include'
          }).catch(error => {
            console.error('Failed to mark message as delivered:', error)
          })
        }

        // Force trigger conversation list refresh for real-time sidebar updates
        // This ensures sidebar updates when receiving messages from multiple users
        if (data.conversationId && socket) {
          console.log('🔄 NotificationBadge: Triggering conversation refresh for real-time sidebar update')
          // Emit a custom event to trigger conversation refresh
          socket.emit('request-conversation-refresh', { userId: session.user.id })
        }
      }
    }


    socket.on('new-notification', handleNewNotification)

    return () => {
      socket.off('new-notification', handleNewNotification)
    }
  }, [socket, session?.user?.id, isFullyInitialized, playNotificationSound])

  if (!session?.user?.id) return null

  return (
    <div className="relative">
      {/* Sound Control Button - Only show sound toggle, no notification badge or history */}
      <button
        onClick={() => setSoundEnabled(!soundEnabled)}
        className="p-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
        title={soundEnabled ? 'Disable notification sounds' : 'Enable notification sounds'}
        aria-label={soundEnabled ? 'Disable notification sounds' : 'Enable notification sounds'}
      >
        {soundEnabled ? (
          <Volume2 className="w-6 h-6" />
        ) : (
          <VolumeX className="w-6 h-6" />
        )}
      </button>
    </div>
  )
}