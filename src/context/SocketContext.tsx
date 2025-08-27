'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Socket, io } from 'socket.io-client'
import { GlobalCallManager } from '@/components/GlobalCallManager'

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
      console.log(`SocketContext: Successfully joined room: ${roomName}`)
      console.log(`SocketContext: Total joined rooms: ${Array.from(joinedRooms).length + 1}`)
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
          const response = await fetch('/api/conversations', { credentials: 'include' })
          if (response.ok) {
            const data = await response.json()
            const conversations = data.conversations || []
            
            console.log(`SocketContext: Found ${conversations.length} conversations to join`)
            conversations.forEach((conv: { id: string; name?: string }, index: number) => {
              console.log(`SocketContext: Auto-joining conversation ${index + 1}/${conversations.length}: ${conv.id} (${conv.name || 'Unnamed'})`)
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

  // Handle group member events
  useEffect(() => {
    if (!socket || !session?.user?.id) return

    const handleGroupMemberAdded = (data: { conversationId: string; member: any; addedBy: any }) => {
      console.log('SocketContext: Group member added event received:', data)
      
      // If current user was added to a group, automatically join the conversation room
      if (data.member.userId === session.user.id) {
        console.log(`SocketContext: Current user was added to group ${data.conversationId}, joining room`)
        joinConversationRoom(data.conversationId)
        
        // Also refresh conversations to ensure the new group appears
        setTimeout(async () => {
          try {
            const response = await fetch('/api/conversations', { credentials: 'include' })
            if (response.ok) {
              console.log('SocketContext: Refreshed conversations after being added to group')
            }
          } catch (error) {
            console.error('SocketContext: Failed to refresh conversations:', error)
          }
        }, 200)
      } else {
        // For existing members, just log that someone new was added
        console.log(`SocketContext: User ${data.member.user?.name || data.member.userId} was added to group ${data.conversationId} by ${data.addedBy?.name || 'admin'}`)
      }
    }

    const handleGroupMemberLeft = (data: { conversationId: string; memberId: string }) => {
      console.log('SocketContext: Group member left event received:', data)
      
      // If current user left the group, leave the conversation room
      if (data.memberId === session.user.id) {
        console.log(`SocketContext: Current user left group ${data.conversationId}, leaving room`)
        leaveConversationRoom(data.conversationId)
        
        // Also refresh conversations to remove the group from the list
        setTimeout(async () => {
          try {
            const response = await fetch('/api/conversations', { credentials: 'include' })
            if (response.ok) {
              console.log('SocketContext: Refreshed conversations after leaving group')
            }
          } catch (error) {
            console.error('SocketContext: Failed to refresh conversations:', error)
          }
        }, 200)
      } else {
        // For existing members, just log that someone left
        console.log(`SocketContext: User ${data.memberId} left group ${data.conversationId}`)
      }
    }

    socket.on('group-member-added', handleGroupMemberAdded)
    socket.on('group-member-left', handleGroupMemberLeft)

    return () => {
      socket.off('group-member-added', handleGroupMemberAdded)
      socket.off('group-member-left', handleGroupMemberLeft)
    }
  }, [socket, session?.user?.id, joinConversationRoom, leaveConversationRoom])

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
      
      // Socket.IO server will be initialized automatically by the socket client connection
      
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
            console.log('SocketContext: 👤 Emitted join-user-room for:', `user:${currentUserId}`)
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

  // Enhanced visibility and focus handling for better idle notification support
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (socket && currentUserId) {
        if (document.visibilityState === 'visible') {
          console.log('SocketContext: Tab became visible, re-establishing connection')
          // Re-establish connection when tab becomes visible
          socket.emit('user-online', currentUserId)
          
          // Ensure socket is still connected and reconnect if needed
          if (!socket.connected) {
            console.log('SocketContext: Socket disconnected during idle, attempting reconnect')
            socket.connect()
          }
          
          // Send additional heartbeats when becoming visible to ensure immediate presence update
          setTimeout(() => {
            if (socket.connected && currentUserId) {
              socket.emit('user-online', currentUserId)
              console.log('SocketContext: Additional heartbeat sent after becoming visible')
            }
          }, 1000)
        } else {
          console.log('SocketContext: Tab became hidden, maintaining aggressive background connection')
          // Send immediate heartbeat when going hidden to establish strong presence
          if (socket.connected) {
            socket.emit('user-online', currentUserId)
          }
        }
      }
    }

    const handleFocus = () => {
      if (socket && currentUserId) {
        console.log('SocketContext: Window focused, refreshing connection')
        socket.emit('user-online', currentUserId)
        
        // Additional connection check on focus
        if (!socket.connected) {
          console.log('SocketContext: Socket disconnected on focus, attempting reconnect')
          socket.connect()
        }
      }
    }

    const handleBlur = () => {
      if (socket && currentUserId) {
        console.log('SocketContext: Window blurred, sending pre-blur heartbeat')
        // Send heartbeat before blur to maintain strong presence
        if (socket.connected) {
          socket.emit('user-online', currentUserId)
        }
      }
    }

    // Handle page hide/show events for better mobile support
    const handlePageHide = () => {
      if (socket && currentUserId && socket.connected) {
        console.log('SocketContext: Page hiding, sending final heartbeat')
        socket.emit('user-online', currentUserId)
      }
    }

    const handlePageShow = () => {
      if (socket && currentUserId) {
        console.log('SocketContext: Page showing, re-establishing connection')
        if (!socket.connected) {
          socket.connect()
        } else {
          socket.emit('user-online', currentUserId)
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [socket, currentUserId])

  // Enhanced periodic heartbeat to maintain online status and detect disconnections
  useEffect(() => {
    if (!socket || !currentUserId || !isConnected) return

    const heartbeat = setInterval(() => {
      // Always send heartbeat if socket is connected, regardless of tab visibility
      if (socket.connected) {
        socket.emit('user-online', currentUserId)
        console.log('SocketContext: Heartbeat sent successfully')
      } else {
        console.warn('SocketContext: Socket disconnected during heartbeat, attempting reconnect')
        // Attempt to reconnect if socket is disconnected
        try {
          socket.connect()
        } catch (error) {
          console.error('SocketContext: Failed to reconnect during heartbeat:', error)
        }
      }
    }, 20000) // Reduced to 20 seconds for better reliability during idle

    // Additional shorter interval check specifically for background/idle scenarios
    const idleCheck = setInterval(() => {
      if (socket && currentUserId) {
        if (!socket.connected) {
          console.log('SocketContext: Idle check detected disconnection, attempting reconnect')
          try {
            socket.connect()
          } catch (error) {
            console.error('SocketContext: Failed to reconnect during idle check:', error)
          }
        } else {
          // Always send heartbeat during idle check, regardless of visibility state
          // This ensures continuous presence even when tab is hidden
          socket.emit('user-online', currentUserId)
          console.log('SocketContext: Idle heartbeat sent (visibility:', document.visibilityState, ')')
        }
      }
    }, 45000) // Check every 45 seconds during idle (more frequent than server grace period)

    // Additional aggressive heartbeat specifically for hidden/background tabs
    const backgroundHeartbeat = setInterval(() => {
      if (socket && currentUserId && socket.connected) {
        if (document.visibilityState === 'hidden') {
          // Send extra heartbeats when tab is hidden to prevent timeout
          socket.emit('user-online', currentUserId)
          console.log('SocketContext: Background heartbeat sent for hidden tab')
        }
      }
    }, 15000) // Very frequent background heartbeats (every 15 seconds)

    return () => {
      clearInterval(heartbeat)
      clearInterval(idleCheck)
      clearInterval(backgroundHeartbeat)
    }
  }, [socket, currentUserId, isConnected])

  // Handle window beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (socket && currentUserId) {
        socket.emit('user-offline', currentUserId)
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
      {/* Global call manager for handling incoming calls anywhere in the app */}
      {isFullyInitialized && <GlobalCallManager />}
    </SocketContext.Provider>
  )
}