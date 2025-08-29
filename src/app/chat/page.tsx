'use client'

import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import { useState } from 'react'
import { ChatSidebar } from '@/components/chat/ChatSidebar'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { UserProfile } from '@/components/UserProfile'
import { ThemeToggle } from '@/components/ThemeToggle'
import { NotificationBadge } from '@/components/NotificationBadge'
import { useSocketContext } from '@/context/SocketContext'

export default function ChatPage() {
  const { status } = useSession()
  const { isConnected } = useSocketContext()
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  // User online status is now handled automatically in SocketContext

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-viber-surface-container dark:bg-viber-surface-container">
        <div className="text-center">
          <div className="w-12 h-12 bg-viber-primary rounded-lg flex items-center justify-center mx-auto mb-4">
            <span className="text-viber-text-inverse font-bold text-lg">V</span>
          </div>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-viber-primary mx-auto"></div>
          <p className="text-viber-text-secondary dark:text-viber-text-secondary mt-3 text-sm">Loading Viber...</p>
        </div>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    redirect('/auth/signin')
  }

  return (
    <div className="h-screen flex bg-viber-surface-container dark:bg-viber-surface-container overflow-hidden">
      {/* Sidebar */}
      <div className={`
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0 transition-transform duration-300 ease-in-out
        fixed md:static inset-y-0 left-0 z-50
        w-full xs:w-80 sm:w-80 md:w-80 lg:w-88 xl:w-96
        bg-viber-surface dark:bg-viber-surface border-r border-viber-border dark:border-viber-border
        flex flex-col shadow-viber-lg md:shadow-none
      `}>
        {/* Header */}
        <div className="p-3 sm:p-4 border-b border-viber-border dark:border-viber-border flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-viber-primary rounded-lg flex items-center justify-center">
                <span className="text-viber-text-inverse font-bold text-sm">V</span>
              </div>
              <div className="flex items-center space-x-2">
                <h1 className="text-lg sm:text-xl font-semibold text-viber-text-primary dark:text-viber-text-primary truncate">
                  Viber
                </h1>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isConnected ? 'bg-viber-green' : 'bg-viber-orange'}`} />
              </div>
            </div>
            <div className="flex items-center space-x-1 sm:space-x-2">
              <div className="bg-viber-teal text-viber-text-inverse px-2 py-1 rounded-full text-xs font-medium">
                Viber Out
              </div>
              <button className="p-2 hover:bg-viber-surface-variant dark:hover:bg-viber-surface-bright rounded-full transition-colors">
                <svg className="w-5 h-5 text-viber-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <NotificationBadge />
              <UserProfile />
              {/* Mobile close button */}
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="md:hidden p-1 text-viber-text-secondary hover:text-viber-text-primary transition-colors"
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
          className="fixed inset-0 bg-black bg-opacity-60 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <div className="md:hidden bg-viber-surface dark:bg-viber-surface border-b border-viber-border dark:border-viber-border p-3 sm:p-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-2 text-viber-text-secondary hover:text-viber-text-primary hover:bg-viber-surface-variant dark:hover:bg-viber-surface-bright rounded-full transition-all duration-200"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            
            {selectedConversationId && (
              <div className="flex items-center space-x-2 flex-1 justify-center">
                <div className="text-sm font-medium text-viber-text-primary dark:text-viber-text-primary truncate">
                  {/* Chat title would go here */}
                </div>
              </div>
            )}
            
            <div className="xs:hidden p-1">
              <button className="p-2 hover:bg-viber-surface-variant dark:hover:bg-viber-surface-bright rounded-full transition-colors">
                <svg className="w-5 h-5 text-viber-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Chat window */}
        <div className="flex-1 flex flex-col min-h-0">
          <ChatWindow 
            conversationId={selectedConversationId}
          />
        </div>
      </div>
    </div>
  )
}
