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

  // Reset initial scroll state when switching conversations
  useEffect(() => {
    if (conversationId) {
      // Always reset initial scroll state for conversation switch
      hasInitialScrolledRef.current[conversationId] = false
      console.log('Reset initial scroll state for conversation:', conversationId)
    }
  }, [conversationId])

  // Auto-scroll function
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setAutoScroll(true)
  }, [messagesEndRef, setAutoScroll])

  // Initial auto-scroll when opening conversation with unread messages
  useEffect(() => {
    if (!conversationId || !messages || messages.length === 0 || !userId) return

    const hasUnread = messages.some(
      (m) => m.senderId !== userId && m.status !== 'read'
    )

    console.log('Auto-scroll check:', {
      conversationId,
      messagesLength: messages.length,
      hasUnread,
      hasInitialScrolled: hasInitialScrolledRef.current[conversationId]
    })

    // Auto-scroll if we haven't done initial scroll for this conversation
    // Always scroll for conversations with unread messages, or when first opening any conversation
    if (!hasInitialScrolledRef.current[conversationId] && (hasUnread || messages.length > 0)) {
      hasInitialScrolledRef.current[conversationId] = true
      
      // Add a small delay to ensure messages are rendered
      setTimeout(() => {
        scrollToBottom()
        console.log('Initial auto-scroll executed for conversation:', conversationId)
      }, 200)
    }
  }, [conversationId, messages, userId, scrollToBottom])

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
        
        // Auto-scroll to show the new message
        setTimeout(() => {
          scrollToBottom()
          console.log('Auto-scroll triggered by new message:', message.id)
        }, 100) // Small delay to ensure message is rendered
      }
    }

    socket.on('new-message', handleNewMessageForAutoScroll)

    return () => {
      socket.off('new-message', handleNewMessageForAutoScroll)
    }
  }, [socket, isFullyInitialized, conversationId, userId, scrollToBottom])

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
    scrollToBottom()
  }, [scrollToBottom, setAutoScroll])

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

  return {
    scrollToBottom,
    scrollOnSendMessage,
    forceScrollToBottom,
    instantScrollToBottom,
  }
}