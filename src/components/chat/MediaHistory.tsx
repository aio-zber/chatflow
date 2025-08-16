'use client'

import { useState, useEffect } from 'react'
import { X, Download, Image, FileText, Video, Calendar, Search } from 'lucide-react'

interface MediaItem {
  id: string
  fileName: string
  fileUrl: string
  fileType: string
  fileSize: number
  createdAt: string
  messageId: string
  sender: {
    id: string
    name: string | null
    username: string
  }
}

interface MediaHistoryProps {
  isOpen: boolean
  onClose: () => void
  conversationId: string
  title?: string
}

type MediaFilter = 'all' | 'images' | 'files' | 'videos'

export function MediaHistory({ isOpen, onClose, conversationId, title = "Media History" }: MediaHistoryProps) {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<MediaFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (isOpen && conversationId) {
      fetchMediaHistory()
    }
  }, [isOpen, conversationId])

  const fetchMediaHistory = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch(`/api/conversations/${conversationId}/media`)
      if (!response.ok) {
        throw new Error('Failed to fetch media history')
      }
      
      const data = await response.json()
      setMediaItems(data.mediaItems || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load media history')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async (item: MediaItem) => {
    try {
      const response = await fetch(item.fileUrl)
      if (!response.ok) throw new Error('Download failed')
      
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = item.fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download failed:', error)
      window.open(item.fileUrl, '_blank')
    }
  }

  const getMediaIcon = (fileType: string) => {
    if (fileType.startsWith('image/')) {
      return <Image className="w-4 h-4" />
    } else if (fileType.startsWith('video/')) {
      return <Video className="w-4 h-4" />
    } else {
      return <FileText className="w-4 h-4" />
    }
  }

  const getMediaCategory = (fileType: string): MediaFilter => {
    if (fileType.startsWith('image/')) return 'images'
    if (fileType.startsWith('video/')) return 'videos'
    return 'files'
  }

  const filteredItems = mediaItems.filter(item => {
    const matchesFilter = filter === 'all' || getMediaCategory(item.fileType) === filter
    const matchesSearch = searchQuery === '' || 
      item.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sender.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sender.username.toLowerCase().includes(searchQuery.toLowerCase())
    
    return matchesFilter && matchesSearch
  })

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getItemCounts = () => {
    return {
      all: mediaItems.length,
      images: mediaItems.filter(item => getMediaCategory(item.fileType) === 'images').length,
      videos: mediaItems.filter(item => getMediaCategory(item.fileType) === 'videos').length,
      files: mediaItems.filter(item => getMediaCategory(item.fileType) === 'files').length,
    }
  }

  const counts = getItemCounts()

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div 
          className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75 dark:bg-gray-900 dark:bg-opacity-75"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="inline-block w-full max-w-4xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white dark:bg-gray-800 shadow-xl rounded-lg">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              {title}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md p-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Search */}
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search media files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex space-x-1 mb-6 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            {[
              { key: 'all', label: `All (${counts.all})` },
              { key: 'images', label: `Images (${counts.images})` },
              { key: 'videos', label: `Videos (${counts.videos})` },
              { key: 'files', label: `Files (${counts.files})` },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key as MediaFilter)}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  filter === key
                    ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-red-600 dark:text-red-400">{error}</p>
              <button
                onClick={fetchMediaHistory}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Retry
              </button>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-gray-400 mb-2">
                {getMediaIcon(filter === 'images' ? 'image/' : filter === 'videos' ? 'video/' : 'file/')}
              </div>
              <p className="text-gray-500 dark:text-gray-400">
                {searchQuery ? `No media found matching "${searchQuery}"` : 
                 filter === 'all' ? 'No media shared yet' : `No ${filter} shared yet`}
              </p>
            </div>
          ) : (
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center space-x-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                >
                  {/* File Icon/Preview */}
                  <div className="flex-shrink-0">
                    {item.fileType.startsWith('image/') ? (
                      <img
                        src={item.fileUrl}
                        alt={item.fileName}
                        className="w-12 h-12 object-cover rounded-lg"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-gray-200 dark:bg-gray-600 rounded-lg flex items-center justify-center">
                        {getMediaIcon(item.fileType)}
                      </div>
                    )}
                  </div>

                  {/* File Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {item.fileName}
                    </p>
                    <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
                      <span>{item.sender.name || item.sender.username}</span>
                      <span>•</span>
                      <span>{formatFileSize(item.fileSize)}</span>
                      <span>•</span>
                      <div className="flex items-center space-x-1">
                        <Calendar className="w-3 h-3" />
                        <span>{formatDate(item.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Download Button */}
                  <button
                    onClick={() => handleDownload(item)}
                    className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    title="Download file"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}