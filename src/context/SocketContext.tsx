'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Socket, io } from 'socket.io-client'

interface SocketContextType {
  socket: Socket | null
  isConnected: boolean
  isFullyInitialized: boolean
  connectionState: 'connecting' | 'connected' | 'disconnected'
  userStatuses: Record<string, { isOnline: boolean; lastSeen: Date }>
  joinedRooms: Set<string>
  joinConversationRoom: (conversationId: string) => void
  leaveConversationRoom: (conversationId: string) => void
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  isFullyInitialized: false,
  connectionState: 'disconnected',
  userStatuses: {},
  joinedRooms: new Set(),
  joinConversationRoom: () => {},
  leaveConversationRoom: () => {},
})

export const useSocketContext = () => {
  const context = useContext(SocketContext)
  if (!context) {
    throw new Error('useSocketContext must be used within a SocketProvider')
  }
  return context
}

interface SocketProviderProps {
  children: React.ReactNode
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const { data: session } = useSession()
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isFullyInitialized, setIsFullyInitialized] = useState(false)
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected')
  const [userStatuses, setUserStatuses] = useState<Record<string, { isOnline: boolean; lastSeen: Date }>>({})
  const [joinedRooms, setJoinedRooms] = useState<Set<string>>(new Set())
  
  // Track user ID separately to detect actual user changes (login/logout)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  const joinConversationRoom = (conversationId: string) => {
    if (socket && (isConnected || socket.connected)) {
      const roomName = `conversation:${conversationId}`
      console.log(`SocketContext: Attempting to join room: ${roomName}`)
      console.log(`SocketContext: Socket connected: ${socket.connected}, Socket ID: ${socket.id}`)
      socket.emit('join-room', conversationId)
      setJoinedRooms(prev => new Set([...Array.from(prev), roomName]))
      console.log(`SocketContext: Joined room: ${roomName}`)
    } else {
      console.log(`SocketContext: Cannot join room - socket: ${!!socket}, connected: ${isConnected || (socket && socket.connected)}`)
    }
  }

  const leaveConversationRoom = (conversationId: string) => {
    if (socket) {
      const roomName = `conversation:${conversationId}`
      socket.emit('leave-room', conversationId)
      setJoinedRooms(prev => {
        const newSet = new Set(Array.from(prev))
        newSet.delete(roomName)
        return newSet
      })
      console.log(`Left room: ${roomName}`)
    }
  }

  // Automatically join all user conversations when connected
  useEffect(() => {
    if (socket && currentUserId) {
      const joinAllUserConversations = async () => {
        try {
          console.log('Auto-joining all user conversations...')
          const response = await fetch('/api/conversations')
          if (response.ok) {
            const data = await response.json()
            const conversations = data.conversations || []
            
            console.log(`SocketContext: Found ${conversations.length} conversations to join`)
            conversations.forEach((conv: any) => {
              console.log(`SocketContext: Auto-joining conversation: ${conv.id}`)
              joinConversationRoom(conv.id)
            })
            
            // Mark as fully initialized after joining all rooms
            console.log('Socket fully initialized with all conversations joined')
            setIsFullyInitialized(true)
          }
        } catch (error) {
          console.error('Error fetching conversations for socket rooms:', error)
          // Still mark as initialized even if there's an error
          setIsFullyInitialized(true)
        }
      }
      
      // If already connected, join immediately, otherwise join on connect
      if (isConnected) {
        joinAllUserConversations()
      } else {
        const onceConnect = () => {
          joinAllUserConversations()
          socket.off('connect', onceConnect)
        }
        socket.on('connect', onceConnect)
        return () => socket.off('connect', onceConnect)
      }
      
      // Also re-join conversations on reconnect
      const handleReconnect = () => {
        console.log('Socket reconnected, rejoining conversations...')
        joinAllUserConversations()
      }
      socket.on('reconnect', handleReconnect)
      return () => socket.off('reconnect', handleReconnect)
    }
  }, [socket, isConnected, currentUserId])

  // Check for actual user changes (login/logout vs session updates)
  useEffect(() => {
    const newUserId = session?.user?.id || null
    
    if (newUserId !== currentUserId) {
      console.log('User ID changed from', currentUserId, 'to', newUserId)
      setCurrentUserId(newUserId)
    }
  }, [session?.user?.id, currentUserId])

  useEffect(() => {
    let isMounted = true
    
    const initSocket = async () => {
      // Only proceed if component is still mounted and user exists
      if (!isMounted || !currentUserId) {
        // Socket initialization skipped - waiting for user authentication
        return
      }

      // Prevent multiple initializations
      if (socket) {
        console.log('Socket already exists, skipping initialization')
        return
      }

      console.log('Initializing Socket.IO client connection for user:', currentUserId)
      setConnectionState('connecting')
      
      const socketInstance = io(process.env.NODE_ENV === 'production' 
        ? process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin
        : window.location.origin, {
        path: '/api/socket/io',
        addTrailingSlash: false,
        forceNew: false, // Allow connection reuse
        timeout: 45000,  // Match server timeout
        transports: ['polling'], // Start with polling only for stability
        upgrade: false, // Disable websocket upgrade to prevent transport issues
        autoConnect: true,
        reconnection: true,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 10000,
        reconnectionAttempts: 10,
        randomizationFactor: 0.5,
        closeOnBeforeunload: false,
        withCredentials: false,
        rememberUpgrade: false,
      })

      socketInstance.on('connect', () => {
        if (isMounted) {
          console.log('SocketContext: Socket connected successfully:', socketInstance.id)
          console.log('SocketContext: Socket transport:', socketInstance.io.engine.transport.name)
          setIsConnected(true)
          setConnectionState('connected')
          
          // Emit user online status and join user-specific room
          if (currentUserId) {
            console.log('SocketContext: Emitting user-online for:', currentUserId)
            socketInstance.emit('user-online', currentUserId)
            
            // Also join user-specific room for targeted notifications
            socketInstance.emit('join-user-room', currentUserId)
            console.log('SocketContext: Joined user-specific room:', `user:${currentUserId}`)
          }
        }
      })

      socketInstance.on('connect_error', (error) => {
        console.error('Socket connection error:', error)
        if (isMounted) {
          setConnectionState('disconnected')
          setIsConnected(false)
          setIsFullyInitialized(false)
          
          // Only retry if it's not a critical server error
          if (error.message !== 'server error') {
            console.log('Will retry connection in 5 seconds...')
          } else {
            console.error('Server error detected - check server configuration')
          }
        }
      })

      socketInstance.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason)
        if (isMounted) {
          setIsConnected(false)
          setConnectionState('disconnected')
          setIsFullyInitialized(false)
        }
      })

      socketInstance.on('reconnect_attempt', (attemptNumber) => {
        console.log(`Socket reconnection attempt ${attemptNumber}`)
      })

      socketInstance.on('reconnect_failed', () => {
        console.log('Socket reconnection failed after all attempts')
        if (isMounted) {
          setConnectionState('disconnected')
        }
      })

      // Handle successful reconnection
      socketInstance.on('reconnect', () => {
        console.log('Socket reconnected successfully')
        if (isMounted && currentUserId) {
          console.log('SocketContext: Re-emitting user-online after reconnection for:', currentUserId)
          socketInstance.emit('user-online', currentUserId)
          socketInstance.emit('join-user-room', currentUserId)
        }
      })

      // Listen for user status changes
      socketInstance.on('user-status-change', (data: { userId: string; isOnline: boolean; lastSeen?: string }) => {
        if (isMounted) {
          setUserStatuses(prev => ({
            ...prev,
            [data.userId]: {
              isOnline: data.isOnline,
              lastSeen: data.lastSeen ? new Date(data.lastSeen) : new Date()
            }
          }))
        }
      })

      // Profile updates are now handled directly by components
      // Message updates are handled directly by useMessages and useConversations

      if (isMounted) {
        setSocket(socketInstance)
      }
    }

    initSocket()

    return () => {
      isMounted = false
      if (socket) {
        console.log('Cleaning up Socket.IO connection...')
        // Remove all listeners first
        socket.removeAllListeners()
        // Emit user offline status before disconnecting
        if (currentUserId) {
          socket.emit('user-offline', currentUserId)
        }
        socket.disconnect()
        setSocket(null)
        setIsConnected(false)
        setIsFullyInitialized(false)
        setConnectionState('disconnected')
      }
    }
  }, [currentUserId]) // Only reinitialize when user actually changes (login/logout)

  // Handle page visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (socket && currentUserId) {
        if (document.visibilityState === 'visible') {
          socket.emit('user-online', currentUserId)
        } else {
          socket.emit('user-offline', currentUserId)
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [socket, currentUserId])

  // Periodic heartbeat to maintain online status
  useEffect(() => {
    if (!socket || !currentUserId || !isConnected) return

    const heartbeat = setInterval(() => {
      if (document.visibilityState === 'visible' && socket.connected) {
        socket.emit('user-online', currentUserId)
      }
    }, 30000) // Send heartbeat every 30 seconds

    return () => {
      clearInterval(heartbeat)
    }
  }, [socket, currentUserId, isConnected])

  // Handle window beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (socket && currentUserId) {
        socket.emit('user-offline', session.user.id)
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [socket, currentUserId])

  return (
    <SocketContext.Provider value={{ socket, isConnected, isFullyInitialized, connectionState, userStatuses, joinedRooms, joinConversationRoom, leaveConversationRoom }}>
      {children}
    </SocketContext.Provider>
  )
}