'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'

export interface BlockedUser {
  id: string
  blockedAt: string
  user: {
    id: string
    username: string
    name: string | null
    avatar: string | null
    status: string | null
    isOnline: boolean
    lastSeen: Date | null
  }
}

interface UseBlockedUsersReturn {
  blockedUsers: BlockedUser[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  unblockUser: (userId: string) => Promise<boolean>
  isUnblocking: string | null
}

export function useBlockedUsers(): UseBlockedUsersReturn {
  const { data: session } = useSession()
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isUnblocking, setIsUnblocking] = useState<string | null>(null)

  const fetchBlockedUsers = useCallback(async () => {
    if (!session?.user?.id) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch('/api/users/blocked')
      if (!response.ok) {
        throw new Error('Failed to fetch blocked users')
      }
      
      const data = await response.json()
      setBlockedUsers(data.blockedUsers || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch blocked users')
      console.error('Error fetching blocked users:', err)
    } finally {
      setLoading(false)
    }
  }, [session?.user?.id])

  const unblockUser = useCallback(async (userId: string): Promise<boolean> => {
    if (!session?.user?.id) return false

    try {
      setIsUnblocking(userId)
      setError(null)
      
      const response = await fetch('/api/users/block', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to unblock user')
      }

      // Remove the user from the blocked list
      setBlockedUsers(prev => prev.filter(blocked => blocked.user.id !== userId))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unblock user')
      console.error('Error unblocking user:', err)
      return false
    } finally {
      setIsUnblocking(null)
    }
  }, [session?.user?.id])

  useEffect(() => {
    fetchBlockedUsers()
  }, [fetchBlockedUsers])

  return {
    blockedUsers,
    loading,
    error,
    refetch: fetchBlockedUsers,
    unblockUser,
    isUnblocking,
  }
}