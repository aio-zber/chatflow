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
      // Sort conversations by updatedAt timestamp (most recent first)
      const sortedConversations = (data.conversations || []).sort((a: Conversation, b: Conversation) => 
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      setConversations(sortedConversations)
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
      setConversations(prev => {
        // Find the conversation with the new message
        const targetConvIndex = prev.findIndex(conv => conv.id === message.conversationId)
        if (targetConvIndex === -1) return prev // Conversation not found
        
        // Update the conversation with the new message
        const updatedConv = {
          ...prev[targetConvIndex],
          messages: [message],
          updatedAt: new Date(message.createdAt),
          unreadCount: message.senderId === session?.user?.id ? prev[targetConvIndex].unreadCount : prev[targetConvIndex].unreadCount + 1
        }
        
        // Create new array with the updated conversation moved to the top
        const newConversations = [updatedConv]
        
        // Add all other conversations (excluding the one we just updated)
        for (let i = 0; i < prev.length; i++) {
          if (i !== targetConvIndex) {
            newConversations.push(prev[i])
          }
        }
        
        return newConversations
      })
    }

    const handleMessageUpdate = (updatedMessage: Message) => {
      console.log('useConversations: Received message-updated:', updatedMessage.id, updatedMessage)
      console.log('useConversations: Current conversations count:', conversations.length)
      setConversations(prev => 
        prev.map(conv => {
          if (conv.id === updatedMessage.conversationId) {
            console.log('useConversations: Updating message in conversation:', conv.id)
            console.log('useConversations: Current messages in conversation:', conv.messages.length)
            const messageExists = conv.messages.some(msg => msg.id === updatedMessage.id)
            console.log('useConversations: Message exists in conversation:', messageExists)
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

    const handleMessageDelete = (data: { messageId: string; conversationId: string }) => {
      console.log('useConversations: Received message-deleted:', data.messageId, data)
      console.log('useConversations: Current conversations count:', conversations.length)
      setConversations(prev => 
        prev.map(conv => {
          if (conv.id === data.conversationId) {
            console.log('useConversations: Removing message from conversation:', conv.id)
            console.log('useConversations: Messages before deletion:', conv.messages.length)
            const messageExists = conv.messages.some(msg => msg.id === data.messageId)
            console.log('useConversations: Message exists in conversation:', messageExists)
            const filtered = conv.messages.filter(msg => msg.id !== data.messageId)
            console.log('useConversations: Messages after deletion:', filtered.length)
            return {
              ...conv,
              messages: filtered
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
      setConversations(prev => {
        // Find the conversation to update
        const targetConvIndex = prev.findIndex(conv => conv.id === updatedConversation.id)
        if (targetConvIndex === -1) return prev // Conversation not found
        
        // Update the conversation
        const updated = { ...prev[targetConvIndex], ...updatedConversation }
        
        // If this conversation has a more recent updatedAt, move it to the top
        const isMoreRecent = prev.some(conv => 
          conv.id !== updatedConversation.id && 
          new Date(updated.updatedAt).getTime() > new Date(conv.updatedAt).getTime()
        )
        
        if (isMoreRecent && targetConvIndex > 0) {
          // Move to top
          const newConversations = [updated]
          for (let i = 0; i < prev.length; i++) {
            if (i !== targetConvIndex) {
              newConversations.push(prev[i])
            }
          }
          return newConversations
        } else {
          // Just update in place
          return prev.map(conv => 
            conv.id === updatedConversation.id ? updated : conv
          )
        }
      })
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

    const handleUserProfileUpdated = (data: { userId: string; avatar?: string; name?: string; username?: string }) => {
      console.log('User profile updated event received:', data)
      setConversations(prev => {
        return prev.map(conv => {
          // Update all participants in this conversation if they match the updated user
          const updatedParticipants = conv.participants.map(participant => {
            if (participant.user.id === data.userId) {
              return {
                ...participant,
                user: {
                  ...participant.user,
                  ...(data.avatar !== undefined && { avatar: data.avatar }),
                  ...(data.name !== undefined && { name: data.name }),
                  ...(data.username !== undefined && { username: data.username })
                }
              }
            }
            return participant
          })
          
          // Update otherParticipants as well
          const updatedOtherParticipants = conv.otherParticipants.map(participant => {
            if (participant.user.id === data.userId) {
              return {
                ...participant,
                user: {
                  ...participant.user,
                  ...(data.avatar !== undefined && { avatar: data.avatar }),
                  ...(data.name !== undefined && { name: data.name }),
                  ...(data.username !== undefined && { username: data.username })
                }
              }
            }
            return participant
          })

          // Update messages sender info if needed
          const updatedMessages = conv.messages.map(message => {
            if (message.senderId === data.userId) {
              return {
                ...message,
                sender: {
                  ...message.sender,
                  ...(data.name !== undefined && { name: data.name }),
                  ...(data.username !== undefined && { username: data.username })
                }
              }
            }
            return message
          })
          
          // Only return updated conversation if there were actual changes
          const hasChanges = 
            updatedParticipants.some((p, i) => p !== conv.participants[i]) ||
            updatedOtherParticipants.some((p, i) => p !== conv.otherParticipants[i]) ||
            updatedMessages.some((m, i) => m !== conv.messages[i])
            
          if (hasChanges) {
            console.log(`Updated profile info for user ${data.userId} in conversation ${conv.id}`)
            return {
              ...conv,
              participants: updatedParticipants,
              otherParticipants: updatedOtherParticipants,
              messages: updatedMessages
            }
          }
          
          return conv
        })
      })
    }

    socket.on('new-message', handleNewMessage)
    socket.on('conversation-read', handleConversationRead)
    socket.on('message-status-updated', handleMessageStatusUpdated)
    socket.on('message-updated', handleMessageUpdate)
    socket.on('message-deleted', handleMessageDelete)
    socket.on('new-conversation', handleNewConversation)
    socket.on('conversation-updated', handleConversationUpdate)
    socket.on('user-profile-updated', handleUserProfileUpdated)

    return () => {
      socket.off('new-message', handleNewMessage)
      socket.off('conversation-read', handleConversationRead)
      socket.off('message-status-updated', handleMessageStatusUpdated)
      socket.off('message-updated', handleMessageUpdate)
      socket.off('message-deleted', handleMessageDelete)
      socket.off('new-conversation', handleNewConversation)
      socket.off('conversation-updated', handleConversationUpdate)
      socket.off('user-profile-updated', handleUserProfileUpdated)
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