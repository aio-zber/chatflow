'use client'

import { useCallback, useRef, useEffect, useState } from 'react'
import { useVirtualizer } from '@/hooks/useVirtualizer'
import { MessageBubble } from './chat/MessageBubble'

interface Message {
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
    type: 'image' | 'file'
    size?: number
  }[]
}

interface VirtualizedMessageListProps {
  messages: Message[]
  currentUserId: string
  onLoadMore?: () => void
  onReact?: (messageId: string, emoji: string) => void
  onReply?: (message: Message) => void
  onEdit?: (messageId: string, content: string) => void
  onDelete?: (messageId: string) => void
  className?: string
}

const ITEM_HEIGHT = 120 // Approximate height per message

export function VirtualizedMessageList({
  messages,
  currentUserId,
  onLoadMore,
  onReact,
  onReply,
  onEdit,
  onDelete,
  className = '',
}: VirtualizedMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(400)
  const [autoScroll, setAutoScroll] = useState(true)

  // Update container height on resize
  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.clientHeight)
      }
    }

    updateHeight()
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  const {
    visibleItems,
    totalHeight,
    handleScroll,
    scrollToItem,
    scrollTop,
  } = useVirtualizer({
    itemHeight: ITEM_HEIGHT,
    containerHeight,
    itemCount: messages.length,
    overscan: 3,
  })

  // Handle scroll for auto-scroll behavior
  const handleScrollEvent = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget
      const { scrollTop, scrollHeight, clientHeight } = target
      
      // Check if user is near the bottom (within 100px)
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
      setAutoScroll(isNearBottom)
      
      // Load more messages when scrolling to top
      if (scrollTop < 100 && onLoadMore) {
        onLoadMore()
      }
      
      handleScroll(event)
    },
    [handleScroll, onLoadMore]
  )

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && messages.length > 0) {
      scrollToItem(messages.length - 1, 'end')
    }
  }, [messages.length, autoScroll, scrollToItem])

  // Scroll to bottom function
  const scrollToBottom = useCallback(() => {
    if (messages.length > 0) {
      scrollToItem(messages.length - 1, 'end')
      setAutoScroll(true)
    }
  }, [messages.length, scrollToItem])

  return (
    <div className={`relative ${className}`}>
      {/* Scroll to bottom button */}
      {!autoScroll && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 z-10 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full shadow-lg transition-colors focus-ring"
          aria-label="Scroll to bottom"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}

      {/* Message list container */}
      <div
        ref={containerRef}
        className="h-full overflow-auto custom-scrollbar"
        onScroll={handleScrollEvent}
        style={{ overscrollBehavior: 'contain' }}
      >
        {/* Virtual container */}
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleItems.map((virtualItem) => {
            const message = messages[virtualItem.index]
            if (!message) return null

            return (
              <div
                key={message.id}
                style={{
                  position: 'absolute',
                  top: virtualItem.start,
                  left: 0,
                  right: 0,
                  height: virtualItem.height,
                }}
              >
                <MessageBubble
                  message={message}
                  isOwn={message.senderId === currentUserId}
                  onReact={onReact}
                  onReply={onReply}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  className="px-4 py-2"
                />
              </div>
            )
          })}
        </div>

        {/* Loading indicator for infinite scroll */}
        {onLoadMore && (
          <div className="flex justify-center py-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Loading more messages...
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
