'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useNotifications } from '@/context/NotificationContext'
import { useSocketContext } from '@/context/SocketContext'
import { useE2EE } from '@/hooks/useE2EE'

/**
 * Global notification listener that works across all pages
 * This component handles notification sounds and browser notifications
 * regardless of which page the user is on
 */
export function GlobalNotificationListener() {
  const { data: session } = useSession()
  const { socket, isFullyInitialized } = useSocketContext()
  const {
    playNotificationSound,
    soundEnabled,
    showNotification,
  } = useNotifications()
  const { decryptMessage, isAvailable } = useE2EE()

  // Listen for new notifications via socket globally
  useEffect(() => {
    console.log('🌐 GlobalNotificationListener: useEffect triggered', { 
      hasSocket: !!socket, 
      hasSession: !!session?.user?.id, 
      socketConnected: socket?.connected,
      socketId: socket?.id 
    })
    
    // Only need socket to be connected and user session, don't wait for conversation rooms
    if (!socket || !session?.user?.id || !socket.connected) {
      console.log('GlobalNotificationListener: Waiting for socket connection and user session', { 
        socket: !!socket, 
        session: !!session?.user?.id, 
        socketConnected: socket?.connected 
      })
      return
    }
    
    console.log('🚀 GlobalNotificationListener: Setting up global socket listeners for user:', session.user.id)
    
    // Ensure user has joined their room by re-emitting join-user-room
    // This is a safety measure in case the initial join failed or was missed
    socket.emit('join-user-room', session.user.id)
    console.log('🔄 GlobalNotificationListener: Re-emitted join-user-room for safety')

    const handleNewNotification = async (data: { 
      userId: string; 
      title: string; 
      content: string; 
      type: string; 
      messageId?: string; 
      conversationId?: string;
    }) => {
      console.log('📨 GlobalNotificationListener: Received new-notification event', { 
        dataUserId: data.userId, 
        sessionUserId: session.user.id, 
        isForCurrentUser: data.userId === session.user.id,
        data 
      })
      
      if (data.userId === session.user.id) {
        console.log('🔊 Global notification received for current user', data)
        
        // Decrypt message content if it's encrypted and E2EE is available
        let displayContent = data.content
        console.log('🔍 GlobalNotificationListener: Checking decryption conditions:', {
          messageId: data.messageId,
          contentIncludesEncrypted: data.content.includes('sent an encrypted message'),
          isAvailable,
          hasDecryptMessage: !!decryptMessage,
          conversationId: data.conversationId
        })
        
        // Try decryption if we have messageId and E2EE is available, regardless of notification content text
        if (data.messageId && isAvailable && decryptMessage && data.conversationId) {
          try {
            console.log('🔑 GlobalNotificationListener: Attempting to fetch and decrypt message:', data.messageId)
            // Try to fetch and decrypt the actual message content
            const response = await fetch(`/api/messages/message/${data.messageId}`)
            console.log('🌐 GlobalNotificationListener: API response status:', response.status)
            
            if (response.ok) {
              const messageData = await response.json()
              console.log('📧 GlobalNotificationListener: Message data:', messageData.message?.content?.substring(0, 20))
              
              // Check if message content is encrypted (starts with 🔐)
              if (messageData.message?.content?.startsWith('🔐')) {
                console.log('🔐 GlobalNotificationListener: Message is encrypted, attempting decryption')
                const encryptedData = messageData.message.content.substring(2) // Remove 🔐 prefix
                const decrypted = await decryptMessage(encryptedData, data.conversationId)
                console.log('🔓 GlobalNotificationListener: Decryption result:', decrypted ? 'SUCCESS' : 'FAILED')
                
                if (decrypted && decrypted.trim()) {
                  const senderName = messageData.message.sender?.name || messageData.message.sender?.username || 'Someone'
                  displayContent = `${senderName}: ${decrypted.substring(0, 100)}${decrypted.length > 100 ? '...' : ''}`
                  console.log('✅ GlobalNotificationListener: Updated notification content:', displayContent.substring(0, 50))
                }
              } else {
                console.log('❌ GlobalNotificationListener: Message is not encrypted or missing 🔐 prefix')
              }
            } else {
              console.log('❌ GlobalNotificationListener: API request failed:', response.statusText)
            }
          } catch (error) {
            console.warn('Failed to decrypt notification content, using fallback:', error)
            // Keep the original "sent an encrypted message" text as fallback
          }
        } else {
          console.log('⚠️ GlobalNotificationListener: Decryption conditions not met, using original content')
        }
        
        // Check if user is currently viewing the conversation that sent the notification
        const isViewingConversation = data.conversationId && 
          typeof window !== 'undefined' && 
          window.location.pathname.includes('/chat') &&
          window.location.search.includes(`conversation=${data.conversationId}`) &&
          document.hasFocus()

        console.log('🔍 GlobalNotificationListener: Notification context check:', {
          soundEnabled,
          isViewingConversation,
          currentPath: typeof window !== 'undefined' ? window.location.pathname : 'N/A',
          currentSearch: typeof window !== 'undefined' ? window.location.search : 'N/A',
          documentFocused: typeof document !== 'undefined' ? document.hasFocus() : 'N/A',
          conversationId: data.conversationId
        })

        // Only play sound and show notifications if:
        // 1. Notifications are enabled 
        // 2. User is NOT actively viewing this specific conversation
        if (soundEnabled && !isViewingConversation) {
          console.log('Playing notification sound (user not actively viewing this conversation)...')
          playNotificationSound()
          
          // Show browser notification with decrypted content
          showNotification(data.title, {
            body: displayContent,
            tag: 'new-message',
            icon: '/favicon.ico',
          })
        } else if (!soundEnabled) {
          console.log('Notifications disabled, skipping sound and browser notification...')
        } else if (isViewingConversation) {
          console.log('User is actively viewing this conversation, skipping notification sound/popup...')
        }

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
        if (data.conversationId && socket) {
          console.log('🔄 GlobalNotificationListener: Triggering conversation refresh')
          socket.emit('request-conversation-refresh', { userId: session.user.id })
        }
      }
    }

    socket.on('new-notification', handleNewNotification)
    console.log('✅ GlobalNotificationListener: Socket listener registered for new-notification events')

    return () => {
      console.log('🧹 GlobalNotificationListener: Cleaning up socket listener for new-notification')
      socket.off('new-notification', handleNewNotification)
    }
  }, [socket, socket?.connected, session?.user?.id, playNotificationSound, soundEnabled, showNotification, decryptMessage, isAvailable])

  // This component doesn't render anything
  return null
}