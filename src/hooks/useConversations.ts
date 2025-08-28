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
  const [forceRefreshKey, setForceRefreshKey] = useState(0)

  const fetchConversations = useCallback(async () => {
    if (!session?.user?.id) return

    try {
      setLoading(true)
      console.log('🔍 fetchConversations: Starting fetch with session:', {
        hasSession: !!session,
        userId: session.user?.id,
        userEmail: session.user?.email
      })
      
      const response = await fetch('/api/conversations', {
        method: 'GET',
        credentials: 'include', // Ensure cookies are included
        headers: {
          'Content-Type': 'application/json',
        }
      })
      
      console.log('🔍 fetchConversations: Response received:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('🔍 fetchConversations: Error response:', errorData)
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('🔍 fetchConversations: Success data:', { 
        conversationsCount: data.conversations?.length || 0 
      })
      
      // Transform conversations to include otherParticipants
      const transformedConversations = (data.conversations || []).map((conv: any) => ({
        ...conv,
        otherParticipants: conv.participants?.filter((p: any) => p.userId !== session?.user?.id) || []
      }))

      // Sort conversations by updatedAt timestamp (most recent first)
      const sortedConversations = transformedConversations.sort((a: Conversation, b: Conversation) => 
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      setConversations(sortedConversations)
      setError(null)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch conversations'
      console.error('🔍 fetchConversations: Final error:', errorMsg)
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }, [session?.user?.id])

  const [refreshPending, setRefreshPending] = useState(false)

  const triggerRefresh = useCallback(() => {
    if (refreshPending) {
      console.log('🔄 useConversations: Refresh already pending, skipping duplicate')
      return
    }
    
    console.log('🔄 useConversations: Triggering forced refresh')
    setRefreshPending(true)
    setForceRefreshKey(prev => prev + 1)
    
    // Clear pending flag after fetch completes
    fetchConversations().finally(() => {
      setTimeout(() => setRefreshPending(false), 100) // Small delay to prevent rapid successive calls
    })
  }, [fetchConversations, refreshPending])

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
        credentials: 'include', // Ensure cookies are included for authentication
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })
      
      console.log('API response status:', response.status, response.statusText)

      if (!response.ok) {
        let errorData
        try {
          errorData = await response.json()
        } catch (parseError) {
          console.error('Failed to parse error response:', parseError)
          errorData = { error: `HTTP ${response.status}: ${response.statusText}` }
        }
        
        console.error('Conversation creation failed:', {
          status: response.status,
          statusText: response.statusText,
          errorData,
          timestamp: new Date().toISOString()
        })
        
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to create conversation`)
      }

      const data = await response.json()
      console.log('API response data:', data)
      const newConversation = {
        ...data.conversation,
        otherParticipants: data.conversation.participants?.filter((p: any) => p.userId !== session?.user?.id) || []
      }
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
        credentials: 'include', // Ensure cookies are included for authentication
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
      const newConversation = {
        ...data.conversation,
        otherParticipants: data.conversation.participants?.filter((p: any) => p.userId !== session?.user?.id) || []
      }

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
    if (!socket || !isFullyInitialized) {
      console.log('useConversations: Socket not fully available yet for event listeners', { socket: !!socket, isFullyInitialized })
      return
    }
    
    console.log('🚀 useConversations: Setting up socket event listeners');

    const handleNewMessage = (message: Message) => {
      console.log('useConversations: Received new-message event:', message.id, 'for conversation:', message.conversationId)
      setConversations(prev => {
        console.log('useConversations: Current conversations count:', prev.length)
        // Find the conversation with the new message
        const targetConvIndex = prev.findIndex(conv => conv.id === message.conversationId)
        console.log('useConversations: Target conversation index:', targetConvIndex)
        if (targetConvIndex === -1) {
          console.log('useConversations: Conversation not found, fetching fresh conversation list...')
          // If conversation not found, it might be a new conversation - refetch immediately
          fetchConversations()
          return prev
        }
        
        // Update the conversation with the new message
        const updatedConv = {
          ...prev[targetConvIndex],
          messages: [message],
          updatedAt: new Date(message.createdAt),
          unreadCount: message.senderId === session?.user?.id ? prev[targetConvIndex].unreadCount : prev[targetConvIndex].unreadCount + 1
        }
        
        console.log('useConversations: Updated conversation:', updatedConv.id, 'with message:', message.id)
        console.log('useConversations: New unread count:', updatedConv.unreadCount)
        
        // Create new array with the updated conversation moved to the top
        const newConversations = [updatedConv]
        
        // Add all other conversations (excluding the one we just updated)
        for (let i = 0; i < prev.length; i++) {
          if (i !== targetConvIndex) {
            newConversations.push(prev[i])
          }
        }
        
        console.log('useConversations: Reordered conversations, moved conversation to top')
        console.log('useConversations: New conversation order:', newConversations.map(c => c.id))
        return newConversations
      })
    }

    // Handle forced refresh requests from notification system
    const handleConversationRefreshRequest = (data: { userId: string }) => {
      if (data.userId === session?.user?.id) {
        console.log('🔄 useConversations: Received refresh request from notification system')
        fetchConversations()
      }
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
      const conversationWithOtherParticipants = {
        ...conversation,
        otherParticipants: conversation.participants?.filter(p => p.userId !== session?.user?.id) || []
      }
      
      setConversations(prev => {
        const existingIndex = prev.findIndex(c => c.id === conversation.id)
        if (existingIndex >= 0) {
          return prev
        }
        return [conversationWithOtherParticipants, ...prev]
      })
    }

    const handleConversationUpdate = (updatedConversation: Conversation) => {
      setConversations(prev => {
        // Find the conversation to update
        const targetConvIndex = prev.findIndex(conv => conv.id === updatedConversation.id)
        if (targetConvIndex === -1) return prev // Conversation not found
        
        // Update the conversation and ensure otherParticipants is set
        const updated = { 
          ...prev[targetConvIndex], 
          ...updatedConversation,
          otherParticipants: updatedConversation.participants?.filter(p => p.userId !== session?.user?.id) || 
                           prev[targetConvIndex].otherParticipants || []
        }
        
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

    const handleMessageStatusUpdated = (data: { messageId: string; status: string; userId: string }) => {
      console.log('useConversations: Message status updated event received:', data)
      
      // Update the message status in conversations (important for showing delivery/read indicators)
      setConversations(prev => {
        return prev.map(conv => {
          // Check if this message belongs to this conversation
          const messageExists = conv.messages.some(msg => msg.id === data.messageId)
          if (messageExists) {
            console.log(`useConversations: Updating message ${data.messageId} status to ${data.status} in conversation ${conv.id}`)
            const updatedMessages = conv.messages.map(msg => {
              if (msg.id === data.messageId) {
                return { ...msg, status: data.status }
              }
              return msg
            })
            
            // If message was marked as read and the current user didn't send it, decrease unread count
            if (data.status === 'read' && conv.unreadCount > 0) {
              const message = conv.messages.find(msg => msg.id === data.messageId)
              if (message && message.senderId !== session?.user?.id) {
                console.log(`useConversations: Reducing unread count for conversation ${conv.id} due to message ${data.messageId} being read`)
                return { 
                  ...conv, 
                  messages: updatedMessages, 
                  unreadCount: Math.max(0, conv.unreadCount - 1) 
                }
              }
            }
            
            return { ...conv, messages: updatedMessages }
          }
          return conv
        })
      })
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

    const handleUserStatusUpdate = (data: { userId: string; isOnline: boolean; lastSeen?: Date }) => {
      // Reduced logging for performance - only log occasionally
      if (Math.random() < 0.1) console.log('User status update received:', data)
      setConversations(prev => {
        return prev.map(conv => {
          // Update participants in this conversation
          const updatedParticipants = conv.participants.map(participant => {
            if (participant.userId === data.userId) {
              return {
                ...participant,
                user: {
                  ...participant.user,
                  isOnline: data.isOnline,
                  ...(data.lastSeen && { lastSeen: new Date(data.lastSeen) })
                }
              }
            }
            return participant
          })

          // Update otherParticipants too
          const updatedOtherParticipants = conv.otherParticipants.map(participant => {
            if (participant.userId === data.userId) {
              return {
                ...participant,
                user: {
                  ...participant.user,
                  isOnline: data.isOnline,
                  ...(data.lastSeen && { lastSeen: new Date(data.lastSeen) })
                }
              }
            }
            return participant
          })

          const hasChanges = 
            updatedParticipants.some((p, i) => p !== conv.participants[i]) ||
            updatedOtherParticipants.some((p, i) => p !== conv.otherParticipants[i])

          if (hasChanges) {
            // Reduced logging for performance
            if (Math.random() < 0.05) console.log(`Updated online status for user ${data.userId} in conversation ${conv.id}`)
            return {
              ...conv,
              participants: updatedParticipants,
              otherParticipants: updatedOtherParticipants
            }
          }
          
          return conv
        })
      })
    }

    const handleGroupMemberAdded = (data: { conversationId: string; member: any; addedBy: any }) => {
      console.log('👥 CRITICAL: Group member added event received:', data)
      
      // FORCE IMMEDIATE REFRESH for group member addition 
      console.log('👥 CRITICAL: Forcing immediate conversation refresh due to member addition')
      triggerRefresh()
    }

    const handleGroupMemberRemoved = (data: { conversationId: string; removedMember: any; removedBy: any }) => {
      console.log('👥 CRITICAL: Group member removed event received:', data)
      
      // FORCE IMMEDIATE REFRESH for group member removal
      console.log('👥 CRITICAL: Forcing immediate conversation refresh due to member removal')
      triggerRefresh()
    }

    const handleGroupMemberLeft = (data: { conversationId: string; memberId: string }) => {
      console.log('👥 CRITICAL: Group member left event received:', data)
      
      // If current user left the group, remove the conversation entirely
      if (data.memberId === session?.user?.id) {
        console.log(`👥 CRITICAL: Current user left group ${data.conversationId}, removing conversation`)
        setConversations(prev => prev.filter(conv => conv.id !== data.conversationId))
        return
      }
      
      // FORCE IMMEDIATE REFRESH for group member left
      console.log('👥 CRITICAL: Forcing immediate conversation refresh due to member leaving')
      triggerRefresh()
    }

    const handleGroupMemberRoleUpdated = (data: { conversationId: string; member: any; oldRole: string; newRole: string }) => {
      console.log('Group member role updated event received:', data)
      setConversations(prev => {
        return prev.map(conv => {
          if (conv.id === data.conversationId) {
            return {
              ...conv,
              participants: conv.participants.map(p => 
                p.userId === data.member.userId 
                  ? { ...p, role: data.member.role }
                  : p
              ),
              otherParticipants: conv.otherParticipants.map(p => 
                p.userId === data.member.userId 
                  ? { ...p, role: data.member.role }
                  : p
              )
            }
          }
          return conv
        })
      })
    }

    const handleGroupDeleted = (data: { conversationId: string; deletedBy: any; reason: string }) => {
      console.log('Group deleted event received:', data)
      setConversations(prev => {
        return prev.filter(conv => conv.id !== data.conversationId)
      })
    }

    const handleUserBlocked = (data: { blocker: any; blocked: any; blockedAt: string }) => {
      console.log('🚫 CRITICAL: User blocked event received in conversations:', data)
      console.log('🔍 Current user ID:', session?.user?.id)
      console.log('🔍 Blocker ID:', data.blocker?.id)
      console.log('🔍 Blocked ID:', data.blocked?.id)
      
      // FORCE IMMEDIATE UI UPDATE for blocking events
      if (data.blocker.id === session?.user?.id || data.blocked.id === session?.user?.id) {
        console.log('🚫 CRITICAL: Current user involved in blocking - forcing immediate UI update')
        
        // Get the other user ID to filter out their conversation
        const otherUserId = data.blocker.id === session?.user?.id ? data.blocked.id : data.blocker.id
        
        // Immediately filter out conversations with the blocked user from current state
        setConversations(prevConversations => {
          const filteredConversations = prevConversations.filter(conv => {
            // Keep group conversations
            if (conv.isGroup) return true
            
            // Filter out direct conversations with the blocked user
            const hasBlockedUser = conv.participants.some(p => p.userId === otherUserId)
            if (hasBlockedUser) {
              console.log(`🚫 CRITICAL: Removing conversation ${conv.id} with blocked user ${otherUserId}`)
              return false
            }
            
            return true
          })
          
          console.log(`🚫 CRITICAL: Filtered conversations: ${prevConversations.length} -> ${filteredConversations.length}`)
          return filteredConversations
        })
        
        // Force immediate refresh for reliability
        triggerRefresh()
      }
    }

    const handleUserUnblocked = async (data: { unblocker: any; unblocked: any; unblockedAt: string }) => {
      console.log('✅ CRITICAL: User unblocked event received in conversations:', data)
      console.log('🔍 Current user ID:', session?.user?.id)
      console.log('🔍 Unblocker ID:', data.unblocker?.id)
      console.log('🔍 Unblocked ID:', data.unblocked?.id)
      
      // FORCE IMMEDIATE REFETCH for unblocking events
      if (data.unblocker.id === session?.user?.id || data.unblocked.id === session?.user?.id) {
        console.log('✅ CRITICAL: Current user involved in unblocking - forcing immediate conversation refetch')
        
        // For unblocking, we need to refetch from backend since conversations might reappear
        triggerRefresh()
      }
    }

    socket.on('new-message', handleNewMessage)
    socket.on('conversation-read', handleConversationRead)
    socket.on('message-status-updated', handleMessageStatusUpdated)
    socket.on('message-updated', handleMessageUpdate)
    socket.on('message-deleted', handleMessageDelete)
    socket.on('new-conversation', handleNewConversation)
    socket.on('conversation-updated', handleConversationUpdate)
    socket.on('user-profile-updated', handleUserProfileUpdated)
    socket.on('user-status-change', handleUserStatusUpdate)
    socket.on('group-member-added', handleGroupMemberAdded)
    socket.on('group-member-removed', handleGroupMemberRemoved)
    socket.on('group-member-left', handleGroupMemberLeft)
    socket.on('group-member-role-updated', handleGroupMemberRoleUpdated)
    socket.on('group-deleted', handleGroupDeleted)
    socket.on('user-blocked', handleUserBlocked)
    socket.on('user-unblocked', handleUserUnblocked)
    socket.on('conversation-refresh-request', handleConversationRefreshRequest)

    return () => {
      socket.off('new-message', handleNewMessage)
      socket.off('conversation-read', handleConversationRead)
      socket.off('message-status-updated', handleMessageStatusUpdated)
      socket.off('message-updated', handleMessageUpdate)
      socket.off('message-deleted', handleMessageDelete)
      socket.off('new-conversation', handleNewConversation)
      socket.off('conversation-updated', handleConversationUpdate)
      socket.off('user-profile-updated', handleUserProfileUpdated)
      socket.off('user-status-change', handleUserStatusUpdate)
      socket.off('group-member-added', handleGroupMemberAdded)
      socket.off('group-member-removed', handleGroupMemberRemoved)
      socket.off('group-member-left', handleGroupMemberLeft)
      socket.off('group-member-role-updated', handleGroupMemberRoleUpdated)
      socket.off('group-deleted', handleGroupDeleted)
      socket.off('user-blocked', handleUserBlocked)
      socket.off('user-unblocked', handleUserUnblocked)
      socket.off('conversation-refresh-request', handleConversationRefreshRequest)
    }
  }, [socket, isFullyInitialized, session?.user?.id, fetchConversations, triggerRefresh])

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
    forceRefreshKey,
    setForceRefreshKey,
    refetch: fetchConversations,
    triggerRefresh,
    createConversation,
    createGroupConversation,
    markConversationAsRead,
  }
}