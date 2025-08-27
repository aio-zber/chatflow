'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { MessageBubble } from './MessageBubble'
import { MessageInput } from './MessageInput'
import { GroupSettings } from './GroupSettings'
import { UserInfoModal } from './UserInfoModal'
import { CallModal } from './CallModal'

import { useMessages } from '@/hooks/useMessages'
import { useConversations } from '@/hooks/useConversations'
import { useSocketContext } from '@/context/SocketContext'
import { useNotifications } from '@/context/NotificationContext'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { Phone, Video, Info, ArrowDown, X, Shield } from 'lucide-react'
import { EncryptionIndicator, E2EESetupPrompt, SafetyNumberModal } from '@/components/e2ee/EncryptionIndicator'
import { useE2EE } from '@/hooks/useE2EE'

// Message interface for MessageBubble compatibility
interface MessageBubbleMessage {
  id: string
  content: string
  type: string
  isSystem?: boolean
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
  const { playNotificationSound } = useNotifications()
  const { conversations, loading: conversationsLoading, markConversationAsRead, forceRefreshKey, triggerRefresh } = useConversations()
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
  const [callId, setCallId] = useState<string | null>(null)
  const [isInitiatingCall, setIsInitiatingCall] = useState(false)

  
  // E2EE state
  const [showE2EESetup, setShowE2EESetup] = useState(false)
  const [showSafetyNumber, setShowSafetyNumber] = useState(false)
  const { isAvailable, isInitializing, setupDevice, getEncryptionStatus, sendMessage: sendE2EEMessage, decryptMessage } = useE2EE()
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const scrollPositionRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)
  const ringingAudioRef = useRef<HTMLAudioElement | null>(null)
  const previousMessageCountRef = useRef<number>(0)
  const conversationOpenTimeRef = useRef<Record<string, number>>({})
  const isPreservingScrollRef = useRef<boolean>(false)
  const messageCountRef = useRef<number>(0)

  // Find the current conversation from the conversations list
  const conversation = conversations.find(conv => conv.id === conversationId)
  
  // Add a forced refresh state for group changes
  const [groupRefreshKey, setGroupRefreshKey] = useState(0)

  // Ringing sound functionality
  const playRingingSound = () => {
    try {
      if (!ringingAudioRef.current) {
        // Create a simple beep sound using Web Audio API since we don't have a file
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
        const oscillator = audioContext.createOscillator()
        const gainNode = audioContext.createGain()
        
        oscillator.connect(gainNode)
        gainNode.connect(audioContext.destination)
        
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime)
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime)
        
        oscillator.start()
        oscillator.stop(audioContext.currentTime + 0.5)
        
        // Repeat every 2 seconds
        const interval = setInterval(() => {
          if (false) { // Disabled - incoming calls handled by GlobalCallManager
            const newOscillator = audioContext.createOscillator()
            const newGainNode = audioContext.createGain()
            
            newOscillator.connect(newGainNode)
            newGainNode.connect(audioContext.destination)
            
            newOscillator.frequency.setValueAtTime(800, audioContext.currentTime)
            newGainNode.gain.setValueAtTime(0.3, audioContext.currentTime)
            
            newOscillator.start()
            newOscillator.stop(audioContext.currentTime + 0.5)
          } else {
            clearInterval(interval)
          }
        }, 2000)
      }
    } catch (error) {
      console.warn('Error with ringing sound:', error)
    }
  }

  const stopRingingSound = () => {
    // Sound stops automatically when incoming call modal closes
  }

  // Debug: Log when conversation participants change and force single re-render
  useEffect(() => {
    if (conversation?.isGroup) {
      console.log(`🔄 ChatWindow: Conversation participants count: ${conversation.participants.length}`)
      console.log(`🔄 ChatWindow: Participants:`, conversation.participants.map(p => ({ userId: p.userId, name: p.user.name })))
      
      // Force single re-render to ensure UI updates
      setGroupRefreshKey(prev => prev + 1)
    }
  }, [conversation?.participants?.length, conversation?.participants])

  // Add direct socket listeners for group member events to force immediate updates
  useEffect(() => {
    if (!socket || !conversationId || !conversation?.isGroup) return

    const handleGroupMemberAdded = (data: { conversationId: string; member: any }) => {
      if (data.conversationId === conversationId) {
        console.log('📥 ChatWindow: Group member added event received, forcing immediate UI update')
        console.log('📥 New member:', data.member)
        
        // Force UI update for header member count (single update)
        setGroupRefreshKey(prev => prev + 1)
      }
    }

    const handleGroupMemberLeft = (data: { conversationId: string; memberId: string }) => {
      if (data.conversationId === conversationId) {
        console.log('📤 ChatWindow: Group member left event received, forcing immediate UI update')
        console.log('📤 Member left:', data.memberId)
        
        // Force UI update for header member count (single update)
        setGroupRefreshKey(prev => prev + 1)
      }
    }

    const handleGroupMemberRemoved = (data: { conversationId: string; removedMember: any }) => {
      if (data.conversationId === conversationId) {
        console.log('🗑️ ChatWindow: Group member removed event received, forcing immediate UI update')
        console.log('🗑️ Removed member:', data.removedMember)
        
        // Force UI update for header member count (single update)
        setGroupRefreshKey(prev => prev + 1)
      }
    }

    socket.on('group-member-added', handleGroupMemberAdded)
    socket.on('group-member-left', handleGroupMemberLeft)
    socket.on('group-member-removed', handleGroupMemberRemoved)

    return () => {
      socket.off('group-member-added', handleGroupMemberAdded)
      socket.off('group-member-left', handleGroupMemberLeft)
      socket.off('group-member-removed', handleGroupMemberRemoved)
    }
  }, [socket, conversationId, conversation?.isGroup])

  // Add socket listener for call initiated event
  useEffect(() => {
    if (!socket || !conversationId) return

    const handleCallInitiated = (data: {
      callId: string
      conversationId: string
      callType: 'voice' | 'video'
      status: string
      onlineParticipants?: number
    }) => {
      // Only handle if this is for our conversation
      if (data.conversationId === conversationId) {
        console.log(`📞 Call initiated with ID: ${data.callId}, type: ${data.callType}`)
        setCallId(data.callId)
        setCallType(data.callType)
        setShowCall(true) // Now show the call modal with the callId
      }
    }

    const handleCallEnded = (data: { conversationId: string; callId?: string; reason?: string }) => {
      console.log(`[ChatWindow] call_ended event received:`, data)
      console.log(`[ChatWindow] Our conversationId: ${conversationId}`)
      console.log(`[ChatWindow] Event conversationId: ${data.conversationId}`)
      console.log(`[ChatWindow] Match: ${data.conversationId === conversationId}`)
      console.log(`[ChatWindow] Current callId: ${callId}`)
      console.log(`[ChatWindow] Event callId: ${data.callId}`)
      console.log(`[ChatWindow] Current showCall: ${showCall}`)
      
      if (data.conversationId === conversationId) {
        console.log(`[ChatWindow] ✅ Processing call_ended for our conversation ${conversationId}, reason: ${data.reason}`)
        setShowCall(false)
        setCallId(null)
        console.log(`[ChatWindow] ✅ Call state cleared - showCall: false, callId: null`)
      } else {
        console.log(`[ChatWindow] ❌ Ignoring call_ended for different conversation`)
      }
    }

    const handleCallError = (data: { error: string }) => {
      console.error(`[CALL UI] Call error:`, data)
      setShowCall(false)
      setCallId(null)
    }

    socket.on('call_initiated', handleCallInitiated)
    socket.on('call_ended', handleCallEnded)
    socket.on('call_error', handleCallError)

    return () => {
      socket.off('call_initiated', handleCallInitiated)
      socket.off('call_ended', handleCallEnded)
      socket.off('call_error', handleCallError)
    }
  }, [socket, conversationId, session?.user?.id])

  // Decrypt E2EE message helper function
  const decryptE2EEContent = async (content: string): Promise<string> => {
    if (!content.startsWith('🔐') || !isAvailable) {
      return content // Not encrypted or E2EE not available
    }
    
    try {
      // Use the centralized decryption function with backward compatibility
      const encryptedData = content.substring(2) // Remove 🔐 prefix
      const decrypted = await decryptMessage(encryptedData, conversationId)
      
      if (decrypted && decrypted.trim().length > 0) {
        console.log('🔓 E2EE: Successfully decrypted message content')
        return decrypted
      } else {
        // Try to provide more helpful feedback for failed decryption
        console.warn('🔐 E2EE: Failed to decrypt message - might be legacy/corrupted data')
        
        // Check if this appears to be valid encrypted data format
        if (encryptedData.includes(':') && encryptedData.length > 20) {
          return '🔒 Message encrypted with unavailable key'
        } else {
          return '🔒 Corrupted encrypted message'
        }
      }
    } catch (error) {
      console.warn('🔐 E2EE: Error during decryption:', error.message)
      return '🔒 Unable to decrypt message'
    }
  }

  // Transform API messages to MessageBubble format with E2EE decryption
  const [decryptedContents, setDecryptedContents] = useState<Record<string, string>>({})
  
  // Decrypt messages as needed
  useEffect(() => {
    const decryptMessages = async () => {
      const newDecryptedContents: Record<string, string> = {}
      
      for (const msg of messages) {
        if (msg.content.startsWith('🔐') && !decryptedContents[msg.id]) {
          const decrypted = await decryptE2EEContent(msg.content)
          newDecryptedContents[msg.id] = decrypted
        }
      }
      
      if (Object.keys(newDecryptedContents).length > 0) {
        setDecryptedContents(prev => ({ ...prev, ...newDecryptedContents }))
      }
    }
    
    decryptMessages()
  }, [messages, conversationId, isAvailable])

  const transformedMessages: MessageBubbleMessage[] = messages.map(msg => {
    // For encrypted messages, only show them once they're decrypted to prevent flash
    let content = msg.content
    if (msg.content.startsWith('🔐')) {
      // If we have the decrypted content, use it, otherwise show loading state
      content = decryptedContents[msg.id] || '🔓 Decrypting message...'
    }
    
    return {
      id: msg.id,
      content,
      type: msg.type,
      isSystem: msg.isSystem ?? false,
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
    }
  })

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
  const { scrollToBottom, scrollOnSendMessage, forceScrollAfterRefresh, instantScrollToBottom } = useAutoScroll({
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

  // Auto-scroll after forced refresh (when forceRefreshKey changes)
  useEffect(() => {
    if (conversationId && !messagesLoading && transformedMessages.length > 0 && !messagesLoadingMore && !isPreservingScrollRef.current && forceRefreshKey > 0) {
      console.log('🔄 ChatWindow: Auto-scrolling after forced refresh, key:', forceRefreshKey)
      // Use the specialized force scroll function for refreshes
      setTimeout(() => {
        forceScrollAfterRefresh()
      }, 200) // Delay to ensure DOM updates are complete
    }
  }, [forceRefreshKey, conversationId, messagesLoading, transformedMessages.length, messagesLoadingMore, forceScrollAfterRefresh])

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

  // Listen for blocking/unblocking events in real-time
  useEffect(() => {
    if (!socket || !conversation?.otherParticipants[0]?.user?.id) return

    const otherUserId = conversation.otherParticipants[0].user.id

    const handleUserBlocked = (data: { blocker: any; blocked: any; blockedAt: string }) => {
      console.log('ChatWindow: User blocked event received:', data)
      // Check if this affects the current conversation
      if ((data.blocker.id === session?.user?.id && data.blocked.id === otherUserId) ||
          (data.blocked.id === session?.user?.id && data.blocker.id === otherUserId)) {
        console.log('ChatWindow: Setting blocked status to true for current conversation')
        setIsBlocked(true)
      }
    }

    const handleUserUnblocked = (data: { unblocker: any; unblocked: any; unblockedAt: string }) => {
      console.log('ChatWindow: User unblocked event received:', data)
      // Check if this affects the current conversation
      if ((data.unblocker.id === session?.user?.id && data.unblocked.id === otherUserId) ||
          (data.unblocked.id === session?.user?.id && data.unblocker.id === otherUserId)) {
        console.log('ChatWindow: Setting blocked status to false for current conversation')
        setIsBlocked(false)
      }
    }

    socket.on('user-blocked', handleUserBlocked)
    socket.on('user-unblocked', handleUserUnblocked)

    return () => {
      socket.off('user-blocked', handleUserBlocked)
      socket.off('user-unblocked', handleUserUnblocked)
    }
  }, [socket, conversation?.otherParticipants, session?.user?.id])

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

  // Listen for message status updates
  useEffect(() => {
    if (!socket || !session?.user?.id) return

    const handleMessageStatusUpdate = (data: { messageId: string; status: 'delivered' | 'read'; userId: string }) => {
      if (data.userId === session.user.id) {
        // Update the local message status for sent messages
        // This would typically be handled by the messages hook/state management
        console.log(`Message ${data.messageId} status updated to: ${data.status}`)
      }
    }

    socket.on('message-status-updated', handleMessageStatusUpdate)

    return () => {
      socket.off('message-status-updated', handleMessageStatusUpdate)
    }
  }, [socket, session?.user?.id])

  // Mark individual messages as read when they come into view
  useEffect(() => {
    if (conversationId && messages.length > 0 && session?.user?.id) {
      const unreadMessages = messages.filter(msg => 
        msg.senderId !== session.user.id && 
        (msg.status === 'unread' || msg.status === 'delivered')
      )
      
      if (unreadMessages.length > 0) {
        const timer = setTimeout(async () => {
          // Mark each message as read individually to update sender's status
          for (const message of unreadMessages) {
            try {
              await fetch(`/api/messages/message/${message.id}/read`, {
                method: 'PATCH',
                credentials: 'include'
              })
            } catch (error) {
              console.error('Failed to mark message as read:', error)
            }
          }
        }, 1000)
        
        return () => clearTimeout(timer)
      }
    }
  }, [conversationId, messages, session?.user?.id])

  // Play notification sound for new messages
  useEffect(() => {
    if (!socket || !conversationId || !session?.user?.id) return

    // Update message count ref whenever messages change
    messageCountRef.current = messages.length

    const handleNewMessage = (message: any) => {
      // Only play notification if:
      // 1. Message is for current conversation
      // 2. Message is not from current user
      // 3. Current tab/window is not focused (user might not see it immediately)
      if (message.conversationId === conversationId && 
          message.senderId !== session.user.id) {
        
        console.log('🔊 Playing notification sound for new message in current conversation')
        playNotificationSound()
      }
    }

    const handleMessageUpdate = (updatedMessage: any) => {
      // Handle message updates (like call trace messages being updated)
      if (updatedMessage.conversationId === conversationId) {
        console.log('📝 Message updated in current conversation:', updatedMessage.id)
        // The useMessages hook should handle this automatically via its listeners
        // but we could trigger a refresh if needed
      }
    }

    socket.on('new-message', handleNewMessage)
    socket.on('message-updated', handleMessageUpdate)

    return () => {
      socket.off('new-message', handleNewMessage)
      socket.off('message-updated', handleMessageUpdate)
    }
  }, [socket, conversationId, session?.user?.id, playNotificationSound])

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
        // Debug logging removed for performance
        const transformedResults: MessageBubbleMessage[] = []
        
        // Process each message and filter based on decrypted content
        for (const msg of data.messages) {
          let content = msg.content
          let shouldInclude = false
          
          // System and call messages should always be included if they match the query
          if (msg.type === 'system' || msg.type === 'call') {
            shouldInclude = content.toLowerCase().includes(query.toLowerCase())
          } else if (msg.content && msg.content.startsWith('🔐')) {
            // Handle encrypted messages - decrypt and check content
            if (isAvailable && decryptMessage) {
              try {
                const encryptedData = msg.content.substring(2) // Remove 🔐 prefix
                const decryptedContent = await decryptMessage(encryptedData, conversationId)
                if (decryptedContent && decryptedContent.trim()) {
                  content = decryptedContent
                  // Check if decrypted content matches search query
                  shouldInclude = content.toLowerCase().includes(query.toLowerCase())
                } else {
                  // Failed to decrypt or empty result - skip this message
                  continue
                }
              } catch (error) {
                console.warn('Failed to decrypt message during search:', error)
                // Decryption failed - skip this message silently
                continue
              }
            } else {
              // E2EE not available, skip encrypted messages
              console.warn('E2EE not available for decrypting search result')
              continue
            }
          } else {
            // Plain text message, check if it matches search query
            shouldInclude = content.toLowerCase().includes(query.toLowerCase())
          }
          
          // Only include messages that match the search query after decryption
          if (shouldInclude) {
            transformedResults.push({
              id: msg.id,
              content,
              type: msg.type,
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
            })
          }
        }
        // Debug logging removed for performance
        setSearchResults(transformedResults)
      } else {
        // Handle API errors
        const errorData = await response.json().catch(() => ({}))
        console.error('Search API error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData.error,
          details: errorData.details
        })
        setSearchResults([])
      }
    } catch (error) {
      console.error('Error searching messages:', error)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }, [conversationId, isAvailable, decryptMessage])

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

  // E2EE integration through regular message flow (no polling needed)
  // Messages are encrypted before sending and decrypted when displaying

  // Message notifications
  useEffect(() => {
    // Request notification permission on component mount
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  // Listen for new messages via socket for notifications and auto-scroll
  useEffect(() => {
    if (!socket) return

    const handleNewMessage = async (data: any) => {
      // Auto-scroll to new message if user is viewing this conversation
      if (data.conversationId === conversationId && data.senderId !== session?.user?.id) {
        // Small delay to ensure message is rendered
        setTimeout(() => {
          scrollToBottom()
        }, 100)
      }

      // Only show notification if:
      // 1. Message is not from current user
      // 2. User is not currently viewing this conversation (or tab is not active)
      // 3. Notifications are permitted
      if (
        data.senderId !== session?.user?.id &&
        (data.conversationId !== conversationId || document.hidden) &&
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        const senderName = data.sender?.name || data.sender?.username || 'Someone'
        const conversationName = data.conversation?.name || senderName
        
        // Get appropriate message preview
        const getNotificationContent = async () => {
          // Handle encrypted messages
          if (data.content?.startsWith('🔐')) {
            try {
              const encryptedData = data.content.substring(2) // Remove 🔐 prefix
              const decryptedContent = await decryptMessage(encryptedData, data.conversationId)
              if (decryptedContent && decryptedContent !== '[Encrypted message - decryption failed]') {
                return decryptedContent.substring(0, 50) + (decryptedContent.length > 50 ? '...' : '')
              }
            } catch (error) {
              console.warn('Failed to decrypt notification message:', error)
            }
            return 'New encrypted message'
          }
          
          // Handle unsent/deleted messages
          if (data.content === '[Message deleted]') {
            return `${senderName} unsent a message`
          }
          
          // Handle different message types
          if (data.type === 'voice') {
            return `${senderName} sent a voice message`
          } else if (data.type === 'image') {
            return `${senderName} sent an image`
          } else if (data.type === 'file') {
            return `${senderName} sent an attachment`
          }
          
          // Regular text message
          return data.content?.substring(0, 50) + (data.content?.length > 50 ? '...' : '')
        }
        
        const messageContent = await getNotificationContent()

        new Notification(`${senderName} in ${conversationName}`, {
          body: messageContent,
          icon: data.sender?.avatar || '/default-avatar.png',
          tag: `message-${data.conversationId}`, // Prevent spam
          requireInteraction: false
        })
      }
    }

    socket.on('new-message', handleNewMessage)
    
    return () => {
      socket.off('new-message', handleNewMessage)
    }
  }, [socket, session?.user?.id, conversationId, scrollToBottom])

  // Socket integration for call management (outgoing calls only, incoming handled globally)
  useEffect(() => {
    if (socket && conversationId) {
      // Listen for call accepted/declined (for outgoing calls)
      socket.on('call_response', (data: {
        accepted: boolean
        participantId: string
        conversationId: string
      }) => {
        if (data.conversationId === conversationId) {
          // Handle call response (for group calls, multiple responses expected)
          console.log(`[CALL UI] Call ${data.accepted ? 'accepted' : 'declined'} by participant ${data.participantId}`)
        }
      })

      // Note: call_initiated, call_ended, and call_error events are handled in a separate useEffect block

      return () => {
        socket.off('call_response')
      }
    }
  }, [socket, conversationId, session?.user?.id])

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
      
      // Use E2EE encryption if available, but send through regular API
      let messageContent = content
      if (isAvailable && conversation && content.trim().length > 0) {
        try {
          console.log('🔐 Encrypting message content...')
          
          // Encrypt the message content using Web Crypto API
          const encoder = new TextEncoder()
          const data = encoder.encode(content)
          
          // Generate a random IV (12 bytes for AES-GCM)
          const iv = crypto.getRandomValues(new Uint8Array(12))
          
          // Create encryption key from conversation ID
          const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(`conversation-key-${conversationId}`),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
          )
          
          const key = await crypto.subtle.deriveKey(
            {
              name: 'PBKDF2',
              salt: encoder.encode('chatflow-e2ee-salt'),
              iterations: 100000,
              hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
          )
          
          // Encrypt the content
          const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            data
          )
          
          // Encode as base64 with IV
          const ivBase64 = btoa(String.fromCharCode(...iv))
          const encryptedBase64 = btoa(String.fromCharCode(...new Uint8Array(encrypted)))
          messageContent = `🔐${ivBase64}:${encryptedBase64}` // Prefix to identify encrypted messages
          
          console.log('🔐 Message encrypted successfully')
        } catch (encryptError) {
          console.warn('E2EE encryption failed, sending as plaintext:', encryptError)
          // Continue with unencrypted message
        }
      }
      
      // Send message through regular API (with encrypted content if E2EE is enabled)
      await sendMessage({
        content: messageContent,
        conversationId,
        replyToId: replyTo?.id || undefined,
        ...(messageAttachments.length > 0 && { attachments: messageAttachments })
      })

      // Auto-scroll after message is sent
      scrollOnSendMessage()
      setReplyTo(null)
    } catch (error) {
      console.error('Failed to send message:', error)
      // Error handling is already done in the useMessages hook
    }
  }

  const handleSendVoiceMessage = async (audioBlob: Blob, duration: number) => {
    if (!conversationId || !session?.user) return
    try {
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

      // Auto-scroll after voice message is sent
      scrollOnSendMessage()
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

  const handleDeleteForMe = async (messageId: string) => {
    try {
      const response = await fetch(`/api/messages/manage/${messageId}/hide`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete message for you')
      }

      // Remove the message from the local state immediately
      const messageElement = document.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement
      if (messageElement) {
        messageElement.style.transition = 'opacity 0.3s ease, height 0.3s ease'
        messageElement.style.opacity = '0'
        messageElement.style.height = '0'
        messageElement.style.marginBottom = '0'
        messageElement.style.paddingTop = '0'
        messageElement.style.paddingBottom = '0'
        
        setTimeout(() => {
          messageElement.style.display = 'none'
        }, 300)
      }
    } catch (error) {
      console.error('Failed to delete message for me:', error)
      throw error
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
    const targetUserId = conversation.otherParticipants[0].user.id
    const wasBlocked = isBlocked
    
    try {
      console.log(`🚫 ChatWindow: ${isBlocked ? 'Unblocking' : 'Blocking'} user ${targetUserId}`)
      
      // Immediately update the UI state for instant feedback
      setIsBlocked(!isBlocked)
      
      const method = wasBlocked ? 'DELETE' : 'POST'
      const response = await fetch('/api/users/block', {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: targetUserId,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        console.log(`🚫 ChatWindow: ${wasBlocked ? 'Unblock' : 'Block'} success:`, data.message)
        
        // Socket events should also handle updating other components in real-time
        // Keep the immediate state update we made above
        
        // Force immediate conversation list refresh in addition to socket events
        if (socket) {
          console.log('🔄 CRITICAL: ChatWindow triggering conversation refresh after block/unblock')
          socket.emit('request-conversation-refresh', { userId: session?.user?.id })
          
          // Additional forced refresh triggers
          setTimeout(() => {
            socket.emit('request-conversation-refresh', { userId: session?.user?.id })
          }, 100)
          
          setTimeout(() => {
            socket.emit('request-conversation-refresh', { userId: session?.user?.id })
          }, 500)
        }
      } else {
        const data = await response.json()
        console.error(`🚫 ChatWindow: ${wasBlocked ? 'Unblock' : 'Block'} error:`, data.error)
        
        // Revert the immediate state update on error
        setIsBlocked(wasBlocked)
      }
    } catch (error) {
      console.error('Error blocking/unblocking user:', error)
      
      // Revert the immediate state update on error
      setIsBlocked(wasBlocked)
    } finally {
      setIsBlockLoading(false)
    }
  }

  const handleSearchConversation = () => {
    setShowSearch(true)
    setShowUserInfo(false)
  }

  const handleVoiceCall = () => {
    // Prevent duplicate call initiation
    if (isInitiatingCall) {
      console.log('🎤 [CHAT] Call initiation already in progress, ignoring duplicate request')
      return
    }
    
    console.log('🎤 [CHAT] Voice call initiated for conversation:', conversationId)
    setIsInitiatingCall(true)
    setCallType('voice')
    
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
        callerId: session?.user?.id,
      })
      
      // Reset initiation flag after a delay to allow for retries if needed
      setTimeout(() => {
        setIsInitiatingCall(false)
      }, 3000)
    } else {
      setIsInitiatingCall(false)
    }
  }

  const handleVideoCall = () => {
    // Prevent duplicate call initiation
    if (isInitiatingCall) {
      console.log('📹 [CHAT] Call initiation already in progress, ignoring duplicate request')
      return
    }
    
    console.log('📹 [CHAT] Video call initiated for conversation:', conversationId)
    setIsInitiatingCall(true)
    setCallType('video')
    
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
        callerId: session?.user?.id,
      })
      
      // Reset initiation flag after a delay to allow for retries if needed
      setTimeout(() => {
        setIsInitiatingCall(false)
      }, 3000)
    } else {
      setIsInitiatingCall(false)
    }
  }

  // Test function to directly test media access (can be removed after testing)
  const testMediaAccess = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      stream.getTracks().forEach(track => track.stop())
      alert('✅ Media access test successful!')
    } catch (error) {
      alert('❌ Media access test failed: ' + (error as Error).message)
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
              <p className="text-sm text-gray-500 dark:text-gray-400" key={`member-count-${groupRefreshKey}-${forceRefreshKey}`}>
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
            onClick={testMediaAccess}
            className="p-2 hover:bg-red-100 dark:hover:bg-red-700 rounded-full focus:outline-none focus:ring-2 focus:ring-red-500"
            title="Test Media Access"
          >
            🧪
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
                  onDeleteForMe={handleDeleteForMe}
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
                onDeleteForMe={handleDeleteForMe}
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
          onGroupUpdated={(updatedGroup) => {
            console.log('🔄 Group updated in GroupSettings:', updatedGroup)
            console.log('🔄 New member count:', updatedGroup.participants.length)
            // The conversation object should automatically update via useConversations
          }}
          onLeftGroup={() => {
            // Refresh conversations when user leaves group
            // The useConversations hook will handle this automatically
          }}
          onSearchConversation={handleSearchConversation}
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

      {/* Call Modal - only render when we have a callId */}
      {showCall && callId && (
        <CallModal
          isOpen={true}
          onClose={() => {
            console.log('[ChatWindow] CallModal onClose called')
            // Don't emit end_call here - let CallModal handle it
            setShowCall(false)
            setCallId(null)
          }}
          callType={callType}
          callId={callId}
          conversationId={conversationId || ''}
          conversationName={conversation?.isGroup ? conversation.name : undefined}
          isGroupCall={conversation?.isGroup || false}
          participants={conversation?.isGroup ? 
            conversation?.participants?.map(p => ({
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

        />
      )}



    </div>
  )
}