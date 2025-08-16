'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
  const [loadingMore, setLoadingMore] = useState(false)
  const [scrollToMessageLoading, setScrollToMessageLoading] = useState<string | null>(null)

  // Use refs to track current state values to avoid stale closures in scrollToMessage
  const currentMessagesRef = useRef(messages)
  const currentHasMoreRef = useRef(hasMore)
  const currentNextCursorRef = useRef(nextCursor)
  
  // Update refs whenever state changes
  useEffect(() => {
    currentMessagesRef.current = messages
    currentHasMoreRef.current = hasMore
    currentNextCursorRef.current = nextCursor
  }, [messages, hasMore, nextCursor])

  const fetchMessages = useCallback(async (cursor?: string) => {
    if (!conversationId || !session?.user?.id) return

    try {
      if (cursor) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }
      
      const url = new URL(`/api/messages/${conversationId}`, window.location.origin)
      if (cursor) url.searchParams.set('cursor', cursor)

      const response = await fetch(url.toString())
      
      if (!response.ok) {
        throw new Error('Failed to fetch messages')
      }

      const data = await response.json()
      
      if (cursor) {
        // When loading more messages, deduplicate by ID to prevent React key conflicts
        setMessages(prev => {
          const existingIds = new Set(prev.map(msg => msg.id))
          const newMessages = data.messages.filter(msg => !existingIds.has(msg.id))
          return [...newMessages, ...prev]
        })
      } else {
        setMessages(data.messages || [])
      }
      
      setNextCursor(data.nextCursor)
      setHasMore(!!data.nextCursor)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch messages')
    } finally {
      if (cursor) {
        setLoadingMore(false)
      } else {
        setLoading(false)
      }
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
    if (nextCursor && !loading && !loadingMore) {
      await fetchMessages(nextCursor)
      return true // Return true if we attempted to load
    }
    return false // Return false if we couldn't load
  }, [nextCursor, loading, loadingMore, fetchMessages])

  // Debounced scroll to message to prevent multiple simultaneous calls
  const [scrollToMessageDebounce, setScrollToMessageDebounce] = useState<{[key: string]: number}>({})

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

  // Ensure we're in the current conversation room
  useEffect(() => {
    if (!socket || !conversationId) return

    const ensureRoomConnection = () => {
      socket.emit('join-room', conversationId)
    }

    if (socket.connected) {
      ensureRoomConnection()
    } else {
      const handleConnect = () => {
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
    if (!socket) return

    const handleMessageUpdated = (updatedMessage: any) => {
      setMessages(prev => {
        const messageExists = prev.some(msg => msg.id === updatedMessage.id)
        if (messageExists) {
          return prev.map(msg => 
            msg.id === updatedMessage.id ? { ...msg, ...updatedMessage } : msg
          )
        }
        // Don't add messages that weren't already present to prevent duplicates
        return prev
      })
    }

    const handleMessageDeleted = (data: any) => {
      setMessages(prev => 
        prev.filter(msg => msg.id !== data.messageId)
      )
    }

    socket.on('message-updated', handleMessageUpdated)
    socket.on('message-deleted', handleMessageDeleted)

    return () => {
      socket.off('message-updated', handleMessageUpdated)
      socket.off('message-deleted', handleMessageDeleted)
    }
  }, [socket])

  // Socket event listeners effect for conversation-specific events
  useEffect(() => {
    if (!socket || !conversationId) return

    const handleNewMessage = (message: Message) => {
      if (message.conversationId === conversationId && message.senderId !== session?.user?.id) {
        setMessages(prev => {
          // Prevent duplicate messages by checking for existing ID
          if (prev.some(m => m.id === message.id)) return prev
          return [...prev, message]
        })
      }
    }

    const handleReactionUpdate = (data: { messageId: string; reactions: any[] }) => {
      setMessages(prev => prev.map(msg => {
        if (msg.id !== data.messageId) return msg

        const reactionsPayload = Array.isArray(data.reactions) ? data.reactions : []
        let normalized: MessageReaction[] = []

        if (reactionsPayload[0] && Array.isArray(reactionsPayload[0].users)) {
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
      if (data.readBy !== session?.user?.id) {
        setMessages(prev => prev.map(msg => 
          msg.id === data.messageId && msg.senderId === session?.user?.id
            ? { ...msg, status: 'read' }
            : msg
        ))
      }
    }

    const handleMessageStatusUpdate = (data: { messageId: string; status: string; updatedAt: string }) => {
      setMessages(prev => prev.map(msg => 
        msg.id === data.messageId ? { ...msg, status: data.status } : msg
      ))
    }

    const handleUserProfileUpdated = (data: { userId: string; avatar?: string; name?: string; username?: string }) => {
      setMessages(prev => prev.map(msg => {
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
      }))
    }

    socket.on('new-message', handleNewMessage)
    socket.on('message-reaction-updated', handleReactionUpdate)
    socket.on('message-read', handleMessageRead)
    socket.on('message-status-updated', handleMessageStatusUpdate)
    socket.on('user-profile-updated', handleUserProfileUpdated)

    return () => {
      socket.off('new-message', handleNewMessage)
      socket.off('message-reaction-updated', handleReactionUpdate)
      socket.off('message-read', handleMessageRead)
      socket.off('message-status-updated', handleMessageStatusUpdate)
      socket.off('user-profile-updated', handleUserProfileUpdated)
    }
  }, [socket, conversationId, session?.user?.id])

  // Scroll to a specific message by ID
  const scrollToMessage = useCallback(async (messageId: string) => {
    // Prevent multiple simultaneous scroll attempts for the same message
    if (scrollToMessageLoading === messageId) {
      console.log(`Already searching for message ${messageId}, ignoring duplicate request`)
      return
    }
    
    // Debounce rapid clicks
    const now = Date.now()
    const lastCall = scrollToMessageDebounce[messageId] || 0
    if (now - lastCall < 500) {
      console.log(`Debouncing scroll to message ${messageId}`)
      return
    }
    
    setScrollToMessageDebounce(prev => ({ ...prev, [messageId]: now }))
    setScrollToMessageLoading(messageId)
    
    try {
    // Helper function to scroll to message element
    const scrollToMessageElement = () => {
      const messageElement = document.querySelector(`[data-message-id="${messageId}"]`)
      if (messageElement) {
        messageElement.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        })
        
        // Add a temporary highlight effect
        messageElement.classList.add('highlight-message')
        setTimeout(() => {
          messageElement.classList.remove('highlight-message')
        }, 2000)
        return true
      }
      return false
    }

    // Helper function to get current state using refs
    const getCurrentState = () => {
      return {
        messages: currentMessagesRef.current,
        hasMore: currentHasMoreRef.current,
        nextCursor: currentNextCursorRef.current
      }
    }

    // First, check if the message is already visible in the DOM
    if (scrollToMessageElement()) {
      return
    }
    
    // Check if message exists in current loaded messages (use fresh state)
    const initialState = getCurrentState()
    let messageExists = initialState.messages.some((msg: Message) => msg.id === messageId)
    
    if (messageExists) {
      // Message exists in data but not rendered (virtual scrolling case)
      // Wait a bit for potential rendering and try again
      setTimeout(() => {
        if (!scrollToMessageElement()) {
          console.warn(`Message ${messageId} exists in data but not currently rendered`)
        }
      }, 100)
      return
    }
    
    // Message not in current messages - try to load older messages
    let attempts = 0
    const maxAttempts = 10 // Reasonable max attempts
    let consecutiveNoNewMessages = 0
    const maxConsecutiveNoNew = 2 // Reduced to fail faster
    
    while (attempts < maxAttempts && consecutiveNoNewMessages < maxConsecutiveNoNew) {
      try {
        // Get current state before loading
        const currentState = getCurrentState()
        const messageCountBefore = currentState.messages.length
        
        // Check if we have more messages to load
        if (!currentState.hasMore && !currentState.nextCursor) {
          console.warn('No more messages available to load')
          break
        }
        
        // Load more messages using the loadMore function
        const didLoad = await loadMore()
        if (!didLoad) {
          console.warn('Could not load more messages - no cursor or already loading')
          break
        }
        attempts++
        
        // Wait for state update with shorter intervals
        const waitTime = Math.min(150 + (attempts * 50), 400)
        await new Promise(resolve => setTimeout(resolve, waitTime))
        
        // Get updated messages state
        const updatedState = getCurrentState()
        messageExists = updatedState.messages.some((msg: Message) => msg.id === messageId)
        
        if (messageExists) {
          // Found the message, try to scroll to it with retry logic
          let scrollAttempts = 0
          const maxScrollAttempts = 5
          
          const tryScroll = () => {
            if (scrollToMessageElement()) {
              return true
            }
            
            scrollAttempts++
            if (scrollAttempts < maxScrollAttempts) {
              setTimeout(tryScroll, 100 * scrollAttempts)
            } else {
              console.warn(`Message ${messageId} loaded but could not scroll to it after ${maxScrollAttempts} attempts`)
            }
            return false
          }
          
          setTimeout(tryScroll, 200)
          return
        }
        
        // Check if we actually loaded new messages
        const newMessagesCount = updatedState.messages.length - messageCountBefore
        if (newMessagesCount === 0) {
          consecutiveNoNewMessages++
          // If we can't load more messages but have the same cursor, we might be at the end
          if (updatedState.nextCursor === currentState.nextCursor || !updatedState.nextCursor) {
            console.warn('Reached end of available messages')
            break
          }
        } else {
          consecutiveNoNewMessages = 0 // Reset counter if we got new messages
        }
        
      } catch (error) {
        console.error('Error loading more messages while searching for target message:', error)
        break
      }
    }
    
    // Provide detailed feedback on why we stopped searching
    if (attempts >= maxAttempts) {
      console.warn(`Reached maximum attempts (${maxAttempts}) searching for message ${messageId}`)
    } else if (consecutiveNoNewMessages >= maxConsecutiveNoNew) {
      console.warn(`Message ${messageId} not found after loading all available messages (${consecutiveNoNewMessages} consecutive empty loads)`)
    }
    } catch (outerError) {
      console.error('Unexpected error in scrollToMessage:', outerError)
    } finally {
      setScrollToMessageLoading(null)
    }
  }, [loadMore, scrollToMessageLoading, scrollToMessageDebounce])

  return {
    messages,
    loading,
    error,
    hasMore,
    loadingMore,
    scrollToMessageLoading,
    sendMessage,
    loadMore,
    markMessagesAsRead,
    reactToMessage,
    scrollToMessage,
    refetch: () => fetchMessages(),
  }
}