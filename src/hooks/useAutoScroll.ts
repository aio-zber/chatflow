'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useSocketContext } from '@/context/SocketContext'

interface UseAutoScrollOptions {
  conversationId: string | null
  messages: any[]
  userId: string | null
  messagesEndRef: React.RefObject<HTMLDivElement>
  setAutoScroll: (value: boolean) => void
  loadingMore?: boolean
  isPreservingScrollRef?: React.RefObject<boolean>
}

export const useAutoScroll = ({
  conversationId,
  messages,
  userId,
  messagesEndRef,
  setAutoScroll,
  loadingMore = false,
  isPreservingScrollRef
}: UseAutoScrollOptions) => {
  const { socket, isFullyInitialized } = useSocketContext()
  
  // Track last message timestamp for each conversation
  const lastMessageTimestampRef = useRef<Record<string, number>>({})
  
  // Track if we've performed initial auto-scroll for each conversation
  const hasInitialScrolledRef = useRef<Record<string, boolean>>({})
  
  // Track current conversation to handle switches properly
  const currentConversationRef = useRef<string | null>(null)
  
  // Stable scroll timeout reference
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Auto-scroll function with improved timing and reliability
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      try {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
        // Schedule setAutoScroll for next tick to avoid state updates during render
        setTimeout(() => setAutoScroll(true), 0)
      } catch (error) {
        // Fallback scroll method
        try {
          const container = messagesEndRef.current.parentElement
          if (container) {
            container.scrollTop = container.scrollHeight
            setTimeout(() => setAutoScroll(true), 0)
          }
        } catch (fallbackError) {
          // Silent fallback failure
        }
      }
    }
  }, [messagesEndRef, setAutoScroll])

  // Debounced scroll function to prevent multiple rapid scroll attempts
  const debouncedScrollToBottom = useCallback(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }
    
    scrollTimeoutRef.current = setTimeout(() => {
      scrollToBottom()
    }, 150)
  }, [scrollToBottom, conversationId])

  // Handle conversation changes with proper cleanup
  useEffect(() => {
    if (conversationId !== currentConversationRef.current) {
      // Clear any pending scroll operations when switching conversations
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
        scrollTimeoutRef.current = null
      }
      
      // Update current conversation reference
      if (conversationId) {
        currentConversationRef.current = conversationId
        // Reset scroll state for auto-scroll to bottom
        hasInitialScrolledRef.current[conversationId] = false
        
        // Force auto-scroll state to be enabled for new conversations
        setTimeout(() => setAutoScroll(true), 0)
      }
    }
  }, [conversationId])

  // Initial auto-scroll - scroll to bottom when opening conversation and messages are loaded
  useEffect(() => {
    if (!conversationId || !messages || messages.length === 0 || !userId) return

    // Don't auto-scroll if we're currently loading more messages or preserving scroll position
    if (loadingMore || (isPreservingScrollRef?.current)) return

    // Only proceed if we haven't scrolled for this conversation yet
    if (hasInitialScrolledRef.current[conversationId]) return

    // Wait a bit longer to ensure messages are rendered
    const scrollTimeout = setTimeout(() => {
      if (!hasInitialScrolledRef.current[conversationId] && !loadingMore && !(isPreservingScrollRef?.current)) {
        // Mark as scrolled immediately to prevent multiple attempts
        hasInitialScrolledRef.current[conversationId] = true
        
        // Scroll to bottom when opening conversation
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'instant', block: 'end' })
          // Schedule setAutoScroll for next tick to avoid state updates during render
          setTimeout(() => setAutoScroll(true), 0)
        }
      }
    }, 200) // Increased delay to ensure message rendering
    
    return () => clearTimeout(scrollTimeout)
  }, [conversationId, messages.length, userId, messagesEndRef, setAutoScroll, loadingMore, isPreservingScrollRef])

  // Enhanced fallback scroll mechanism - only if initial scroll failed
  useEffect(() => {
    if (!conversationId || !messages || messages.length === 0) return
    
    // Don't run fallback if we're currently loading more messages or preserving scroll position
    if (loadingMore || (isPreservingScrollRef?.current)) return
    
    // Only run fallbacks if initial scroll hasn't happened yet
    if (hasInitialScrolledRef.current[conversationId]) return
    
    // Fallback with longer timeout to ensure messages are rendered
    const fallbackTimeout = setTimeout(() => {
      if (messagesEndRef.current && !hasInitialScrolledRef.current[conversationId] && !loadingMore && !(isPreservingScrollRef?.current)) {
        hasInitialScrolledRef.current[conversationId] = true
        
        try {
          messagesEndRef.current.scrollIntoView({ behavior: 'instant', block: 'end' })
          setTimeout(() => setAutoScroll(true), 0)
        } catch (error) {
          // Try container scroll as backup
          const container = messagesEndRef.current.parentElement
          if (container) {
            container.scrollTop = container.scrollHeight
            setTimeout(() => setAutoScroll(true), 0)
          }
        }
      }
    }, 400) // Increased timeout to ensure messages are rendered

    return () => {
      clearTimeout(fallbackTimeout)
    }
  }, [conversationId, messages.length, messagesEndRef, setAutoScroll, loadingMore, isPreservingScrollRef])

  // Listen for new messages from ALL conversations and auto-scroll if currently viewing
  useEffect(() => {
    if (!socket || !isFullyInitialized || !conversationId || !userId) return

    const handleNewMessageForAutoScroll = (message: any) => {
      // Only auto-scroll if the message is for the current conversation
      if (message.conversationId !== conversationId) return
      
      // Don't auto-scroll for own messages (they're handled separately)
      if (message.senderId === userId) return

      // Check if this is a new message (not a duplicate)
      const messageTimestamp = new Date(message.createdAt).getTime()
      const lastTimestamp = lastMessageTimestampRef.current[conversationId] || 0
      
      if (messageTimestamp > lastTimestamp) {
        lastMessageTimestampRef.current[conversationId] = messageTimestamp
        
        // Use debounced scroll for new messages too
        debouncedScrollToBottom()
      }
    }

    socket.on('new-message', handleNewMessageForAutoScroll)

    return () => {
      socket.off('new-message', handleNewMessageForAutoScroll)
    }
  }, [socket, isFullyInitialized, conversationId, userId, debouncedScrollToBottom])

  // Update last message timestamp when messages change
  useEffect(() => {
    if (!conversationId || !messages || messages.length === 0) return

    const lastMessage = messages[messages.length - 1]
    if (lastMessage) {
      const timestamp = new Date(lastMessage.createdAt).getTime()
      lastMessageTimestampRef.current[conversationId] = Math.max(
        timestamp,
        lastMessageTimestampRef.current[conversationId] || 0
      )
    }
  }, [conversationId, messages])

  // Auto-scroll when user sends a message
  const scrollOnSendMessage = useCallback(() => {
    setTimeout(() => setAutoScroll(true), 0)
    // Immediate scroll for user's own messages
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messagesEndRef, setAutoScroll])

  // Force scroll to bottom (for manual triggers)
  const forceScrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
      setTimeout(() => setAutoScroll(true), 0)
    }
  }, [messagesEndRef, setAutoScroll])

  // Scroll to bottom when conversation changes - with proper timing
  const instantScrollToBottom = useCallback(() => {
    if (!conversationId || (isPreservingScrollRef?.current)) return
    
    // Clear the initial scroll flag to allow fresh scroll
    hasInitialScrolledRef.current[conversationId] = false
    
    // Wait for messages to be rendered before scrolling
    const scrollWithDelay = () => {
      if (messagesEndRef.current && !(isPreservingScrollRef?.current)) {
        messagesEndRef.current.scrollIntoView({ behavior: 'instant', block: 'end' })
        setTimeout(() => setAutoScroll(true), 0)
        hasInitialScrolledRef.current[conversationId] = true
      }
    }
    
    // Use requestAnimationFrame to ensure DOM updates are complete
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollWithDelay()
      })
    })
  }, [messagesEndRef, setAutoScroll, conversationId, isPreservingScrollRef])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  return {
    scrollToBottom,
    scrollOnSendMessage,
    forceScrollToBottom,
    instantScrollToBottom,
  }
}