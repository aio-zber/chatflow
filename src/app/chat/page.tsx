'use client'

import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import { useState, useEffect } from 'react'
import { ChatSidebar } from '@/components/chat/ChatSidebar'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { UserProfile } from '@/components/UserProfile'
import { ThemeToggle } from '@/components/ThemeToggle'
import { NotificationBadge } from '@/components/NotificationBadge'
import { useSocketContext } from '@/context/SocketContext'

export default function ChatPage() {
  const { data: session, status } = useSession()
  const { socket, isConnected } = useSocketContext()
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  // User online status is now handled automatically in SocketContext

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    redirect('/auth/signin')
  }

  return (
    <div className="h-screen flex bg-gray-50 dark:bg-gray-900 overflow-hidden">
      {/* Sidebar */}
      <div className={`
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0 transition-transform duration-300 ease-in-out
        fixed md:static inset-y-0 left-0 z-50
        w-full xs:w-80 sm:w-80 md:w-80 lg:w-88 xl:w-96
        bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700
        flex flex-col shadow-lg md:shadow-none
      `}>
        {/* Header */}
        <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <h1 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white truncate">
                ChatFlow
              </h1>
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            </div>
            <div className="flex items-center space-x-1 sm:space-x-2">
              <NotificationBadge />
              <div className="hidden xs:block">
                <ThemeToggle />
              </div>
              <UserProfile />
              {/* Mobile close button */}
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="md:hidden p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <ChatSidebar
            selectedConversationId={selectedConversationId}
            onSelectConversation={(id) => {
              setSelectedConversationId(id)
              setIsMobileMenuOpen(false)
            }}
          />
        </div>
      </div>

      {/* Mobile overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <div className="md:hidden bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-3 sm:p-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            
            {selectedConversationId && (
              <div className="flex items-center space-x-2 flex-1 justify-center">
                <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {/* Chat title would go here */}
                </div>
              </div>
            )}
            
            <div className="xs:hidden">
              <ThemeToggle />
            </div>
          </div>
        </div>

        {/* Chat window */}
        <div className="flex-1 overflow-hidden">
          <ChatWindow 
            conversationId={selectedConversationId}
          />
        </div>
      </div>
    </div>
  )
}