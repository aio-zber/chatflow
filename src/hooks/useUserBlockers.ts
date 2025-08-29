'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useSocketContext } from '@/context/SocketContext'

export interface UserBlocker {
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

interface UseUserBlockersReturn {
  blockers: UserBlocker[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useUserBlockers(): UseUserBlockersReturn {
  const { data: session } = useSession()
  const { socket } = useSocketContext()
  const [blockers, setBlockers] = useState<UserBlocker[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchUserBlockers = useCallback(async () => {
    if (!session?.user?.id) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch('/api/users/blockers')
      if (!response.ok) {
        throw new Error('Failed to fetch user blockers')
      }

      const data = await response.json()
      setBlockers(data.blockers || [])
    } catch (err) {
      console.error('Failed to fetch user blockers:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch user blockers')
      setBlockers([])
    } finally {
      setLoading(false)
    }
  }, [session?.user?.id])

  // Initial fetch
  useEffect(() => {
    fetchUserBlockers()
  }, [fetchUserBlockers])

  // Listen for socket events related to blocking/unblocking
  useEffect(() => {
    if (!socket) return

    const handleUserBlocked = (data: { blockedUserId: string, blockerId: string }) => {
      // If current user was blocked by someone, refetch
      if (data.blockedUserId === session?.user?.id) {
        console.log('🚫 Current user was blocked, refetching blockers')
        fetchUserBlockers()
      }
    }

    const handleUserUnblocked = (data: { unblockedUserId: string, unblockerId: string }) => {
      // If current user was unblocked by someone, refetch
      if (data.unblockedUserId === session?.user?.id) {
        console.log('🚫 Current user was unblocked, refetching blockers')
        fetchUserBlockers()
      }
    }

    socket.on('user-blocked', handleUserBlocked)
    socket.on('user-unblocked', handleUserUnblocked)

    return () => {
      socket.off('user-blocked', handleUserBlocked)
      socket.off('user-unblocked', handleUserUnblocked)
    }
  }, [socket, session?.user?.id, fetchUserBlockers])

  return {
    blockers,
    loading,
    error,
    refetch: fetchUserBlockers,
  }
}