'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useSocketContext } from '@/context/SocketContext'

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
  const { socket } = useSocketContext()
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

      // Remove the user from the blocked list immediately for instant UI update
      setBlockedUsers(prev => {
        const filtered = prev.filter(blocked => blocked.user.id !== userId)
        console.log(`useBlockedUsers: Removed user ${userId} from blocked list, count: ${prev.length} -> ${filtered.length}`)
        return filtered
      })
      
      // The socket event will trigger conversation refetch automatically
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

  // Socket event handlers for real-time updates
  useEffect(() => {
    if (!socket) return

    const handleUserBlocked = (data: { blocker: any; blocked: any; blockedAt: string }) => {
      console.log('🚫 useBlockedUsers: User blocked event received:', data)
      console.log('🔍 Current user ID:', session?.user?.id)
      console.log('🔍 Blocker ID:', data.blocker?.id)
      
      // Only update if current user is the blocker
      if (data.blocker.id === session?.user?.id) {
        console.log('🚫 useBlockedUsers: Adding blocked user to local state')
        const newBlockedUser: BlockedUser = {
          id: `block-${data.blocked.id}`,
          blockedAt: data.blockedAt,
          user: {
            id: data.blocked.id,
            username: data.blocked.username,
            name: data.blocked.name,
            avatar: null,
            status: null,
            isOnline: false,
            lastSeen: null
          }
        }
        setBlockedUsers(prev => [newBlockedUser, ...prev])
      }
    }

    const handleUserUnblocked = (data: { unblocker: any; unblocked: any; unblockedAt: string }) => {
      console.log('✅ useBlockedUsers: User unblocked event received:', data)
      console.log('🔍 Current user ID:', session?.user?.id)
      console.log('🔍 Unblocker ID:', data.unblocker?.id)
      
      // Only update if current user is the unblocker
      if (data.unblocker.id === session?.user?.id) {
        console.log('✅ useBlockedUsers: Removing unblocked user from local state')
        setBlockedUsers(prev => {
          const filtered = prev.filter(blocked => blocked.user.id !== data.unblocked.id)
          console.log(`✅ useBlockedUsers: Blocked users count: ${prev.length} -> ${filtered.length}`)
          return filtered
        })
      }
    }

    socket.on('user-blocked', handleUserBlocked)
    socket.on('user-unblocked', handleUserUnblocked)

    return () => {
      socket.off('user-blocked', handleUserBlocked)
      socket.off('user-unblocked', handleUserUnblocked)
    }
  }, [socket, session?.user?.id])

  return {
    blockedUsers,
    loading,
    error,
    refetch: fetchBlockedUsers,
    unblockUser,
    isUnblocking,
  }
}