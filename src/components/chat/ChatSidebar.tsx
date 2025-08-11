'use client'

import { useState, useCallback, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { Search, Plus, MessageCircle, X } from 'lucide-react'
import { BlockedUsersManager } from '@/components/BlockedUsersManager'
import { useConversations } from '@/hooks/useConversations'
import { UserSelectionModal } from './UserSelectionModal'
import { ConversationAvatar } from './ConversationAvatar'

interface ChatSidebarProps {
  selectedConversationId: string | null
  onSelectConversation: (conversationId: string) => void
}

// Helper functions moved outside component to avoid hoisting issues
function getConversationName(conversation: any) {
  if (conversation.name) return conversation.name
  if (conversation.isGroup) return 'Group Chat'
  
  const otherParticipant = conversation.otherParticipants[0]
  return otherParticipant?.user?.name || otherParticipant?.user?.username || 'Unknown'
}

function formatTime(date: Date | string) {
  const messageDate = new Date(date)
  const now = new Date()
  const diffInHours = Math.floor((now.getTime() - messageDate.getTime()) / (1000 * 60 * 60))
  
  if (diffInHours < 1) {
    const diffInMinutes = Math.floor((now.getTime() - messageDate.getTime()) / (1000 * 60))
    return diffInMinutes < 1 ? 'now' : `${diffInMinutes}m`
  } else if (diffInHours < 24) {
    return `${diffInHours}h`
  } else {
    const diffInDays = Math.floor(diffInHours / 24)
    return diffInDays === 1 ? '1d' : `${diffInDays}d`
  }
}

function getLastMessagePreview(conversation: any, sessionUserId?: string) {
  const lastMessage = conversation.messages[0]
  if (!lastMessage) return 'No messages yet'

  const isOwn = lastMessage.senderId === sessionUserId
  const senderName = isOwn ? 'You' : (lastMessage.sender?.name || lastMessage.sender?.username || 'Someone')
  
  if (conversation.isGroup && !isOwn) {
    return `${senderName}: ${lastMessage.content}`
  }
  
  return lastMessage.content
}

export function ChatSidebar({ selectedConversationId, onSelectConversation }: ChatSidebarProps) {
  const { data: session } = useSession()
  const { conversations, loading, error } = useConversations()
  const [searchQuery, setSearchQuery] = useState('')
  const [showUserSelection, setShowUserSelection] = useState(false)
  const [activeTab, setActiveTab] = useState<'conversations' | 'blocked'>('conversations')
  
  // Use callback to ensure stable references
  const handleNewChatClick = useCallback(() => {
    setShowUserSelection(true)
  }, [])
  
  const handleConversationCreated = useCallback((conversationId: string) => {
    onSelectConversation(conversationId)
    setShowUserSelection(false)
  }, [onSelectConversation])
  
  const handleCloseModal = useCallback(() => {
    setShowUserSelection(false)
  }, [])

  // Filter conversations using useMemo for performance
  const filteredConversations = useMemo(() => {
    return conversations.filter(conversation => {
      const conversationName = getConversationName(conversation)
      const lastMessage = conversation.messages[0]?.content || ''
      
      return conversationName.toLowerCase().includes(searchQuery.toLowerCase()) ||
             lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
    })
  }, [conversations, searchQuery])

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        {/* Search skeleton */}
        <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded-md animate-pulse"></div>
        
        {/* Conversation skeletons */}
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center space-x-3 p-3">
            <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse"></div>
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4"></div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-center text-red-600 dark:text-red-400">
        <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tabs + Search/New Chat */}
      <div className="p-4 space-y-4">
        {/* Tabs */}
        <div className="bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700">
          <nav className="-mb-px flex">
            <button
              onClick={() => setActiveTab('conversations')}
              className={`flex-1 py-2 px-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'conversations'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Conversations
            </button>
            <button
              onClick={() => setActiveTab('blocked')}
              className={`flex-1 py-2 px-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'blocked'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Blocked Users
            </button>
          </nav>
        </div>

        {activeTab === 'conversations' && (
          <>
            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search conversations..."
                className="w-full pl-10 pr-10 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* New Chat Button */}
            <button 
              onClick={handleNewChatClick}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="text-sm font-medium">New Chat</span>
            </button>
          </>
        )}
      </div>

      {/* Content */}
      {activeTab === 'conversations' ? (
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              {searchQuery ? (
                <>
                  <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No conversations found</p>
                </>
              ) : (
                <>
                  <MessageCircle className="w-8 h-8 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No conversations yet</p>
                  <p className="text-xs mt-1">Start a new chat to get started</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredConversations.map((conversation) => {
                const lastMessage = conversation.messages[0]
                return (
                  <button
                    key={conversation.id}
                    onClick={() => onSelectConversation(conversation.id)}
                    className={`w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                      selectedConversationId === conversation.id
                        ? 'bg-blue-50 dark:bg-blue-900/50 border-r-2 border-blue-600'
                        : ''
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <ConversationAvatar conversation={conversation} />
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className={`text-sm text-gray-900 dark:text-white truncate ${
                            conversation.unreadCount > 0 ? 'font-bold' : 'font-medium'
                          }`}>
                            {getConversationName(conversation)}
                          {/* Removed group member count for cleaner UI */}
                          </h3>
                          {lastMessage && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {formatTime(lastMessage.createdAt)}
                            </span>
                          )}
                        </div>
                        
                        <p className={`text-sm text-gray-600 dark:text-gray-300 truncate break-words ${
                          conversation.unreadCount > 0 ? 'font-bold' : 'font-normal'
                        }`}>
                          {getLastMessagePreview(conversation, session?.user?.id)}
                        </p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overscroll-contain p-4">
          <BlockedUsersManager />
        </div>
      )}

      {/* User Selection Modal */}
      <UserSelectionModal
        isOpen={showUserSelection}
        onClose={handleCloseModal}
        onConversationCreated={handleConversationCreated}
      />
    </div>
  )
}