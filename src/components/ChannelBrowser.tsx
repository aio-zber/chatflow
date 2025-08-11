'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Hash, Lock, Users, Plus, Search, X } from 'lucide-react'

interface Channel {
  id: string
  name: string
  description?: string
  isPrivate: boolean
  memberCount: number
  isMember: boolean
  userRole?: string | null
  creator: {
    id: string
    name: string
    username: string
  }
}

interface ChannelBrowserProps {
  onChannelSelect: (channelId: string) => void
  onClose: () => void
}

export function ChannelBrowser({ onChannelSelect, onClose }: ChannelBrowserProps) {
  const { data: session } = useSession()
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createData, setCreateData] = useState({
    name: '',
    description: '',
    isPrivate: false,
  })

  useEffect(() => {
    fetchChannels()
  }, [])

  const fetchChannels = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/channels')
      if (response.ok) {
        const data = await response.json()
        setChannels(data.channels)
      }
    } catch (error) {
      console.error('Failed to fetch channels:', error)
    } finally {
      setLoading(false)
    }
  }

  const createChannel = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createData.name.trim()) return

    try {
      setCreateLoading(true)
      const response = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createData),
      })

      if (response.ok) {
        const data = await response.json()
        setChannels(prev => [{ ...data.channel, memberCount: 1, isMember: true, userRole: 'admin' }, ...prev])
        setShowCreateForm(false)
        setCreateData({ name: '', description: '', isPrivate: false })
        onChannelSelect(data.channel.id)
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to create channel')
      }
    } catch (error) {
      console.error('Create channel error:', error)
      alert('Failed to create channel')
    } finally {
      setCreateLoading(false)
    }
  }

  const joinChannel = async (channelId: string) => {
    try {
      const response = await fetch(`/api/channels/${channelId}/join`, {
        method: 'POST',
      })

      if (response.ok) {
        setChannels(prev => prev.map(ch => 
          ch.id === channelId 
            ? { ...ch, isMember: true, memberCount: ch.memberCount + 1, userRole: 'member' }
            : ch
        ))
        onChannelSelect(channelId)
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to join channel')
      }
    } catch (error) {
      console.error('Join channel error:', error)
      alert('Failed to join channel')
    }
  }

  const filteredChannels = channels.filter(channel =>
    channel.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    channel.description?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Browse Channels</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Search and Create */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex space-x-4 mb-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search channels..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center space-x-2"
            >
              <Plus className="w-5 h-5" />
              <span>Create</span>
            </button>
          </div>

          {/* Create Channel Form */}
          {showCreateForm && (
            <form onSubmit={createChannel} className="bg-gray-50 dark:bg-gray-700 p-4 rounded-md space-y-3">
              <input
                type="text"
                placeholder="Channel name"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-600 dark:text-white"
                value={createData.name}
                onChange={(e) => setCreateData({ ...createData, name: e.target.value })}
                required
              />
              <textarea
                placeholder="Description (optional)"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-600 dark:text-white resize-none"
                rows={2}
                value={createData.description}
                onChange={(e) => setCreateData({ ...createData, description: e.target.value })}
              />
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="isPrivate"
                  className="rounded focus:ring-blue-500"
                  checked={createData.isPrivate}
                  onChange={(e) => setCreateData({ ...createData, isPrivate: e.target.checked })}
                />
                <label htmlFor="isPrivate" className="text-sm text-gray-700 dark:text-gray-300">
                  Private channel
                </label>
              </div>
              <div className="flex space-x-2">
                <button
                  type="submit"
                  disabled={createLoading || !createData.name.trim()}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                >
                  {createLoading ? 'Creating...' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Channel List */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center space-x-3 p-3 animate-pulse">
                  <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="flex-1 space-y-1">
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredChannels.map((channel) => (
                <div
                  key={channel.id}
                  className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex-shrink-0">
                    {channel.isPrivate ? (
                      <Lock className="w-6 h-6 text-gray-400" />
                    ) : (
                      <Hash className="w-6 h-6 text-gray-400" />
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {channel.name}
                      </h3>
                      {channel.isMember && channel.userRole === 'admin' && (
                        <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded">
                          Admin
                        </span>
                      )}
                    </div>
                    {channel.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                        {channel.description}
                      </p>
                    )}
                    <div className="flex items-center space-x-4 mt-1">
                      <div className="flex items-center space-x-1 text-xs text-gray-500">
                        <Users className="w-3 h-3" />
                        <span>{channel.memberCount}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        by {channel.creator.name || channel.creator.username}
                      </div>
                    </div>
                  </div>

                  <div className="flex-shrink-0">
                    {channel.isMember ? (
                      <button
                        onClick={() => {
                          onChannelSelect(channel.id)
                          onClose()
                        }}
                        className="px-3 py-1.5 text-sm bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-md hover:bg-green-200 dark:hover:bg-green-800"
                      >
                        Open
                      </button>
                    ) : (
                      <button
                        onClick={() => joinChannel(channel.id)}
                        disabled={channel.isPrivate}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {channel.isPrivate ? 'Private' : 'Join'}
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {filteredChannels.length === 0 && (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  {searchQuery ? 'No channels found matching your search.' : 'No channels available.'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}