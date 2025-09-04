'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useSession } from 'next-auth/react'
import { Heart, Reply, MoreHorizontal, Check, CheckCheck, Edit3, Trash2, Save, X, Download, Phone, Video } from 'lucide-react'
import { MessageFormatter } from '../MessageFormatter'
import { VoiceMessagePlayer } from '../VoiceMessagePlayer'
import { Poll } from './Poll'
import { getCompatibleFileUrl } from '@/utils/fileProxy'
import { useE2EE } from '@/hooks/useE2EE'
import { formatMessageTime } from '@/utils/dateUtils'

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
  poll?: {
    id: string
    question: string
    allowMultiple: boolean
    isAnonymous: boolean
    expiresAt: string | null
    createdAt: string
    createdBy: {
      id: string
      username: string
      name: string | null
      avatar: string | null
    }
    options: Array<{
      id: string
      text: string
      order: number
      voteCount: number
      hasVoted: boolean
      voters?: Array<{
        id: string
        username: string
        name: string | null
        avatar: string | null
      }>
    }>
    totalVotes: number
    messageId: string
  }
}

interface MessageBubbleProps {
  message: Message
  conversationId: string // E2EE FIX: Required for reply decryption
  onReply?: (message: Message) => void
  onReact?: (messageId: string, emoji: string) => void
  onScrollToMessage?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onDelete?: (messageId: string) => void
  onDeleteForMe?: (messageId: string) => void
  onVotePoll?: (pollId: string, optionIds: string[]) => void
  scrollToMessageLoading?: string | null
  isLastMessage?: boolean
  isGroupChat?: boolean
  currentUserRole?: 'admin' | 'member' | null
}

export function MessageBubble({ message, conversationId, onReply, onReact, onScrollToMessage, onEdit, onDelete, onDeleteForMe, onVotePoll, scrollToMessageLoading, isLastMessage, isGroupChat, currentUserRole }: MessageBubbleProps) {
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
  
  // E2EE FIX: Add E2EE decryption support for reply content
  const { decryptMessage, isAvailable } = useE2EE()
  const [decryptedReplyContent, setDecryptedReplyContent] = useState<string | null>(null)

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

  // E2EE FIX: Decrypt reply content if encrypted
  useEffect(() => {
    const decryptReplyContent = async () => {
      if (message.replyTo?.content && message.replyTo.content.startsWith('🔐') && isAvailable && decryptMessage) {
        try {
          const encryptedData = message.replyTo.content.substring(2) // Remove 🔐 prefix
          const decrypted = await decryptMessage(encryptedData, conversationId)
          if (decrypted && decrypted.trim()) {
            setDecryptedReplyContent(decrypted)
          } else {
            setDecryptedReplyContent('[Encrypted message - decryption failed]')
          }
        } catch (error) {
          console.warn('E2EE: Failed to decrypt reply content:', error)
          setDecryptedReplyContent('[Encrypted message - decryption failed]')
        }
      } else if (message.replyTo?.content && !message.replyTo.content.startsWith('🔐')) {
        // Not encrypted, use original content
        setDecryptedReplyContent(message.replyTo.content)
      }
    }

    decryptReplyContent()
  }, [message.replyTo?.content, isAvailable, decryptMessage, conversationId])

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
  const isSystemMessage = message.type === 'system' || message.type === 'call_trace'
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

  // Using utility function for consistent 12-hour timestamp formatting

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
      const compatibleUrl = getCompatibleFileUrl(attachment.url)
      const response = await fetch(compatibleUrl)
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

  // Special rendering for voice messages - don't nest in blue containers
  const hasVoiceAttachment = message.attachments?.some(att => att.type === 'voice')
  if (hasVoiceAttachment && message.attachments?.length === 1 && (!message.content || message.content.trim() === '')) {
    // Pure voice message - render without message bubble container
    const voiceAttachment = message.attachments.find(att => att.type === 'voice')!
    
    return (
      <div className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} group px-2`} data-message-id={message.id} role="article">
        <div className={`flex ${isOwnMessage ? 'flex-row-reverse' : 'flex-row'} items-end space-x-2 relative max-w-[85%] sm:max-w-[70%]`}>
          {/* Avatar for received messages */}
          {!isOwnMessage && (
            <div className="flex-shrink-0 mb-1">
              {message.senderImage ? (
                <img
                  src={getCompatibleFileUrl(message.senderImage)}
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
          
          {/* Voice message player directly */}
          <div className="relative">
            {/* Sender name for received messages */}
            {!isOwnMessage && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 ml-3">
                {message.senderName}
              </p>
            )}
            
            <VoiceMessagePlayer
              audioUrl={getCompatibleFileUrl(voiceAttachment.url)}
              duration={voiceAttachment.duration || 0}
              isOwn={isOwnMessage}
              senderName={isOwnMessage ? undefined : message.senderName}
              timestamp={message.timestamp}
            />
            
            {/* Timestamp and status for own messages */}
            {isOwnMessage && (
              <div className="flex items-center justify-end space-x-1 mt-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formatMessageTime(message.timestamp)}
                </span>
                {getStatusIcon()}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Special rendering for system messages including call traces
  if (isSystemMessage) {
    // Check if this is a call trace system message
    if (message.content && (
      message.content.includes('Missed call') || 
      message.content.includes('Cancelled call') ||
      message.content.includes('Incoming call') ||
      message.content.includes('Outgoing call') ||
      message.content.includes('voice call') ||
      message.content.includes('video call')
    )) {
      // Render call trace as a centered system message with Viber styling
      // Determine call direction based on who sent the message (call initiator)
      // If current user sent the call trace message, it was an outgoing call
      const isOutgoing = message.senderId === session?.user?.id
      const isMissed = message.content.includes('Missed') || message.content.includes('Cancelled')
      const isVideo = message.content.includes('video')
      
      // Extract duration if present
      const durationMatch = message.content.match(/\((\d+:\d+)\)/)
      const duration = durationMatch ? durationMatch[1] : ''
      
      const getCallTraceMessage = () => {
        const getDirectionIcon = () => {
          if (isOutgoing) {
            return (
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            )
          } else {
            return (
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
            )
          }
        }
        
        const callTypeIcon = isVideo ? 
          <Video className="w-4 h-4" /> : 
          <Phone className="w-4 h-4" />
        
        if (isMissed) {
          return {
            text: message.content.replace(/\s*\(\d+:\d+\)/, ''),
            bgColor: 'bg-red-50 dark:bg-red-900/30',
            borderColor: 'border-red-200 dark:border-red-800/50',
            textColor: 'text-red-700 dark:text-red-300',
            directionIcon: getDirectionIcon(),
            callIcon: callTypeIcon,
            duration
          }
        } else {
          return {
            text: message.content.replace(/\s*\(\d+:\d+\)/, ''),
            bgColor: 'bg-gray-50 dark:bg-gray-800/50',
            borderColor: 'border-gray-200 dark:border-gray-700/50',
            textColor: 'text-gray-700 dark:text-gray-300',
            directionIcon: getDirectionIcon(),
            callIcon: callTypeIcon,
            duration
          }
        }
      }
      
      const callTrace = getCallTraceMessage()
      
      return (
        <div className="flex justify-center my-3" data-message-id={message.id} role="article">
          <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${callTrace.bgColor} ${callTrace.borderColor} shadow-sm max-w-sm`}>
            {/* Direction Arrow */}
            <div className={`${callTrace.textColor} flex-shrink-0`}>
              {callTrace.directionIcon}
            </div>
            
            {/* Call Text */}
            <div className="flex-1 min-w-0">
              <span className={`text-sm font-medium ${callTrace.textColor}`}>
                {callTrace.text}
              </span>
              {callTrace.duration && (
                <span className={`text-sm ${callTrace.textColor} ml-1`}>
                  ({callTrace.duration})
                </span>
              )}
            </div>
            
            {/* Call Type Icon */}
            <div className={`${callTrace.textColor} flex-shrink-0`}>
              {callTrace.callIcon}
            </div>
          </div>
        </div>
      )
    }
    
    // Regular system message
    return (
      <div className="flex justify-center my-2" data-message-id={message.id} role="article">
        <div className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-xs text-gray-600 dark:text-gray-300 text-center max-w-[80%]">
          {message.content}
        </div>
      </div>
    )
  }


  return (
    <div className={`flex ${isCallMessage ? 'justify-center' : isOwnMessage ? 'justify-end' : 'justify-start'} group px-2`} data-message-id={message.id} role="article">
      <div className={`${message.type === 'poll' ? 'min-w-[40%]' : 'flex'} message-bubble ${isMobile ? getMobileContainerClass() : 'max-w-[85%] sm:max-w-[70%]'}  ${isOwnMessage ? 'flex-row-reverse' : 'flex-row'} items-end space-x-2 relative`}>
        {/* Avatar for received messages */}
        {!isOwnMessage && (
          <div className="flex-shrink-0 mb-1">
            {message.senderImage ? (
              <img
                src={getCompatibleFileUrl(message.senderImage)}
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
                {decryptedReplyContent !== null ? decryptedReplyContent : (
                  message.replyTo.content.startsWith('🔐') ? '🔓 Decrypting...' : message.replyTo.content
                )}
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
                  className="w-full resize-none border-0 p-0 bg-transparent focus:outline-none text-sm leading-relaxed break-words overflow-wrap-anywhere hyphens-auto
                    text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
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
                    className="p-1 rounded-md focus:outline-none text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
                    title="Save changes (Enter)"
                  >
                    <Save className="w-3 h-3" />
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="p-1 rounded-md focus:outline-none text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
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
                  <span className="text-gray-500 dark:text-gray-400">
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
                  <span className="italic text-gray-700 dark:text-gray-300">
                    {message.content}
                  </span>
                </div>
              ) : message.type === 'poll' && message.poll ? (
                <Poll
                  poll={message.poll}
                  onVote={onVotePoll || (() => {})}
                  className="max-w-none"
                />
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
                          src={getCompatibleFileUrl(attachment.url)}
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
                        audioUrl={getCompatibleFileUrl(attachment.url)}
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
            <div className="flex items-center justify-end space-x-1 mt-1 text-xs text-gray-500 dark:text-gray-400">
              <span>{formatMessageTime(message.timestamp)}</span>
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

                        {/* Delete option - Only admins can delete in group chats */}
                        {(!isGroupChat && isOwnMessage && onDelete) && (
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
                        
                        {/* Admin delete option in group chats */}
                        {isGroupChat && !isOwnMessage && currentUserRole === 'admin' && onDelete && (
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
                            <span>Delete (Admin)</span>
                          </button>
                        )}

                        {/* Delete for me option - for group members' own messages or others' messages */}
                        {((isGroupChat && isOwnMessage) || !isOwnMessage) && onDeleteForMe && (
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
                display: 'flex' as const,
                flexDirection: 'row' as const,
                flexWrap: 'wrap' as const,
                gap: '4px',
                alignItems: 'center' as const
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