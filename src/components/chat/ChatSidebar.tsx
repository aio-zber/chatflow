'use client'

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { Search, Plus, MessageCircle, X } from 'lucide-react'
import { BlockedUsersManager } from '@/components/BlockedUsersManager'
import { useConversations } from '@/hooks/useConversations'
import { useBlockedUsers } from '@/hooks/useBlockedUsers'
import { useUserBlockers } from '@/hooks/useUserBlockers'
import { useE2EE } from '@/hooks/useE2EE'
import { useSocketContext } from '@/context/SocketContext'
import { UserSelectionModal } from './UserSelectionModal'
import { ConversationAvatar } from './ConversationAvatar'
import { formatConversationTime } from '@/utils/dateUtils'

interface ChatSidebarProps {
  selectedConversationId: string | null
  searchQuery?: string
  onSelectConversation: (conversationId: string) => void
}

// Helper functions moved outside component to avoid hoisting issues
function getConversationName(conversation: any) {
  if (conversation.name) return conversation.name
  if (conversation.isGroup) return 'Group Chat'
  
  const otherParticipant = conversation.otherParticipants?.[0]
  return otherParticipant?.user?.name || otherParticipant?.user?.username || 'Unknown'
}

function formatTime(date: Date | string) {
  const messageDate = new Date(date)
  const now = new Date()
  
  // Check if message is from today
  const isToday = messageDate.toDateString() === now.toDateString()
  
  // Check if message is from yesterday
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = messageDate.toDateString() === yesterday.toDateString()
  
  const diffInMinutes = Math.floor((now.getTime() - messageDate.getTime()) / (1000 * 60))
  const diffInHours = Math.floor(diffInMinutes / 60)
  const diffInDays = Math.floor(diffInHours / 24)
  
  if (isToday) {
    if (diffInMinutes < 1) {
      return 'now'
    } else if (diffInMinutes < 60) {
      return `${diffInMinutes}m`
    } else {
      return formatConversationTime(messageDate)
    }
  } else if (isYesterday) {
    return 'Yesterday'
  } else if (diffInDays < 7) {
    return messageDate.toLocaleDateString(undefined, { weekday: 'short' })
  } else {
    return messageDate.toLocaleDateString(undefined, { 
      month: 'short', 
      day: 'numeric',
      ...(messageDate.getFullYear() !== now.getFullYear() && { year: 'numeric' })
    })
  }
}

function getLastMessagePreview(conversation: any, sessionUserId?: string, decryptedContents: Record<string, string> = {}) {
  const lastMessage = conversation.messages?.[0]
  if (!lastMessage) return { content: 'No messages yet', status: null }

  const isOwn = lastMessage.senderId === sessionUserId
  const senderName = isOwn ? 'You' : (lastMessage.sender?.name || lastMessage.sender?.username || 'Someone')
  
  // Handle unsent/deleted messages first
  if (lastMessage.isDeleted || lastMessage.content === '[Message deleted]' || (lastMessage as any).type === 'deleted') {
    const messageContent = isOwn ? 'You unsent a message' : `${senderName} unsent a message`
    return { content: messageContent, status: null }
  }
  
  // Handle file/media attachments - check both type field and attachments array
  if (lastMessage.type === 'voice' || (lastMessage.attachments && lastMessage.attachments.some((a: any) => a.type === 'voice'))) {
    const content = isOwn ? 'You sent a voice message' : `${senderName} sent a voice message`
    return { content, status: isOwn ? lastMessage.status : null }
  } else if (lastMessage.type === 'image' || (lastMessage.attachments && lastMessage.attachments.some((a: any) => a.type === 'image'))) {
    const content = isOwn ? 'You sent an image' : `${senderName} sent an image`
    return { content, status: isOwn ? lastMessage.status : null }
  } else if (lastMessage.type === 'file' || (lastMessage.attachments && lastMessage.attachments.length > 0)) {
    const content = isOwn ? 'You sent an attachment' : `${senderName} sent an attachment`
    return { content, status: isOwn ? lastMessage.status : null }
  }
  
  // Handle encrypted messages - try to use decrypted content first
  let messageContent = lastMessage.content
  if (messageContent && messageContent.startsWith('🔐')) {
    // Check if we have a decrypted version
    const decryptedContent = decryptedContents[lastMessage.id]
    if (decryptedContent && decryptedContent !== 'Encrypted message' && decryptedContent !== '🔒 Encrypted message') {
      messageContent = decryptedContent
    } else {
      // Return a more informative message while waiting for decryption
      return { content: '🔒 Encrypted message', status: isOwn ? lastMessage.status : null }
    }
  }
  
  // Handle empty content
  if (!messageContent || messageContent.trim() === '') {
    const content = isOwn ? 'You sent a message' : `${senderName} sent a message`
    return { content, status: isOwn ? lastMessage.status : null }
  }
  
  let finalContent
  if (conversation.isGroup && !isOwn) {
    finalContent = `${senderName}: ${messageContent}`
  } else {
    finalContent = messageContent
  }
  
  return { content: finalContent, status: isOwn ? lastMessage.status : null }
}


export function ChatSidebar({ selectedConversationId, searchQuery: externalSearchQuery, onSelectConversation }: ChatSidebarProps) {
  const { data: session } = useSession()
  const { conversations, loading, error, forceRefreshKey, setForceRefreshKey } = useConversations(selectedConversationId)
  const { blockedUsers } = useBlockedUsers()
  const { blockers } = useUserBlockers() // BLOCKING FIX: Get users who blocked current user
  const { decryptMessage, isAvailable: e2eeAvailable } = useE2EE()
  const { socket, isFullyInitialized } = useSocketContext()
  const [searchQuery, setSearchQuery] = useState('')
  
  // Use external search query if provided, otherwise use internal
  const effectiveSearchQuery = externalSearchQuery !== undefined ? externalSearchQuery : searchQuery
  const [showUserSelection, setShowUserSelection] = useState(false)
  const [activeTab, setActiveTab] = useState<'conversations' | 'blocked'>('conversations')
  const [decryptedContents, setDecryptedContents] = useState<Record<string, string>>({})
  const decryptionAttemptsRef = useRef<Set<string>>(new Set())
  
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

  // Debug: Monitor conversation changes for sidebar updates
  useEffect(() => {
    console.log('ChatSidebar: Conversations updated, count:', conversations.length)
    if (conversations.length > 0) {
      console.log('ChatSidebar: Latest conversation:', conversations[0]?.id, 'last message:', conversations[0]?.messages[0]?.id)
    }
  }, [conversations])

  // Debug: Monitor socket connectivity for sidebar
  useEffect(() => {
    console.log('ChatSidebar: Socket state -', 'connected:', !!socket?.connected, 'initialized:', isFullyInitialized)
  }, [socket?.connected, isFullyInitialized])

  // Decrypt encrypted messages in conversations
  useEffect(() => {
    if (!e2eeAvailable || !conversations.length || !decryptMessage) return

    const decryptMessages = async () => {
      for (const conversation of conversations) {
        const lastMessage = conversation.messages?.[0]
        if (lastMessage && 
            lastMessage.content && 
            lastMessage.content.startsWith('🔐') && 
            !decryptionAttemptsRef.current.has(lastMessage.id)) {
          
          // Mark this message as attempted to prevent retries
          decryptionAttemptsRef.current.add(lastMessage.id)
          
          try {
            const encryptedData = lastMessage.content.substring(2) // Remove 🔐 prefix
            if (encryptedData.trim()) { // Only attempt decryption if there's actual encrypted data
              
              // Try decryption with multiple conversation ID variations
              let decryptedContent = null
              const conversationIds = [
                conversation.id, // Current conversation ID
                lastMessage.conversationId, // Message's conversation ID (if available)
                'default' // Fallback used in encryption
              ].filter(Boolean)
              
              for (const conversationId of conversationIds) {
                try {
                  const result = await decryptMessage(encryptedData, conversationId)
                  if (result && 
                      result !== '[Encrypted message - decryption failed]' &&
                      result !== '[Encrypted message - decrypt operation failed]' &&
                      result !== 'Encrypted message') {
                    decryptedContent = result
                    console.log(`🔐 Sidebar: Successfully decrypted message with conversationId: ${conversationId}`)
                    break
                  }
                } catch (decryptError) {
                  console.log(`🔐 Sidebar: Failed to decrypt with conversationId ${conversationId}:`, decryptError.message || decryptError)
                  continue
                }
              }
              
              if (decryptedContent) {
                setDecryptedContents(prev => ({
                  ...prev,
                  [lastMessage.id]: decryptedContent
                }))
              } else {
                console.warn(`🔐 Sidebar: All decryption attempts failed for message ${lastMessage.id}`)
                setDecryptedContents(prev => ({
                  ...prev,
                  [lastMessage.id]: '🔒 Encrypted message'
                }))
              }
            }
          } catch (error) {
            console.warn('🔐 Sidebar: Failed to decrypt message for sidebar preview:', error)
            setDecryptedContents(prev => ({
              ...prev,
              [lastMessage.id]: '🔒 Encrypted message'
            }))
          }
        }
      }
    }

    decryptMessages()
  }, [conversations, e2eeAvailable, decryptMessage])

  // Add force refresh state for blocked users changes
  const [forceRefresh, setForceRefresh] = useState(0)
  
  // Force refresh when blocked users OR blockers change - ensuring immediate UI update
  useEffect(() => {
    console.log('🚫 ChatSidebar: Blocked users changed, count:', blockedUsers.length)
    console.log('🚫 ChatSidebar: Blocked user IDs:', blockedUsers.map(b => b.user.id))
    console.log('🚫 ChatSidebar: Users who blocked us, count:', blockers.length)
    console.log('🚫 ChatSidebar: Blocker user IDs:', blockers.map(b => b.user.id))
    
    // Force multiple re-renders to ensure UI updates immediately
    setForceRefresh(prev => prev + 1)
    
    // Trigger immediate conversation refresh through multiple methods
    setTimeout(() => {
      console.log('🔄 ChatSidebar: Immediate conversation refresh trigger')
      setForceRefresh(prev => prev + 1)
      if (socket) {
        socket.emit('request-conversation-refresh', { userId: session?.user?.id })
      }
    }, 0)
    
    setTimeout(() => {
      console.log('🔄 ChatSidebar: Secondary conversation refresh trigger')  
      setForceRefresh(prev => prev + 1)
      if (socket) {
        socket.emit('request-conversation-refresh', { userId: session?.user?.id })
      }
    }, 100)
    
    setTimeout(() => {
      console.log('🔄 ChatSidebar: Tertiary conversation refresh trigger')
      setForceRefresh(prev => prev + 1)
      if (socket) {
        socket.emit('request-conversation-refresh', { userId: session?.user?.id })
      }
    }, 500)
  }, [blockedUsers, blockers, socket, session?.user?.id]) // BLOCKING FIX: Include blockers in dependencies

  // Add direct socket listeners for group events to force sidebar updates
  useEffect(() => {
    if (!socket) return

    const handleGroupMemberAdded = (data: { conversationId: string }) => {
      console.log('👥 ChatSidebar: Group member added, forcing refresh')
      setForceRefresh(prev => prev + 1)
    }

    const handleGroupMemberLeft = (data: { conversationId: string }) => {
      console.log('👥 ChatSidebar: Group member left, forcing refresh')  
      setForceRefresh(prev => prev + 1)
    }

    const handleGroupMemberRemoved = (data: { conversationId: string }) => {
      console.log('👥 ChatSidebar: Group member removed, forcing refresh')
      setForceRefresh(prev => prev + 1)
    }

    const handleNewMessage = (message: any) => {
      if (message.type === 'system') {
        console.log('🔔 ChatSidebar: System message received, forcing refresh')
        setForceRefresh(prev => prev + 1)
      }
    }

    socket.on('group-member-added', handleGroupMemberAdded)
    socket.on('group-member-left', handleGroupMemberLeft)
    socket.on('group-member-removed', handleGroupMemberRemoved)
    socket.on('new-message', handleNewMessage)

    return () => {
      socket.off('group-member-added', handleGroupMemberAdded)
      socket.off('group-member-left', handleGroupMemberLeft)
      socket.off('group-member-removed', handleGroupMemberRemoved)
      socket.off('new-message', handleNewMessage)
    }
  }, [socket])

  // BLOCKING FIX: Filter conversations using useMemo for performance
  const filteredConversations = useMemo(() => {
    // Create sets of blocked user IDs for quick lookup
    const blockedUserIds = new Set(blockedUsers.map(blocked => blocked.user.id))
    const blockerUserIds = new Set(blockers.map(blocker => blocker.user.id))
    
    // Reduced logging for performance
    if (Math.random() < 0.1) {
      console.log('ChatSidebar: Filtering conversations', {
        totalConversations: conversations.length,
        blockedUserIds: Array.from(blockedUserIds),
        blockerUserIds: Array.from(blockerUserIds),
        effectiveSearchQuery,
        forceRefresh,
        conversationIds: conversations.map(c => c.id)
      })
    }
    
    const filtered = conversations.filter(conversation => {
      // Skip group conversations - they should always be shown even if some members are blocked
      if (conversation.isGroup) {
        const conversationName = getConversationName(conversation)
        const lastMessage = conversation.messages?.[0]?.content || ''
        
        // Reduced logging for performance
        if (Math.random() < 0.05) console.log(`ChatSidebar: Group conversation ${conversation.id} (${conversationName}) - members: ${conversation.participants?.length || 0}`)
        
        return conversationName.toLowerCase().includes(effectiveSearchQuery.toLowerCase()) ||
               lastMessage.toLowerCase().includes(effectiveSearchQuery.toLowerCase())
      }
      
      // BLOCKING FIX: For direct messages, check both blocking relationships
      const otherParticipant = conversation.otherParticipants?.[0]
      if (otherParticipant) {
        const otherUserId = otherParticipant.user.id
        
        // Hide if current user blocked the other user
        if (blockedUserIds.has(otherUserId)) {
          console.log(`ChatSidebar: Hiding conversation ${conversation.id} - current user blocked ${otherUserId} (${otherParticipant.user.name})`)
          return false
        }
        
        // Hide if other user blocked the current user
        if (blockerUserIds.has(otherUserId)) {
          console.log(`ChatSidebar: Hiding conversation ${conversation.id} - current user blocked by ${otherUserId} (${otherParticipant.user.name})`)
          return false
        }
      }
      
      // Apply search filter
      const conversationName = getConversationName(conversation)
      const lastMessage = conversation.messages?.[0]?.content || ''
      
      const matchesSearch = conversationName.toLowerCase().includes(effectiveSearchQuery.toLowerCase()) ||
                           lastMessage.toLowerCase().includes(effectiveSearchQuery.toLowerCase())
      
      // Reduced logging for performance
      if (!matchesSearch && effectiveSearchQuery && Math.random() < 0.05) {
        console.log(`ChatSidebar: Conversation ${conversation.id} doesn't match search "${effectiveSearchQuery}"`)
      }
      
      return matchesSearch
    })
    
    // Reduced logging for performance
    if (Math.random() < 0.1) {
      console.log(`ChatSidebar: Filtered ${conversations.length} -> ${filtered.length} conversations`)
      console.log(`ChatSidebar: Final conversation list:`, filtered.map(c => ({ id: c.id, name: getConversationName(c), memberCount: c.participants?.length })))
    }
    return filtered
  }, [conversations, effectiveSearchQuery, blockedUsers, blockers, forceRefresh]) // BLOCKING FIX: Include blockers dependency

  if (loading) {
    return (
      <div className="p-4 space-y-4 bg-viber-surface dark:bg-viber-surface">
        {/* Search skeleton */}
        <div className="h-12 bg-viber-surface-variant dark:bg-viber-surface-bright rounded-2xl animate-pulse"></div>
        
        {/* Conversation skeletons */}
        {[...Array(5)].map((_, i) => (
          <div key={`conversation-skeleton-${i}`} className="flex items-center space-x-3 p-3">
            <div className="w-12 h-12 bg-viber-surface-variant dark:bg-viber-surface-bright rounded-full animate-pulse"></div>
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-viber-surface-variant dark:bg-viber-surface-bright rounded animate-pulse w-3/4"></div>
              <div className="h-3 bg-viber-surface-variant dark:bg-viber-surface-bright rounded animate-pulse w-1/2"></div>
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
        <p className="text-sm mb-3">{error}</p>
        <button
          onClick={() => setForceRefreshKey(prev => prev + 1)}
          className="px-3 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-viber-surface dark:bg-viber-surface">
      {/* Tab Bar - All/Blocked */}
      <div className="px-4 pt-2 pb-0">
        <div className="bg-viber-surface dark:bg-viber-surface">
          <nav className="flex">
            <button
              onClick={() => setActiveTab('conversations')}
              className={`flex-1 py-3 px-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'conversations'
                  ? 'border-viber-primary text-viber-primary'
                  : 'border-transparent text-viber-text-secondary hover:text-viber-text-primary dark:text-viber-text-secondary dark:hover:text-viber-text-primary'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setActiveTab('blocked')}
              className={`flex-1 py-3 px-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'blocked'
                  ? 'border-viber-primary text-viber-primary'
                  : 'border-transparent text-viber-text-secondary hover:text-viber-text-primary dark:text-viber-text-secondary dark:hover:text-viber-text-primary'
              }`}
            >
              Blocked
            </button>
          </nav>
        </div>
      </div>

      {/* Content */}
      {activeTab === 'conversations' ? (
        <div className="flex-1 overflow-y-auto overscroll-contain bg-viber-surface dark:bg-viber-surface">
          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-viber-text-secondary dark:text-viber-text-secondary">
              {effectiveSearchQuery ? (
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
            <div className="">
              {filteredConversations.map((conversation) => {
                const lastMessage = conversation.messages?.[0]
                const messagePreview = getLastMessagePreview(conversation, session?.user?.id, decryptedContents)
                return (
                  <button
                    key={conversation.id}
                    onClick={() => onSelectConversation(conversation.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-viber-surface-variant dark:hover:bg-viber-surface-bright transition-all duration-200 border-l-4 ${
                      selectedConversationId === conversation.id
                        ? 'bg-viber-accent dark:bg-viber-accent border-l-viber-primary shadow-sm'
                        : 'border-l-transparent hover:border-l-viber-primary/20'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="relative flex-shrink-0">
                        <ConversationAvatar conversation={conversation} />
                        {/* Online status indicator for non-group conversations */}
                        {!conversation.isGroup && conversation.otherParticipants.length > 0 && (
                          <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-viber-surface dark:border-viber-surface ${
                            conversation.otherParticipants?.[0]?.user.isOnline 
                              ? 'bg-viber-green' 
                              : 'bg-viber-text-tertiary'
                          }`} />
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center space-x-2 min-w-0">
                            <h3 className={`text-base text-viber-text-primary dark:text-viber-text-primary truncate ${
                              conversation.unreadCount > 0 ? 'font-semibold' : 'font-medium'
                            }`}>
                              {getConversationName(conversation)}
                            </h3>
                            {/* Message status indicators - show checkmarks for sent messages */}
                            {lastMessage && lastMessage.senderId === session?.user?.id && (
                              <span className={`text-sm flex-shrink-0 ${
                                lastMessage.status === 'read' 
                                  ? 'text-viber-teal' 
                                  : lastMessage.status === 'delivered'
                                  ? 'text-viber-text-secondary dark:text-viber-text-secondary'
                                  : 'text-viber-text-tertiary dark:text-viber-text-tertiary'
                              }`}>
                                {lastMessage.status === 'read' ? '✓✓' : 
                                 lastMessage.status === 'delivered' ? '✓✓' : 
                                 '✓'}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            {conversation.unreadCount > 0 && (
                              <span className="bg-viber-primary text-viber-text-inverse text-xs rounded-full min-w-[1.25rem] h-5 flex items-center justify-center px-2 font-semibold shadow-sm">
                                {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                              </span>
                            )}
                            {lastMessage && (
                              <span className="text-xs text-viber-text-tertiary dark:text-viber-text-tertiary flex-shrink-0 font-medium">
                                {formatTime(lastMessage.createdAt)}
                              </span>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <p className={`text-sm text-viber-text-secondary dark:text-viber-text-secondary truncate break-words flex-1 ${
                            conversation.unreadCount > 0 ? 'font-medium text-viber-text-primary dark:text-viber-text-primary' : 'font-normal'
                          }`}>
                            {messagePreview.content}
                          </p>
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 bg-viber-surface dark:bg-viber-surface">
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