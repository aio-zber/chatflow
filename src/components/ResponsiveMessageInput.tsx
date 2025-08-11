'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Paperclip, Smile, X, Plus } from 'lucide-react'

interface ResponsiveMessageInputProps {
  onSendMessage: (content: string, attachments?: File[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function ResponsiveMessageInput({ 
  onSendMessage, 
  placeholder = "Type a message...", 
  disabled = false,
  className = "" 
}: ResponsiveMessageInputProps) {
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false)
  const [isMobileKeyboardOpen, setIsMobileKeyboardOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [message])

  // Detect mobile keyboard
  useEffect(() => {
    const handleResize = () => {
      // On mobile, when keyboard opens, viewport height decreases significantly
      const isMobile = window.innerWidth <= 768
      if (isMobile) {
        const viewportHeight = window.visualViewport?.height || window.innerHeight
        const documentHeight = document.documentElement.clientHeight
        setIsMobileKeyboardOpen(documentHeight - viewportHeight > 150)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    window.visualViewport?.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.visualViewport?.removeEventListener('resize', handleResize)
    }
  }, [])

  const handleSend = () => {
    if (message.trim() || attachments.length > 0) {
      onSendMessage(message, attachments)
      setMessage('')
      setAttachments([])
      setShowAttachmentMenu(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    setAttachments(prev => [...prev, ...files])
    setShowAttachmentMenu(false)
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className={`
      ${className}
      ${isMobileKeyboardOpen ? 'pb-2' : 'pb-4 safe-area-inset-bottom'}
      bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700
      transition-all duration-200 ease-in-out
    `}>
      {/* Attachments Preview */}
      {attachments.length > 0 && (
        <div className="px-3 sm:px-4 pt-3 sm:pt-4">
          <div className="flex flex-wrap gap-2">
            {attachments.map((file, index) => (
              <div key={index} className="flex items-center space-x-2 bg-gray-100 dark:bg-gray-700 rounded-lg p-2 text-sm">
                <Paperclip className="w-4 h-4 text-gray-500" />
                <span className="truncate max-w-32 sm:max-w-48">{file.name}</span>
                <span className="text-xs text-gray-500">({formatFileSize(file.size)})</span>
                <button
                  onClick={() => removeAttachment(index)}
                  className="text-red-500 hover:text-red-700 p-1"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="px-3 sm:px-4 pt-3 sm:pt-4">
        <div className="flex items-end space-x-2 sm:space-x-3">
          {/* Attachment Button */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
              className="btn-touch p-2 sm:p-2.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors touch-manipulation focus-ring"
              disabled={disabled}
            >
              <Plus className="w-5 h-5" />
            </button>

            {/* Attachment Menu */}
            {showAttachmentMenu && (
              <>
                <div 
                  className="fixed inset-0 z-10 sm:hidden"
                  onClick={() => setShowAttachmentMenu(false)}
                />
                <div className="absolute bottom-full left-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 min-w-40">
                  <button
                    onClick={() => {
                      fileInputRef.current?.click()
                      setShowAttachmentMenu(false)
                    }}
                    className="w-full flex items-center space-x-2 px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 first:rounded-t-lg last:rounded-b-lg"
                  >
                    <Paperclip className="w-4 h-4" />
                    <span>Attach File</span>
                  </button>
                </div>
              </>
            )}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
              accept="image/*,application/pdf,.doc,.docx,.txt"
            />
          </div>

          {/* Message Input */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              className="w-full px-3 sm:px-4 py-2 sm:py-3 border border-gray-300 dark:border-gray-600 rounded-lg sm:rounded-xl resize-none focus-ring bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 text-sm sm:text-base max-h-30 custom-scrollbar"
              style={{ minHeight: '44px' }}
            />
          </div>

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={disabled || (!message.trim() && attachments.length === 0)}
            className="btn-touch flex-shrink-0 p-2 sm:p-2.5 bg-primary-600 text-white rounded-full hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation focus-ring"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  )
}
