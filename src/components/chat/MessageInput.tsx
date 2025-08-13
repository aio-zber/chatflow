'use client'

import { useState, useRef, useCallback, KeyboardEvent } from 'react'
import { Send, Paperclip, Image, Smile, X, File, Mic } from 'lucide-react'
import { VoiceMessageRecorder } from '../VoiceMessage'

interface MessageInputProps {
  onSendMessage: (content: string, attachments?: File[]) => void
  onSendVoiceMessage?: (audioBlob: Blob, duration: number) => void
  onTyping?: (isTyping: boolean) => void
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
}

export function MessageInput({ 
  onSendMessage, 
  onSendVoiceMessage,
  onTyping, 
  disabled = false, 
  placeholder = "Type a message...",
  replyTo,
  onCancelReply
}: MessageInputProps) {
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([])
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout>()

  // Common emojis for quick access
  const commonEmojis = ['😊', '😂', '❤️', '👍', '👎', '😮', '😢', '😡', '🎉', '🔥', '💯', '👀']

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

  const handleSend = () => {
    const trimmedMessage = message.trim()
    
    if (!trimmedMessage && attachments.length === 0) {
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

    // Send message
    const attachmentFiles = attachments.map(a => a.file)
    onSendMessage(trimmedMessage, attachmentFiles.length > 0 ? attachmentFiles : undefined)

    // Clear input
    setMessage('')
    setAttachments([])
    
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
        return
      }

      const url = URL.createObjectURL(file)
      let fileType: 'image' | 'file' = 'file'
      
      if (type) {
        fileType = type
      } else if (file.type.startsWith('image/')) {
        fileType = 'image'
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
    setShowEmojiPicker(false)
    
    // Set cursor position after emoji
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + emoji.length, start + emoji.length)
    }, 0)
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
    <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      {/* Reply preview */}
      {replyTo && (
        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-1 h-8 bg-blue-500 rounded-full" />
              <div>
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  Replying to {replyTo.senderName}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 break-words line-clamp-2 max-w-full pr-8">
                  {replyTo.content}
                </p>
              </div>
            </div>
            <button
              onClick={onCancelReply}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Cancel reply"
            >
              <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>
      )}

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment, index) => (
              <div key={index} className="relative group">
                {attachment.type === 'image' ? (
                  <div className="relative">
                    <img
                      src={attachment.url}
                      alt={attachment.file.name}
                      className="w-16 h-16 object-cover rounded-lg"
                    />
                    {/* Show GIF indicator */}
                    {attachment.file.type === 'image/gif' && (
                      <div className="absolute bottom-1 right-1 bg-black bg-opacity-70 text-white text-xs px-1 rounded">
                        GIF
                      </div>
                    )}
                    <button
                      onClick={() => removeAttachment(index)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity focus:outline-none focus:opacity-100"
                      aria-label="Remove attachment"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="relative flex items-center space-x-2 p-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                    <File className="w-8 h-8 text-gray-500 dark:text-gray-400" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate max-w-32">
                        {attachment.file.name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {(attachment.file.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                    <button
                      onClick={() => removeAttachment(index)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity focus:outline-none focus:opacity-100"
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
      <div className="flex items-end space-x-3 p-4">
        {/* Attachment buttons */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Attach file"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={disabled}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Attach image"
          >
            <Image className="w-5 h-5" />
          </button>

          <button
            onClick={() => setShowVoiceRecorder(true)}
            disabled={disabled}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Record voice message"
          >
            <Mic className="w-5 h-5" />
          </button>
        </div>

        {/* Text input */}
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
            className="w-full resize-none border border-gray-300 dark:border-gray-600 rounded-2xl px-4 py-3 pr-12 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ minHeight: '44px', maxHeight: '120px' }}
          />
          
          {/* Emoji button */}
          <div className="absolute right-3 bottom-3">
            <button
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              disabled={disabled}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 focus:outline-none focus:text-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
              <div className="absolute bottom-full right-0 mb-2 p-3 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20">
                <div className="grid grid-cols-6 gap-2">
                  {commonEmojis.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => insertEmoji(emoji)}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg hover:scale-110 transition-transform"
                      aria-label={`Insert ${emoji} emoji`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={disabled || (!message.trim() && attachments.length === 0)}
          className="p-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          aria-label="Send message"
        >
          <Send className="w-5 h-5" />
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
        accept="image/*,.gif"
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