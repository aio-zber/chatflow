'use client'

import { useState, useRef, useCallback, KeyboardEvent } from 'react'
import { Send, Paperclip, Image, Smile, X, File, Mic, Sticker, BarChart3 } from 'lucide-react'
import { VoiceMessageRecorder } from '../VoiceMessage'
import { StickerPicker } from './StickerPicker'

interface MessageInputProps {
  onSendMessage: (content: string, attachments?: File[]) => void
  onSendVoiceMessage?: (audioBlob: Blob, duration: number) => void
  onTyping?: (isTyping: boolean) => void
  onCreatePoll?: () => void
  disabled?: boolean
  placeholder?: string
  replyTo?: {
    id: string
    content: string
    senderName: string
  }
  onCancelReply?: () => void
}

interface AttachmentPreview {
  file: File
  url: string
  type: 'image' | 'file'
  uploading?: boolean
  uploadProgress?: number
}

export function MessageInput({ 
  onSendMessage, 
  onSendVoiceMessage,
  onTyping,
  onCreatePoll,
  disabled = false, 
  placeholder = "Type a message...",
  replyTo,
  onCancelReply
}: MessageInputProps) {
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([])
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showStickerPicker, setShowStickerPicker] = useState(false)
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [isSending, setIsSending] = useState(false)
  
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout>()

  // Enhanced emoji collection with categories from the old stickers
  const emojiCategories = {
    popular: ['😊', '😂', '❤️', '👍', '👎', '😮', '😢', '😡', '🎉', '🔥', '💯', '👀'],
    emotions: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
      '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩',
      '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪',
      '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨',
      '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥',
      '😔', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩',
      '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯',
      '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓'
    ],
    gestures: [
      '👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🤟',
      '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️',
      '👋', '🤚', '🖐️', '✋', '🖖', '👏', '🙌', '🤲',
      '🤝', '🙏', '✍️', '💪', '🦾', '🦿', '🦵', '🦶'
    ],
    hearts: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
      '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖',
      '💘', '💝', '💟', '☮️'
    ],
    nature: [
      '🌱', '🌿', '🍀', '🍁', '🍂', '🍃', '🌾', '🌵',
      '🌲', '🌳', '🌴', '🌸', '🌺', '🌻', '🌹', '🥀',
      '🌷', '💐', '🌼', '🌙', '🌛', '🌜', '🌚', '🌕',
      '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔', '⭐'
    ]
  }
  
  const [currentEmojiCategory, setCurrentEmojiCategory] = useState<keyof typeof emojiCategories>('popular')

  const handleInputChange = useCallback((value: string) => {
    setMessage(value)
    
    // Handle typing indicators
    if (onTyping && !isTyping && value.trim()) {
      setIsTyping(true)
      onTyping(true)
    }

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    // Set new timeout to stop typing indicator
    typingTimeoutRef.current = setTimeout(() => {
      if (isTyping) {
        setIsTyping(false)
        onTyping?.(false)
      }
    }, 1000)
  }, [isTyping, onTyping])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = async () => {
    const trimmedMessage = message.trim()
    
    if (!trimmedMessage && attachments.length === 0) {
      return
    }

    // Don't send if already sending
    if (isSending) {
      return
    }

    // Clear typing indicator immediately
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }
    if (isTyping) {
      setIsTyping(false)
      onTyping?.(false)
    }

    // Set sending state
    setIsSending(true)

    // If there are attachments, show uploading state
    if (attachments.length > 0) {
      setAttachments(prev => prev.map(att => ({ ...att, uploading: true, uploadProgress: 0 })))
      
      // Simulate upload progress for visual feedback
      const progressInterval = setInterval(() => {
        setAttachments(prev => prev.map(att => ({
          ...att,
          uploadProgress: Math.min((att.uploadProgress || 0) + Math.random() * 30, 90)
        })))
      }, 200)

      try {
        // Send message
        const attachmentFiles = attachments.map(a => a.file)
        await onSendMessage(trimmedMessage, attachmentFiles.length > 0 ? attachmentFiles : undefined)
        
        // Complete the progress
        setAttachments(prev => prev.map(att => ({ ...att, uploadProgress: 100 })))
        
        // Wait a bit to show completion
        setTimeout(() => {
          clearInterval(progressInterval)
          // Clear input
          setMessage('')
          setAttachments([])
          setIsSending(false)
        }, 500)
      } catch (error) {
        clearInterval(progressInterval)
        setAttachments(prev => prev.map(att => ({ ...att, uploading: false, uploadProgress: 0 })))
        setIsSending(false)
        console.error('Failed to send message:', error)
      }
    } else {
      try {
        // Send text message
        await onSendMessage(trimmedMessage)
        
        // Clear input
        setMessage('')
        setIsSending(false)
      } catch (error) {
        setIsSending(false)
        console.error('Failed to send message:', error)
      }
    }
    
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleFileUpload = (files: FileList | null, type?: 'image' | 'file') => {
    if (!files) return

    Array.from(files).forEach(file => {
      // Check file size (50MB limit for GIFs and videos, 10MB for others)
      const isLargeMediaFile = file.type.includes('gif') || file.type.includes('video')
      const maxSize = isLargeMediaFile ? 50 * 1024 * 1024 : 10 * 1024 * 1024
      
      if (file.size > maxSize) {
        // TODO: Show error toast
        console.error(`File too large: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`)
        alert(`File too large: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size: ${isLargeMediaFile ? '50MB' : '10MB'}`)
        return
      }

      const url = URL.createObjectURL(file)
      let fileType: 'image' | 'file' = 'file'
      
      if (type) {
        fileType = type
      } else if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        fileType = 'image' // Treat videos as visual media like images for UI purposes
      }
      
      setAttachments(prev => [...prev, { file, url, type: fileType }])
    })
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => {
      const newAttachments = [...prev]
      URL.revokeObjectURL(newAttachments[index].url)
      newAttachments.splice(index, 1)
      return newAttachments
    })
  }

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const newMessage = message.slice(0, start) + emoji + message.slice(end)
    
    setMessage(newMessage)
    
    // Set cursor position after emoji
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + emoji.length, start + emoji.length)
    }, 0)
  }

  const handleStickerSelect = (sticker: string) => {
    // For stickers, we can either send them immediately or insert them like emojis
    // Let's send them immediately as this is more typical for sticker functionality
    if (onSendMessage) {
      onSendMessage(sticker)
    }
    setShowStickerPicker(false)
  }

  const handleVoiceMessage = (audioBlob: Blob, duration: number) => {
    if (onSendVoiceMessage) {
      onSendVoiceMessage(audioBlob, duration)
      setShowVoiceRecorder(false)
    }
  }

  const handleCancelVoiceMessage = () => {
    setShowVoiceRecorder(false)
  }

  // Auto-resize textarea
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    const scrollHeight = textarea.scrollHeight
    const maxHeight = 120 // ~6 lines
    textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`
  }

  return (
    <div className="border-t border-viber-border dark:border-viber-border bg-viber-surface dark:bg-viber-surface">
      {/* Reply preview */}
      {replyTo && (
        <div className="px-4 py-3 border-b border-viber-border dark:border-viber-border bg-viber-accent dark:bg-viber-accent">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-1 h-10 bg-viber-primary rounded-full" />
              <div>
                <p className="text-xs font-medium text-viber-primary">
                  Replying to {replyTo.senderName}
                </p>
                <p className="text-sm text-viber-text-secondary dark:text-viber-text-secondary break-words line-clamp-2 max-w-full pr-8">
                  {replyTo.content}
                </p>
              </div>
            </div>
            <button
              onClick={onCancelReply}
              className="p-1.5 hover:bg-viber-surface-variant dark:hover:bg-viber-surface-bright rounded-full focus:outline-none transition-colors"
              aria-label="Cancel reply"
            >
              <X className="w-4 h-4 text-viber-text-secondary dark:text-viber-text-secondary" />
            </button>
          </div>
        </div>
      )}

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="px-4 py-3 border-b border-viber-border dark:border-viber-border bg-viber-surface-container dark:bg-viber-surface-container">
          <div className="flex flex-wrap gap-3">
            {attachments.map((attachment, index) => (
              <div key={`attachment-${attachment.file.name}-${attachment.file.size}-${index}`} className="relative group">
                {attachment.type === 'image' ? (
                  <div className="relative">
                    {attachment.file.type.startsWith('video/') ? (
                      <video
                        src={attachment.url}
                        className={`w-16 h-16 object-cover rounded-lg transition-opacity ${
                          attachment.uploading ? 'opacity-60' : 'opacity-100'
                        }`}
                        muted
                        playsInline
                      />
                    ) : (
                      <img
                        src={attachment.url}
                        alt={attachment.file.name}
                        className={`w-16 h-16 object-cover rounded-lg transition-opacity ${
                          attachment.uploading ? 'opacity-60' : 'opacity-100'
                        }`}
                      />
                    )}
                    {/* Show video indicator */}
                    {attachment.file.type.startsWith('video/') && (
                      <div className="absolute bottom-1 right-1 bg-black bg-opacity-70 text-white text-xs px-1 rounded">
                        📹
                      </div>
                    )}
                    {/* Show GIF indicator */}
                    {attachment.file.type === 'image/gif' && (
                      <div className="absolute bottom-1 right-1 bg-black bg-opacity-70 text-white text-xs px-1 rounded">
                        GIF
                      </div>
                    )}
                    {/* Upload progress overlay */}
                    {attachment.uploading && (
                      <div className="absolute inset-0 bg-black bg-opacity-50 rounded-lg flex items-center justify-center">
                        <div className="text-center">
                          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mb-1" />
                          <div className="text-xs text-white font-medium">
                            {Math.round(attachment.uploadProgress || 0)}%
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Upload progress bar */}
                    {attachment.uploading && (
                      <div className="absolute bottom-0 left-0 right-0 bg-gray-200 rounded-b-lg overflow-hidden">
                        <div 
                          className="h-1 bg-blue-500 transition-all duration-300 ease-out"
                          style={{ width: `${attachment.uploadProgress || 0}%` }}
                        />
                      </div>
                    )}
                    <button
                      onClick={() => removeAttachment(index)}
                      disabled={attachment.uploading}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-viber-orange text-viber-text-inverse rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 focus:outline-none focus:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:scale-105"
                      aria-label="Remove attachment"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className={`relative flex items-center space-x-2 p-2 bg-gray-100 dark:bg-gray-700 rounded-lg transition-opacity ${
                    attachment.uploading ? 'opacity-60' : 'opacity-100'
                  }`}>
                    <div className="flex-shrink-0">
                      {attachment.uploading ? (
                        <div className="w-8 h-8 border-2 border-gray-400 border-t-blue-500 rounded-full animate-spin" />
                      ) : (
                        <File className="w-8 h-8 text-gray-500 dark:text-gray-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate max-w-32">
                        {attachment.file.name}
                      </p>
                      <div className="flex items-center space-x-2">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {(attachment.file.size / 1024 / 1024).toFixed(1)} MB
                        </p>
                        {attachment.uploading && (
                          <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                            {Math.round(attachment.uploadProgress || 0)}%
                          </p>
                        )}
                      </div>
                      {/* Upload progress bar */}
                      {attachment.uploading && (
                        <div className="mt-1 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden h-1">
                          <div 
                            className="h-full bg-blue-500 transition-all duration-300 ease-out"
                            style={{ width: `${attachment.uploadProgress || 0}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => removeAttachment(index)}
                      disabled={attachment.uploading}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-viber-orange text-viber-text-inverse rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 focus:outline-none focus:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:scale-105"
                      aria-label="Remove attachment"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-3 p-4">
        {/* Attachment buttons - left side */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="p-2.5 text-viber-text-secondary dark:text-viber-text-secondary hover:text-viber-primary dark:hover:text-viber-primary rounded-full focus:outline-none transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Attach file"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={disabled}
            className="p-2.5 text-viber-text-secondary dark:text-viber-text-secondary hover:text-viber-primary dark:hover:text-viber-primary rounded-full focus:outline-none transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Attach image"
          >
            <Image className="w-5 h-5" />
          </button>

          <button
            onClick={() => setShowVoiceRecorder(true)}
            disabled={disabled}
            className="p-2.5 text-viber-text-secondary dark:text-viber-text-secondary hover:text-viber-primary dark:hover:text-viber-primary rounded-full focus:outline-none transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Record voice message"
          >
            <Mic className="w-5 h-5" />
          </button>
        </div>

        {/* Text input with improved dark mode support */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => {
              handleInputChange(e.target.value)
              adjustTextareaHeight()
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="w-full resize-none border border-viber-border dark:border-viber-border rounded-3xl px-5 py-3 pr-20 bg-viber-surface-container dark:bg-viber-surface-bright text-viber-text-primary dark:text-viber-text-primary placeholder-viber-text-tertiary dark:placeholder-viber-text-tertiary focus:outline-none focus:ring-2 focus:ring-viber-primary focus:border-viber-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            style={{ minHeight: '48px', maxHeight: '120px' }}
          />
          
          {/* Emoji and Sticker buttons - inside input */}
          <div className="absolute right-4 bottom-3.5 flex gap-2">
            <button
              onClick={() => {
                setShowStickerPicker(!showStickerPicker)
                setShowEmojiPicker(false)
              }}
              disabled={disabled}
              className="text-viber-text-tertiary dark:text-viber-text-secondary hover:text-viber-primary dark:hover:text-viber-primary rounded-full p-1 focus:outline-none transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Add sticker"
            >
              <Sticker className="w-5 h-5" />
            </button>
            {onCreatePoll && (
              <button
                onClick={onCreatePoll}
                disabled={disabled}
                className="text-viber-text-tertiary dark:text-viber-text-secondary hover:text-viber-primary dark:hover:text-viber-primary rounded-full p-1 focus:outline-none transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Create poll"
              >
                <BarChart3 className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => {
                setShowEmojiPicker(!showEmojiPicker)
                setShowStickerPicker(false)
              }}
              disabled={disabled}
              className="text-viber-text-tertiary dark:text-viber-text-secondary hover:text-viber-primary dark:hover:text-viber-primary rounded-full p-1 focus:outline-none transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Add emoji"
            >
              <Smile className="w-5 h-5" />
            </button>
          </div>

          {/* Emoji picker */}
          {showEmojiPicker && (
            <>
              <div 
                className="fixed inset-0 z-10" 
                onClick={() => setShowEmojiPicker(false)}
                aria-hidden="true"
              />
              <div className="absolute bottom-full right-0 mb-2 w-80 bg-viber-surface dark:bg-viber-surface rounded-2xl shadow-viber-lg border border-viber-border dark:border-viber-border z-20">
                {/* Emoji Category Tabs */}
                <div className="flex border-b border-viber-border dark:border-viber-border overflow-x-auto">
                  {Object.entries(emojiCategories).map(([key, emojis]) => (
                    <button
                      key={key}
                      onClick={() => setCurrentEmojiCategory(key as keyof typeof emojiCategories)}
                      className={`px-4 py-3 text-xs font-medium whitespace-nowrap border-b-2 focus:outline-none transition-colors ${
                        currentEmojiCategory === key
                          ? 'text-viber-primary border-viber-primary bg-viber-accent dark:bg-viber-accent'
                          : 'text-viber-text-secondary border-transparent hover:text-viber-text-primary dark:text-viber-text-secondary dark:hover:text-viber-text-primary'
                      }`}
                    >
                      {key.charAt(0).toUpperCase() + key.slice(1)}
                    </button>
                  ))}
                </div>
                
                {/* Emoji Grid */}
                <div className="p-4 h-48 overflow-y-auto">
                  <div className="grid grid-cols-8 gap-1">
                    {emojiCategories[currentEmojiCategory].map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => insertEmoji(emoji)}
                        className="p-2 hover:bg-viber-surface-variant dark:hover:bg-viber-surface-bright rounded-lg focus:outline-none focus:ring-2 focus:ring-viber-primary text-lg hover:scale-110 transition-all duration-200"
                        aria-label={`Insert ${emoji} emoji`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Sticker picker */}
          {showStickerPicker && (
            <>
              <div 
                className="fixed inset-0 z-10" 
                onClick={() => setShowStickerPicker(false)}
                aria-hidden="true"
              />
              <StickerPicker
                isOpen={showStickerPicker}
                onClose={() => setShowStickerPicker(false)}
                onStickerSelect={handleStickerSelect}
              />
            </>
          )}
        </div>

        {/* Viber-style Send button */}
        <button
          onClick={handleSend}
          disabled={disabled || (!message.trim() && attachments.length === 0) || isSending}
          className="btn-touch p-3 bg-viber-primary text-viber-text-inverse rounded-full hover:bg-viber-secondary focus:outline-none shadow-viber transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 viber-focus ml-2"
          aria-label="Send message"
        >
          {isSending ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept="*/*"
        onChange={(e) => handleFileUpload(e.target.files)}
      />
      
      <input
        ref={imageInputRef}
        type="file"
        multiple
        className="hidden"
        accept="image/*,video/*,.gif"
        onChange={(e) => handleFileUpload(e.target.files, 'image')}
      />

      {/* Voice Message Recorder Modal */}
      {showVoiceRecorder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <VoiceMessageRecorder
            onSend={handleVoiceMessage}
            onCancel={handleCancelVoiceMessage}
            maxDuration={300} // 5 minutes
          />
        </div>
      )}
    </div>
  )
}