'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { MessageBubble } from './MessageBubble'
import { MessageInput } from './MessageInput'
import { GroupSettings } from './GroupSettings'
import { UserInfoModal } from './UserInfoModal'
import { CallModal } from './CallModal'
import { IncomingCallModal } from './IncomingCallModal'
import { useMessages } from '@/hooks/useMessages'
import { useConversations } from '@/hooks/useConversations'
import { useSocketContext } from '@/context/SocketContext'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { Phone, Video, Info, ArrowDown, X, Shield } from 'lucide-react'
import { EncryptionIndicator, E2EESetupPrompt, SafetyNumberModal } from '@/components/e2ee/EncryptionIndicator'
import { useE2EE } from '@/hooks/useE2EE'

// Message interface for MessageBubble compatibility
interface MessageBubbleMessage {
  id: string
  content: string
  senderId: string
  senderName: string
  senderImage?: string
  timestamp: Date
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'unread'
  reactions?: {
    emoji: string
    count: number
    users: string[]
    hasReacted: boolean
  }[]
  replyTo?: {
    id: string
    content: string
    senderName: string
  }
  attachments?: {
    id: string
    name: string
    url: string
    type: 'image' | 'file' | 'voice'
    size?: number
    duration?: number
  }[]
}

interface TypingUser {
  id: string
  name: string
}

interface ChatWindowProps {
  conversationId: string | null
}

export function ChatWindow({ conversationId }: ChatWindowProps) {
  const { data: session } = useSession()
  const { socket } = useSocketContext()
  const { conversations, loading: conversationsLoading, markConversationAsRead } = useConversations()
  const { messages, loading: messagesLoading, error: messagesError, sendMessage, loadMore, hasMore, loadingMore: messagesLoadingMore, scrollToMessageLoading, markMessagesAsRead, reactToMessage, scrollToMessage } = useMessages(conversationId)
  const [replyTo, setReplyTo] = useState<MessageBubbleMessage | null>(null)
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<MessageBubbleMessage[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isBlocked, setIsBlocked] = useState(false)
  const [isBlockLoading, setIsBlockLoading] = useState(false)
  const [showGroupSettings, setShowGroupSettings] = useState(false)
  const [showUserInfo, setShowUserInfo] = useState(false)
  const [showCall, setShowCall] = useState(false)
  const [callType, setCallType] = useState<'voice' | 'video'>('voice')
  const [showIncomingCall, setShowIncomingCall] = useState(false)
  const [incomingCall, setIncomingCall] = useState<{
    callType: 'voice' | 'video'
    callerName: string
    callerAvatar?: string | null
    conversationName?: string | null
    isGroupCall: boolean
    participantCount: number
  } | null>(null)
  
  // E2EE state
  const [showE2EESetup, setShowE2EESetup] = useState(false)
  const [showSafetyNumber, setShowSafetyNumber] = useState(false)
  const { isAvailable, isInitializing, setupDevice, getEncryptionStatus, sendMessage: sendE2EEMessage } = useE2EE()
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const scrollPositionRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)
  const previousMessageCountRef = useRef<number>(0)
  const conversationOpenTimeRef = useRef<Record<string, number>>({})
  const isPreservingScrollRef = useRef<boolean>(false)

  // Find the current conversation from the conversations list
  const conversation = conversations.find(conv => conv.id === conversationId)

  // Transform API messages to MessageBubble format
  const transformedMessages: MessageBubbleMessage[] = messages.map(msg => ({
    id: msg.id,
    content: msg.content,
    senderId: msg.senderId,
    senderName: msg.sender.name || msg.sender.username,
    senderImage: msg.sender.avatar || undefined,
    timestamp: new Date(msg.createdAt),
    status: (msg.status === 'unread' && msg.senderId === session?.user?.id)
      ? 'sent'
      : (msg.status as 'sending' | 'sent' | 'delivered' | 'read' | 'unread'),
    reactions: msg.reactions?.map(reaction => ({
      emoji: reaction.emoji,
      count: 1, // Since each reaction is individual, count is 1
      users: [reaction.user?.username || 'Unknown'],
      hasReacted: reaction.userId === session?.user?.id
    })) || [],
    replyTo: msg.replyTo ? {
      id: msg.replyTo.id,
      content: msg.replyTo.content,
      senderName: msg.replyTo.sender?.name || msg.replyTo.sender?.username || 'Unknown'
    } : undefined,
    attachments: msg.attachments?.map(att => ({
      id: att.id,
      name: att.fileName,
      url: att.fileUrl,
      type: att.fileType === 'audio/webm' || att.fileType.startsWith('audio/') ? 'voice' as const : (att.fileType.startsWith('image/') ? 'image' as const : 'file' as const),
      size: att.fileSize
    })) || []
  }))

  // Handle scroll position preservation when loading older messages
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    // If messages were added (more than before) and we have stored scroll position
    if (transformedMessages.length > previousMessageCountRef.current && scrollPositionRef.current) {
      // Set flag to prevent other scroll effects from interfering
      isPreservingScrollRef.current = true
      
      const { scrollTop: oldScrollTop, scrollHeight: oldScrollHeight } = scrollPositionRef.current
      const currentScrollHeight = container.scrollHeight
      
      // Calculate new scroll position to maintain user's view
      const heightDifference = currentScrollHeight - oldScrollHeight
      const newScrollTop = oldScrollTop + heightDifference
      
      // Use requestAnimationFrame to ensure DOM is fully updated before restoring position
      requestAnimationFrame(() => {
        // Restore scroll position without animation to prevent jarring
        container.scrollTop = newScrollTop
        
        // Clear the preserving flag after a delay to ensure all effects have run
        setTimeout(() => {
          isPreservingScrollRef.current = false
        }, 100)
      })
      
      // Clear stored position
      scrollPositionRef.current = null
    }
    
    // Update message count for next comparison
    previousMessageCountRef.current = transformedMessages.length
  }, [transformedMessages.length])

  // Use the new auto-scroll hook for multi-websocket support
  const { scrollToBottom, scrollOnSendMessage, instantScrollToBottom } = useAutoScroll({
    conversationId,
    messages,
    userId: session?.user?.id || null,
    messagesEndRef,
    setAutoScroll,
    loadingMore: messagesLoadingMore,
    isPreservingScrollRef,
  })

  // Reset reply state and search when conversation changes (moved after useAutoScroll)
  useEffect(() => {
    setReplyTo(null)
    setShowSearch(false)
    setSearchQuery('')
    setSearchResults([])
    setIsBlocked(false)
    
    // Track when conversation opens to prevent immediate load-more
    if (conversationId) {
      conversationOpenTimeRef.current[conversationId] = Date.now()
    }
    
    // Force scroll to bottom when conversation changes - wait for messages to load
    if (conversationId && instantScrollToBottom) {
      // Wait longer to ensure messages are loaded and rendered
      setTimeout(() => {
        instantScrollToBottom()
      }, 300)
    }
  }, [conversationId, instantScrollToBottom])

  // Additional auto-scroll when messages finish loading for a new conversation
  useEffect(() => {
    if (conversationId && !messagesLoading && transformedMessages.length > 0 && !messagesLoadingMore && !isPreservingScrollRef.current) {
      // Only auto-scroll if we switched to this conversation recently
      const openTime = conversationOpenTimeRef.current[conversationId]
      if (openTime && Date.now() - openTime < 5000) { // Within 5 seconds of opening
        setTimeout(() => {
          if (messagesEndRef.current && !isPreservingScrollRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'instant', block: 'end' })
            setAutoScroll(true)
          }
        }, 100)
      }
    }
  }, [conversationId, messagesLoading, transformedMessages.length, messagesLoadingMore])

  // The useAutoScroll hook now handles all scroll behavior automatically
  // Removed redundant scroll logic to prevent conflicts

  // Check if the other user is blocked
  useEffect(() => {
    const checkBlockStatus = async () => {
      if (!conversation?.isGroup && conversation?.otherParticipants[0]?.user?.id) {
        try {
          const response = await fetch('/api/users/blocked')
          if (response.ok) {
            const data = await response.json()
            const blockedUser = data.blockedUsers.find(
              (block: any) => block.user.id === conversation.otherParticipants[0].user.id
            )
            setIsBlocked(!!blockedUser)
          }
        } catch (error) {
          console.error('Error checking block status:', error)
        }
      }
    }

    if (conversationId && conversation) {
      checkBlockStatus()
    }
  }, [conversationId, conversation])

  // Listen for typing events
  useEffect(() => {
    if (!socket || !conversationId) return

    const handleUserTyping = (data: { userId: string; username: string; isTyping: boolean }) => {
      if (data.userId === session?.user?.id) return // Don't show own typing

      setTypingUsers(prev => {
        const filtered = prev.filter(user => user.id !== data.userId)
        if (data.isTyping) {
          return [...filtered, { id: data.userId, name: data.username }]
        }
        return filtered
      })
    }

    socket.on('user-typing', handleUserTyping)

    return () => {
      socket.off('user-typing', handleUserTyping)
    }
  }, [socket, conversationId, session?.user?.id])

  // Mark messages as read when conversation is viewed
  useEffect(() => {
    if (conversationId && messages.length > 0 && session?.user?.id) {
      // Mark unread messages as read (messages not sent by current user and not already read)
      const unreadMessages = messages
        .filter(msg => 
          msg.senderId !== session.user.id && 
          msg.status !== 'read'
        )
        .map(msg => msg.id)
      
      if (unreadMessages.length > 0) {
        // Delay marking as read to ensure user actually sees the messages
        const timer = setTimeout(async () => {
          // Immediately update the conversation unread count for instant UI feedback
          if (conversationId) {
            markConversationAsRead(conversationId)
          }
          // Then mark messages as read on the server
          markMessagesAsRead(unreadMessages)
        }, 1000)
        
        return () => clearTimeout(timer)
      }
    }
  }, [conversationId, messages, session?.user?.id, markMessagesAsRead, markConversationAsRead])

  // Search messages function
  const searchMessages = useCallback(async (query: string) => {
    if (!query.trim() || !conversationId) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    try {
      const response = await fetch(`/api/messages/search?query=${encodeURIComponent(query)}&conversationId=${conversationId}`)
      if (response.ok) {
        const data = await response.json()
        const transformedResults: MessageBubbleMessage[] = data.messages.map((msg: any) => ({
          id: msg.id,
          content: msg.content,
          senderId: msg.senderId,
          senderName: msg.sender.name || msg.sender.username,
          senderImage: msg.sender.avatar || undefined,
          timestamp: new Date(msg.createdAt),
          status: (msg.status === 'unread' && msg.senderId === session?.user?.id)
            ? 'sent'
            : (msg.status as 'sending' | 'sent' | 'delivered' | 'read' | 'unread'),
          reactions: msg.reactions || [],
          replyTo: msg.replyTo ? {
            id: msg.replyTo.id,
            content: msg.replyTo.content,
            senderName: msg.replyTo.sender?.name || msg.replyTo.sender?.username || 'Unknown'
          } : undefined,
          attachments: msg.attachments?.map((att: any) => ({
            id: att.id,
            name: att.fileName,
            url: att.fileUrl,
            type: att.fileType.startsWith('image/') ? 'image' as const : 'file' as const,
            size: att.fileSize
          })) || []
        }))
        setSearchResults(transformedResults)
      }
    } catch (error) {
      console.error('Error searching messages:', error)
    } finally {
      setIsSearching(false)
    }
  }, [conversationId])

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery) {
        searchMessages(searchQuery)
      } else {
        setSearchResults([])
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, searchMessages])

  // Auto-scroll is now fully handled by the useAutoScroll hook
  // Removed redundant effect to prevent scroll conflicts

  // Join conversation room when conversation changes
  useEffect(() => {
    if (socket && conversationId && session?.user?.id) {
      console.log(`ChatWindow: Joining conversation room ${conversationId}`)
      socket.emit('join-room', conversationId)
      socket.emit('join-user-room', session.user.id)
    }

    return () => {
      if (socket && conversationId) {
        console.log(`ChatWindow: Leaving conversation room ${conversationId}`)
        socket.emit('leave-room', conversationId)
      }
    }
  }, [socket, conversationId, session?.user?.id])

  // E2EE message polling
  useEffect(() => {
    if (!isAvailable || !conversationId) return

    const pollE2EEMessages = async () => {
      try {
        const response = await fetch('/api/e2ee/messages/poll', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include'
        })

        if (response.ok) {
          const data = await response.json()
          if (data.status === 'no_devices') {
            // User hasn't set up E2EE yet, which is fine
            return
          }
          if (data.messages && data.messages.length > 0) {
            console.log(`Received ${data.messages.length} encrypted messages`)
            // The useE2EE hook will handle these via the custom event
          }
        } else {
          // Log error but don't spam console for expected failures
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
          if (response.status !== 400) {
            console.error('E2EE message polling error:', errorData.error)
          }
        }
      } catch (error) {
        // Silently handle network errors to avoid console spam
        if (process.env.NODE_ENV === 'development') {
          console.error('E2EE message polling error:', error)
        }
      }
    }

    // Poll every 5 seconds for E2EE messages
    const pollInterval = setInterval(pollE2EEMessages, 5000)
    
    // Initial poll
    pollE2EEMessages()

    return () => clearInterval(pollInterval)
  }, [isAvailable, conversationId])

  // Socket integration for call management
  useEffect(() => {
    if (socket && conversationId) {
      // Listen for incoming calls
      socket.on('incoming_call', (data: {
        callType: 'voice' | 'video'
        callerName: string
        callerAvatar?: string | null
        conversationName?: string | null
        isGroupCall: boolean
        participantCount: number
        conversationId: string
      }) => {
        if (data.conversationId === conversationId) {
          setIncomingCall(data)
          setShowIncomingCall(true)
        }
      })

      // Listen for call accepted/declined
      socket.on('call_response', (data: {
        accepted: boolean
        participantId: string
        conversationId: string
      }) => {
        if (data.conversationId === conversationId) {
          // Handle call response (for group calls, multiple responses expected)
          console.log(`Call ${data.accepted ? 'accepted' : 'declined'} by participant ${data.participantId}`)
        }
      })

      // Listen for call ended
      socket.on('call_ended', (data: { conversationId: string }) => {
        if (data.conversationId === conversationId) {
          setShowCall(false)
          setShowIncomingCall(false)
          setIncomingCall(null)
        }
      })

      return () => {
        socket.off('incoming_call')
        socket.off('call_response')
        socket.off('call_ended')
      }
    }
  }, [socket, conversationId])

  // Handle scroll to show/hide scroll button and load more messages
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    const isNearBottom = distanceFromBottom < 100
    const isNearTop = scrollTop < 100
    
    setShowScrollButton(!isNearBottom && transformedMessages.length > 0)
    setAutoScroll(isNearBottom)

    // Only load more messages if we're near the top AND not trying to auto-scroll to bottom
    // Add additional checks to prevent unwanted load-more triggers
    if (isNearTop && hasMore && !messagesLoading && !messagesLoadingMore && !showSearch && !autoScroll) {
      // Don't load more if we're within the first 1 second of opening a conversation
      // This prevents immediate load-more when auto-scrolling to bottom
      const now = Date.now()
      const conversationOpenTime = conversationId ? conversationOpenTimeRef.current[conversationId] || 0 : 0
      
      if (now - conversationOpenTime > 1000) {
        // Store current scroll position before loading more messages
        scrollPositionRef.current = {
          scrollTop,
          scrollHeight
        }
        
        loadMore()
      }
    }
  }, [transformedMessages.length, hasMore, messagesLoading, messagesLoadingMore, showSearch, loadMore, autoScroll, conversationId])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (container) {
      container.addEventListener('scroll', handleScroll)
      return () => container.removeEventListener('scroll', handleScroll)
    }
  }, [handleScroll])

  // Removed scroll-to-first-unread behavior; stick to auto-scroll-to-bottom strategy

  const handleSendMessage = async (content: string, attachments?: File[]) => {
    if (!conversationId || !session?.user) return

    try {
      // Use the enhanced auto-scroll for sent messages
      scrollOnSendMessage()
      
      const messageAttachments: any[] = []
      
      // Handle file uploads if attachments are provided
      if (attachments && attachments.length > 0) {
        // Process file attachments
        
        for (const file of attachments) {
          try {
            const formData = new FormData()
            formData.append('file', file)
            
            const uploadResponse = await fetch('/api/upload', {
              method: 'POST',
              body: formData,
            })
            
            if (!uploadResponse.ok) {
              const errorData = await uploadResponse.json().catch(() => ({ error: 'Upload failed' }))
              throw new Error(errorData.error || 'Failed to upload file')
            }
            
            const uploadData = await uploadResponse.json()
            // File uploaded successfully
            
            // Handle the response format from the upload API
            const uploadedFile = uploadData.files?.[0]
            if (uploadedFile) {
              messageAttachments.push({
                fileName: uploadedFile.name,
                fileSize: uploadedFile.size,
                fileType: uploadedFile.mimetype || file.type,
                fileUrl: uploadedFile.url,
              })
            }
          } catch (uploadError) {
            // File upload error
            // Continue with other files but notify user of the error
            // TODO: Add proper error notification to user
          }
        }
      }
      
      // E2EE message sending only - no plaintext fallback
      if (!conversation?.isGroup && conversation?.otherParticipants[0]?.user) {
        try {
          console.log('Sending E2EE encrypted message...')
          
          const recipientUserId = conversation.otherParticipants[0].user.id;
          const recipientDeviceId = `${recipientUserId}-primary`;
          
          // Use the E2EE hook for proper encryption
          const message = { 
            content, 
            timestamp: Date.now(),
            conversationId 
          };
          const recipients = [{
            userId: recipientUserId,
            deviceId: recipientDeviceId
          }];
          
          // Send via E2EE API with proper encryption
          const encryptResult = await sendE2EEMessage(message, recipients);
          
          if (encryptResult.success) {
            console.log('✅ E2EE message sent successfully - stored as encrypted ciphertext only')
            setReplyTo(null)
            return
          } else {
            console.error('❌ E2EE encryption failed - message not sent to protect privacy')
            // Do not send unencrypted message - protect user privacy
            throw new Error('E2EE encryption failed')
          }
        } catch (e2eeError) {
          console.error('E2EE message failed:', e2eeError)
          console.error('❌ Message not sent - E2EE required for privacy protection')
          // Do not fall back to plaintext - this would compromise security
          return
        }
      } else {
        console.log('Group messages not yet supported with E2EE')
        // For now, group messages use regular API
        await sendMessage({
          content,
          conversationId,
          replyToId: replyTo?.id || undefined,
          ...(messageAttachments.length > 0 && { attachments: messageAttachments })
        })
        setReplyTo(null)
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      // Error handling is already done in the useMessages hook
    }
  }

  const handleSendVoiceMessage = async (audioBlob: Blob, duration: number) => {
    if (!conversationId || !session?.user) return
    try {
      // Use the enhanced auto-scroll for sent voice messages
      scrollOnSendMessage()
      const formData = new FormData()
      formData.append('voice', audioBlob, 'voice-message.webm')
      formData.append('duration', duration.toString())
      const resp = await fetch('/api/upload/voice', { method: 'POST', body: formData })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to upload voice message')
      }
      const data = await resp.json()
      await sendMessage({
        content: '',
        type: 'voice',
        conversationId,
        replyToId: replyTo?.id || undefined,
        attachments: [{
          fileName: data.filename,
          fileSize: data.size,
          fileType: 'audio/webm',
          fileUrl: data.fileUrl,
          duration: data.duration || duration,
        }],
      })
      setReplyTo(null)
    } catch (error) {
      console.error('Failed to send voice message:', error)
    }
  }

  const handleReply = (message: MessageBubbleMessage) => {
    setReplyTo(message)
  }

  const handleReact = (messageId: string, emoji: string) => {
    reactToMessage(messageId, emoji)
  }

  const handleEditMessage = async (messageId: string, newContent: string) => {
    try {
      const response = await fetch(`/api/messages/message/${messageId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: newContent,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to edit message')
      }

      // The useMessages hook will handle the real-time update via socket
    } catch (error) {
      console.error('Failed to edit message:', error)
      throw error
    }
  }

  const handleDeleteMessage = async (messageId: string) => {
    try {
      const response = await fetch(`/api/messages/message/${messageId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete message')
      }

      // The useMessages hook will handle the real-time update via socket
    } catch (error) {
      console.error('Failed to delete message:', error)
      throw error
    }
  }

  const handleHideMessage = async (messageId: string) => {
    // This is a client-side only operation - hide from current view
    // In a real implementation, you might want to store this preference
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement
    if (messageElement) {
      messageElement.style.display = 'none'
    }
  }

  const handleTyping = (isTyping: boolean) => {
    if (!socket || !conversationId || !session?.user) return

    const conversation = conversations.find(conv => conv.id === conversationId)
    
    if (isTyping) {
      socket.emit('typing-start', {
        conversationId: conversation?.isGroup ? null : conversationId,
        channelId: conversation?.isGroup ? conversationId : null,
        userId: session.user.id,
        username: session.user.name || session.user.username || 'Unknown'
      })
    } else {
      socket.emit('typing-stop', {
        conversationId: conversation?.isGroup ? null : conversationId,
        channelId: conversation?.isGroup ? conversationId : null,
        userId: session.user.id,
        username: session.user.name || session.user.username || 'Unknown'
      })
    }
  }

  const handleBlockToggle = async () => {
    if (!conversation?.otherParticipants[0]?.user?.id || isBlockLoading) return

    setIsBlockLoading(true)
    try {
      const method = isBlocked ? 'DELETE' : 'POST'
      const response = await fetch('/api/users/block', {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: conversation.otherParticipants[0].user.id,
        }),
      })

      if (response.ok) {
        setIsBlocked(!isBlocked)
        // TODO: Show success toast
      } else {
        const data = await response.json()
        console.error('Block/unblock error:', data.error)
        // TODO: Show error toast
      }
    } catch (error) {
      console.error('Error blocking/unblocking user:', error)
      // TODO: Show error toast
    } finally {
      setIsBlockLoading(false)
    }
  }

  const handleSearchConversation = () => {
    setShowSearch(true)
    setShowUserInfo(false)
  }

  const handleVoiceCall = () => {
    setCallType('voice')
    setShowCall(true)
    
    // Emit call initiation to other participants
    if (socket && conversation) {
      socket.emit('initiate_call', {
        conversationId,
        callType: 'voice',
        callerName: session?.user?.name || session?.user?.username,
        callerAvatar: session?.user?.image,
        conversationName: conversation.isGroup ? conversation.name : undefined,
        isGroupCall: conversation.isGroup,
        participantCount: conversation.isGroup ? conversation.participants?.length || 0 : 1,
      })
    }
  }

  const handleVideoCall = () => {
    setCallType('video')
    setShowCall(true)
    
    // Emit call initiation to other participants
    if (socket && conversation) {
      socket.emit('initiate_call', {
        conversationId,
        callType: 'video',
        callerName: session?.user?.name || session?.user?.username,
        callerAvatar: session?.user?.image,
        conversationName: conversation.isGroup ? conversation.name : undefined,
        isGroupCall: conversation.isGroup,
        participantCount: conversation.isGroup ? conversation.participants?.length || 0 : 1,
      })
    }
  }


  if (!conversationId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <div className="w-24 h-24 mx-auto mb-4 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center">
            <Video className="w-12 h-12" />
          </div>
          <h2 className="text-xl font-medium mb-2">Select a conversation</h2>
          <p>Choose a conversation from the sidebar to start chatting</p>
        </div>
      </div>
    )
  }

  if (messagesLoading || conversationsLoading) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 animate-pulse" />
        <div className="flex-1 p-4 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={`skeleton-${i}`} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
              <div className="flex items-end space-x-2 max-w-[70%]">
                {i % 2 === 0 && <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse" />}
                <div className="bg-gray-200 dark:bg-gray-700 rounded-2xl p-4 animate-pulse">
                  <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-32 animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (messagesError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center text-red-500 dark:text-red-400">
          <h2 className="text-xl font-medium mb-2">Error</h2>
          <p>{messagesError}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-3">
          {conversation?.isGroup ? (
            <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
              <span className="text-white font-medium">
                {conversation.participants.length}
              </span>
            </div>
          ) : (
            <div className="relative">
              {conversation?.otherParticipants[0]?.user.avatar ? (
                <img
                  src={conversation.otherParticipants[0].user.avatar}
                  alt={conversation.name || conversation.otherParticipants[0]?.user.name || 'User'}
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 bg-gray-400 rounded-full flex items-center justify-center">
                  <span className="text-white font-medium">
                    {(conversation?.name || conversation?.otherParticipants[0]?.user.name || conversation?.otherParticipants[0]?.user.username || 'U').charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              {conversation?.otherParticipants[0]?.user.isOnline && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full" />
              )}
            </div>
          )}
          
          <div>
            <h2 className="font-medium text-gray-900 dark:text-white">
              {conversation?.name || conversation?.otherParticipants[0]?.user.name || conversation?.otherParticipants[0]?.user.username || 'Unknown'}
            </h2>
            {conversation?.isGroup ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {conversation.participants.length} members
              </p>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {conversation?.otherParticipants[0]?.user.isOnline ? 'Online' : 'Offline'}
              </p>
            )}
            
            {/* E2EE Encryption Indicator - temporarily disabled */}
            {/* 
            {conversationId && (
              <div className="mt-1">
                <EncryptionIndicator 
                  conversationId={conversationId} 
                  showLabel={true}
                  className="text-xs"
                />
              </div>
            )}
            */}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* E2EE Security Button - temporarily disabled */}
          {/*
          {!conversation?.isGroup && (
            <button 
              onClick={() => {
                if (isAvailable) {
                  setShowSafetyNumber(true)
                } else {
                  setShowE2EESetup(true)
                }
              }}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
              title={isAvailable ? "View safety number" : "Setup encryption"}
            >
              <Shield className={`w-5 h-5 ${isAvailable ? 'text-green-600' : 'text-gray-400'}`} />
            </button>
          )}
          */}
          
          <button 
            onClick={handleVoiceCall}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <Phone className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <button 
            onClick={handleVideoCall}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <Video className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <button 
            onClick={() => conversation?.isGroup ? setShowGroupSettings(true) : setShowUserInfo(true)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <Info className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
        </div>
      </div>

      {/* Search Interface */}
      {showSearch && (
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center space-x-2">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="Search messages..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
                </div>
              )}
            </div>
            <button
              onClick={() => {
                setShowSearch(false)
                setSearchQuery('')
                setSearchResults([])
              }}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </button>
          </div>
          
          {searchResults.length > 0 && (
            <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
            </div>
          )}
        </div>
      )}

      {/* E2EE Setup Prompt - temporarily disabled */}
      {/*
      {!isAvailable && !conversation?.isGroup && !isInitializing && (
        <div className="border-b border-gray-200 dark:border-gray-700">
          <E2EESetupPrompt
            onSetup={async () => {
              try {
                await setupDevice();
              } catch (error) {
                console.error('E2EE setup failed:', error);
              }
            }}
            onDismiss={() => {
              // User dismissed the prompt, could store this preference
            }}
          />
        </div>
      )}
      */}

      {/* Messages */}
      <div 
        ref={messagesContainerRef}
        data-messages-container
        className="flex-1 overflow-y-auto p-4 space-y-4 relative"
      >
        {/* Load more indicator - positioned at the very top */}
        {messagesLoadingMore && (
          <div className="flex justify-center py-2 mb-2">
            <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 px-3 py-1 rounded-full">
              <div className="w-3 h-3 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
              <span>Loading older messages...</span>
            </div>
          </div>
        )}
        
        {/* Show "Load more" button if there are more messages and not currently loading */}
        {hasMore && !messagesLoadingMore && !showSearch && transformedMessages.length > 0 && (
          <div className="flex justify-center py-2 mb-2">
            <button
              onClick={() => {
                const container = messagesContainerRef.current
                if (container) {
                  scrollPositionRef.current = {
                    scrollTop: container.scrollTop,
                    scrollHeight: container.scrollHeight
                  }
                  loadMore()
                }
              }}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 bg-gray-50 dark:bg-gray-800 px-3 py-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Load older messages
            </button>
          </div>
        )}
        {showSearch && searchQuery ? (
          // Show search results
          searchResults.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
              <div className="text-center">
                <p className="text-lg mb-2">
                  {isSearching ? 'Searching...' : 'No messages found'}
                </p>
                {!isSearching && (
                  <p className="text-sm">Try different keywords</p>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-4">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  Showing search results for "{searchQuery}"
                </p>
              </div>
              {searchResults.map((message) => (
                <MessageBubble
                  key={`search-${message.id}`}
                  message={message}
                  onReply={handleReply}
                  onReact={handleReact}
                  onScrollToMessage={scrollToMessage}
                  onEdit={handleEditMessage}
                  onDelete={handleDeleteMessage}
                  onHideFromView={handleHideMessage}
                  scrollToMessageLoading={scrollToMessageLoading}
                />
              ))}
            </>
          )
        ) : (
          // Show regular messages
          transformedMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
              <div className="text-center">
                <p className="text-lg mb-2">No messages yet</p>
                <p className="text-sm">Start the conversation by sending a message</p>
              </div>
            </div>
          ) : (
            transformedMessages.map((message) => (
              <MessageBubble
                key={`msg-${message.id}`}
                message={message}
                onReply={handleReply}
                onReact={handleReact}
                onScrollToMessage={scrollToMessage}
                onEdit={handleEditMessage}
                onDelete={handleDeleteMessage}
                onHideFromView={handleHideMessage}
                scrollToMessageLoading={scrollToMessageLoading}
              />
            ))
          )
        )}

        {/* Typing indicators */}
        {typingUsers.length > 0 && (
          <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
            </div>
            <span>
              {typingUsers.length === 1 
                ? `${typingUsers[0].name} is typing...`
                : `${typingUsers.length} people are typing...`
              }
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            className="fixed bottom-24 right-8 w-10 h-10 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 z-10 flex items-center justify-center"
            aria-label="Scroll to bottom"
          >
            <ArrowDown className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Message Input */}
      <MessageInput
        onSendMessage={handleSendMessage}
        onSendVoiceMessage={handleSendVoiceMessage}
        onTyping={handleTyping}
        replyTo={replyTo ? {
          id: replyTo.id,
          content: replyTo.content,
          senderName: replyTo.senderName
        } : undefined}
        onCancelReply={() => setReplyTo(null)}
      />

      {/* E2EE Setup Prompt */}
      {showE2EESetup && (
        <E2EESetupPrompt
          onSetup={async () => {
            try {
              await setupDevice();
              setShowE2EESetup(false);
            } catch (error) {
              console.error('E2EE setup failed:', error);
            }
          }}
          onDismiss={() => setShowE2EESetup(false)}
        />
      )}

      {/* Safety Number Modal */}
      {showSafetyNumber && conversation?.otherParticipants[0]?.user && (
        <SafetyNumberModal
          userId={conversation.otherParticipants[0].user.id}
          userName={conversation.otherParticipants[0].user.name || conversation.otherParticipants[0].user.username || 'Unknown'}
          isOpen={showSafetyNumber}
          onClose={() => setShowSafetyNumber(false)}
        />
      )}

      {/* Group Settings Modal */}
      {conversationId && (
        <GroupSettings
          conversationId={conversationId}
          isOpen={showGroupSettings}
          onClose={() => setShowGroupSettings(false)}
          onGroupUpdated={() => {
            // Refresh conversations to update the group info
            // The useConversations hook will handle this automatically
          }}
          onLeftGroup={() => {
            // Refresh conversations when user leaves group
            // The useConversations hook will handle this automatically
          }}
        />
      )}

      {/* User Info Modal */}
      {conversationId && !conversation?.isGroup && conversation?.otherParticipants[0]?.user && (
        <UserInfoModal
          isOpen={showUserInfo}
          onClose={() => setShowUserInfo(false)}
          userId={conversation.otherParticipants[0].user.id}
          conversationId={conversationId}
          isBlocked={isBlocked}
          onBlockToggle={handleBlockToggle}
          onSearchConversation={handleSearchConversation}
          isBlockLoading={isBlockLoading}
        />
      )}

      {/* Call Modal */}
      {conversationId && conversation && (
        <CallModal
          isOpen={showCall}
          onClose={() => {
            // Emit call ended
            if (socket) {
              socket.emit('end_call', {
                conversationId,
                participantId: session?.user?.id,
              })
            }
            setShowCall(false)
          }}
          callType={callType}
          conversationId={conversationId}
          conversationName={conversation.isGroup ? conversation.name : undefined}
          isGroupCall={conversation.isGroup}
          participants={conversation.isGroup ? 
            conversation.participants?.map(p => ({
              id: p.user.id,
              name: p.user.name || p.user.username,
              username: p.user.username,
              avatar: p.user.avatar,
              isMuted: false,
              isCameraOff: callType === 'voice',
              isConnected: false,
            })) || [] :
            conversation.otherParticipants?.map(p => ({
              id: p.user.id,
              name: p.user.name || p.user.username,
              username: p.user.username,
              avatar: p.user.avatar,
              isMuted: false,
              isCameraOff: callType === 'voice',
              isConnected: false,
            })) || []
          }
          currentUserId={session?.user?.id || ''}
        />
      )}

      {/* Incoming Call Modal */}
      {incomingCall && (
        <IncomingCallModal
          isOpen={showIncomingCall}
          onAccept={() => {
            // Emit acceptance
            if (socket) {
              socket.emit('call_response', {
                conversationId,
                accepted: true,
                participantId: session?.user?.id,
              })
            }
            
            setShowIncomingCall(false)
            setShowCall(true)
            setCallType(incomingCall.callType)
            setIncomingCall(null)
          }}
          onDecline={() => {
            // Emit decline
            if (socket) {
              socket.emit('call_response', {
                conversationId,
                accepted: false,
                participantId: session?.user?.id,
              })
            }
            
            setShowIncomingCall(false)
            setIncomingCall(null)
          }}
          callType={incomingCall.callType}
          callerName={incomingCall.callerName}
          callerAvatar={incomingCall.callerAvatar}
          conversationName={incomingCall.conversationName}
          isGroupCall={incomingCall.isGroupCall}
          participantCount={incomingCall.participantCount}
        />
      )}

    </div>
  )
}