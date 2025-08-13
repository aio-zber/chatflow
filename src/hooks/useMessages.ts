'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useSocketContext } from '@/context/SocketContext'

interface MessageAttachment {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  fileUrl: string
  duration?: number
}

interface MessageReaction {
  id: string
  emoji: string
  userId: string
  user: {
    id: string
    username: string
  }
}

interface Message {
  id: string
  content: string
  type: string
  status: string
  senderId: string
  conversationId: string | null
  channelId: string | null
  replyToId: string | null
  createdAt: Date
  updatedAt: Date
  sender: {
    id: string
    username: string
    name: string | null
    avatar: string | null
  }
  replyTo?: {
    id: string
    content: string
    sender: {
      id: string
      username: string
      name: string | null
    }
  }
  reactions: MessageReaction[]
  attachments: MessageAttachment[]
}

interface SendMessageData {
  content: string
  type?: string
  conversationId?: string
  channelId?: string
  replyToId?: string
  attachments?: Array<{
    fileName: string
    fileSize: number
    fileType: string
    fileUrl: string
    duration?: number
  }>
}

export const useMessages = (conversationId: string | null) => {
  const { data: session } = useSession()
  const { socket } = useSocketContext()
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  const fetchMessages = useCallback(async (cursor?: string) => {
    if (!conversationId || !session?.user?.id) return

    try {
      setLoading(true)
      const url = new URL(`/api/messages/${conversationId}`, window.location.origin)
      if (cursor) url.searchParams.set('cursor', cursor)

      const response = await fetch(url.toString())
      
      if (!response.ok) {
        throw new Error('Failed to fetch messages')
      }

      const data = await response.json()
      
      if (cursor) {
        setMessages(prev => [...data.messages, ...prev])
      } else {
        setMessages(data.messages || [])
      }
      
      setNextCursor(data.nextCursor)
      setHasMore(!!data.nextCursor)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch messages')
    } finally {
      setLoading(false)
    }
  }, [conversationId, session?.user?.id])

  const sendMessage = useCallback(async (messageData: SendMessageData) => {
    if (!session?.user?.id) return null

    const tempId = `temp-${Date.now()}`
    const tempMessage: Message = {
      id: tempId,
      content: messageData.content,
      type: messageData.type || 'text',
      status: 'sending',
      senderId: session.user.id,
      conversationId: messageData.conversationId || null,
      channelId: messageData.channelId || null,
      replyToId: messageData.replyToId || null,
      createdAt: new Date(),
      updatedAt: new Date(),
      sender: {
        id: session.user.id,
        username: session.user.username || '',
        name: session.user.name || null,
        avatar: session.user.avatar || null,
      },
      reactions: [],
      attachments: [],
    }

    setMessages(prev => [...prev, tempMessage])

    try {
      const response = await fetch('/api/messages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messageData),
      })

      if (!response.ok) {
        throw new Error('Failed to send message')
      }

      const data = await response.json()
      const sentMessage = data.message

      setMessages(prev => 
        prev.map(msg => 
          msg.id === tempId 
            ? { ...sentMessage, status: 'sent' }
            : msg
        )
      )

      return sentMessage
    } catch (err) {
      setMessages(prev => 
        prev.map(msg => 
          msg.id === tempId 
            ? { ...msg, status: 'failed' }
            : msg
        )
      )
      setError(err instanceof Error ? err.message : 'Failed to send message')
      return null
    }
  }, [session?.user])

  const loadMore = useCallback(async () => {
    if (nextCursor && !loading) {
      await fetchMessages(nextCursor)
    }
  }, [nextCursor, loading, fetchMessages])

  // React to a message: only one reaction per user. If a different emoji is selected,
  // replace the previous reaction. If same emoji is selected, remove it (toggle off).
  const reactToMessage = useCallback(async (messageId: string, emoji: string) => {
    if (!session?.user?.id) return

    const currentMessage = messages.find(m => m.id === messageId)
    if (!currentMessage) return
    
    const existingForUser = currentMessage.reactions?.find(r => r.userId === session.user!.id) || null

    // Optimistic update
    setMessages(prev => prev.map(msg => {
      if (msg.id !== messageId) return msg
      if (!msg.reactions) return msg
      
      const userIdx = msg.reactions.findIndex(r => r.userId === session!.user!.id)
      const hasExisting = userIdx !== -1
      const isSameEmoji = hasExisting && msg.reactions[userIdx].emoji === emoji

      if (isSameEmoji) {
        // Remove existing reaction
        return {
          ...msg,
          reactions: msg.reactions.filter((_, i) => i !== userIdx)
        }
      }

      // Replace or add new reaction
      const reactionsWithoutUser = hasExisting
        ? msg.reactions.filter((_, i) => i !== userIdx)
        : msg.reactions

      const newReaction: MessageReaction = {
        id: `temp-${messageId}-${session!.user!.id}-${Date.now()}`,
        emoji,
        userId: session!.user!.id,
        user: {
          id: session!.user!.id,
          username: session!.user!.username || session!.user!.name || 'You'
        }
      }

      return {
        ...msg,
        reactions: [...reactionsWithoutUser, newReaction]
      }
    }))

    try {
      // Decide server calls based on initial state
      if (existingForUser && existingForUser.emoji === emoji) {
        // Toggle off
        await fetch('/api/messages/reactions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, emoji })
        })
      } else {
        // Replace existing with new emoji
        if (existingForUser) {
          await fetch('/api/messages/reactions', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId, emoji: existingForUser.emoji })
          })
        }
        await fetch('/api/messages/reactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, emoji })
        })
      }
    } catch (error) {
      console.error('Error updating reaction:', error)
      // Re-sync from server on error
      fetchMessages()
    }
  }, [messages, session?.user?.id, fetchMessages])

  const markMessagesAsRead = useCallback(async (messageIds: string[]) => {
    if (!conversationId || messageIds.length === 0) return

    try {
      await fetch('/api/messages/read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messageIds,
          conversationId,
        }),
      })
    } catch (error) {
      console.error('Error marking messages as read:', error)
    }
  }, [conversationId])

  useEffect(() => {
    if (conversationId) {
      setMessages([])
      setNextCursor(null)
      setHasMore(false)
      fetchMessages()
    }
  }, [conversationId, fetchMessages])

  // Ensure we're in the current conversation room (in case auto-join missed it or for new conversations)
  useEffect(() => {
    if (!socket || !conversationId) return

    const ensureRoomConnection = () => {
      console.log(`Ensuring room connection for conversation: ${conversationId}`)
      socket.emit('join-room', conversationId)
    }

    if (socket.connected) {
      ensureRoomConnection()
    } else {
      const handleConnect = () => {
        console.log('Socket connected, ensuring room connection...')
        ensureRoomConnection()
      }
      
      socket.on('connect', handleConnect)
      
      return () => {
        socket.off('connect', handleConnect)
      }
    }
  }, [socket, conversationId])

  // Global socket listeners for message updates/deletes 
  useEffect(() => {
    if (!socket) {
      console.log('useMessages: No socket available for global listeners')
      return
    }

    console.log('useMessages: Setting up GLOBAL socket listeners for message updates/deletes')

    const handleMessageUpdated = (updatedMessage: any) => {
      console.log('useMessages: GLOBAL Received message-updated socket event:', updatedMessage.id, updatedMessage)
      
      // Update messages regardless of current conversation - let the state update handle filtering
      setMessages(prev => {
        // Check if the message exists in the current messages
        const messageExists = prev.some(msg => msg.id === updatedMessage.id)
        if (messageExists) {
          console.log('useMessages: Message found in current conversation, updating')
          const updated = prev.map(msg => {
            if (msg.id === updatedMessage.id) {
              console.log('useMessages: Updating message:', msg.id, 'from:', msg.content, 'to:', updatedMessage.content)
              return { ...msg, ...updatedMessage }
            }
            return msg
          })
          return updated
        } else {
          console.log('useMessages: Message not found in current messages, ignoring')
          return prev
        }
      })
    }

    const handleMessageDeleted = (data: any) => {
      console.log('useMessages: GLOBAL Received message-deleted socket event:', data.messageId, data)
      
      // Update messages regardless of current conversation - let the state update handle filtering
      setMessages(prev => {
        const messageExists = prev.some(msg => msg.id === data.messageId)
        if (messageExists) {
          console.log('useMessages: Message found in current conversation, deleting')
          const filtered = prev.filter(msg => msg.id !== data.messageId)
          console.log('useMessages: Messages after deletion:', filtered.length)
          return filtered
        } else {
          console.log('useMessages: Message not found in current messages, ignoring')
          return prev
        }
      })
    }

    socket.on('message-updated', handleMessageUpdated)
    socket.on('message-deleted', handleMessageDeleted)
    console.log('useMessages: GLOBAL socket listeners registered')

    return () => {
      console.log('useMessages: Cleaning up GLOBAL socket listeners')
      socket.off('message-updated', handleMessageUpdated)
      socket.off('message-deleted', handleMessageDeleted)
    }
  }, [socket]) // Only depend on socket

  // Socket event listeners effect for conversation-specific events
  useEffect(() => {
    if (!socket) {
      console.log('useMessages: Socket not available')
      return
    }

    if (!conversationId) {
      console.log('useMessages: No conversation ID available')
      return
    }

    console.log('useMessages: Setting up Socket.IO event listeners for conversation:', conversationId)
    console.log('useMessages: Socket connected:', socket.connected)
    console.log('useMessages: Socket ID:', socket.id)

    const handleNewMessage = (message: Message) => {
      console.log('Received new message via Socket.IO:', message)
      if (message.conversationId === conversationId) {
        // Skip messages sent by current user (they're already added locally)
        if (message.senderId === session?.user?.id) {
          console.log('Skipping own message received via Socket.IO:', message.id)
          return
        }
        
        setMessages(prev => {
          console.log('Current messages count before new message:', prev.length)
          
          // Check if message already exists by ID
          const exists = prev.some(m => m.id === message.id)
          
          if (exists) {
            console.log('Message already exists, skipping:', message.id)
            return prev
          }
          
          console.log('Adding new message to conversation:', message.id)
          const newMessages = [...prev, message]
          console.log('New messages count after adding:', newMessages.length)
          return newMessages
        })
      } else {
        console.log('Message not for current conversation:', message.conversationId, 'vs', conversationId)
      }
    }

    // Removed handleMessageUpdate - now handled by window events

    const handleReactionUpdate = (data: { messageId: string; reactions: any[] }) => {
      console.log('Reaction updated via Socket.IO:', data.messageId)
      setMessages(prev => prev.map(msg => {
        if (msg.id !== data.messageId) return msg

        // Normalize incoming payload into per-user reactions
        // Supports either aggregated format [{ emoji, users: [...] }] or per-user format
        const reactionsPayload = Array.isArray(data.reactions) ? data.reactions : []
        let normalized: MessageReaction[] = []

        if (reactionsPayload[0] && Array.isArray(reactionsPayload[0].users)) {
          // Aggregated: flatten to per-user entries
          reactionsPayload.forEach((r: any) => {
            (r.users || []).forEach((u: any) => {
              normalized.push({
                id: `${data.messageId}-${u.id}-${r.emoji}`,
                emoji: r.emoji,
                userId: u.id,
                user: {
                  id: u.id,
                  username: u.username || u.name || 'Unknown'
                }
              })
            })
          })
        } else {
          // Assume already per-user
          normalized = reactionsPayload.map((r: any) => ({
            id: r.id || `${data.messageId}-${r.userId}-${r.emoji}`,
            emoji: r.emoji,
            userId: r.userId,
            user: r.user || { id: r.userId, username: r.username || 'Unknown' }
          }))
        }

        return { ...msg, reactions: normalized }
      }))
    }

    const handleMessageRead = (data: { messageId: string; readBy: string; readAt: string }) => {
      console.log('Message read status updated via Socket.IO:', data.messageId, 'by user:', data.readBy)
      // Update status to 'read' for messages sent by current user that were read by others
      if (data.readBy !== session?.user?.id) {
        setMessages(prev => {
          const updated = prev.map(msg => 
            msg.id === data.messageId && msg.senderId === session?.user?.id
              ? { ...msg, status: 'read' }
              : msg
          )
          console.log('Updated message status for:', data.messageId)
          return updated
        })
      }
    }

    const handleMessageStatusUpdate = (data: { messageId: string; status: string; updatedAt: string }) => {
      console.log('Message status updated via Socket.IO:', data.messageId, 'to:', data.status)
      setMessages(prev => {
        const updated = prev.map(msg => 
          msg.id === data.messageId
            ? { ...msg, status: data.status }
            : msg
        )
        console.log('Updated message status to:', data.status, 'for message:', data.messageId)
        return updated
      })
    }

    // Removed handleMessageDeleted - now handled by window events

    const handleUserProfileUpdated = (data: { userId: string; avatar?: string; name?: string; username?: string }) => {
      console.log('User profile updated via Socket.IO:', data.userId)
      setMessages(prev => {
        return prev.map(msg => {
          if (msg.sender.id === data.userId) {
            return {
              ...msg,
              sender: {
                ...msg.sender,
                ...(data.avatar !== undefined && { avatar: data.avatar }),
                ...(data.name !== undefined && { name: data.name }),
                ...(data.username !== undefined && { username: data.username })
              }
            }
          }
          return msg
        })
      })
    }

    // Set up conversation-specific socket event listeners
    console.log('useMessages: Registering socket event listeners for conversation only')
    socket.on('new-message', handleNewMessage)
    socket.on('message-reaction-updated', handleReactionUpdate)
    socket.on('message-read', handleMessageRead)
    socket.on('message-status-updated', handleMessageStatusUpdate)
    socket.on('user-profile-updated', handleUserProfileUpdated)
    console.log('useMessages: Conversation-specific socket event listeners registered')

    return () => {
      console.log('useMessages: Cleaning up Socket.IO event listeners for conversation:', conversationId)
      socket.off('new-message', handleNewMessage)
      socket.off('message-reaction-updated', handleReactionUpdate)
      socket.off('message-read', handleMessageRead)
      socket.off('message-status-updated', handleMessageStatusUpdate)
      socket.off('user-profile-updated', handleUserProfileUpdated)
      console.log('useMessages: Socket event listeners cleaned up')
    }
  }, [socket, conversationId, session?.user?.id])

  // Scroll to a specific message by ID
  const scrollToMessage = useCallback(async (messageId: string) => {
    // First, check if the message is already in the current view
    let messageElement = document.querySelector(`[data-message-id="${messageId}"]`)
    
    if (messageElement) {
      // Message is visible, scroll to it immediately
      messageElement.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      })
      
      // Add a temporary highlight effect
      messageElement.classList.add('highlight-message')
      setTimeout(() => {
        messageElement.classList.remove('highlight-message')
      }, 2000)
      return
    }
    
    // Message not visible - check if it exists in our current messages
    const messageExists = messages.some(msg => msg.id === messageId)
    
    if (!messageExists) {
      // Message might be in older messages - need to load more
      console.log(`Message ${messageId} not found in current messages, attempting to load more...`)
      
      // For now, show a user-friendly message
      // In a full implementation, you might want to:
      // 1. Load older messages until the message is found
      // 2. Make an API call to find the message position
      // 3. Navigate to the correct page/offset
      
      // Simple user feedback for now
      const notification = document.createElement('div')
      notification.className = 'fixed top-4 right-4 bg-yellow-100 dark:bg-yellow-900/90 border border-yellow-400 dark:border-yellow-600 text-yellow-800 dark:text-yellow-200 px-4 py-2 rounded-lg shadow-lg z-50 max-w-sm text-sm'
      notification.textContent = 'Original message not found in current view. It might be in older messages.'
      document.body.appendChild(notification)
      
      setTimeout(() => {
        document.body.removeChild(notification)
      }, 3000)
      
      return
    }
    
    // Message exists in our data but not rendered (virtual scrolling case)
    console.warn(`Message ${messageId} exists but not currently rendered`)
  }, [messages])

  return {
    messages,
    loading,
    error,
    hasMore,
    sendMessage,
    loadMore,
    markMessagesAsRead,
    reactToMessage,
    scrollToMessage,
    refetch: () => fetchMessages(),
  }
}