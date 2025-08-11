'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useSocketContext } from '@/context/SocketContext'

interface User {
  id: string
  username: string
  name: string | null
  avatar: string | null
  isOnline: boolean
  lastSeen: Date
}

interface ConversationParticipant {
  id: string
  userId: string
  role: string
  joinedAt: Date
  user: User
}

interface Message {
  id: string
  content: string
  type: string
  senderId: string
  conversationId: string | null
  channelId: string | null
  createdAt: Date
  sender: {
    username: string
    name: string | null
  }
}

interface Conversation {
  id: string
  name: string | null
  description: string | null
  isGroup: boolean
  avatar: string | null
  createdAt: Date
  updatedAt: Date
  participants: ConversationParticipant[]
  messages: Message[]
  unreadCount: number
  otherParticipants: ConversationParticipant[]
}

export const useConversations = () => {
  const { data: session } = useSession()
  const { socket, isFullyInitialized } = useSocketContext()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchConversations = useCallback(async () => {
    if (!session?.user?.id) return

    try {
      setLoading(true)
      const response = await fetch('/api/conversations')
      
      if (!response.ok) {
        throw new Error('Failed to fetch conversations')
      }

      const data = await response.json()
      setConversations(data.conversations || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch conversations')
    } finally {
      setLoading(false)
    }
  }, [session?.user?.id])

  const createConversation = useCallback(async (userId: string) => {
    console.log('createConversation called with:', { userId, sessionUserId: session?.user?.id })
    
    if (!session?.user?.id) {
      console.log('No session or user ID, returning null')
      return null
    }

    try {
      const requestBody = {
        userId,
        isGroup: false,
      }
      console.log('Making POST request to /api/conversations with body:', requestBody)
      
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })
      
      console.log('API response status:', response.status, response.statusText)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create conversation')
      }

      const data = await response.json()
      console.log('API response data:', data)
      const newConversation = data.conversation
      console.log('New conversation created:', newConversation)

      setConversations(prev => {
        console.log('Updating conversations list, current count:', prev.length)
        const existingIndex = prev.findIndex(c => c.id === newConversation.id)
        if (existingIndex >= 0) {
          console.log('Conversation already exists, not adding duplicate')
          return prev
        }
        const updatedConversations = [newConversation, ...prev]
        console.log('Added new conversation, new count:', updatedConversations.length)
        return updatedConversations
      })

      return newConversation
    } catch (err) {
      console.error('Create conversation error:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to create conversation'
      setError(errorMessage)
      throw err // Re-throw to allow components to handle specific errors
    }
  }, [session?.user?.id])

  const createGroupConversation = useCallback(async (userIds: string[], name: string, description?: string) => {
    if (!session?.user?.id) return null

    try {
      const response = await fetch('/api/conversations/group', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userIds,
          name,
          description,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create group conversation')
      }

      const data = await response.json()
      const newConversation = data.conversation

      setConversations(prev => [newConversation, ...prev])

      return newConversation
    } catch (err) {
      console.error('Create group conversation error:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to create group conversation'
      setError(errorMessage)
      throw err // Re-throw to allow components to handle specific errors
    }
  }, [session?.user?.id])

  useEffect(() => {
    fetchConversations()
  }, [fetchConversations])

  // Refresh conversations when socket connects (covers page refreshes)
  useEffect(() => {
    if (!socket) return
    const handleConnect = () => {
      console.log('Socket connected (useConversations), refetching conversations...')
      fetchConversations()
    }
    socket.on('connect', handleConnect)
    return () => {
      socket.off('connect', handleConnect)
    }
  }, [socket, fetchConversations])

  useEffect(() => {
    if (!socket) {
      console.log('useConversations: Socket not available yet for event listeners')
      return
    }

    const handleNewMessage = (message: Message) => {
      setConversations(prev => 
        prev.map(conv => {
          if (conv.id === message.conversationId) {
            return {
              ...conv,
              messages: [message],
              updatedAt: new Date(message.createdAt),
              unreadCount: message.senderId === session?.user?.id ? conv.unreadCount : conv.unreadCount + 1
            }
          }
          return conv
        })
      )
    }

    const handleMessageUpdate = (updatedMessage: Message) => {
      setConversations(prev => 
        prev.map(conv => {
          if (conv.id === updatedMessage.conversationId) {
            return {
              ...conv,
              messages: conv.messages.map(msg => 
                msg.id === updatedMessage.id ? { ...msg, ...updatedMessage } : msg
              )
            }
          }
          return conv
        })
      )
    }

    const handleNewConversation = (conversation: Conversation) => {
      setConversations(prev => {
        const existingIndex = prev.findIndex(c => c.id === conversation.id)
        if (existingIndex >= 0) {
          return prev
        }
        return [conversation, ...prev]
      })
    }

    const handleConversationUpdate = (updatedConversation: Conversation) => {
      setConversations(prev => 
        prev.map(conv => 
          conv.id === updatedConversation.id ? { ...conv, ...updatedConversation } : conv
        )
      )
    }

    const handleConversationRead = (data: { userId: string; conversationId: string | null; updatedCount: number }) => {
      console.log('Conversation read event received:', data)
      if (data.userId === session?.user?.id && data.conversationId) {
        console.log('Setting unread count to 0 for conversation:', data.conversationId)
        setConversations(prev => {
          const updated = prev.map(conv =>
            conv.id === data.conversationId ? { ...conv, unreadCount: 0 } : conv
          )
          console.log('Updated conversations with unread counts:', updated.map(c => ({ id: c.id, unreadCount: c.unreadCount })))
          return updated
        })
      }
    }

    const handleMessageStatusUpdated = (data: { messageId: string; status: string; updatedAt: string }) => {
      console.log('Message status updated event received:', data)
      if (data.status === 'read') {
        // Find which conversation this message belongs to and update unread count
        setConversations(prev => {
          const updated = prev.map(conv => {
            // Check if this message belongs to this conversation
            const hasMessage = conv.messages.some(msg => msg.id === data.messageId)
            if (hasMessage && conv.unreadCount > 0) {
              console.log(`Reducing unread count for conversation ${conv.id} due to message ${data.messageId} being read`)
              return { ...conv, unreadCount: Math.max(0, conv.unreadCount - 1) }
            }
            return conv
          })
          return updated
        })
      }
    }

    socket.on('new-message', handleNewMessage)
    socket.on('conversation-read', handleConversationRead)
    socket.on('message-status-updated', handleMessageStatusUpdated)
    socket.on('message-updated', handleMessageUpdate)
    socket.on('new-conversation', handleNewConversation)
    socket.on('conversation-updated', handleConversationUpdate)

    return () => {
      socket.off('new-message', handleNewMessage)
      socket.off('conversation-read', handleConversationRead)
      socket.off('message-status-updated', handleMessageStatusUpdated)
      socket.off('message-updated', handleMessageUpdate)
      socket.off('new-conversation', handleNewConversation)
      socket.off('conversation-updated', handleConversationUpdate)
    }
  }, [socket, session?.user?.id])

  const markConversationAsRead = useCallback((conversationId: string) => {
    console.log('Manually marking conversation as read:', conversationId)
    setConversations(prev => {
      const updated = prev.map(conv =>
        conv.id === conversationId ? { ...conv, unreadCount: 0 } : conv
      )
      console.log('Manually updated conversations with unread counts:', updated.map(c => ({ id: c.id, unreadCount: c.unreadCount })))
      return updated
    })
  }, [])

  return {
    conversations,
    loading,
    error,
    refetch: fetchConversations,
    createConversation,
    createGroupConversation,
    markConversationAsRead,
  }
}