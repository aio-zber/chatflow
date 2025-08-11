'use client'

import { useState, useRef, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Heart, Reply, MoreHorizontal, Check, CheckCheck } from 'lucide-react'
import { MessageFormatter } from '../MessageFormatter'
import { VoiceMessagePlayer } from '../VoiceMessagePlayer'

interface Reaction {
  emoji: string
  count: number
  users: string[]
  hasReacted: boolean
}

interface Message {
  id: string
  content: string
  senderId: string
  senderName: string
  senderImage?: string
  timestamp: Date
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'unread'
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
  // onDelete?: (messageId: string) => void
}

export function MessageBubble({ message, onReply, onReact }: MessageBubbleProps) {
  const { data: session } = useSession()
  const [showActions, setShowActions] = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  const [isReacting, setIsReacting] = useState(false)

  // Interaction timing
  const LONG_PRESS_MS = 450
  const LINGER_MS = 1200
  const AUTO_HIDE_AFTER_SHOW_MS = 3000

  const hideTimerRef = useRef<number | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const autoHideTimerRef = useRef<number | null>(null)

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

  useEffect(() => {
    return () => {
      clearHide()
      clearLongPress()
      if (autoHideTimerRef.current) window.clearTimeout(autoHideTimerRef.current)
    }
  }, [])

  const isOwnMessage = message.senderId === session?.user?.id
  const commonReactions = ['❤️', '👍', '😂', '😮', '😢', '😡']

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
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
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

  return (
    <div className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} group`} data-message-id={message.id}>
      <div className={`flex max-w-[70%] ${isOwnMessage ? 'flex-row-reverse' : 'flex-row'} items-end space-x-2`}>
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
            <div className={`
              mb-2 p-2 rounded-lg border-l-4 text-xs
              ${isOwnMessage 
                ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-500' 
                : 'bg-gray-100 dark:bg-gray-700 border-gray-400'
              }
            `}>
              <p className="font-medium text-gray-700 dark:text-gray-300">
                {message.replyTo.senderName}
              </p>
              <p className="text-gray-600 dark:text-gray-400 truncate">
                {message.replyTo.content}
              </p>
            </div>
          )}

          {/* Main message content */}
          <div
            className={`
              relative px-4 py-2 rounded-2xl max-w-full break-words
              ${isOwnMessage
                ? 'bg-blue-600 text-white rounded-br-md'
                : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-bl-md'
              }
            `}
            onMouseEnter={() => {
              clearHide()
              setShowActions(true)
            }}
            onMouseLeave={() => {
              // linger after leaving
              scheduleHide()
            }}
            onPointerDown={() => {
              // long-press to show actions (touch/mouse)
              clearLongPress()
              longPressTimerRef.current = window.setTimeout(() => {
                setShowActions(true)
                scheduleAutoHide()
              }, LONG_PRESS_MS)
            }}
            onPointerUp={() => {
              clearLongPress()
            }}
            onPointerCancel={() => {
              clearLongPress()
            }}
            onFocus={() => {
              clearHide()
              setShowActions(true)
            }}
            onBlur={() => {
              scheduleHide()
            }}
          >
            <MessageFormatter 
              content={message.content}
              className="text-sm leading-relaxed"
            />

            {/* Attachments */}
            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-2 space-y-2">
                {message.attachments.map((attachment) => (
                  <div key={attachment.id}>
                    {attachment.type === 'image' ? (
                      <img
                        src={attachment.url}
                        alt={attachment.name}
                        className="max-w-full h-auto rounded-lg cursor-pointer hover:opacity-90"
                        onClick={() => {
                          // TODO: Open image in modal
                        }}
                      />
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
                      <div className="flex items-center space-x-2 p-2 bg-white/10 dark:bg-black/10 rounded-lg">
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
              {isOwnMessage && getStatusIcon()}
            </div>

            {/* Quick actions (visible via hover/long-press) */}
            {showActions && (
              <div
                className={`
                  absolute top-0 flex items-center space-x-1
                  ${isOwnMessage ? 'right-full mr-2' : 'left-full ml-2'}
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
                  className="p-1.5 bg-white dark:bg-gray-800 rounded-full shadow-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  aria-label="Add reaction"
                >
                  <Heart className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </button>
                
                <button
                  onClick={() => onReply?.(message)}
                  className="p-1.5 bg-white dark:bg-gray-800 rounded-full shadow-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  aria-label="Reply to message"
                >
                  <Reply className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </button>

                <div className="relative">
                  <button
                    onClick={() => {
                      // TODO: Show more options menu
                    }}
                    className="p-1.5 bg-white dark:bg-gray-800 rounded-full shadow-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-label="More options"
                  >
                    <MoreHorizontal className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Reactions */}
          {message.reactions && message.reactions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1 ml-3">
              {message.reactions.map((reaction, index) => (
                <button
                  key={`${message.id}-reaction-${reaction.emoji}-${index}`}
                  onClick={() => handleReaction(reaction.emoji)}
                  disabled={isReacting}
                  className={`
                    inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs
                    ${
                      // Treat message.reactions as per-user entries; highlight current user's reaction
                      // Fallback to old shape if present
                      (reaction as any).userId === session?.user?.id || (reaction as any).hasReacted
                        ? 'bg-blue-100 dark:bg-blue-900/30 border border-blue-500'
                        : 'bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600'
                    }
                    ${isReacting ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 transition-transform'}
                    focus:outline-none focus:ring-2 focus:ring-blue-500
                  `}
                  title={(() => {
                    const anyReaction = reaction as any
                    if (Array.isArray(anyReaction.users)) {
                      return `Reacted by: ${anyReaction.users.map((u: any) => u.name || u.username).join(', ')}`
                    }
                    return `Reacted by: ${anyReaction.user?.username || anyReaction.userId || 'Unknown'}`
                  })()}
                >
                  <span>{reaction.emoji}</span>
                  <span className={`font-medium ${((reaction as any).userId === session?.user?.id || (reaction as any).hasReacted) ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>1</span>
                </button>
              ))}
            </div>
          )}

          {/* Reaction picker */}
          {showReactions && (
            <>
              <div 
                className="fixed inset-0 z-10" 
                onClick={() => setShowReactions(false)}
                aria-hidden="true"
              />
              <div className={`
                absolute z-20 mt-2 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700
                ${isOwnMessage ? 'right-0' : 'left-0'}
              `}>
                <div className="flex space-x-1">
                  {commonReactions.map((emoji) => (
                    <button
                      key={`${message.id}-emoji-${emoji}`}
                      onClick={() => handleReaction(emoji)}
                      disabled={isReacting}
                      className={`p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg transition-transform ${
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
      </div>
    </div>
  )
}