'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useSocketContext } from '@/context/SocketContext'

interface UseAutoScrollOptions {
  conversationId: string | null
  messages: any[]
  userId: string | null
  messagesEndRef: React.RefObject<HTMLDivElement>
  setAutoScroll: (value: boolean) => void
}

export const useAutoScroll = ({
  conversationId,
  messages,
  userId,
  messagesEndRef,
  setAutoScroll
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
        setAutoScroll(true)
        console.log('Scroll to bottom executed successfully')
      } catch (error) {
        console.error('Error during scroll:', error)
        // Fallback scroll method
        try {
          const container = messagesEndRef.current.parentElement
          if (container) {
            container.scrollTop = container.scrollHeight
          }
        } catch (fallbackError) {
          console.error('Fallback scroll also failed:', fallbackError)
        }
      }
    } else {
      console.warn('messagesEndRef.current is null, cannot scroll')
    }
  }, [messagesEndRef, setAutoScroll])

  // Debounced scroll function to prevent multiple rapid scroll attempts
  const debouncedScrollToBottom = useCallback(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }
    
    scrollTimeoutRef.current = setTimeout(() => {
      scrollToBottom()
      console.log('Debounced scroll executed for conversation:', conversationId)
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
        console.log('Conversation switched to:', conversationId)
        
        // Always reset scroll state to false when switching conversations
        // This ensures auto-scroll to bottom happens every time a conversation is opened
        hasInitialScrolledRef.current[conversationId] = false
        console.log('Resetting scroll state for conversation (will auto-scroll to bottom):', conversationId)
      }
    }
  }, [conversationId])

  // Initial auto-scroll - wait for messages to stabilize and DOM to be ready
  useEffect(() => {
    if (!conversationId || !messages || messages.length === 0 || !userId) return

    // Only proceed if we haven't scrolled for this conversation yet
    if (hasInitialScrolledRef.current[conversationId]) return

    console.log('Auto-scroll check:', {
      conversationId,
      messagesLength: messages.length,
      hasInitialScrolled: hasInitialScrolledRef.current[conversationId]
    })

    // Mark as scrolled immediately to prevent multiple attempts
    hasInitialScrolledRef.current[conversationId] = true
    
    // Use requestAnimationFrame to ensure DOM is ready, then scroll
    requestAnimationFrame(() => {
      setTimeout(() => {
        debouncedScrollToBottom()
      }, 100) // Small delay to ensure all messages are rendered
    })
    
  }, [conversationId, messages.length, userId, debouncedScrollToBottom])

  // Enhanced fallback scroll mechanism with better DOM readiness checks
  useEffect(() => {
    if (!conversationId || !messages || messages.length === 0) return
    
    // Only run fallbacks if initial scroll hasn't happened yet
    if (hasInitialScrolledRef.current[conversationId]) return
    
    // Single fallback with better timing
    const fallbackTimeout = setTimeout(() => {
      if (messagesEndRef.current && !hasInitialScrolledRef.current[conversationId]) {
        console.log('Fallback scroll triggered for conversation:', conversationId)
        hasInitialScrolledRef.current[conversationId] = true
        
        // Use requestAnimationFrame for better timing
        requestAnimationFrame(() => {
          try {
            if (messagesEndRef.current) {
              messagesEndRef.current.scrollIntoView({ behavior: 'instant', block: 'end' })
              setAutoScroll(true)
            } else {
              // Try container scroll as backup
              const container = document.querySelector('[data-messages-container]') as HTMLElement
              if (container) {
                container.scrollTop = container.scrollHeight
                setAutoScroll(true)
              }
            }
          } catch (error) {
            console.error('Fallback scroll failed:', error)
          }
        })
      }
    }, 300)

    return () => {
      clearTimeout(fallbackTimeout)
    }
  }, [conversationId, messages.length, messagesEndRef, setAutoScroll])

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
        console.log('Auto-scroll triggered by new message:', message.id)
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
    setAutoScroll(true)
    // Immediate scroll for user's own messages
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messagesEndRef, setAutoScroll])

  // Force scroll to bottom (for manual triggers)
  const forceScrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
      setAutoScroll(true)
      console.log('Force scroll to bottom executed')
    }
  }, [messagesEndRef, setAutoScroll])

  // Scroll to bottom immediately when conversation changes (instant scroll)
  const instantScrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'instant' })
      setAutoScroll(true)
      console.log('Instant scroll to bottom executed')
    }
  }, [messagesEndRef, setAutoScroll])

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