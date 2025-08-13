'use client'

import { useState, useRef, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Heart, Reply, MoreHorizontal, Check, CheckCheck, Edit3, Trash2, EyeOff, Save, X } from 'lucide-react'
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
  onScrollToMessage?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onDelete?: (messageId: string) => void
  onHideFromView?: (messageId: string) => void
}

export function MessageBubble({ message, onReply, onReact, onScrollToMessage, onEdit, onDelete, onHideFromView }: MessageBubbleProps) {
  const { data: session } = useSession()
  const [showActions, setShowActions] = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  const [showMoreOptions, setShowMoreOptions] = useState(false)
  const [isReacting, setIsReacting] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const [isDeleting, setIsDeleting] = useState(false)

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

  const handleHideFromView = async () => {
    if (!onHideFromView) return
    
    if (confirm('Hide this message from your view? You can still see it if you reload the conversation.')) {
      try {
        await onHideFromView(message.id)
        setShowMoreOptions(false)
        setShowActions(false)
      } catch (error) {
        console.error('Error hiding message:', error)
      }
    }
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditContent(message.content)
    setShowMoreOptions(false)
  }

  return (
    <div className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} group`} data-message-id={message.id}>
      <div className={`flex message-bubble max-w-[85%] sm:max-w-[70%] ${isOwnMessage ? 'flex-row-reverse' : 'flex-row'} items-end space-x-2`}>
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
              title={onScrollToMessage ? "Click to scroll to original message" : undefined}
            >
              <p className="font-medium text-gray-700 dark:text-gray-300 truncate">
                {message.replyTo.senderName}
              </p>
              <p className="text-gray-600 dark:text-gray-400 break-words line-clamp-2 text-wrap">
                {message.replyTo.content}
              </p>
            </div>
          )}

          {/* Main message content */}
          <div
            className={`
              message-content relative px-4 py-2 rounded-2xl max-w-full break-words
              ${isOwnMessage
                ? 'bg-blue-600 text-white rounded-br-md'
                : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-bl-md'
              }
            `}
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
            onPointerDown={() => {
              if (!isEditing) {
                clearLongPress()
                longPressTimerRef.current = window.setTimeout(() => {
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
                  className={`w-full resize-none border-0 p-0 bg-transparent focus:outline-none text-sm leading-relaxed ${
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
              <MessageFormatter 
                content={message.content}
                className="text-sm leading-relaxed"
              />
            )}

            {/* Attachments */}
            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-2 space-y-2">
                {message.attachments.map((attachment) => (
                  <div key={attachment.id}>
                    {attachment.type === 'image' ? (
                      <div className="relative">
                        <img
                          src={attachment.url}
                          alt={attachment.name}
                          className="max-w-full h-auto rounded-lg cursor-pointer hover:opacity-90"
                          onClick={() => {
                            // TODO: Open image in modal
                          }}
                        />
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
            {showActions && !isEditing && (
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
                    onClick={() => setShowMoreOptions(!showMoreOptions)}
                    className="p-1.5 bg-white dark:bg-gray-800 rounded-full shadow-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-label="More options"
                  >
                    <MoreHorizontal className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                  </button>

                  {/* More options dropdown */}
                  {showMoreOptions && (
                    <>
                      <div 
                        className="fixed inset-0 z-10" 
                        onClick={() => setShowMoreOptions(false)}
                        aria-hidden="true"
                      />
                      <div className={`
                        absolute z-20 mt-2 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 min-w-[140px]
                        ${isOwnMessage ? 'right-0' : 'left-0'}
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

                        {/* Hide from view option (only for others' messages) */}
                        {!isOwnMessage && onHideFromView && (
                          <button
                            onClick={handleHideFromView}
                            className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center space-x-2"
                          >
                            <EyeOff className="w-4 h-4" />
                            <span>Hide from view</span>
                          </button>
                        )}
                      </div>
                    </>
                  )}
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