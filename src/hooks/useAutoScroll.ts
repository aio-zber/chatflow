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

  // Simplified and more reliable auto-scroll function
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      try {
        // First try direct container scroll which is more reliable
        const container = messagesEndRef.current.parentElement
        if (container) {
          container.scrollTop = container.scrollHeight
          setTimeout(() => setAutoScroll(true), 0)
        } else {
          // Fallback to scrollIntoView
          messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
          setTimeout(() => setAutoScroll(true), 0)
        }
      } catch (error) {
        console.warn('Auto-scroll failed:', error)
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

    // Only skip auto-scroll if we're preserving scroll position (loading older messages)
    // Don't skip for initial loading of a conversation
    if (isPreservingScrollRef?.current) return

    // Only proceed if we haven't scrolled for this conversation yet
    if (hasInitialScrolledRef.current[conversationId]) return

    // Mark as scrolled immediately to prevent multiple attempts
    hasInitialScrolledRef.current[conversationId] = true

    // Wait for messages to be fully rendered before scrolling
    const attemptScroll = (attempt: number = 1) => {
      if (messagesEndRef.current && !(isPreservingScrollRef?.current)) {
        const container = messagesEndRef.current.parentElement
        if (container) {
          // Force scroll to absolute bottom
          container.scrollTop = container.scrollHeight
          setTimeout(() => setAutoScroll(true), 0)
          console.log(`Auto-scroll: Successfully scrolled to bottom for conversation ${conversationId}`)
        } else if (attempt < 5) {
          // Retry if container not found, with more attempts for conversations with many messages
          setTimeout(() => attemptScroll(attempt + 1), 100 * attempt)
        }
      }
    }

    // Use progressive delays to handle conversations with many messages
    const scrollWithProgression = () => {
      // First attempt immediately
      attemptScroll(1)
      
      // Additional attempts with longer delays for conversations with many messages
      if (messages.length > 50) {
        setTimeout(() => attemptScroll(2), 200)
        setTimeout(() => attemptScroll(3), 500)
      }
    }

    // Start with a small delay to ensure DOM is ready
    setTimeout(scrollWithProgression, 100)
    
  }, [conversationId, messages.length, userId, messagesEndRef, setAutoScroll, isPreservingScrollRef])

  // Remove the complex fallback mechanism to prevent conflicts

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
    // Immediate scroll for user's own messages using container scroll
    if (messagesEndRef.current) {
      const container = messagesEndRef.current.parentElement
      if (container) {
        container.scrollTop = container.scrollHeight
      } else {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
      }
    }
  }, [messagesEndRef, setAutoScroll])

  // Force scroll to bottom (for manual triggers)
  const forceScrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
      setTimeout(() => setAutoScroll(true), 0)
    }
  }, [messagesEndRef, setAutoScroll])

  // Special scroll for forced refresh scenarios - more aggressive and immediate
  const forceScrollAfterRefresh = useCallback(() => {
    if (!conversationId || (isPreservingScrollRef?.current)) return
    
    console.log('useAutoScroll: Force scrolling after refresh for conversation:', conversationId)
    
    // Clear any existing scroll state
    hasInitialScrolledRef.current[conversationId] = false
    
    // More aggressive scroll approach for refreshes
    const aggressiveScroll = (attempt: number = 1, maxAttempts: number = 8) => {
      if (messagesEndRef.current && !(isPreservingScrollRef?.current)) {
        const container = messagesEndRef.current.parentElement
        if (container) {
          // Force immediate scroll to bottom
          container.scrollTop = container.scrollHeight
          
          // Use requestAnimationFrame for better timing
          requestAnimationFrame(() => {
            // Double check and force again if needed
            if (container.scrollTop < container.scrollHeight - container.clientHeight - 5) {
              // Still not at bottom, try multiple approaches
              container.scrollTop = container.scrollHeight
              messagesEndRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' })
              
              // Retry with increasing delays for DOM updates
              if (attempt < maxAttempts) {
                setTimeout(() => aggressiveScroll(attempt + 1, maxAttempts), 50 * attempt)
              } else {
                console.warn('useAutoScroll: Failed to reach bottom after max attempts')
              }
            } else {
              // Successfully scrolled to bottom
              setAutoScroll(true)
              hasInitialScrolledRef.current[conversationId] = true
              console.log(`useAutoScroll: Successfully scrolled to bottom after refresh (attempt ${attempt})`)
            }
          })
        } else {
          // No container found, retry later
          if (attempt < maxAttempts) {
            setTimeout(() => aggressiveScroll(attempt + 1, maxAttempts), 100 * attempt)
          }
        }
      }
    }
    
    // Start immediately, then with small delay for DOM updates
    aggressiveScroll(1, 8)
    setTimeout(() => aggressiveScroll(2, 8), 100)
    setTimeout(() => aggressiveScroll(3, 8), 300)
  }, [messagesEndRef, setAutoScroll, conversationId, isPreservingScrollRef])

  // Enhanced instant scroll for conversation changes, especially with many messages
  const instantScrollToBottom = useCallback(() => {
    if (!conversationId || (isPreservingScrollRef?.current)) return
    
    // Clear the initial scroll flag to allow fresh scroll
    hasInitialScrolledRef.current[conversationId] = false
    
    // Enhanced scroll with multiple attempts for conversations with many messages
    const scrollWithRetries = (attempt: number = 1, maxAttempts: number = 5) => {
      if (messagesEndRef.current && !(isPreservingScrollRef?.current)) {
        const container = messagesEndRef.current.parentElement
        if (container) {
          // Use both scrollTop and scrollIntoView for maximum reliability
          container.scrollTop = container.scrollHeight
          
          // Double-check scroll position and retry if needed
          requestAnimationFrame(() => {
            if (container.scrollTop < container.scrollHeight - container.clientHeight - 10) {
              // Still not at bottom, try scrollIntoView as backup
              messagesEndRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' })
              
              // Retry if we haven't reached max attempts
              if (attempt < maxAttempts) {
                setTimeout(() => scrollWithRetries(attempt + 1, maxAttempts), 100 * attempt)
              }
            } else {
              // Successfully at bottom
              setTimeout(() => setAutoScroll(true), 0)
              hasInitialScrolledRef.current[conversationId] = true
              console.log(`Instant scroll: Successfully reached bottom for conversation ${conversationId}`)
            }
          })
        }
      }
    }
    
    // Start with immediate attempt, then progressive delays
    setTimeout(() => scrollWithRetries(1, 5), 50)
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
    forceScrollAfterRefresh,
    instantScrollToBottom,
  }
}