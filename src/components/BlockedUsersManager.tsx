'use client'

import { useState, useMemo } from 'react'
import { useBlockedUsers } from '@/hooks/useBlockedUsers'
import { 
  UserX, 
  UserCheck, 
  Search, 
  Clock, 
  AlertCircle,
  RefreshCw,
  Filter,
  CheckCircle,
  X
} from 'lucide-react'

interface BlockedUsersManagerProps {
  className?: string
}

type SortOption = 'name' | 'date' | 'status'
type FilterOption = 'all' | 'online' | 'offline'

export function BlockedUsersManager({ className = '' }: BlockedUsersManagerProps) {
  const { blockedUsers, loading, error, refetch, unblockUser, isUnblocking } = useBlockedUsers()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('date')
  const [filterBy, setFilterBy] = useState<FilterOption>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Filter and sort blocked users
  const filteredAndSortedUsers = useMemo(() => {
    const filtered = blockedUsers.filter(blocked => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const name = blocked.user.name?.toLowerCase() || ''
        const username = blocked.user.username.toLowerCase()
        if (!name.includes(query) && !username.includes(query)) {
          return false
        }
      }

      // Status filter
      if (filterBy === 'online' && !blocked.user.isOnline) return false
      if (filterBy === 'offline' && blocked.user.isOnline) return false

      return true
    })

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          const nameA = a.user.name || a.user.username
          const nameB = b.user.name || b.user.username
          return nameA.localeCompare(nameB)
        case 'date':
          return new Date(b.blockedAt).getTime() - new Date(a.blockedAt).getTime()
        case 'status':
          if (a.user.isOnline && !b.user.isOnline) return -1
          if (!a.user.isOnline && b.user.isOnline) return 1
          return 0
        default:
          return 0
      }
    })

    return filtered
  }, [blockedUsers, searchQuery, sortBy, filterBy])

  const handleUnblock = async (userId: string, userName: string) => {
    const success = await unblockUser(userId)
    if (success) {
      setSuccessMessage(`${userName} has been unblocked`)
      setTimeout(() => setSuccessMessage(null), 3000)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return 'Today'
    } else if (diffDays === 1) {
      return 'Yesterday'
    } else if (diffDays < 7) {
      return `${diffDays} days ago`
    } else {
      return date.toLocaleDateString()
    }
  }

  if (loading) {
    return (
      <div className={`bg-white dark:bg-gray-800 rounded-lg shadow ${className}`}>
        <div className="p-6">
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
            <span className="ml-2 text-gray-600 dark:text-gray-400">Loading blocked users...</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow ${className}`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <UserX className="w-5 h-5 text-gray-500 dark:text-gray-400 mr-2" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Blocked Users
            </h3>
            {blockedUsers.length > 0 && (
              <span className="ml-2 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-full">
                {blockedUsers.length}
              </span>
            )}
          </div>
          <button
            onClick={refetch}
            className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Manage users you&apos;ve blocked from contacting you
        </p>
      </div>

      {/* Success Message */}
      {successMessage && (
        <div className="mx-6 mt-4 p-3 bg-green-50 dark:bg-green-900/50 border border-green-200 dark:border-green-800 rounded-md">
          <div className="flex items-center">
            <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400 mr-2" />
            <span className="text-sm text-green-600 dark:text-green-400">{successMessage}</span>
            <button
              onClick={() => setSuccessMessage(null)}
              className="ml-auto text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-800 rounded-md">
          <div className="flex items-center">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mr-2" />
            <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
          </div>
        </div>
      )}

      {blockedUsers.length === 0 ? (
        <div className="p-8 text-center">
          <UserCheck className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No blocked users
          </h4>
          <p className="text-gray-600 dark:text-gray-400">
            You haven&apos;t blocked anyone yet. When you block users, they&apos;ll appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Search and Filters */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex flex-col sm:flex-row gap-4">
              {/* Search */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search blocked users..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                />
              </div>

              {/* Filters Toggle */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md border ${
                  showFilters 
                    ? 'bg-blue-50 dark:bg-blue-900/50 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                    : 'bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                }`}
              >
                <Filter className="w-4 h-4 mr-2" />
                Filters
              </button>
            </div>

            {/* Filter Options */}
            {showFilters && (
              <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Sort by
                    </label>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortOption)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-600 dark:text-white"
                    >
                      <option value="date">Date blocked (newest first)</option>
                      <option value="name">Name (A-Z)</option>
                      <option value="status">Online status</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Filter by status
                    </label>
                    <select
                      value={filterBy}
                      onChange={(e) => setFilterBy(e.target.value as FilterOption)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-600 dark:text-white"
                    >
                      <option value="all">All users</option>
                      <option value="online">Online only</option>
                      <option value="offline">Offline only</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Results Summary */}
          <div className="px-6 py-2 text-sm text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            {filteredAndSortedUsers.length === blockedUsers.length ? (
              `Showing all ${blockedUsers.length} blocked user${blockedUsers.length !== 1 ? 's' : ''}`
            ) : (
              `Showing ${filteredAndSortedUsers.length} of ${blockedUsers.length} blocked user${blockedUsers.length !== 1 ? 's' : ''}`
            )}
          </div>

          {/* User List */}
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {filteredAndSortedUsers.map((blocked) => (
              <div key={blocked.id} className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {/* Avatar */}
                    <div className="relative">
                      {blocked.user.avatar ? (
                        <img
                          src={blocked.user.avatar}
                          alt={blocked.user.name || blocked.user.username}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-gray-400 dark:bg-gray-600 rounded-full flex items-center justify-center">
                          <span className="text-white font-medium text-sm">
                            {(blocked.user.name || blocked.user.username).charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      {/* Online Status Indicator */}
                      <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-gray-800 ${
                        blocked.user.isOnline ? 'bg-green-500' : 'bg-gray-400'
                      }`} />
                    </div>

                    {/* User Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {blocked.user.name || blocked.user.username}
                        </p>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          @{blocked.user.username}
                        </span>
                      </div>
                      <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mt-1">
                        <Clock className="w-3 h-3 mr-1" />
                        Blocked {formatDate(blocked.blockedAt)}
                      </div>
                    </div>
                  </div>

                  {/* Unblock Button */}
                  <button
                    onClick={() => handleUnblock(blocked.user.id, blocked.user.name || blocked.user.username)}
                    disabled={isUnblocking === blocked.user.id}
                    className={`flex items-center px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                      isUnblocking === blocked.user.id
                        ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                        : 'bg-green-50 dark:bg-green-900/50 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/70'
                    }`}
                  >
                    {isUnblocking === blocked.user.id ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                        Unblocking...
                      </>
                    ) : (
                      <>
                        <UserCheck className="w-4 h-4 mr-1" />
                        Unblock
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}