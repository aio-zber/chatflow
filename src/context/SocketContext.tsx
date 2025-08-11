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

  const joinConversationRoom = (conversationId: string) => {
    if (socket && isConnected) {
      const roomName = `conversation:${conversationId}`
      socket.emit('join-room', conversationId)
      setJoinedRooms(prev => new Set([...Array.from(prev), roomName]))
      console.log(`Joined room: ${roomName}`)
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
    if (socket && session?.user?.id) {
      const joinAllUserConversations = async () => {
        try {
          console.log('Auto-joining all user conversations...')
          const response = await fetch('/api/conversations')
          if (response.ok) {
            const data = await response.json()
            const conversations = data.conversations || []
            
            console.log(`Found ${conversations.length} conversations to join`)
            conversations.forEach((conv: any) => {
              console.log(`Auto-joining conversation: ${conv.id}`)
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
  }, [socket, isConnected, session?.user?.id])

  useEffect(() => {
    let isMounted = true
    
    const initSocket = async () => {
      // Only proceed if component is still mounted and session exists
      if (!isMounted || !session?.user?.id) return

      // Prevent multiple initializations
      if (socket) {
        console.log('Socket already exists, skipping initialization')
        return
      }

      console.log('Initializing Socket.IO client connection...')
      setConnectionState('connecting')
      
      const socketInstance = io(process.env.NODE_ENV === 'production' 
        ? process.env.NEXT_PUBLIC_SOCKET_URL || '' 
        : window.location.origin, {
        path: '/api/socket/io',
        addTrailingSlash: false,
        forceNew: true, // Force new connection to avoid conflicts
        timeout: 20000,  // Increased timeout
        transports: ['polling', 'websocket'], // Start with polling, upgrade to websocket
        upgrade: true,
        rememberUpgrade: false, // Don't remember upgrade to avoid transport conflicts
        autoConnect: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
      })

      socketInstance.on('connect', () => {
        if (isMounted) {
          console.log('Socket connected successfully:', socketInstance.id)
          setIsConnected(true)
          setConnectionState('connected')
          
          // Emit user online status and join user-specific room
          if (session?.user?.id) {
            console.log('Emitting user-online for:', session.user.id)
            socketInstance.emit('user-online', session.user.id)
            
            // Also join user-specific room for targeted notifications
            socketInstance.emit('join-user-room', session.user.id)
            console.log('Joined user-specific room:', `user:${session.user.id}`)
          }
        }
      })

      socketInstance.on('connect_error', (error) => {
        console.error('Socket connection error:', error)
        if (isMounted) {
          setConnectionState('disconnected')
        }
      })

      socketInstance.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason)
        if (isMounted) {
          setIsConnected(false)
          setConnectionState('disconnected')
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
        if (session?.user?.id) {
          socket.emit('user-offline', session.user.id)
        }
        socket.disconnect()
        setSocket(null)
        setIsConnected(false)
        setIsFullyInitialized(false)
        setConnectionState('disconnected')
      }
    }
  }, [session?.user?.id]) // Add session dependency to reinitialize on user change

  // Handle page visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (socket && session?.user?.id) {
        if (document.visibilityState === 'visible') {
          socket.emit('user-online', session.user.id)
        } else {
          socket.emit('user-offline', session.user.id)
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [socket, session?.user?.id])

  // Handle window beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (socket && session?.user?.id) {
        socket.emit('user-offline', session.user.id)
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [socket, session?.user?.id])

  return (
    <SocketContext.Provider value={{ socket, isConnected, isFullyInitialized, connectionState, userStatuses, joinedRooms, joinConversationRoom, leaveConversationRoom }}>
      {children}
    </SocketContext.Provider>
  )
}