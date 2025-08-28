'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useSession } from 'next-auth/react'
import { Heart, Reply, MoreHorizontal, Check, CheckCheck, Edit3, Trash2, Save, X, Download } from 'lucide-react'
import { MessageFormatter } from '../MessageFormatter'
import { VoiceMessagePlayer } from '../VoiceMessagePlayer'

interface Reaction {
  emoji: string
  count: number
  users: Array<{
    id: string
    username: string
    name?: string
    avatar?: string
  }>
  hasReacted: boolean
}

interface Message {
  id: string
  content: string
  type: string
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'unread'
  senderId: string
  senderName: string
  senderImage?: string
  timestamp: Date
  // Note: 'unread' applies to received messages before being read
  // It is not shown for own messages' tick marks
  reactions?: Reaction[]
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

interface MessageBubbleProps {
  message: Message
  onReply?: (message: Message) => void
  onReact?: (messageId: string, emoji: string) => void
  onScrollToMessage?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onDelete?: (messageId: string) => void
  onDeleteForMe?: (messageId: string) => void
  scrollToMessageLoading?: string | null
  isLastMessage?: boolean
}

export function MessageBubble({ message, onReply, onReact, onScrollToMessage, onEdit, onDelete, onDeleteForMe, scrollToMessageLoading, isLastMessage }: MessageBubbleProps) {
  const { data: session } = useSession()
  const [showActions, setShowActions] = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  const [showMoreOptions, setShowMoreOptions] = useState(false)
  const [isReacting, setIsReacting] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeletingForMe, setIsDeletingForMe] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isClient, setIsClient] = useState(false)

  // Interaction timing - adjusted for mobile
  const LONG_PRESS_MS = isMobile ? 300 : 450 // Shorter on mobile for better UX
  const LINGER_MS = 1200
  const AUTO_HIDE_AFTER_SHOW_MS = 4000 // Longer on mobile

  // Client-side and mobile detection effect
  useEffect(() => {
    setIsClient(true)
    
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768) // Tailwind 'md' breakpoint
    }
    
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Get responsive positioning class for panels with dynamic positioning
  const getPanelPositionClass = () => {
    if (isMobile) {
      // On mobile, always position panels above the message with spacing
      return 'bottom-full mb-2 left-1/2 transform -translate-x-1/2 max-w-[calc(100vw-2rem)] z-[70]'
    } else {
      // On desktop, use side positioning but with better overflow protection
      return isOwnMessage 
        ? 'top-1/2 transform -translate-y-1/2 right-full mr-2 z-[70]' 
        : 'top-1/2 transform -translate-y-1/2 left-full ml-2 z-[70]'
    }
  }

  // Get smart positioning for emoji picker with chat container boundary detection
  const getEmojiPickerPositionClass = () => {
    if (typeof window !== 'undefined') {
      const messageElement = document.querySelector(`[data-message-id="${message.id}"]`)
      if (messageElement) {
        const rect = messageElement.getBoundingClientRect()
        
        // Find the chat container/window
        const chatContainer = messageElement.closest('.overflow-y-auto, .overflow-auto, [class*="chat"], .flex-1')
        let containerTop = 0
        
        if (chatContainer) {
          const containerRect = chatContainer.getBoundingClientRect()
          containerTop = containerRect.top + 20 // Add some padding from top
        }
        
        // Calculate space above message within chat container
        const spaceAboveInContainer = rect.top - containerTop
        const needsSpaceForPicker = 100 // Minimum space needed for picker (increased)
        
        // If not enough space above within container, position below
        const hasSpaceAbove = spaceAboveInContainer > needsSpaceForPicker
        
        // Also check if this is one of the top messages as fallback
        const messageParent = messageElement.parentElement
        if (messageParent) {
          const allMessages = Array.from(messageParent.children)
          const messageIndex = allMessages.indexOf(messageElement)
          
          // Force below positioning for first 3 messages
          if (messageIndex < 3) {
            return 'top-full mt-2'
          }
        }
        
        return hasSpaceAbove ? 'bottom-full mb-2' : 'top-full mt-2'
      }
    }
    // Default: position above
    return 'bottom-full mb-2'
  }

  // Get smart horizontal positioning to prevent overflow - space-aware approach
  const getEmojiPickerHorizontalPosition = () => {
    if (isMobile) {
      // On mobile, use edge alignment to prevent overflow
      return isOwnMessage 
        ? 'right-0' // Align to right edge for own messages
        : 'left-0'  // Align to left edge for others' messages
    } else {
      // On desktop, use safer edge alignment
      return isOwnMessage 
        ? 'right-0' // Align to right edge for own messages
        : 'left-0'  // Align to left edge for others' messages
    }
  }

  // Get responsive container class for mobile optimization
  const getMobileContainerClass = () => {
    if (isMobile) {
      return 'max-w-[calc(100vw-4rem)]' // Ensure proper mobile viewport width
    }
    return ''
  }

  const hideTimerRef = useRef<number | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const autoHideTimerRef = useRef<number | null>(null)
  const reactionPanelRef = useRef<HTMLDivElement | null>(null)
  const optionsPanelRef = useRef<HTMLDivElement | null>(null)

  const clearHide = () => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }
  const scheduleHide = (delay = LINGER_MS) => {
    clearHide()
    hideTimerRef.current = window.setTimeout(() => {
      setShowActions(false)
    }, delay)
  }

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }
  const scheduleAutoHide = () => {
    if (autoHideTimerRef.current) {
      window.clearTimeout(autoHideTimerRef.current)
    }
    autoHideTimerRef.current = window.setTimeout(() => {
      setShowActions(false)
    }, AUTO_HIDE_AFTER_SHOW_MS)
  }


  // Sync editContent with message content when not editing
  useEffect(() => {
    if (!isEditing && message.content !== editContent) {
      setEditContent(message.content)
    }
  }, [message.content, isEditing, editContent])

  useEffect(() => {
    return () => {
      clearHide()
      clearLongPress()
      if (autoHideTimerRef.current) window.clearTimeout(autoHideTimerRef.current)
    }
  }, [])

  // Hide panels when clicking outside, pressing escape, or scrolling
  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      const target = event.target as Element
      // Check if click is outside reaction or options panels
      if (showReactions && reactionPanelRef.current && !reactionPanelRef.current.contains(target)) {
        setShowReactions(false)
      }
      if (showMoreOptions && optionsPanelRef.current && !optionsPanelRef.current.contains(target)) {
        setShowMoreOptions(false)
      }
    }

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowReactions(false)
        setShowMoreOptions(false)
        setShowActions(false)
      }
    }

    const handleScroll = () => {
      // Hide all panels when scrolling to prevent visual artifacts
      setShowReactions(false)
      setShowMoreOptions(false)
      setShowActions(false)
    }

    if (showReactions || showMoreOptions || showActions) {
      document.addEventListener('click', handleGlobalClick, true)
      document.addEventListener('keydown', handleEscapeKey)
      document.addEventListener('scroll', handleScroll, true)
      
      return () => {
        document.removeEventListener('click', handleGlobalClick, true)
        document.removeEventListener('keydown', handleEscapeKey)
        document.removeEventListener('scroll', handleScroll, true)
      }
    }
  }, [showReactions, showMoreOptions, showActions])

  const isOwnMessage = message.senderId === session?.user?.id
  const isSystemMessage = message.type === 'system'
  const isCallMessage = message.type === 'call'
  const isCallTrace = message.type === 'call_trace'
  const commonReactions = ['❤️', '👍', '😂', '😮', '😢', '😡']

  // Process reactions for display - Always group to ensure no duplicates
  const groupedReactions = useMemo(() => {
    if (!message.reactions || message.reactions.length === 0) return []
    
    // Always group reactions to prevent duplicates, regardless of source format
    const groups = message.reactions.reduce((acc, reaction: any) => {
      if (!acc[reaction.emoji]) {
        acc[reaction.emoji] = {
          emoji: reaction.emoji,
          count: 0,
          users: [],
          hasCurrentUser: false
        }
      }
      
      // Handle both grouped and individual reaction formats
      if (typeof reaction.count === 'number' && Array.isArray(reaction.users)) {
        // Already grouped reaction
        acc[reaction.emoji].count += reaction.count
        if (reaction.users) {
          acc[reaction.emoji].users.push(...reaction.users)
        }
        if (reaction.users?.some(user => user?.id === session?.user?.id)) {
          acc[reaction.emoji].hasCurrentUser = true
        }
      } else {
        // Individual reaction instance
        acc[reaction.emoji].count++
        if (reaction.user) {
          acc[reaction.emoji].users.push(reaction.user)
        }
        if (reaction.userId === session?.user?.id) {
          acc[reaction.emoji].hasCurrentUser = true
        }
      }
      
      return acc
    }, {} as Record<string, { emoji: string; count: number; users: any[]; hasCurrentUser: boolean }>)
    
    return Object.values(groups)
  }, [message.reactions, session?.user?.id])

  const handleReaction = async (emoji: string) => {
    if (!session?.user?.id || isReacting) return
    setIsReacting(true)
    try {
      onReact?.(message.id, emoji)
    } finally {
      setIsReacting(false)
      setShowReactions(false)
    }
  }

  const formatTime = (date: Date) => {
    const now = new Date()
    const messageDate = new Date(date)
    
    // Check if message is from today
    const isToday = messageDate.toDateString() === now.toDateString()
    
    // Check if message is from yesterday
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const isYesterday = messageDate.toDateString() === yesterday.toDateString()
    
    // Check if message is from this week (within 7 days)
    const daysDiff = Math.floor((now.getTime() - messageDate.getTime()) / (1000 * 60 * 60 * 24))
    const isThisWeek = daysDiff < 7
    
    const timeString = messageDate.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
    
    if (isToday) {
      return timeString
    } else if (isYesterday) {
      return `Yesterday ${timeString}`
    } else if (isThisWeek) {
      return `${messageDate.toLocaleDateString(undefined, { weekday: 'short' })} ${timeString}`
    } else {
      return `${messageDate.toLocaleDateString(undefined, { 
        month: 'short', 
        day: 'numeric',
        ...(messageDate.getFullYear() !== now.getFullYear() && { year: 'numeric' })
      })} ${timeString}`
    }
  }

  const getStatusIcon = () => {
    switch (message.status) {
      case 'sending':
        return <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
      case 'sent':
        return <Check className="w-4 h-4 text-gray-400" />
      case 'delivered':
        return <CheckCheck className="w-4 h-4 text-gray-400" />
      case 'read':
        return <CheckCheck className="w-4 h-4 text-blue-500" />
      default:
        return null
    }
  }

  const handleEdit = async () => {
    if (!onEdit || editContent.trim() === message.content.trim()) {
      setIsEditing(false)
      setEditContent(message.content)
      return
    }

    try {
      await onEdit(message.id, editContent.trim())
      setIsEditing(false)
      setShowMoreOptions(false)
      setShowActions(false)
    } catch (error) {
      console.error('Error editing message:', error)
    }
  }

  const handleDelete = async () => {
    if (!onDelete || isDeleting) return
    
    if (confirm('Are you sure you want to delete this message?')) {
      setIsDeleting(true)
      try {
        await onDelete(message.id)
        setShowMoreOptions(false)
        setShowActions(false)
      } catch (error) {
        console.error('Error deleting message:', error)
      } finally {
        setIsDeleting(false)
      }
    }
  }


  const handleDeleteForMe = async () => {
    if (!onDeleteForMe || isDeletingForMe) return
    
    if (confirm('Delete this message from your chat? Other participants will still see it.')) {
      setIsDeletingForMe(true)
      try {
        await onDeleteForMe(message.id)
        setShowMoreOptions(false)
        setShowActions(false)
      } catch (error) {
        console.error('Error deleting message for me:', error)
      } finally {
        setIsDeletingForMe(false)
      }
    }
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditContent(message.content)
    setShowMoreOptions(false)
  }

  const handleDownloadAttachment = async (attachment: { url: string; name: string }) => {
    try {
      // Create a temporary link element to trigger download
      const response = await fetch(attachment.url)
      if (!response.ok) throw new Error('Download failed')
      
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = attachment.name
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download failed:', error)
      // Fallback: open in new tab
      window.open(attachment.url, '_blank')
    }
  }

  // Special rendering for system messages
  if (isSystemMessage) {
    return (
      <div className="flex justify-center my-2" data-message-id={message.id} role="article">
        <div className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-xs text-gray-600 dark:text-gray-300 text-center max-w-[80%]">
          {message.content}
        </div>
      </div>
    )
  }

  // Special rendering for call trace messages (as regular user messages)
  if (isCallTrace) {
    return (
      <div className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} mb-3`} data-message-id={message.id} role="article">
        <div className="flex items-start space-x-2 max-w-[70%]">
          {!isOwnMessage && (
            <div className="flex-shrink-0">
              {message.senderImage ? (
                <img
                  src={message.senderImage}
                  alt={message.senderName}
                  className="w-8 h-8 rounded-full"
                />
              ) : (
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">
                    {message.senderName?.charAt(0).toUpperCase() || '?'}
                  </span>
                </div>
              )}
            </div>
          )}
          <div className="flex flex-col">
            {!isOwnMessage && (
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {message.senderName}
              </div>
            )}
            <div className={`rounded-lg px-3 py-2 ${
              isOwnMessage
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            }`}>
              <div className="text-sm">{message.content}</div>
              <div className={`text-xs mt-1 ${
                isOwnMessage ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'
              }`}>
                {formatTime(message.timestamp)}
              </div>
            </div>
            
            {/* Reactions for call traces */}
            {groupedReactions.length > 0 && (
              <div className={`flex flex-wrap gap-1 mt-2 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                {groupedReactions.map((reactionGroup, index) => (
                  <button
                    key={`${message.id}-reaction-${reactionGroup.emoji}-${index}`}
                    onClick={() => handleReaction(reactionGroup.emoji)}
                    disabled={isReacting}
                    className={`
                      inline-flex items-center space-x-1 rounded-full text-xs flex-shrink-0 px-2 py-1
                      ${
                        reactionGroup.hasCurrentUser
                          ? 'bg-blue-100 dark:bg-blue-900/30 border border-blue-500'
                          : 'bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600'
                      }
                      ${isReacting ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 transition-transform'}
                      focus:outline-none focus:ring-2 focus:ring-blue-500
                    `}
                    title={(() => {
                      if (!reactionGroup.users || !Array.isArray(reactionGroup.users)) {
                        return `Reacted by: ${reactionGroup.count} user${reactionGroup.count > 1 ? 's' : ''}`
                      }
                      const userList = reactionGroup.users
                        .filter(u => u && typeof u === 'object' && (u.username || u.name))
                        .map(u => {
                          try {
                            return u.username || u.name || 'Unknown'
                          } catch {
                            return 'Unknown'
                          }
                        })
                        .slice(0, 3)
                      return userList.length > 0 
                        ? `Reacted by: ${userList.join(', ')}${reactionGroup.count > 3 ? ` and ${reactionGroup.count - 3} others` : ''}`
                        : `Reacted by: ${reactionGroup.count} user${reactionGroup.count > 1 ? 's' : ''}`
                    })()}
                  >
                    <span>{reactionGroup.emoji}</span>
                    <span className="font-medium">{reactionGroup.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex ${isCallMessage ? 'justify-center' : isOwnMessage ? 'justify-end' : 'justify-start'} group px-2`} data-message-id={message.id} role="article">
      <div className={`flex message-bubble ${isMobile ? getMobileContainerClass() : 'max-w-[85%] sm:max-w-[70%]'} ${isOwnMessage ? 'flex-row-reverse' : 'flex-row'} items-end space-x-2 relative`}>
        {/* Avatar for received messages */}
        {!isOwnMessage && (
          <div className="flex-shrink-0 mb-1">
            {message.senderImage ? (
              <img
                src={message.senderImage}
                alt={message.senderName}
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
              <div className="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center">
                <span className="text-white text-xs font-medium">
                  {message.senderName.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Message bubble */}
        <div className={`relative ${isOwnMessage ? 'mr-2' : 'ml-2'}`}>
          {/* Sender name for received messages */}
          {!isOwnMessage && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 ml-3">
              {message.senderName}
            </p>
          )}

          {/* Reply preview */}
          {message.replyTo && (
            <div 
              className={`
                reply-preview reply-preview-clickable mb-2 p-2 rounded-lg border-l-4 text-xs max-w-full
                ${isOwnMessage 
                  ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-500' 
                  : 'bg-gray-100 dark:bg-gray-700 border-gray-400'
                }
              `}
              onClick={() => {
                if (onScrollToMessage) {
                  onScrollToMessage(message.replyTo!.id)
                } else {
                  console.log('Scroll to message not available:', message.replyTo!.id)
                }
              }}
              role={onScrollToMessage ? "button" : undefined}
              tabIndex={onScrollToMessage ? 0 : undefined}
              onKeyDown={onScrollToMessage ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onScrollToMessage(message.replyTo!.id)
                }
              } : undefined}
              aria-label={onScrollToMessage ? `Go to original message from ${message.replyTo.senderName}` : undefined}
              title={onScrollToMessage ? (scrollToMessageLoading === message.replyTo!.id ? "Searching for message..." : "Click to scroll to original message") : undefined}
            >
              <div className="font-medium text-gray-700 dark:text-gray-300 truncate flex items-center space-x-2">
                <span>{message.replyTo.senderName}</span>
                {scrollToMessageLoading === message.replyTo.id && (
                  <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                )}
              </div>
              <p className="text-gray-600 dark:text-gray-400 break-words line-clamp-2 text-wrap overflow-wrap-anywhere hyphens-auto">
                {message.replyTo.content}
              </p>
            </div>
          )}

          {/* Main message content */}
          <div
            className={`
              message-content relative ${isMobile ? 'px-3 py-2' : 'px-4 py-2'} rounded-2xl max-w-full break-words overflow-wrap-anywhere hyphens-auto
              ${isMobile ? 'text-sm leading-relaxed' : 'text-sm'}
              ${isCallMessage
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-xl'
                : isOwnMessage
                ? 'bg-blue-600 text-white rounded-br-md'
                : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-bl-md'
              }
            `}
            style={{
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
              maxWidth: isMobile ? 'calc(100vw - 6rem)' : 'none'
            }}
            onMouseEnter={() => {
              if (!isEditing) {
                clearHide()
                setShowActions(true)
              }
            }}
            onMouseLeave={() => {
              if (!isEditing) {
                scheduleHide()
              }
            }}
            onPointerDown={(e) => {
              if (!isEditing) {
                clearLongPress()
                longPressTimerRef.current = window.setTimeout(() => {
                  // Add haptic feedback on mobile
                  if (isMobile && 'vibrate' in navigator) {
                    navigator.vibrate(50) // Short vibration feedback
                  }
                  setShowActions(true)
                  scheduleAutoHide()
                }, LONG_PRESS_MS)
              }
            }}
            onPointerUp={() => {
              clearLongPress()
            }}
            onPointerCancel={() => {
              clearLongPress()
            }}
            onTouchStart={(e) => {
              // Additional touch event for better mobile support
              if (!isEditing && isMobile) {
                clearLongPress()
                longPressTimerRef.current = window.setTimeout(() => {
                  if (isMobile && 'vibrate' in navigator) {
                    navigator.vibrate(50)
                  }
                  setShowActions(true)
                  scheduleAutoHide()
                }, LONG_PRESS_MS)
              }
            }}
            onTouchEnd={() => {
              if (isMobile) {
                clearLongPress()
              }
            }}
            onTouchCancel={() => {
              if (isMobile) {
                clearLongPress()
              }
            }}
            onFocus={() => {
              if (!isEditing) {
                clearHide()
                setShowActions(true)
              }
            }}
            onBlur={() => {
              if (!isEditing) {
                scheduleHide()
              }
            }}
          >
            {isEditing ? (
              <div className="space-y-2">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className={`w-full resize-none border-0 p-0 bg-transparent focus:outline-none text-sm leading-relaxed break-words overflow-wrap-anywhere hyphens-auto ${
                    isOwnMessage ? 'text-white placeholder-white/70' : 'text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400'
                  }`}
                  rows={Math.max(1, editContent.split('\n').length)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleEdit()
                    } else if (e.key === 'Escape') {
                      handleCancelEdit()
                    }
                  }}
                />
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleEdit}
                    className={`p-1 rounded-md focus:outline-none ${
                      isOwnMessage 
                        ? 'text-white/80 hover:text-white hover:bg-white/10' 
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}
                    title="Save changes (Enter)"
                  >
                    <Save className="w-3 h-3" />
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className={`p-1 rounded-md focus:outline-none ${
                      isOwnMessage 
                        ? 'text-white/80 hover:text-white hover:bg-white/10' 
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}
                    title="Cancel editing (Esc)"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ) : (
              // Check if this is a deleted message
              (message as any).type === 'deleted' ? (
                <div className="flex items-center space-x-2 text-sm italic opacity-75">
                  <span className="text-gray-500 dark:text-gray-400">🗑️</span>
                  <span className={isOwnMessage ? 'text-white/70' : 'text-gray-500 dark:text-gray-400'}>
                    {isOwnMessage 
                      ? 'You deleted this message' 
                      : `${message.senderName} deleted this message`
                    }
                  </span>
                </div>
              ) : isCallMessage ? (
                <div className="flex items-center space-x-2 text-sm">
                  <span className="text-lg">
                    {message.content.includes('started') ? '📞' :
                     message.content.includes('Missed') ? '📵' :
                     message.content.includes('declined') ? '❌' :
                     message.content.includes('ended') ? '✅' : '📞'}
                  </span>
                  <span className={`italic ${isOwnMessage ? 'text-white/90' : 'text-gray-700 dark:text-gray-300'}`}>
                    {message.content}
                  </span>
                </div>
              ) : (
                <MessageFormatter 
                  content={message.content}
                  className="text-sm leading-relaxed"
                />
              )
            )}

            {/* Attachments */}
            {message.attachments && message.attachments.length > 0 && (message as any).type !== 'deleted' && (
              <div className="mt-2 space-y-2" style={{ maxWidth: '100%', overflow: 'hidden' }}>
                {message.attachments.map((attachment) => (
                  <div key={attachment.id}>
                    {attachment.type === 'image' ? (
                      <div className="relative group">
                        <img
                          src={attachment.url}
                          alt={attachment.name}
                          className="w-full max-w-full h-auto max-h-80 rounded-lg cursor-pointer hover:opacity-90 object-contain"
                          style={{
                            maxWidth: isMobile ? 'calc(100vw - 8rem)' : '100%',
                            width: 'auto'
                          }}
                          onClick={() => {
                            // TODO: Open image in modal
                          }}
                        />
                        {/* Download button for images */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDownloadAttachment(attachment)
                          }}
                          className="absolute top-2 right-2 bg-black bg-opacity-50 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-opacity-70 focus:outline-none focus:ring-2 focus:ring-white"
                          title="Download image"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        {/* Show GIF indicator */}
                        {attachment.name.toLowerCase().endsWith('.gif') && (
                          <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
                            GIF
                          </div>
                        )}
                      </div>
                    ) : attachment.type === 'voice' ? (
                      <VoiceMessagePlayer
                        audioUrl={attachment.url}
                        duration={attachment.duration || 0}
                        isOwn={isOwnMessage}
                        senderName={isOwnMessage ? undefined : message.senderName}
                        timestamp={message.timestamp}
                        className="my-1"
                      />
                    ) : (
                      <div className="flex items-center space-x-2 p-2 bg-white/10 dark:bg-black/10 rounded-lg hover:bg-white/20 dark:hover:bg-black/20 transition-colors group">
                        <div className="w-8 h-8 bg-white/20 dark:bg-black/20 rounded flex items-center justify-center">
                          <span className="text-xs font-mono">📄</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{attachment.name}</p>
                          {attachment.size && (
                            <p className="text-xs opacity-75">
                              {(attachment.size / 1024 / 1024).toFixed(1)} MB
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDownloadAttachment(attachment)}
                          className="p-2 rounded-full hover:bg-white/20 dark:hover:bg-black/20 focus:outline-none focus:ring-2 focus:ring-blue-500 opacity-60 hover:opacity-100 transition-opacity"
                          title="Download file"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Timestamp and status */}
            <div className={`
              flex items-center justify-end space-x-1 mt-1 text-xs
              ${isOwnMessage ? 'text-white/70' : 'text-gray-500 dark:text-gray-400'}
            `}>
              <span>{formatTime(message.timestamp)}</span>
              {isOwnMessage && <span data-testid="message-status">{getStatusIcon()}</span>}
            </div>

            {/* Quick actions (visible via hover/long-press) - Facebook Messenger style */}
            {showActions && !isEditing && (message as any).type !== 'deleted' && !isCallMessage && (
              <div
                className={`
                  absolute flex items-center ${isMobile ? 'space-x-2' : 'space-x-1'} z-[60]
                  ${getEmojiPickerPositionClass()} ${isOwnMessage ? 'right-0' : 'left-0'}
                  bg-white dark:bg-gray-800 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 p-1
                  ${isMobile ? 'max-w-[calc(100vw-4rem)] animate-fade-in' : ''}
                `}
                onMouseEnter={() => {
                  clearHide()
                }}
                onMouseLeave={() => {
                  scheduleHide()
                }}
              >
                <button
                  onClick={() => setShowReactions(!showReactions)}
                  className={`${isMobile ? 'p-2' : 'p-1.5'} rounded-full hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors`}
                  aria-label="Add reaction"
                >
                  <Heart className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} text-gray-600 dark:text-gray-400`} />
                </button>
                
                <button
                  onClick={() => onReply?.(message)}
                  className={`${isMobile ? 'p-2' : 'p-1.5'} rounded-full hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors`}
                  aria-label="Reply to message"
                >
                  <Reply className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} text-gray-600 dark:text-gray-400`} />
                </button>

                <div className="relative">
                  <button
                    onClick={() => setShowMoreOptions(!showMoreOptions)}
                    className={`${isMobile ? 'p-2' : 'p-1.5'} rounded-full hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors`}
                    aria-label="More options"
                  >
                    <MoreHorizontal className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} text-gray-600 dark:text-gray-400`} />
                  </button>

                  {/* More options dropdown */}
                  {showMoreOptions && (
                    <>
                      <div 
                        className="fixed inset-0 z-[50]" 
                        onClick={() => setShowMoreOptions(false)}
                        aria-hidden="true"
                      />
                      <div 
                        ref={optionsPanelRef}
                        className={`
                          absolute z-[80] py-1 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 
                          ${getEmojiPickerPositionClass()} ${isOwnMessage ? 'right-0' : 'left-0'}
                          ${isMobile ? 'min-w-[200px]' : 'min-w-[140px]'}
                        `}>
                        {/* Edit option (only for own messages) */}
                        {isOwnMessage && onEdit && (
                          <button
                            onClick={() => {
                              setIsEditing(true)
                              setShowMoreOptions(false)
                              setShowActions(false)
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center space-x-2"
                          >
                            <Edit3 className="w-4 h-4" />
                            <span>Edit</span>
                          </button>
                        )}

                        {/* Delete option (only for own messages) */}
                        {isOwnMessage && onDelete && (
                          <button
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center space-x-2 disabled:opacity-50"
                          >
                            {isDeleting ? (
                              <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                            <span>Delete</span>
                          </button>
                        )}

                        {/* Delete for me option (only for others' messages) */}
                        {!isOwnMessage && onDeleteForMe && (
                          <button
                            onClick={handleDeleteForMe}
                            disabled={isDeletingForMe}
                            className="w-full px-3 py-2 text-left text-sm text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20 flex items-center space-x-2 disabled:opacity-50"
                          >
                            {isDeletingForMe ? (
                              <div className="w-4 h-4 border-2 border-orange-600 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                            <span>Delete for me</span>
                          </button>
                        )}

                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Reaction picker positioned to the side */}
            {showReactions && (
              <>
                <div 
                  className="fixed inset-0 z-[50]" 
                  onClick={() => setShowReactions(false)}
                  aria-hidden="true"
                />
                <div 
                  ref={reactionPanelRef}
                  className={`
                    absolute z-[70] p-1 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700
                    ${getEmojiPickerPositionClass()} ${getEmojiPickerHorizontalPosition()}
                  `}
                  style={{
                    maxWidth: isMobile ? 'min(280px, calc(100vw - 8rem))' : '280px',
                    width: 'fit-content',
                    minWidth: '0',
                    overflow: 'hidden',
                    boxSizing: 'border-box'
                  }}
                >
                  <div 
                    className={`emoji-picker-container`}
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      flexWrap: 'nowrap',
                      gap: '8px',
                      justifyContent: 'center',
                      alignItems: 'center',
                      width: 'fit-content',
                      maxWidth: '100%',
                      overflowX: 'auto'
                    }}
                  >
                    {commonReactions.map((emoji) => (
                      <button
                        key={`${message.id}-emoji-${emoji}`}
                        onClick={() => handleReaction(emoji)}
                        disabled={isReacting}
                        className={`${isMobile ? 'p-2 text-lg min-w-[2.5rem] min-h-[2.5rem] flex items-center justify-center' : 'p-2 text-lg'} rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-transform ${
                          isReacting
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:bg-gray-100 dark:hover:bg-gray-700 hover:scale-110'
                        }`}
                        aria-label={`React with ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Reactions - Use same layout as working call trace reactions */}
          {groupedReactions.length > 0 && (message as any).type !== 'deleted' && !isCallMessage && !isCallTrace && (
            <div 
              className={`flex flex-wrap gap-1 mt-2 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
              style={{
                display: 'flex !important',
                flexDirection: 'row !important',
                flexWrap: 'wrap !important',
                gap: '4px !important',
                alignItems: 'center !important'
              }}
            >
              {groupedReactions.map((reactionGroup, index) => (
                <button
                  key={`${message.id}-reaction-${reactionGroup.emoji}-${index}`}
                  onClick={() => handleReaction(reactionGroup.emoji)}
                  disabled={isReacting}
                  className={`
                    inline-flex items-center space-x-1 rounded-full text-xs flex-shrink-0 px-2 py-1
                    ${
                      reactionGroup.hasCurrentUser
                        ? 'bg-blue-100 dark:bg-blue-900/30 border border-blue-500'
                        : 'bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600'
                    }
                    ${isReacting ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 transition-transform'}
                    focus:outline-none focus:ring-2 focus:ring-blue-500
                  `}
                  title={(() => {
                    if (!reactionGroup.users || !Array.isArray(reactionGroup.users)) {
                      return `Reacted by: ${reactionGroup.count} user${reactionGroup.count > 1 ? 's' : ''}`
                    }
                    const userList = reactionGroup.users
                      .filter(u => u && typeof u === 'object' && (u.username || u.name))
                      .map(u => {
                        try {
                          return u.username || u.name || 'Unknown'
                        } catch {
                          return 'Unknown'
                        }
                      })
                      .slice(0, 3)
                    return userList.length > 0 
                      ? `Reacted by: ${userList.join(', ')}${reactionGroup.count > 3 ? ` and ${reactionGroup.count - 3} others` : ''}`
                      : `Reacted by: ${reactionGroup.count} user${reactionGroup.count > 1 ? 's' : ''}`
                  })()}
                >
                  <span>{reactionGroup.emoji}</span>
                  <span className="font-medium">{reactionGroup.count}</span>
                </button>
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}