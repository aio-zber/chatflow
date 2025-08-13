'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { MessageBubble } from './MessageBubble'
import { MessageInput } from './MessageInput'
import { GroupSettings } from './GroupSettings'
import { useMessages } from '@/hooks/useMessages'
import { useConversations } from '@/hooks/useConversations'
import { useSocketContext } from '@/context/SocketContext'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { Phone, Video, Info, Search, ArrowDown, X, UserX, UserCheck } from 'lucide-react'

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
  const { messages, loading: messagesLoading, error: messagesError, sendMessage, loadMore, hasMore, markMessagesAsRead, reactToMessage, scrollToMessage } = useMessages(conversationId)
  const [replyTo, setReplyTo] = useState<MessageBubbleMessage | null>(null)
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<MessageBubbleMessage[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isBlocked, setIsBlocked] = useState(false)
  const [isBlockLoading, setIsBlockLoading] = useState(false)
  const [showGroupSettings, setShowGroupSettings] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

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

  // Reset reply state and search when conversation changes
  useEffect(() => {
    setReplyTo(null)
    setShowSearch(false)
    setSearchQuery('')
    setSearchResults([])
    setIsBlocked(false)
    
    // Immediate scroll to bottom when conversation changes and has messages
    if (conversationId && transformedMessages.length > 0) {
      // Use multiple methods to ensure scroll happens
      requestAnimationFrame(() => {
        // First try: scroll to the ref
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'instant', block: 'end' })
        }
        
        // Second try: scroll the container
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
        }
        
        setAutoScroll(true)
      })
      
      // Additional delayed scroll to ensure it works with async content
      setTimeout(() => {
        requestAnimationFrame(() => {
          if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'instant', block: 'end' })
          }
          if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
          }
        })
      }, 100)
    }
  }, [conversationId, transformedMessages.length])

  // Use the new auto-scroll hook for multi-websocket support
  const { scrollToBottom, scrollOnSendMessage } = useAutoScroll({
    conversationId,
    messages,
    userId: session?.user?.id || null,
    messagesEndRef,
    setAutoScroll,
  })

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

    // Load more messages when scrolling near the top
    if (isNearTop && hasMore && !messagesLoading && !isLoadingMore && !showSearch) {
      setIsLoadingMore(true)
      loadMore().finally(() => setIsLoadingMore(false))
    }
  }, [transformedMessages.length, hasMore, messagesLoading, isLoadingMore, showSearch, loadMore])

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
      
      let messageAttachments: any[] = []
      
      // Handle file uploads if attachments are provided
      if (attachments && attachments.length > 0) {
        console.log('Processing file attachments:', attachments.length)
        
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
            console.log('File uploaded successfully:', uploadData)
            
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
            console.error('Error uploading file:', file.name, uploadError)
            // Continue with other files but notify user of the error
            // TODO: Add proper error notification to user
          }
        }
      }
      
      await sendMessage({
        content,
        conversationId,
        replyToId: replyTo?.id || undefined,
        ...(messageAttachments.length > 0 && { attachments: messageAttachments })
      })
      setReplyTo(null)
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
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`)
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

  if (!conversationId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <div className="w-24 h-24 mx-auto mb-4 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center">
            <Search className="w-12 h-12" />
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
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button 
            onClick={() => setShowSearch(!showSearch)}
            className={`p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              showSearch ? 'bg-gray-100 dark:bg-gray-700' : ''
            }`}
          >
            <Search className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          
          {/* Block/Unblock button - only show for direct messages */}
          {!conversation?.isGroup && conversation?.otherParticipants[0]?.user && (
            <button
              onClick={handleBlockToggle}
              disabled={isBlockLoading}
              className={`p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                isBlocked
                  ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
                  : 'text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
              } ${isBlockLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={isBlocked ? 'Unblock user' : 'Block user'}
            >
              {isBlockLoading ? (
                <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
              ) : isBlocked ? (
                <UserCheck className="w-5 h-5" />
              ) : (
                <UserX className="w-5 h-5" />
              )}
            </button>
          )}
          
          <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500">
            <Phone className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500">
            <Video className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <button 
            onClick={() => conversation?.isGroup ? setShowGroupSettings(true) : null}
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

      {/* Messages */}
      <div 
        ref={messagesContainerRef}
        data-messages-container
        className="flex-1 overflow-y-auto p-4 space-y-4 relative"
      >
        {/* Load more indicator */}
        {isLoadingMore && (
          <div className="flex justify-center py-4">
            <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
              <span>Loading more messages...</span>
            </div>
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
    </div>
  )
}