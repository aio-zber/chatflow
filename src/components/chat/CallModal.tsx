'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { PhoneOff, Mic, MicOff, Camera, CameraOff, Monitor, Users, Minimize2 } from 'lucide-react'
import { useSocketContext } from '@/context/SocketContext'
import { useSession } from 'next-auth/react'
import { WebRTCService } from '@/lib/webrtc'
import { VideoGrid } from '@/components/video/VideoGrid'
import { ScreenShareManager, getScreenShareCapabilities } from '@/utils/screenShare'
import { useCallPerformance } from '@/hooks/useCallPerformance'
import { useVoiceActivity } from '@/hooks/useVoiceActivity'
import { getGlobalAudioManager } from '@/lib/audio-manager'
import type { CallStatus } from '@/types/call'

// DEBOUNCING UTILITIES for performance optimization
const debounce = <T extends (...args: any[]) => void>(func: T, delay: number): T => {
  let timeoutId: NodeJS.Timeout
  return ((...args: any[]) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => func(...args), delay)
  }) as T
}

// Debounced loggers to reduce console spam
const debouncedLoggers = {
  participantCount: debounce((info: any) => {
    console.log(`[CallModal] 📊 Participant State Debug (debounced):`, info)
  }, 500),
  stateUpdate: debounce((prev: string, next: string, data: any) => {
    console.log(`[CallModal] 🔄 State updated (debounced):`, prev, '->', next, 'authCount:', data.connectedParticipants)
  }, 300)
}

interface CallParticipant {
  id: string
  name: string
  username: string
  avatar?: string | null
  isMuted: boolean
  isCameraOff: boolean
  isConnected: boolean
  participantStatus: 'ringing' | 'connecting' | 'connected'
}

interface CallModalProps {
  isOpen: boolean
  onClose: () => void
  callType: 'voice' | 'video'
  conversationId: string
  conversationName?: string | null
  isGroupCall?: boolean
  participants?: CallParticipant[]
  callId?: string
  isIncoming?: boolean
}

interface CallState {
  status: CallStatus
  duration: number
  connectedParticipants: number
  isMuted: boolean
  isCameraOff: boolean
  isScreenSharing: boolean
}

export function CallModal({
  isOpen,
  onClose,
  callType,
  conversationId,
  conversationName,
  isGroupCall = false,
  participants = [],
  callId,
  isIncoming = false,
}: CallModalProps) {
  const { socket } = useSocketContext()
  const { data: session } = useSession()
  // Reduced logging for better performance - moved to useEffect to prevent setState during render

  // Initialize refs first to avoid initialization errors
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const remoteAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const webrtcServiceRef = useRef<WebRTCService | null>(null)
  const screenShareManagerRef = useRef<ScreenShareManager | null>(null)
  const userInitiatedCloseRef = useRef<boolean>(false)
  const userHasAcceptedCall = useRef<boolean>(!isIncoming)
  const lastStateUpdateRef = useRef<string>('')
  const lastRecoveryAttemptRef = useRef<number>(0)
  // PHASE 1 FIX: Removed authoritative state logic to prevent race conditions

  const [callState, setCallState] = useState<CallState>({
    status: isIncoming ? 'ringing' : 'dialing',
    duration: 0,
    isMuted: false,
    isCameraOff: callType === 'voice',
    isScreenSharing: false,
    connectedParticipants: 0,
  })

  // ENHANCED: Track server-provided call start time for synchronized duration
  const callStartTimeRef = useRef<number | null>(null)
  const serverCallStartTimeRef = useRef<number | null>(null)
  const [outgoingRingingInterval, setOutgoingRingingInterval] = useState<NodeJS.Timeout | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const [participantConnectionStates, setParticipantConnectionStates] = useState<Map<string, 'ringing' | 'connecting' | 'connected' | 'declined' | number>>(new Map())
  const [offerCreationAttempts, setOfferCreationAttempts] = useState<Set<string>>(new Set())
  const [isMinimized, setIsMinimized] = useState(false)
  const [activeParticipants, setActiveParticipants] = useState<CallParticipant[]>(participants || [])

  // ENHANCED: Track group call connection attempts to prevent duplicates
  const groupCallConnectionAttempts = useRef<Set<string>>(new Set())
  const lastGroupCallParticipants = useRef<string>('')
  
  // PERFORMANCE: Track previous participant IDs to prevent unnecessary re-renders
  const prevParticipantIds = useRef<string>('')
  
  // ENHANCED: Event deduplication and processing locks to prevent conflicts
  const lastProcessedEventRef = useRef<{ type: string; id: string; timestamp: number } | null>(null)
  const eventProcessingLockRef = useRef<boolean>(false)
  
  // ENHANCED: Event deduplication helper - OPTIMIZED for group calls
  const shouldProcessEvent = useCallback((eventType: string, eventId: string) => {
    const now = Date.now()
    const lastEvent = lastProcessedEventRef.current

    // ENHANCED: More lenient deduplication for group call events
    const isGroupCallEvent = eventType.includes('call_state_update') || eventType.includes('call_response')
    const deduplicationWindow = isGroupCallEvent ? 50 : 200 // Ultra-short window for real-time responsiveness

    // Check for duplicate events within a short time window
    if (lastEvent &&
        lastEvent.type === eventType &&
        lastEvent.id === eventId &&
        (now - lastEvent.timestamp) < deduplicationWindow) {
      console.log(`[CallModal] 🔄 Duplicate event detected, skipping ${eventType}:${eventId} (window: ${deduplicationWindow}ms)`)
      return false
    }

    // Update last processed event
    lastProcessedEventRef.current = { type: eventType, id: eventId, timestamp: now }
    return true
  }, [])

  // ENHANCED: Process event with lock - OPTIMIZED for group calls
  const processEventWithLock = useCallback(async (eventType: string, eventId: string, handler: () => Promise<void> | void) => {
    if (!shouldProcessEvent(eventType, eventId)) {
      return
    }

    // ENHANCED: Use shorter locks for group call events
    const isGroupCallEvent = eventType.includes('call_state_update') || eventType.includes('call_response')
    const lockTimeout = isGroupCallEvent ? 50 : 200 // Ultra-short locks for real-time responsiveness

    // ENHANCED: Check if already locked with timeout and priority handling
    const criticalEvents = ['call_ended', 'call_timeout', 'call_response', 'call_state_update']
    const isCriticalEvent = criticalEvents.some(critical => eventType.includes(critical))

    if (eventProcessingLockRef.current) {
      if (isCriticalEvent) {
        // For critical events, wait briefly then proceed
        console.log(`[CallModal] ⏰ Critical event ${eventType} waiting for lock...`)
        let waitTime = 0
        const maxWait = 300 // 300ms max wait for critical events

        while (eventProcessingLockRef.current && waitTime < maxWait) {
          await new Promise(resolve => setTimeout(resolve, 50))
          waitTime += 50
        }

        if (eventProcessingLockRef.current) {
          console.warn(`[CallModal] ⚠️ Critical event ${eventType} proceeding despite lock (timeout)`)
          // Force clear stale lock
          eventProcessingLockRef.current = false
        }
      } else {
        console.log(`[CallModal] 🔒 Event processing locked, skipping ${eventType}:${eventId}`)
        return
      }
    }

    eventProcessingLockRef.current = true
    const lockStart = Date.now()

    // Auto-release lock after maximum timeout to prevent deadlocks
    const lockReleaseTimeout = setTimeout(() => {
      if (eventProcessingLockRef.current) {
        console.warn(`[CallModal] 🚨 Force releasing stuck lock for ${eventType} after ${lockTimeout * 2}ms`)
        eventProcessingLockRef.current = false
      }
    }, lockTimeout * 2)

    try {
      await handler()
    } finally {
      clearTimeout(lockReleaseTimeout)
      eventProcessingLockRef.current = false

      // DEBUGGING: Log excessive lock times
      const lockDuration = Date.now() - lockStart
      if (lockDuration > lockTimeout) {
        console.warn(`[CallModal] ⏱️ Long event processing: ${eventType} took ${lockDuration}ms (expected <${lockTimeout}ms)`)
      }
    }
  }, [shouldProcessEvent])
  
  // Sync activeParticipants with participants prop changes
  useEffect(() => {
    if (participants && participants.length > 0) {
      // PERFORMANCE: Check if participants actually changed before processing
      const participantIds = participants.map(p => p.id).sort().join(',')
      
      if (prevParticipantIds.current === participantIds) {
        console.log('[CallModal] 🔄 Participants unchanged, skipping re-initialization')
        return
      }
      
      prevParticipantIds.current = participantIds
      
      // FIXED: Use participants list as-is without manual current user addition
      // This prevents UI duplication issues. Current user display is handled separately
      let completeParticipants = [...participants]
      
      setActiveParticipants(completeParticipants)
      console.log('[CallModal] Initialized active participants (including all):', completeParticipants.map(p => p.id))
      console.log('[CallModal] Current user ID:', session?.user?.id)
      console.log('[CallModal] Participant details:', completeParticipants.map(p => ({id: p.id, name: p.name})))
      
      // Initialize participant states for all participants
      const newParticipantStates = new Map(participantConnectionStates)
      completeParticipants.forEach(participant => {
        if (!newParticipantStates.has(participant.id)) {
          // FIXED: Proper state flow for group calls
          // Incoming calls: all participants start as 'ringing' 
          // Outgoing calls: caller starts as 'connecting', recipients start as 'ringing'
          let initialState: 'ringing' | 'connecting'
          
          if (isIncoming) {
            // For incoming calls, everyone starts as ringing
            initialState = 'ringing'
          } else {
            // For outgoing calls, caller connects immediately, recipients ring
            initialState = participant.id === session?.user?.id ? 'connecting' : 'ringing'
          }
          
          newParticipantStates.set(participant.id, initialState)
          console.log(`[CallModal] Set initial state for ${participant.name} (${participant.id}):`, initialState, `(incoming: ${isIncoming})`)
        }
      })
      setParticipantConnectionStates(newParticipantStates)
    } else {
      console.log('[CallModal] No participants provided or empty participants array')
    }
  }, [participants, session?.user?.id, isIncoming])

  // ENHANCED: Create safe participant object with improved validation and intelligent fallback
  const createSafeParticipant = useCallback((participantData: any, fallbackId?: string): CallParticipant => {
    const id = participantData?.id || fallbackId
    if (!id) {
      throw new Error('Cannot create participant without ID')
    }

    // ENHANCED: Intelligent fallback naming system
    const generateFallbackName = (userId: string): string => {
      // Try to create a more user-friendly fallback name
      const shortId = userId.slice(-8)

      // Check if ID looks like a UUID (contains hyphens)
      if (userId.includes('-')) {
        const lastPart = userId.split('-').pop() || shortId
        return `User-${lastPart.slice(-6).toUpperCase()}`
      }

      // For shorter IDs, use a different pattern
      if (userId.length <= 10) {
        return `User-${userId.slice(-6).toUpperCase()}`
      }

      // Default pattern with better formatting
      return `User-${shortId.toUpperCase()}`
    }

    // ENHANCED: More robust validation and sanitization
    let safeName: string
    if (participantData?.name && typeof participantData.name === 'string' && participantData.name.trim()) {
      safeName = participantData.name.trim()

      // Validate that the name is not just a fallback pattern already
      if (safeName.match(/^User[\s-][a-z0-9]{6,8}$/i)) {
        console.log(`[CallModal] 🔄 Received fallback-style name "${safeName}", attempting to improve it`)
        safeName = generateFallbackName(id)
      }
    } else {
      safeName = generateFallbackName(id)
      console.log(`[CallModal] 🔤 Generated fallback name: ${safeName} for ID: ${id}`)
    }

    // ENHANCED: Better username fallback
    let safeUsername: string
    if (participantData?.username && typeof participantData.username === 'string' && participantData.username.trim()) {
      safeUsername = participantData.username.trim()
    } else {
      // Create a cleaner username fallback
      const shortId = id.slice(-6).toLowerCase()
      safeUsername = `user_${shortId}`
    }

    // Avatar validation remains the same
    const safeAvatar = participantData?.avatar && typeof participantData.avatar === 'string'
      ? participantData.avatar
      : null

    const participant = {
      id,
      name: safeName,
      username: safeUsername,
      avatar: safeAvatar,
      isMuted: false,
      isCameraOff: callType === 'voice',
      isConnected: false,
      participantStatus: 'ringing' as const
    }

    console.log(`[CallModal] 🎯 Created safe participant:`, {
      id: participant.id,
      name: participant.name,
      username: participant.username,
      hasData: !!participantData?.name
    })

    return participant
  }, [callType])


  // Memoize participant IDs to prevent unnecessary re-renders
  const memoizedParticipantIds = useMemo(() => {
    return activeParticipants?.map(p => p.id).filter(id => id !== session?.user?.id) || []
  }, [activeParticipants, session?.user?.id])

  // Memoize connected participants for better performance - ENHANCED to prevent auto-answer UI
  const connectedParticipants = useMemo(() => {
    return activeParticipants?.filter(participant => {
      // CRITICAL FIX: Only show participants who have ACCEPTED the call (connecting or connected)
      // This prevents the false "auto-join" appearance where ringing participants show up as connected
      const serverParticipantState = participantConnectionStates.get(participant.id)
      const isCurrentUser = participant.id === session?.user?.id

      // ENHANCED: For current user, add additional validation against auto-answer
      if (isCurrentUser) {
        const hasLocallyAccepted = userHasAcceptedCall.current
        // Current user must have locally accepted to be in connected participants list
        return hasLocallyAccepted && (serverParticipantState === 'connecting' || serverParticipantState === 'connected')
      }

      // For other participants, use server state
      return serverParticipantState === 'connecting' || serverParticipantState === 'connected'
    }).map(participant => {
      const streamActive = remoteStreams.has(participant.id)
      const stream = remoteStreams.get(participant.id)
      const streamHasLiveTracks = stream && stream.getTracks().some(track => 
        track.readyState === 'live' && !track.muted
      )
      
      let participantStatus: 'ringing' | 'connecting' | 'connected' = 'ringing'
      
      // Get server-side participant state first - this is the primary source of truth
      const serverParticipantState = participantConnectionStates.get(participant.id)
      
      // CRITICAL FIX: Current user status logic that respects user acceptance
      if (participant.id === session?.user?.id) {
        // CRITICAL: For current user, use local state and WebRTC connection, NOT server participant state
        const hasLocallyAccepted = userHasAcceptedCall.current
        const hasWebRTCConnection = webrtcServiceRef.current &&
                                   webrtcServiceRef.current.getActivePeerConnectionCount() > 0
        const hasLiveStream = streamActive && streamHasLiveTracks
        
        // Log current user status calculation outside of render

        // ULTRA-STRICT: Non-accepting incoming call users MUST stay ringing regardless of any other state
        if (isIncoming && !hasLocallyAccepted) {
          participantStatus = 'ringing'
        } else {
          // ENHANCED: Determine status based PURELY on LOCAL state and WebRTC connections
          if (hasLiveStream && hasLocallyAccepted) {
            // User has accepted and has active media stream - fully connected
            participantStatus = 'connected'
          } else if (hasWebRTCConnection && hasLocallyAccepted) {
            // User has accepted and has WebRTC connection - connected
            participantStatus = 'connected'
          } else if (hasLocallyAccepted && callState.status === 'connected') {
            // User has accepted and call is in connected state - connecting
            participantStatus = 'connecting'
          } else if (hasLocallyAccepted && (callState.status === 'connecting' || !isIncoming)) {
            // User has accepted and call is connecting, OR this is outgoing call (caller is always "connecting" when accepted)
            participantStatus = 'connecting'
          } else if (!isIncoming && !hasLocallyAccepted) {
            // Outgoing calls: should auto-accept, but if somehow not accepted, show ringing
            participantStatus = 'ringing'
          } else {
            // Ultimate fallback: respect user acceptance state only
            participantStatus = hasLocallyAccepted ? 'connecting' : 'ringing'
          }
        }
        
        // ENHANCED: State validation and suspicious auto-join detection (LOCAL STATE ONLY)
        const suspiciousConditions = []

        // Check for suspicious auto-join scenarios using only local state
        if (isIncoming && !hasLocallyAccepted && (participantStatus === 'connecting' || participantStatus === 'connected')) {
          suspiciousConditions.push('incoming_user_not_accepted_but_connecting')
        }

        if (!hasWebRTCConnection && !hasLiveStream && participantStatus === 'connected') {
          suspiciousConditions.push('no_webrtc_or_stream_but_status_connected')
        }

        if (callState.status === 'connected' && !hasLocallyAccepted && isIncoming) {
          suspiciousConditions.push('call_connected_but_user_not_accepted')
        }
        
        // Override suspicious states without logging during render
        if (suspiciousConditions.length > 0) {
          // For incoming calls, force override to ringing if user hasn't accepted
          if (isIncoming && !hasLocallyAccepted) {
            participantStatus = 'ringing'
          }
        }
      } else {
        // For remote participants, use server state as primary source
        if (serverParticipantState === 'connected') {
          participantStatus = 'connected'
        } else if (serverParticipantState === 'connecting') {
          participantStatus = 'connecting'
        } else if (serverParticipantState === 'ringing') {
          participantStatus = 'ringing'
        } else {
          // Fallback: check WebRTC connection state
          const hasWebRTCConnection = webrtcServiceRef.current &&
                                     webrtcServiceRef.current.hasActivePeerConnection(participant.id)
          
          if (streamActive && streamHasLiveTracks) {
            participantStatus = 'connected'
          } else if (hasWebRTCConnection) {
            participantStatus = 'connected'
          } else if (callState.status === 'connected') {
            participantStatus = 'connecting'
          } else {
            participantStatus = 'ringing'
          }
        }
      }

      return {
        ...participant,
        participantStatus,
        stream
      }
    }) || []
  }, [activeParticipants, remoteStreams, participantConnectionStates, callState.status, callState.connectedParticipants, session?.user?.id, isIncoming])

  // PHASE 1 FIX: Simplified single source of truth for participant counting
  const actualConnectedParticipants = useMemo(() => {
    try {
      // Single source of truth: Use server's connectedParticipants count directly
      // This eliminates race conditions and complex client-side calculations
      const serverCount = callState.connectedParticipants || 0

      // For UI display: ensure minimum count of 1 when user has accepted and call is active
      const isCallActive = callState.status === 'connected' || callState.status === 'connecting'
      const userIsActive = userHasAcceptedCall.current && isCallActive
      const displayCount = Math.max(serverCount, userIsActive ? 1 : 0)

      // Cap at reasonable maximum to prevent display issues
      const maxParticipants = Math.max(activeParticipants.length, 10)
      const finalCount = Math.min(displayCount, maxParticipants)

      console.log(`[CallModal] 📊 SIMPLIFIED count logic: server=${serverCount}, userActive=${userIsActive}, display=${displayCount}, final=${finalCount}`)

      return finalCount
    } catch (error) {
      console.error('[CallModal] Error calculating connected participants:', error)
      return Math.max(0, (callState.connectedParticipants || 0))
    }
  }, [callState.connectedParticipants, callState.status, userHasAcceptedCall.current, activeParticipants.length])

  // ENHANCED: Comprehensive participant state debugging
  useEffect(() => {
    const debugInfo = {
      actualConnected: actualConnectedParticipants,
      serverCount: callState.connectedParticipants,
      activeParticipants: activeParticipants.length,
      isGroupCall,
      hasAccepted: userHasAcceptedCall.current,
      callStatus: callState.status,
      // PHASE 1 FIX: Removed authoritative state debugging
      participantStates: Array.from(participantConnectionStates.entries()).map(([id, state]) => ({
        id: id.slice(-8), // Last 8 chars for privacy
        state
      })),
      webrtcConnections: webrtcServiceRef.current ? webrtcServiceRef.current.getActivePeerConnectionCount() : 0
    }

    debouncedLoggers.participantCount(debugInfo)

    // Alert on critical mismatches (immediate - not debounced)
    if (isGroupCall && Math.abs(actualConnectedParticipants - (callState.connectedParticipants || 0)) > 1) {
      console.warn(`[CallModal] ⚠️ CRITICAL MISMATCH: actualConnected=${actualConnectedParticipants} vs serverCount=${callState.connectedParticipants}`)
    }
  }, [actualConnectedParticipants, callState.connectedParticipants, callState.status, activeParticipants.length, isGroupCall, participantConnectionStates, webrtcServiceRef.current])

  // ENHANCED: Smart status text that respects user acceptance state
  const statusText = useMemo(() => {
    const getStatusText = (): string => {
      const hasAccepted = userHasAcceptedCall.current
      
      // CRITICAL FIX: For incoming calls, always show "Incoming call" until user accepts
      if (isIncoming && !hasAccepted) {
        return 'Incoming call'
      }
      
      // ENHANCED: Status text that considers user acceptance for other states
      const statusMapping = {
        'dialing': 'Calling...',
        'ringing': isIncoming ? 'Incoming call' : 'Ringing...',
        'connecting': hasAccepted 
          ? 'Connecting...' 
          : (isIncoming ? 'Incoming call' : 'Ringing...'),
        'connected': hasAccepted
          ? (isGroupCall ? `Connected \u2022 ${actualConnectedParticipants} joined` : 'Connected')
          : (isIncoming ? 'Incoming call' : 'Connected'),
        'disconnected': 'Call ended',
        'declined': 'Call declined',
        'ended': 'Call ended'
      }
      
      const finalStatus = statusMapping[callState.status] || callState.status
      console.log(`[CallModal] 📱 Status text: "${finalStatus}" (hasAccepted: ${hasAccepted}, isIncoming: ${isIncoming}, callState: ${callState.status})`)
      
      // FINAL CONSISTENCY CHECK: Verify status text matches user acceptance state
      if (isIncoming && !hasAccepted && (finalStatus.includes('Connecting') || finalStatus.includes('Connected'))) {
        console.log(`[CallModal] 🛡️ CONSISTENCY OVERRIDE: Forcing "Incoming call" for non-accepting user despite status: ${finalStatus}`)
        return 'Incoming call'
      }
      
      return finalStatus
    }
    return getStatusText()
  }, [callState.status, actualConnectedParticipants, isIncoming, isGroupCall, userHasAcceptedCall.current])

  // ENHANCED: Calculate dynamic invited count for group calls
  const totalInvitedCount = useMemo(() => {
    if (!isGroupCall) return 0

    // Use the maximum of initial participants or current active participants for invited count
    // This ensures the count reflects the actual conversation size, not just who was initially passed
    const conversationSize = Math.max(
      participants?.length || 0,
      activeParticipants.length,
      callState.connectedParticipants || 0
    )

    return conversationSize
  }, [isGroupCall, participants?.length, activeParticipants.length, callState.connectedParticipants])

  // CRITICAL FIX: Add stability check to prevent immediate unmounting - ENHANCED for group calls
  const [isInitializing, setIsInitializing] = useState(true)

  useEffect(() => {
    // Mark as stable after initial render to prevent premature unmounting
    // EXTENDED timeout to give WebRTC more time to establish connections - longer for group calls
    const isGroupCall = activeParticipants.length > 2
    const stabilityTimeout = isGroupCall ? 5000 : 3000 // 5s for group calls, 3s for direct calls

    const timeoutId = setTimeout(() => {
      console.log('[CallModal] 🛡️ Initialization stability timeout complete - component now stable', {
        isGroupCall,
        timeoutUsed: stabilityTimeout,
        participantCount: activeParticipants.length
      })
      setIsInitializing(false)
    }, stabilityTimeout)
    
    return () => {
      console.log('[CallModal] 🧹 Component unmounting - performing thorough cleanup')
      clearTimeout(timeoutId)
      
      // CRITICAL: Ensure WebRTC is completely cleaned up on unmount
      if (webrtcServiceRef.current) {
        console.log('[CallModal] 🧹 Emergency WebRTC cleanup on unmount')
        try {
          webrtcServiceRef.current.cleanup()
        } catch (error) {
          console.warn('[CallModal] Error during unmount WebRTC cleanup:', error)
        }
        webrtcServiceRef.current = null
      }
      
      // Clear all refs
      localStreamRef.current = null
      remoteStreams.clear()
      setRemoteStreams(new Map())
      
      // Clear state  
      setOfferCreationAttempts(new Set())
      setParticipantConnectionStates(new Map())
    }
  }, [])

  const [connectionErrors, setConnectionErrors] = useState<Map<string, string>>(new Map())
  // State to track peer connections for performance monitoring
  const [peerConnections, setPeerConnections] = useState<Map<string, RTCPeerConnection>>(new Map())
  
  // State to track participant mute states received from server
  const [participantMuteStates, setParticipantMuteStates] = useState<Map<string, boolean>>(new Map())

  // Update peer connections when WebRTC connections change
  useEffect(() => {
    const updatePeerConnections = () => {
      if (webrtcServiceRef.current) {
        try {
          const activePeerConnections = webrtcServiceRef.current.getActivePeerConnections()
          const rtcPeerConnections = new Map<string, RTCPeerConnection>()
          activePeerConnections.forEach((peerConn, participantId) => {
            if (peerConn.connection && peerConn.connection.connectionState !== 'closed') {
              rtcPeerConnections.set(participantId, peerConn.connection)
            }
          })
          console.log('[CallModal] Updated peer connections for performance monitoring:', rtcPeerConnections.size)
          console.log('[CallModal] Peer connection participants:', Array.from(rtcPeerConnections.keys()))
          setPeerConnections(rtcPeerConnections)
          
          // IMMEDIATE TRANSITION TRIGGER: If we're in connecting state and have peer connections, transition to connected
          if (callState.status === 'connecting' && rtcPeerConnections.size > 0) {
            console.log('[CallModal] 🚀 IMMEDIATE TRANSITION: Peer connections established, moving to connected state')
            setCallState(prev => ({ ...prev, status: 'connected' }))
            
            // Ensure ringing stops
            stopOutgoingRingingSound()
            
            // Notify server of state change
            if (socket && callId) {
              socket.emit('force_call_connected', { callId })
            }
          }
        } catch (error) {
          console.warn('[CallModal] Error updating peer connections:', error)
        }
      }
    }

    // Update initially and then every 2 seconds
    updatePeerConnections()
    const interval = setInterval(updatePeerConnections, 2000)

    return () => clearInterval(interval)
  }, [callState.status, remoteStreams])

  useCallPerformance(peerConnections, callType)


  // Announce call status changes to screen readers
  const [screenReaderAnnouncement, setScreenReaderAnnouncement] = useState('')
  useEffect(() => {
    const announcements: { [key: string]: string } = {
      'ringing': isIncoming ? 'Incoming call' : 'Calling...',
      'connecting': 'Connecting to call',
      'connected': 'Call connected',
      'disconnected': 'Call ended'
    }
    
    const announcement = announcements[callState.status]
    if (announcement) {
      setScreenReaderAnnouncement(announcement)
      // Clear announcement after screen reader has time to read it
      setTimeout(() => setScreenReaderAnnouncement(''), 1000)
    }
  }, [callState.status, isIncoming])

  // Track participant connecting times separately to avoid setState in render
  useEffect(() => {
    if (callState.status === 'connected' && connectedParticipants.length > 0) {
      const now = Date.now()
      connectedParticipants.forEach(participant => {
        const participantConnectingTime = participantConnectionStates.get(participant.id + '_time')
        if (participant.participantStatus === 'connecting' && !participantConnectingTime) {
          setParticipantConnectionStates(prev => 
            new Map(prev.set(participant.id + '_time', now))
          )
        }
      })
    }
  }, [connectedParticipants, participantConnectionStates, callState.status])
  
  // Voice activity detection for local user
  const { isSpeaking: isLocalSpeaking } = useVoiceActivity({ 
    stream: localStreamRef.current,
    threshold: -50 
  })

  // ENHANCED: Audio context with proper user gesture handling
  const audioContextRef = useRef<AudioContext | null>(null)
  const ringingAudioRef = useRef<HTMLAudioElement | null>(null)
  
  
  // Initialize audio context with user gesture requirement
  const initializeAudioContext = async () => {
    if (audioContextRef.current) {
      return audioContextRef.current
    }
    
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) {
        console.warn('[CallModal] AudioContext not supported in this browser')
        return null
      }
      
      const audioContext = new AudioContextClass()
      
      // Resume AudioContext if it's suspended (required after user gesture)
      if (audioContext.state === 'suspended') {
        console.log('[CallModal] AudioContext suspended, attempting to resume...')
        await audioContext.resume()
        console.log('[CallModal] AudioContext resumed successfully')
      }
      
      audioContextRef.current = audioContext
      return audioContext
    } catch (error) {
      console.warn('[CallModal] Failed to initialize AudioContext:', error)
      return null
    }
  }

  // Socket-based call state management

  // CONSOLIDATED: Delegate ringing stop to GlobalCallManager for consistency
  const requestStopRinging = useCallback((reason: string = 'callmodal_request') => {
    console.log('[CallModal] 🔇 Requesting ringing stop from GlobalCallManager:', reason)

    // Send browser event to GlobalCallManager to stop all ringing
    const stopRingingEvent = new CustomEvent('stopGlobalCallManagerRinging', {
      detail: {
        eventCallId: callId,
        reason,
        callerId: session?.user?.id,
        priority: true  // Mark as high priority to override other ringing
      }
    })

    window.dispatchEvent(stopRingingEvent)
  }, [callId, session?.user?.id])

  const stopOutgoingRingingSound = useCallback(() => {
    console.log('[CallModal] 🔇 STOPPING ringing sound completely')

    // Stop current interval if exists
    if (outgoingRingingInterval) {
      clearInterval(outgoingRingingInterval)
      setOutgoingRingingInterval(null)
      console.log('[CallModal] ✅ Cleared outgoing ringing interval')
    }

    // ENHANCED: Use audio manager to stop ringing
    try {
      const audioManager = getGlobalAudioManager()
      if (audioManager) {
        audioManager.stopOutgoingRinging()
        console.log('[CallModal] ✅ Audio manager ringing stopped')
      }
    } catch (error) {
      console.warn('[CallModal] Error stopping audio manager ringing:', error)
    }

    // LEGACY: Also stop old ringing audio for backward compatibility
    try {
      if (ringingAudioRef.current) {
        console.log('[CallModal] Stopping legacy ringing audio completely...')

        // Pause and reset audio
        ringingAudioRef.current.pause()
        ringingAudioRef.current.currentTime = 0

        // CRITICAL: Remove all event listeners to prevent memory leaks
        ringingAudioRef.current.onended = null
        ringingAudioRef.current.onerror = null
        ringingAudioRef.current.onplay = null
        ringingAudioRef.current.onpause = null

        // Set volume to 0 for immediate silence
        ringingAudioRef.current.volume = 0

        // Clear src to stop loading
        ringingAudioRef.current.src = ''
        ringingAudioRef.current.load()

        console.log('[CallModal] ✅ Legacy ringing audio completely stopped and cleaned up')
      }
    } catch (error) {
      console.warn('[CallModal] Error stopping legacy ringing audio:', error)
    }
    
    // ENHANCED: Coordinate AudioContext suspension with GlobalCallManager
    try {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        console.log('[CallModal] 🔇 Suspending AudioContext to stop all audio')
        audioContextRef.current.suspend()
        
        // COORDINATION: Also notify GlobalCallManager that audio context should be suspended
        // This prevents conflicts between multiple audio contexts
        if (callId && session?.user?.id) {
          const suspendAudioEvent = new CustomEvent('suspendGlobalAudioContext', {
            detail: {
              callId: callId,
              reason: 'callmodal_audio_stopped',
              callerId: session.user.id
            }
          })
          window.dispatchEvent(suspendAudioEvent)
        }
      }
    } catch (error) {
      console.warn('[CallModal] Error suspending audio context:', error)
    }
    
    // CONSISTENCY FIX: Suspend (don't close) AudioContext to preserve it for next call
    try {
      if (audioContextRef.current && audioContextRef.current.state === 'running') {
        console.log('[CallModal] Suspending AudioContext (preserving for consistency)...')
        audioContextRef.current.suspend().then(() => {
          console.log('[CallModal] ✅ AudioContext suspended for reuse')
        }).catch(error => {
          console.warn('[CallModal] Error suspending AudioContext:', error)
        })
        // CRITICAL: Keep the reference for consistent tone across calls
        // audioContextRef.current = null  // REMOVED - this was causing inconsistency
      }
    } catch (error) {
      console.warn('[CallModal] Error during AudioContext suspend:', error)
    }
    
    // ENHANCED: Notify GlobalCallManager to stop any global ringing with priority
    // This ensures coordination between CallModal and GlobalCallManager
    if (callId && session?.user?.id) {
      console.log('[CallModal] 📢 Notifying GlobalCallManager to stop ringing via browser event (PRIORITY)')
      const stopRingingEvent = new CustomEvent('stopGlobalCallManagerRinging', {
        detail: {
          callId: callId,
          reason: 'callmodal_ringing_stopped_priority',
          callerId: session.user.id,
          priority: true  // Indicate this is a priority stop from CallModal
        }
      })
      window.dispatchEvent(stopRingingEvent)
    }
  }, [outgoingRingingInterval, callId, session?.user?.id])

  // ENHANCED: Handle call start time synchronization from other participants
  const handleCallStartTimeSync = useCallback((data: {
    callId: string
    participantId: string
    callStartTime: number
    timestamp: number
  }) => {
    if (data.callId !== callId) return

    console.log('[CallModal] ⏰ Received call start time sync:', {
      from: data.participantId,
      startTime: new Date(data.callStartTime).toISOString(),
      currentLocal: callStartTimeRef.current ? new Date(callStartTimeRef.current).toISOString() : 'none'
    })

    // CRITICAL: Use the earliest start time for synchronization
    const shouldUpdateTime = !callStartTimeRef.current || data.callStartTime < callStartTimeRef.current

    if (shouldUpdateTime) {
      const oldStartTime = callStartTimeRef.current
      callStartTimeRef.current = data.callStartTime

      console.log('[CallModal] ⏰ Updated call start time to earlier timestamp:', {
        old: oldStartTime ? new Date(oldStartTime).toISOString() : 'none',
        new: new Date(data.callStartTime).toISOString(),
        difference: oldStartTime ? (oldStartTime - data.callStartTime) : 0,
        source: 'peer_sync'
      })

      // Immediately update duration if call is connected and no server time exists
      if (callState.status === 'connected' && !serverCallStartTimeRef.current) {
        const elapsed = Math.max(0, Math.floor((Date.now() - data.callStartTime) / 1000))
        setCallState(prev => ({ ...prev, duration: elapsed }))
        console.log('[CallModal] ⏰ Duration updated from peer sync:', elapsed, 'seconds')
      }
    } else {
      console.log('[CallModal] ⏰ Ignoring later call start time from peer:', {
        received: new Date(data.callStartTime).toISOString(),
        current: callStartTimeRef.current ? new Date(callStartTimeRef.current).toISOString() : 'none'
      })
    }
  }, [callId, callState.status])

  useEffect(() => {
    console.log('[CallModal] 🔌 Socket setup useEffect triggered:', {
      socket: !!socket,
      isOpen,
      callId,
      hasRequirements: !!(socket && callId)
    })
    
    // CRITICAL FIX: Only require socket and callId - allow setup regardless of isOpen
    if (!socket || !callId) {
      console.log('[CallModal] ❌ Missing critical requirements for socket setup:', { 
        socket: !!socket, 
        isOpen, 
        callId
      })
      return
    }
    
    console.log('[CallModal] ✅ Setting up socket listeners for call:', callId)
    
    // Validate socket connection with retry mechanism
    if (!socket.connected) {
      console.warn('[CallModal] ⚠️ Socket not connected, attempting to connect...')
      socket.connect()
      
      // Wait briefly for connection
      const connectTimeout = setTimeout(() => {
        if (!socket.connected) {
          console.error('[CallModal] ❌ Socket connection failed after timeout')
        }
      }, 2000)
      
      socket.once('connect', () => {
        clearTimeout(connectTimeout)
        console.log('[CallModal] ✅ Socket connection established')
      })
    }

    // Listen for call response events
    const handleCallResponse = (data: { 
      accepted: boolean
      participantId: string
      participantCount: number
      callStatus: string
      callId?: string
      participantStates?: Record<string, string>
      allParticipants?: string[]
      connectedParticipants?: number
      [key: string]: any // Allow for participant state keys like cmeifn5qp002dkunge64m0xss: 'connecting'
    }) => {
      // ENHANCED: Use event lock to prevent duplicate processing
      const eventId = `${data.callId || callId}-${data.participantId}-${data.accepted ? 'accept' : 'decline'}`
      processEventWithLock('call_response', eventId, () => {
      console.log('[CallModal] Received call_response:', data)
      console.log('[CallModal] Current call state:', callState.status)
      console.log('[CallModal] Is incoming call:', isIncoming)
      
      // Validate call_response data
      if (data.callId && data.callId !== callId) {
        console.log('[CallModal] ❌ Ignoring call_response for different call:', data.callId, 'vs', callId)
        return
      }
      
      // RACE CONDITION PREVENTION: Add event sequence validation
      if (data.eventSequence && data.eventType === 'call_response') {
        console.log('[CallModal] 📧 Processing call_response event with sequence:', data.eventSequence)
      }
      
      // CRITICAL FIX: Extract and synchronize participant states from enhanced call_response
      const participantStatesFromServer: Record<string, string> = {}
      
      // First, try to get participant states from flattened properties
      Object.keys(data).forEach(key => {
        // Check if key looks like a participant ID (not a standard property)
        if (key !== 'accepted' && key !== 'participantId' && key !== 'participantCount' && 
            key !== 'callStatus' && key !== 'callId' && key !== 'participantStates' && 
            key !== 'allParticipants' && key !== 'connectedParticipants' &&
            typeof data[key] === 'string' && key.startsWith('cme')) {
          participantStatesFromServer[key] = data[key] as string
        }
      })
      
      // FALLBACK: Use participantStates object if flattened properties are empty
      if (Object.keys(participantStatesFromServer).length === 0 && data.participantStates) {
        Object.assign(participantStatesFromServer, data.participantStates)
      }
      
      console.log('[CallModal] 🔄 Participant states from server:', participantStatesFromServer)
      
      // ENHANCED: Comprehensive state validation and synchronization
      if (Object.keys(participantStatesFromServer).length > 0) {
        setParticipantConnectionStates(prev => {
          const updated = new Map(prev)
          Object.entries(participantStatesFromServer).forEach(([participantId, state]) => {
            // Validate state value
            if (['ringing', 'connecting', 'connected', 'declined'].includes(state)) {
              const previousState = prev.get(participantId)
              const isCurrentUser = participantId === session?.user?.id
              const hasUserAccepted = userHasAcceptedCall.current
              
              // CRITICAL: Enhanced multi-layer client-side auto-answer prevention
              if (isCurrentUser && !hasUserAccepted && isIncoming) {
                // Block ANY state change for current user who hasn't accepted incoming call
                if (state === 'connecting' || state === 'connected') {
                  console.log(`[CallModal] 🚫 ENHANCED CLIENT STATE GUARD: Blocking auto-transition to ${state} - user hasn't accepted yet`)
                  console.log(`[CallModal] 🚫 Current user: ${participantId}, hasAccepted: ${hasUserAccepted}, isIncoming: ${isIncoming}`)
                  console.log(`[CallModal] 🚫 Previous state: ${previousState}, attempted state: ${state}`)
                  console.log(`[CallModal] 🛡️ PROTECTION: Forcing current user to remain in 'ringing' state`)
                  console.log(`[CallModal] 🔍 DEBUG: Server sent state '${state}' but user hasn't accepted - this indicates server-side issue`)

                  // Keep current user in ringing state until they explicitly accept
                  updated.set(participantId, 'ringing' as any)

                  // Log this as a potential server-side bug
                  console.warn(`[CallModal] ⚠️ POTENTIAL BUG: Server attempted to set non-accepting user to '${state}' state`)
                  return
                }

                // Additional protection: Only allow 'ringing' state for non-accepting users
                if (state !== 'ringing' && state !== 'declined') {
                  console.log(`[CallModal] 🚫 ADDITIONAL GUARD: Blocking state '${state}' for non-accepting user, forcing 'ringing'`)
                  updated.set(participantId, 'ringing' as any)
                  return
                }
              }

              // CRITICAL: Additional protection for outgoing calls
              if (isCurrentUser && !hasUserAccepted && !isIncoming && state === 'ringing') {
                // For outgoing calls, caller should not be forced back to ringing after accepting
                console.log(`[CallModal] 🔍 Outgoing call state check: caller should auto-accept, but got 'ringing' state`)
                // Allow the ringing state for debugging, but log it
                console.log(`[CallModal] 📝 Caller state: ${state}, hasAccepted: ${hasUserAccepted}`)
              }

              // ADDITIONAL: Enhanced protection for incoming group calls
              if (isCurrentUser && !hasUserAccepted && isIncoming && isGroupCall && state !== 'ringing') {
                console.log(`[CallModal] 🚫 GROUP CALL PROTECTION: Non-accepting user forced to ringing state`)
                console.log(`[CallModal] 🚫 Group call context: state=${state}, userAccepted=${hasUserAccepted}`)
                updated.set(participantId, 'ringing' as any)
                return
              }

              // ADDITIONAL: Protect against outgoing call auto-acceptance issues
              if (isCurrentUser && !hasUserAccepted && !isIncoming && state === 'connected' && previousState !== 'connecting') {
                console.log(`[CallModal] 🚫 OUTGOING CALL GUARD: Blocking direct transition to 'connected' for outgoing call`)
                console.log(`[CallModal] 🚫 User should transition through 'connecting' state first`)
                // Allow connecting but not direct to connected
                updated.set(participantId, 'connecting' as any)
                return
              }
              
              // ENHANCED: Validate state transitions to prevent invalid changes
              if (previousState && previousState !== state) {
                // Check for invalid state transitions
                const invalidTransitions = [
                  { from: 'declined', to: ['ringing', 'connecting', 'connected'], reason: 'Cannot revive declined call' },
                  { from: 'connected', to: ['ringing'], reason: 'Connected cannot go back to ringing' }
                ]
                
                const invalidTransition = invalidTransitions.find(t => 
                  t.from === previousState && t.to.includes(state)
                )
                
                if (invalidTransition) {
                  console.warn(`[CallModal] ⚠️ BLOCKED invalid state transition for ${participantId}: ${previousState} → ${state} (${invalidTransition.reason})`)
                  return // Skip this update
                }
              }
              
              updated.set(participantId, state as any)
              
              // Log state transitions for debugging
              if (previousState !== state) {
                console.log(`[CallModal] 🔄 Participant ${participantId} state: ${previousState} → ${state}`)
              }
              
              // Validate state transition logic
              if (previousState === 'declined' && state !== 'declined') {
                console.warn(`[CallModal] ⚠️ Invalid state transition: declined → ${state} for ${participantId}`)
              }
              if (previousState === 'connected' && state === 'ringing') {
                console.warn(`[CallModal] ⚠️ Invalid state transition: connected → ringing for ${participantId}`)
              }
            } else {
              console.warn(`[CallModal] ⚠️ Invalid participant state received: ${state} for ${participantId}`)
            }
          })
          
          // State consistency validation
          const allStates = Array.from(updated.values())
          const connectedCount = allStates.filter(s => s === 'connected').length
          const connectingCount = allStates.filter(s => s === 'connecting').length
          const ringingCount = allStates.filter(s => s === 'ringing').length
          
          console.log(`[CallModal] 📊 State summary: Connected: ${connectedCount}, Connecting: ${connectingCount}, Ringing: ${ringingCount}`)
          
          return updated
        })
        
        // CRITICAL: Ensure all participants in the server response are in our activeParticipants list
        setActiveParticipants(prev => {
          const existingIds = new Set(prev.map(p => p.id))
          
          // Get participant IDs from both participant states and allParticipants array
          const stateParticipantIds = Object.keys(participantStatesFromServer)
          const allParticipantIds = data.allParticipants || []
          const allServerParticipantIds = Array.from(new Set([...stateParticipantIds, ...allParticipantIds]))
          
          const missingParticipants = allServerParticipantIds.filter(id => !existingIds.has(id) && id !== session?.user?.id)
          
          if (missingParticipants.length > 0) {
            console.log('[CallModal] 🚀 Adding missing participants from server:', missingParticipants)
            
            // Performance optimization: Limit max participants for mesh networking
            const MAX_PARTICIPANTS = 8 // Recommend 8 max for good performance
            const totalParticipants = prev.length + missingParticipants.length
            
            if (totalParticipants > MAX_PARTICIPANTS) {
              console.warn(`[CallModal] ⚠️ Total participants (${totalParticipants}) exceeds recommended limit (${MAX_PARTICIPANTS})`)
            }
            
            // Try to get better participant data from conversation participants first
            const conversationParticipantMap = new Map(
              participants?.map(p => [p.id, p]) || []
            )
            
            const newParticipants = missingParticipants.map(id => {
              const conversationParticipant = conversationParticipantMap.get(id)
              if (conversationParticipant) {
                // Use existing conversation participant data
                return {
                  ...conversationParticipant,
                  participantStatus: (participantStatesFromServer[id] || 'ringing') as any,
                  isConnected: true
                }
              } else {
                // ENHANCED: Use createSafeParticipant for consistent fallback logic
                const fallbackParticipant = createSafeParticipant(null, id)
                return {
                  ...fallbackParticipant,
                  isConnected: true,
                  participantStatus: (participantStatesFromServer[id] || 'ringing') as any
                }
              }
            })
            
            console.log('[CallModal] 📋 New participants with enhanced data:', newParticipants.map(p => `${p.name} (${p.id})`))
            return [...prev, ...newParticipants]
          }
          return prev
        })
      }
      
      // For outgoing calls, check if someone accepted
      if (data.accepted) {
        console.log('[CallModal] Call accepted by participant:', data.participantId)
        console.log('[CallModal] Call status from server:', data.callStatus)
        console.log('[CallModal] Participant count:', data.participantCount)
        
        // Stop outgoing ringing sound immediately
        stopOutgoingRingingSound()
        
        // CRITICAL FIX: Force stop GlobalCallManager ringing for callers when someone accepts
        if (!isIncoming && session?.user?.id) {
          console.log('[CallModal] 📢 Forcing GlobalCallManager to stop caller ringing via browser event')
          // Use browser events to directly communicate with GlobalCallManager
          const stopRingingEvent = new CustomEvent('stopGlobalCallManagerRinging', {
            detail: {
              callId: callId,
              reason: 'participant_accepted',
              callerId: session.user.id
            }
          })
          window.dispatchEvent(stopRingingEvent)
        }
        
        // CRITICAL FIX: Only process state transitions for current user when they actually accept
        const currentUserId = session?.user?.id
        const currentUserServerState = participantStatesFromServer[currentUserId || '']
        const hasCurrentUserAccepted = userHasAcceptedCall.current

        // Only transition state if CURRENT USER has accepted or is the caller
        const shouldTransitionCurrentUser = hasCurrentUserAccepted ||
                                          (!isIncoming && currentUserId) || // Caller auto-accepts outgoing calls
                                          (currentUserServerState === 'connecting' || currentUserServerState === 'connected')

        if (shouldTransitionCurrentUser && (callState.status === 'ringing' || callState.status === 'dialing')) {
          console.log('[CallModal] 🚀 Current user accepted - transitioning from', callState.status, 'to connecting state')
          console.log('[CallModal] 🔍 Transition context:', {
            hasAccepted: hasCurrentUserAccepted,
            isIncoming,
            serverState: currentUserServerState,
            userId: currentUserId
          })

          setCallState(prev => ({
            ...prev,
            status: 'connecting',
            connectedParticipants: Math.max(prev.connectedParticipants, 1)
          }))

          // Update current user's participant state
          if (currentUserId) {
            setParticipantConnectionStates(prev => {
              const updated = new Map(prev)
              updated.set(currentUserId, 'connecting')
              return updated
            })
          }
        } else {
          console.log('[CallModal] 🚫 Skipping state transition - current user has not accepted:', {
            hasAccepted: hasCurrentUserAccepted,
            isIncoming,
            serverState: currentUserServerState,
            callState: callState.status
          })
        }

        // CRITICAL FIX: Only initialize WebRTC if current user has actually accepted
        const currentUserAccepted = shouldTransitionCurrentUser

        if (currentUserAccepted && !webrtcServiceRef.current) {
          console.log('[CallModal] 🚀 WebRTC initialization - current user accepted or is caller')

          // Initialize WebRTC asynchronously
          const initializeWebRTC = async () => {
            try {
              const WebRTCServiceModule = await import('@/lib/webrtc')
              const WebRTCService = WebRTCServiceModule.WebRTCService
              const service = new WebRTCService(socket, session?.user?.id || '')
              webrtcServiceRef.current = service

              console.log('[CallModal] 📱 Initializing WebRTC call...')
              const stream = await service.initializeCall(callId, callType === 'video')
              localStreamRef.current = stream
              service.setLocalStream(stream)

              console.log('[CallModal] ✅ WebRTC service initialized successfully')
            } catch (error) {
              console.error('[CallModal] ❌ Failed to initialize WebRTC:', error)

              // ENHANCED: Provide user-friendly error handling
              const errorObj = error as Error
              let userMessage = 'Failed to start call. '
              if (errorObj.name === 'MediaAccessError' || errorObj.name === 'NotAllowedError') {
                userMessage += 'Please allow camera and microphone permissions and try again.'
              } else if (errorObj.name === 'NoAudioTrackError') {
                userMessage += 'No microphone detected. Please check your audio device.'
              } else if (errorObj.name === 'NotFoundError') {
                userMessage += 'No camera or microphone found. Please check your devices.'
              } else if (errorObj.name === 'NotReadableError') {
                userMessage += 'Camera or microphone is in use by another application.'
              } else {
                userMessage += 'Please check your camera and microphone settings.'
              }

              // Set call state to error and show user-friendly message
              setCallState(prev => ({ ...prev, status: 'ended' }))

              // TODO: Show user notification or error message
              console.error('[CallModal] User-friendly error:', userMessage)

              // Automatically close the call modal after showing error
              setTimeout(() => {
                console.log('[CallModal] Auto-closing call due to initialization error')
                onClose()
              }, 3000)
            }
          }

          initializeWebRTC()
        }

        // State will also be updated via call_state_update event from server
        console.log('[CallModal] Call accepted, caller transitioned to connecting state')
      } else if (!data.accepted) {
        console.log('[CallModal] Call declined by participant:', data.participantId)
        // CRITICAL: Stop ringing immediately when call is declined
        stopOutgoingRingingSound()
        
        // For 1-on-1 calls, end the call immediately if declined
        if (!isGroupCall) {
          console.log('[CallModal] 1-on-1 call declined, ending call')
          // Immediately cleanup resources when call is declined
          cleanupCallResources(true)
          setCallState(prev => ({ ...prev, status: 'disconnected' }))
          setTimeout(() => onClose(), 1500)
        } else {
          console.log('[CallModal] Group call - removing declined participant:', data.participantId)
          // Remove the declined participant from active participants
          setActiveParticipants(prev => 
            prev.filter(participant => participant.id !== data.participantId)
          )
          
          // Remove their stream if any
          setRemoteStreams(prev => {
            const newStreams = new Map(prev)
            newStreams.delete(data.participantId)
            return newStreams
          })
          
          // Clean up WebRTC connection for this participant
          if (webrtcServiceRef.current) {
            webrtcServiceRef.current.removePeerConnection(data.participantId)
          }
        }
      }
      }) // Close processEventWithLock
    }

    // Listen for participant joined events
    const handleParticipantJoined = (data: {
      callId: string
      participantId: string
      participantCount: number
      participantData?: {
        id: string
        name: string
        username: string
        avatar: string | null
      }
    }) => {
      console.log('[CallModal] Participant joined event received:', data)
      console.log('[CallModal] Our callId:', callId, 'Event callId:', data.callId)
      console.log('[CallModal] Our userId:', session?.user?.id, 'Event participantId:', data.participantId)
      
      // Only handle if this is for our call
      if (data.callId !== callId) {
        console.log('[CallModal] Ignoring participant_joined for different call')
        return
      }
      
      console.log('[CallModal] Processing participant joined for our call')
      console.log('[CallModal] Current call state:', callState.status)
      console.log('[CallModal] Total participants now:', data.participantCount)
      
      // Update participant count but don't change state - let server control state
      setCallState(prev => ({ 
        ...prev, 
        connectedParticipants: data.participantCount
      }))

      // Add new participant to activeParticipants if not already present
      // ENHANCED: Include ALL participants, even if it's ourselves (for complete participant sync)
      setActiveParticipants(prev => {
        // Check if participant already exists to prevent duplicates
        const existingParticipantIndex = prev.findIndex(p => p.id === data.participantId)
        if (existingParticipantIndex !== -1) {
          // ENHANCED: More intelligent participant data updating
          const existingParticipant = prev[existingParticipantIndex]

          // Define criteria for when to update participant data
          const shouldUpdate = data.participantData && (
            // Update if current name is a fallback pattern
            existingParticipant.name.match(/^User[\s-][A-Z0-9]{6,8}$/i) ||
            // Update if no current name
            !existingParticipant.name ||
            // Update if we have a better name (not another fallback)
            (data.participantData.name &&
             !data.participantData.name.match(/^User[\s-][a-z0-9]{6,8}$/i) &&
             data.participantData.name !== existingParticipant.name) ||
            // Update if we previously had no avatar but now have one
            (!existingParticipant.avatar && data.participantData.avatar) ||
            // Update if username is better
            (existingParticipant.username.startsWith('user') &&
             data.participantData.username &&
             !data.participantData.username.startsWith('user'))
          )

          if (shouldUpdate) {
            console.log('[CallModal] 🔄 Updating existing participant with enhanced data:', {
              id: data.participantId,
              oldName: existingParticipant.name,
              newName: data.participantData?.name,
              oldUsername: existingParticipant.username,
              newUsername: data.participantData?.username,
              hasNewAvatar: !!data.participantData?.avatar && !existingParticipant.avatar
            })

            const updatedParticipants = [...prev]
            // Use createSafeParticipant to ensure consistent validation
            const updatedParticipant = createSafeParticipant(data.participantData, data.participantId)
            // Preserve status and connection state
            updatedParticipant.participantStatus = existingParticipant.participantStatus
            updatedParticipant.isConnected = existingParticipant.isConnected
            updatedParticipant.isMuted = existingParticipant.isMuted
            updatedParticipant.isCameraOff = existingParticipant.isCameraOff

            updatedParticipants[existingParticipantIndex] = updatedParticipant
            return updatedParticipants
          } else {
            console.log('[CallModal] Participant already in list with optimal data, skipping update:', {
              id: data.participantId,
              currentName: existingParticipant.name,
              receivedName: data.participantData?.name
            })
            return prev
          }
        }
        
        console.log('[CallModal] Adding new participant to active list:', data.participantId)

        // ENHANCED: Use validation and safe participant creation
        try {
          const newParticipant = createSafeParticipant(data.participantData, data.participantId)
          newParticipant.isConnected = true
          newParticipant.participantStatus = data.participantId === session?.user?.id ? 'connecting' : 'connecting'

          console.log('[CallModal] ✅ Successfully created validated participant:', newParticipant.name)

          const updatedParticipants = [...prev, newParticipant]
          console.log('[CallModal] Updated participant list:', updatedParticipants.map(p => `${p.name} (${p.id})`))
          return updatedParticipants
        } catch (error) {
          console.error('[CallModal] ❌ Failed to create participant:', error)
          return prev
        }
      })
      
      console.log('[CallModal] Participant joined, waiting for server state updates...')
      
      // ENHANCED: For group calls, ensure full mesh connectivity by initiating WebRTC connections
      if (webrtcServiceRef.current && data.participantId !== session?.user?.id) {
        
        // For group calls, we need to ensure all participants connect to each other
        // Not just rely on the ID comparison mesh logic
        if (isGroupCall) {
          console.log('[CallModal] 🔀 GROUP CALL: Ensuring full mesh connectivity with new participant:', data.participantId)
          
          // Always try to establish connection in group calls, regardless of ID comparison
          const existingConnection = webrtcServiceRef.current.getActivePeerConnections()
          const hasConnectionToParticipant = Object.keys(existingConnection).includes(data.participantId)
          
          if (!hasConnectionToParticipant) {
            console.log('[CallModal] 🚀 Creating WebRTC connection for group call participant:', data.participantId)
            try {
              webrtcServiceRef.current.createOffer(data.participantId).catch(error => {
                console.error('[CallModal] Failed to create offer for group participant:', data.participantId, error)

                // Enhanced error handling: Check if it's a closed connection error
                if (error.message && error.message.includes('closed')) {
                  console.log('[CallModal] 🔄 Connection closed error detected, will retry after delay')

                  // Retry after a short delay
                  setTimeout(async () => {
                    if (webrtcServiceRef.current?.hasLocalStream?.()) {
                      try {
                        console.log('[CallModal] 🔄 Retrying offer creation for group participant:', data.participantId)
                        await webrtcServiceRef.current.createOffer(data.participantId)
                        console.log('[CallModal] ✅ Retry successful for:', data.participantId)
                      } catch (retryError) {
                        console.error('[CallModal] ❌ Retry also failed for:', data.participantId, retryError)
                      }
                    }
                  }, 1000) // 1 second delay
                }
              })
            } catch (error) {
              console.error('[CallModal] Error initiating group call connection:', error)
            }
          } else {
            console.log('[CallModal] ✅ Connection already exists for group participant:', data.participantId)
          }
          return // Skip the regular mesh logic for group calls
        }
        
        // Regular 1-on-1 call logic with ID comparison
        console.log('[CallModal] Initiating WebRTC offer to:', data.participantId)
        console.log('[CallModal] WebRTC service callId:', (webrtcServiceRef.current as any)?.callId)
        console.log('[CallModal] Our callId:', callId)
        
        // ENHANCED: Use robust mesh networking - create offers based on participant ID comparison
        // This prevents duplicate connections and ensures proper peer-to-peer mesh
        const shouldCreateOffer = session?.user?.id && session.user.id > data.participantId;
        
        console.log('[CallModal] Offer creation decision:', {
          ourUserId: session?.user?.id,
          theirUserId: data.participantId,
          isGroupCall,
          shouldCreateOffer,
          reason: shouldCreateOffer ? 'Our ID is higher - we create offer' : 'Their ID is higher - they will create offer'
        });
        
        if (shouldCreateOffer && !offerCreationAttempts.has(data.participantId)) {
          // Mark that we're attempting to create offer for this participant
          setOfferCreationAttempts(prev => new Set([...Array.from(prev), data.participantId]))
          
          // ENHANCED: Wait for WebRTC service to be fully ready before creating offer
          const createOfferWhenReady = async () => {
            console.log('[CallModal] Preparing to create WebRTC offer to participant:', data.participantId)
            
            // Wait for WebRTC service to be available and have a local stream
            let attempts = 0
            const maxAttempts = 60 // 3 seconds max wait
            
            while (attempts < maxAttempts) {
              if (webrtcServiceRef.current?.hasLocalStream?.()) {
                console.log('[CallModal] ✅ WebRTC service ready, creating offer')
                try {
                  await webrtcServiceRef.current.createOffer(data.participantId)
                  return // Success
                } catch (error) {
                  console.error('[CallModal] ❌ Failed to create offer for participant:', data.participantId, error)
                  // Remove from attempts so it can be retried
                  setOfferCreationAttempts(prev => {
                    const newSet = new Set(prev)
                    newSet.delete(data.participantId)
                    return newSet
                  })
                  return // Exit on error
                }
              }
              
              console.log(`[CallModal] ⏳ WebRTC service not ready yet (attempt ${attempts + 1}/${maxAttempts}), waiting...`)
              await new Promise(resolve => setTimeout(resolve, 50))
              attempts++
            }
            
            console.error('[CallModal] ❌ Timeout waiting for WebRTC service to be ready')
            // Remove from attempts so it can be retried
            setOfferCreationAttempts(prev => {
              const newSet = new Set(prev)
              newSet.delete(data.participantId)
              return newSet
            })
          }
          
          // Start the async offer creation process
          createOfferWhenReady()
        } else if (offerCreationAttempts.has(data.participantId)) {
          console.log('[CallModal] Offer creation already attempted for participant:', data.participantId)
        } else {
          console.log('[CallModal] Waiting for offer from participant with higher ID:', data.participantId)
          
          // FAILSAFE: If no offer is received within 10 seconds, force create one
          setTimeout(async () => {
            if (webrtcServiceRef.current?.hasLocalStream?.() && callState.status !== 'connected' && !offerCreationAttempts.has(data.participantId)) {
              console.log('[CallModal] 🚨 FAILSAFE: No offer received, creating fallback offer')
              setOfferCreationAttempts(prev => new Set([...Array.from(prev), data.participantId]))
              try {
                await webrtcServiceRef.current.createOffer(data.participantId)
              } catch (error) {
                console.error('[CallModal] Failsafe offer creation failed:', error)
                setOfferCreationAttempts(prev => {
                  const newSet = new Set(prev)
                  newSet.delete(data.participantId)
                  return newSet
                })
              }
            }
          }, 10000)
        }
      } else {
        console.log('[CallModal] Not creating offer - either no WebRTC service or this is our own join event')
        console.log('[CallModal] WebRTC available:', !!webrtcServiceRef.current)
        console.log('[CallModal] Participant is us:', data.participantId === session?.user?.id)
      }
    }

    // Listen for participant left events
    const handleParticipantLeft = (data: {
      callId: string
      participantId: string
      participantCount: number
    }) => {
      console.log('[CallModal] Participant left:', data.participantId)
      console.log('[CallModal] Remaining participants:', data.participantCount)
      
      // Only handle if it's for our call
      if (data.callId !== callId) {
        console.log('[CallModal] Ignoring participant_left for different call')
        return
      }
      
      setCallState(prev => ({ 
        ...prev, 
        connectedParticipants: data.participantCount
      }))
      
      // Clean up WebRTC connection for this participant
      if (webrtcServiceRef.current) {
        webrtcServiceRef.current.removePeerConnection(data.participantId)
      }
      
      // Remove remote stream
      setRemoteStreams(prev => {
        const newStreams = new Map(prev)
        newStreams.delete(data.participantId)
        return newStreams
      })
      
      // Remove participant from active participants list
      setActiveParticipants(prev => 
        prev.filter(participant => participant.id !== data.participantId)
      )
      
      // If this is a 1-on-1 call and the other participant left, end the call
      // ENHANCED FIX: Add extended delay during initialization and WebRTC setup
      if (!isGroupCall && data.participantCount < 2 && data.participantId !== session?.user?.id) {
        console.log('[CallModal] ⚠️ Participant count dropped in 1-on-1 call - waiting before ending...')
        console.log('[CallModal] Current state:', callState.status, 'Participant count:', data.participantCount)
        console.log('[CallModal] Initialization status:', isInitializing, 'WebRTC status:', !!webrtcServiceRef.current)
        
        // Use longer delay during initialization to prevent premature termination
        const delayTime = isInitializing ? 10000 : 3000 // 10 seconds during init, 3 seconds normally
        console.log('[CallModal] Using delay of', delayTime, 'ms for reconnection attempt')
        
        setTimeout(() => {
          // Re-check conditions after delay in case participant reconnected
          console.log('[CallModal] Re-checking call status after participant left delay')
          console.log('[CallModal] Current call state:', callState.status)
          console.log('[CallModal] Still initializing:', isInitializing)
          console.log('[CallModal] WebRTC established:', !!webrtcServiceRef.current)
          
          // Only end if call is still active and we're NOT in initialization phase
          if (!isInitializing && (callState.status === 'connected' || callState.status === 'connecting')) {
            console.log('[CallModal] 🔴 Other participant left 1-on-1 call, ending call after verification delay')
            cleanupCallResources(true)
            setCallState(prev => ({ ...prev, status: 'disconnected' }))
            setTimeout(() => onClose(), 1500)
          } else {
            console.log('[CallModal] ✅ Call preserved - still initializing or call state changed during delay')
            console.log('[CallModal] Not ending call due to:', isInitializing ? 'still initializing' : 'call state changed')
          }
        }, delayTime)
      }
    }

    // Listen for call ended events
    const handleCallEnded = (data?: { callId?: string; reason?: string }) => {
      console.log('\n🚫 [CallModal] CALL_ENDED EVENT RECEIVED:', data)
      console.log('[CallModal] Our call ID:', callId)
      console.log('[CallModal] Event call ID:', data?.callId)
      console.log('[CallModal] Session user ID:', session?.user?.id)
      
      // Only handle if it's for our call or no specific call ID (global end)
      if (data?.callId && data.callId !== callId) {
        console.log('[CallModal] ❌ Ignoring call_ended for different call')
        return
      }
      
      console.log('[CallModal] ✅ Processing call_ended for our call')
      
      // Immediately stop ringing sounds first
      stopOutgoingRingingSound()
      
      // Immediately cleanup all resources to stop ringing and release microphone
      try {
        cleanupCallResources(true)
        console.log('[CallModal] ✅ Resources cleaned up after call_ended')
      } catch (error) {
        console.error('[CallModal] Error during cleanup:', error)
      }
      
      // Update state and close
      try {
        setCallState(prev => ({ ...prev, status: 'disconnected' }))
        console.log('[CallModal] ✅ State set to disconnected')
        
        // Delayed close to allow UI updates
        setTimeout(() => {
          try {
            onClose()
            console.log('[CallModal] ✅ Modal closed')
            
            // Refresh/reload the app after call ends - for ALL participants
            setTimeout(() => {
              console.log('[CallModal] Refreshing app after call_ended event')
              window.location.reload()
            }, 500)
          } catch (closeError) {
            console.error('[CallModal] Error closing modal:', closeError)
          }
        }, 1000) // Reduced delay
      } catch (error) {
        console.error('[CallModal] Error updating state:', error)
      }
    }

    // Listen for call timeout
    const handleCallTimeout = (data?: { callId?: string }) => {
      console.log('[CallModal] Call timeout event received:', data)
      
      // Only handle if it's for our call
      if (data?.callId && data.callId !== callId) {
        console.log('[CallModal] Ignoring call_timeout for different call')
        return
      }
      
      // Immediately cleanup all resources
      cleanupCallResources(true)
      
      setCallState(prev => ({ ...prev, status: 'disconnected' }))
      setTimeout(() => {
        onClose()
        // Refresh/reload the app after call timeout - for ALL participants
        setTimeout(() => {
          console.log('[CallModal] Refreshing app after call timeout')
          window.location.reload()
        }, 500)
      }, 1500)
    }

    // ENHANCED: Listen for WebRTC stream ready events with strict auto-join prevention
    const handleWebRTCStreamReady = async (data: {
      callId: string
      participantId: string
      streamId: string
    }) => {
      console.log('[CallModal] 🔍 WebRTC stream ready for participant:', data.participantId)
      console.log('[CallModal] 🔍 Our callId:', callId, 'Event callId:', data.callId)
      console.log('[CallModal] 🔍 Our user ID:', session?.user?.id)
      console.log('[CallModal] 🔍 Current call state:', callState.status)
      console.log('[CallModal] 🔍 Current participant states:', Object.fromEntries(participantConnectionStates))
      
      // Only handle if this is for our call
      if (data.callId !== callId) {
        console.log('[CallModal] ❌ Ignoring webrtc_stream_ready for different call')
        return
      }
      
      // CRITICAL: Don't try to get remote stream for ourselves
      if (data.participantId === session?.user?.id) {
        console.log('[CallModal] ✅ Ignoring webrtc_stream_ready for our own stream (not a remote stream)')
        console.log('[CallModal] 🆔 Session user ID:', session?.user?.id)
        console.log('[CallModal] 🆔 Event participant ID:', data.participantId)
        return
      }

      // 🚨 CRITICAL AUTO-JOIN FIX: Only process stream ready events if current user has explicitly accepted
      const hasUserAccepted = userHasAcceptedCall.current
      const currentUserId = session?.user?.id
      
      // ENHANCED: Better detection of who is the actual caller in group calls
      // For group calls, we need to check if this user initiated the call, not just if it's "not incoming"
      const isActualCaller = participants?.some(p => p.id === currentUserId) && 
                           callState.status !== 'ringing' && 
                           !isIncoming
      
      // CRITICAL FIX: For incoming calls, ALWAYS require explicit user acceptance
      // For outgoing calls, only allow if user has accepted OR they are confirmed as the actual caller
      // ENHANCED: Also check that current user is not in 'ringing' state for group calls
      const currentUserState = currentUserId ? participantConnectionStates.get(currentUserId) : undefined
      const isCurrentUserRinging = currentUserState === 'ringing' || callState.status === 'ringing'
      
      const shouldAllowStreamProcessing = hasUserAccepted || 
                                        (isActualCaller && !isCurrentUserRinging)

      if (!shouldAllowStreamProcessing) {
        console.log('[CallModal] 🚨 AUTO-JOIN PREVENTION: Blocking webrtc_stream_ready processing - user has not accepted call')
        console.log('[CallModal] 🚨 User acceptance status:', {
          hasAccepted: hasUserAccepted,
          isIncoming: isIncoming,
          isActualCaller: isActualCaller,
          callState: callState.status,
          currentUserState: currentUserState,
          isCurrentUserRinging: isCurrentUserRinging,
          currentUserId: currentUserId,
          remoteParticipant: data.participantId,
          participantsList: participants?.map(p => ({ id: p.id, name: p.name }))
        })
        console.log('[CallModal] 🚨 This prevents auto-joining when other participants connect')
        return
      }
      
      console.log('[CallModal] ✅ Processing REMOTE stream ready event')
      console.log('[CallModal] 🆔 Our session ID:', session?.user?.id)
      console.log('[CallModal] 🆔 Remote participant ID:', data.participantId)
      console.log('[CallModal] 🔍 Stream data:', {
        callId: data.callId,
        participantId: data.participantId,
        streamId: data.streamId,
        hasAudio: (data as any).hasAudio,
        hasVideo: (data as any).hasVideo
      })
      
      console.log('[CallModal] 🚀 INITIATING PEER CONNECTION for remote participant:', data.participantId)
      console.log('[CallModal] 🚀 WebRTC service available:', !!webrtcServiceRef.current)
      
      // Removed auto-transition test mode logic that was causing auto-join issues
      
      console.log('[CallModal] 🎥 Processing webrtc_stream_ready for REMOTE participant:', data.participantId)
      
      if (webrtcServiceRef.current) {
        // CRITICAL FIX: Initiate peer connection with remote participant if not already connected
        const activePeerConnections = webrtcServiceRef.current.getActivePeerConnections()
        const hasConnectionToParticipant = Object.keys(activePeerConnections).includes(data.participantId)
        
        console.log('[CallModal] 🔗 Active peer connections:', Object.keys(activePeerConnections))
        console.log('[CallModal] 🔗 Has connection to', data.participantId, ':', hasConnectionToParticipant)
        
        if (!hasConnectionToParticipant) {
          console.log('[CallModal] 🚀 Creating peer connection to', data.participantId)

          // ENHANCED: Check if this is a group call to enable optimization - WITH DUPLICATE PREVENTION
          const isGroupCall = activeParticipants.length > 2
          const participantKey = `${data.participantId}-${callId}`

          if (isGroupCall &&
              webrtcServiceRef.current?.initializeGroupCallConnections &&
              !groupCallConnectionAttempts.current.has(participantKey)) {

            console.log('[CallModal] 🎯 Group call detected - using optimized connection setup')

            // Mark this participant as attempted to prevent duplicates
            groupCallConnectionAttempts.current.add(participantKey)

            try {
              await webrtcServiceRef.current.initializeGroupCallConnections([data.participantId])
              console.log('[CallModal] ✅ Group call connection created successfully')
            } catch (error) {
              console.error('[CallModal] ❌ Group call connection failed, falling back to direct offer:', error)

              // Remove from attempts on failure so it can be retried
              groupCallConnectionAttempts.current.delete(participantKey)

              // Fallback to direct offer
              try {
                await webrtcServiceRef.current.safeCreateOffer(data.participantId)
                console.log('[CallModal] ✅ Fallback offer created successfully')
              } catch (fallbackError) {
                console.error('[CallModal] ❌ Fallback offer also failed:', fallbackError)
              }
            }
          } else if (isGroupCall && groupCallConnectionAttempts.current.has(participantKey)) {
            console.log('[CallModal] 🔄 Group call connection already attempted for:', data.participantId)
          } else {
            try {
              // Use the safe offer creation method that waits for local stream
              await webrtcServiceRef.current.safeCreateOffer(data.participantId)
              console.log('[CallModal] ✅ Peer connection offer created successfully')
            } catch (error) {
              console.error('[CallModal] ❌ Failed to create offer:', error)

              // If initial offer fails, schedule a retry
              setTimeout(async () => {
                if (webrtcServiceRef.current?.hasLocalStream?.()) {
                  try {
                    console.log('[CallModal] 🔄 Retrying offer creation after delay')
                    await webrtcServiceRef.current.safeCreateOffer(data.participantId)
                    console.log('[CallModal] ✅ Delayed offer created successfully')
                  } catch (retryError) {
                    console.error('[CallModal] ❌ Delayed offer creation also failed:', retryError)
                  }
                }
              }, 1000)
            }
          }
        }
        const remoteStream = webrtcServiceRef.current.getRemoteStream(data.participantId)
        console.log('[CallModal] Retrieved remote stream for', data.participantId, ':', !!remoteStream)
        
        if (remoteStream && typeof remoteStream.getTracks === 'function') {
          console.log('[CallModal] Remote stream tracks:', remoteStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled })))
          setRemoteStreams(prev => {
            const newStreams = new Map(prev)
            newStreams.set(data.participantId, remoteStream)
            console.log('[CallModal] Updated remote streams map, now has:', Array.from(newStreams.keys()))
            return newStreams
          })
          
          // VideoGrid will handle the video elements
          console.log('[CallModal] ✅ Remote stream added to state for VideoGrid')
        } else {
          console.log('[CallModal] ⏰ No remote stream found yet for participant:', data.participantId, '- WebRTC connection may still be establishing')

          // ENHANCED: Retry stream retrieval with exponential backoff
          let retryCount = 0
          const maxRetries = 5

          const retryStreamRetrieval = () => {
            retryCount++
            const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000) // Cap at 5 seconds

            setTimeout(() => {
              if (webrtcServiceRef.current && retryCount <= maxRetries) {
                const retryStream = webrtcServiceRef.current.getRemoteStream(data.participantId)
                console.log(`[CallModal] 🔄 Retry ${retryCount}/${maxRetries} for stream from:`, data.participantId, '- Found:', !!retryStream)

                if (retryStream && typeof retryStream.getTracks === 'function') {
                  console.log('[CallModal] ✅ Remote stream found on retry:', retryStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, readyState: t.readyState })))
                  setRemoteStreams(prev => {
                    const newStreams = new Map(prev)
                    newStreams.set(data.participantId, retryStream)
                    console.log('[CallModal] ✅ Added delayed remote stream for:', data.participantId)
                    return newStreams
                  })
                } else if (retryCount < maxRetries) {
                  console.log('[CallModal] ⏰ Stream still not ready, scheduling retry', retryCount + 1)
                  retryStreamRetrieval()
                } else {
                  console.warn('[CallModal] ❌ Max retries reached for remote stream from:', data.participantId)
                }
              }
            }, delay)
          }

          retryStreamRetrieval()
        }
        
        // CRITICAL FIX: When participant stream is ready, update call state to connected if needed
        if (callState.status === 'connecting') {
          console.log('[CallModal] 🚀 Participant stream ready - updating call to connected state')
          setCallState(prev => ({ ...prev, status: 'connected' }))
          
          // Ensure ringing stops immediately
          stopOutgoingRingingSound()
          
          // Notify server of state change
          if (socket && callId) {
            socket.emit('force_call_connected', { callId })
          }
        }
      } else {
        console.warn('[CallModal] ❌ No WebRTC service available for stream ready event')
      }
    }

    // Note: WebRTC signaling events are handled directly by the WebRTC service
    // which has its own socket listeners for webrtc_offer, webrtc_answer, and webrtc_ice_candidate


    // Handle call state updates for synchronization
    const handleCallStateUpdate = (data: {
      callId: string
      status: string
      participantCount: number
      connectedParticipants?: number
      sequenceNumber?: number
      // PHASE 1 FIX: Removed authoritative property
      serverTimestamp?: number
      callStartTime?: number
      participantStates?: Record<string, string>
    }) => {
      // CRITICAL: Handle server-provided call start time as authoritative source
      if (data.callStartTime) {
        const hadServerTime = !!serverCallStartTimeRef.current

        // Always use server time as authoritative, even if we already have one
        if (!hadServerTime || data.callStartTime < serverCallStartTimeRef.current!) {
          const oldServerTime = serverCallStartTimeRef.current
          serverCallStartTimeRef.current = data.callStartTime
          console.log('[CallModal] ⏰ Server call start time updated:', {
            new: new Date(data.callStartTime).toISOString(),
            old: oldServerTime ? new Date(oldServerTime).toISOString() : 'none',
            isEarlier: !oldServerTime || data.callStartTime < oldServerTime
          })

          // Immediately recalculate duration for connected calls
          if (callState.status === 'connected') {
            const elapsed = Math.max(0, Math.floor((Date.now() - data.callStartTime) / 1000))
            setCallState(prev => ({ ...prev, duration: elapsed }))
            console.log('[CallModal] ⏰ Duration immediately synchronized to server time:', elapsed, 'seconds')
          }
        }
      }

      // Create unique key for this update
      const updateKey = `${data.callId}-${data.status}-${data.participantCount}-${Date.now()}`
      
      // CRITICAL: Prevent duplicate processing using timestamps 
      const timeSinceLastUpdate = Date.now() - parseInt(lastStateUpdateRef.current.split('-').pop() || '0')
      const isSameUpdate = lastStateUpdateRef.current.includes(`${data.callId}-${data.status}`)
      
      if (isSameUpdate && timeSinceLastUpdate < 50) { // 50ms deduplication window for better responsiveness
        console.log('[CallModal] 🚫 Ignoring duplicate CALL_STATE_UPDATE within 100ms:', data.status)
        return
      }
      
      lastStateUpdateRef.current = updateKey
      
      console.log(`[CallModal] Data:`, data)

      if (data.callId !== callId) {
        console.log('[CallModal] ❌ Ignoring state update for different call:', data.callId, 'vs', callId)
        return
      }

      // PHASE 1 FIX: Removed complex authoritative state logic
      // Now using simple server state as single source of truth

      // RACE CONDITION PREVENTION: Add event sequence validation
      if ((data as any).eventSequence && (data as any).eventType === 'call_state_update') {
        console.log('[CallModal] 📧 Processing call_state_update event with sequence:', (data as any).eventSequence)
      }
      
      // ENHANCED CLIENT STATE GUARD: Prevent non-accepting users from transitioning to connecting/connected
      const hasUserAccepted = userHasAcceptedCall.current
      const currentUserId = session?.user?.id
      const blockedStates = ['connecting', 'connected', 'in_call']
      
      // ENHANCED: Protect both incoming and outgoing calls from unauthorized state transitions
      if (!hasUserAccepted && blockedStates.includes(data.status)) {
        // For incoming calls: always block if user hasn't accepted
        // For outgoing calls: block 'connected' state if user hasn't explicitly accepted locally
        const shouldBlock = isIncoming || 
                           (data.status === 'connected' && !hasUserAccepted) ||
                           (data.status === 'connecting' && isIncoming && !hasUserAccepted)
        
        if (shouldBlock) {
          console.log(`[CallModal] 🚨 ENHANCED STATE GUARD: Blocking ${data.status} for non-accepting user`)
          console.log(`[CallModal] 🚫 User details: {hasAccepted: ${hasUserAccepted}, isIncoming: ${isIncoming}, userId: ${currentUserId}, status: ${data.status}}`)
          console.log(`[CallModal] 📋 Block reason: ${isIncoming ? 'incoming call not accepted' : 'connected state without acceptance'}`)
          
          // Additional validation: Check if this state update includes participant states
          if ((data as any).participantStates && currentUserId) {
            const currentUserState = (data as any).participantStates[currentUserId]
            console.log(`[CallModal] 🔍 Current user state in server data: ${currentUserState}`)
            
            // Double-check: Even if server says user is connected, block it if user hasn't explicitly accepted locally
            if ((currentUserState === 'connected' || currentUserState === 'connecting') && !hasUserAccepted && isIncoming) {
              console.log(`[CallModal] 🚨 CRITICAL BLOCK: Server reports user as ${currentUserState} but local state shows not accepted!`)
              console.log(`[CallModal] 🚨 This indicates a server-side state sync issue - preventing auto-join`)
            }
          }
          
          return // Block the state update completely
        }
      }
      
      // Additional safeguard: Log any suspicious state transitions
      if (data.status === 'connected' && callState.status === 'ringing' && !hasUserAccepted && isIncoming) {
        console.log(`[CallModal] ⚠️ SUSPICIOUS STATE TRANSITION: Direct ringing->connected without user acceptance`)
        console.log(`[CallModal] ⚠️ This may indicate a server-side bug. Blocking transition.`)
        return
      }

      // CRITICAL: Group call auto-answer protection - check participant states
      if (isIncoming && !hasUserAccepted && (data as any).participantStates && currentUserId) {
        const participantStates = (data as any).participantStates
        const currentUserServerState = participantStates[currentUserId]

        // If server thinks we're connecting/connected but we haven't accepted, force override
        if (currentUserServerState && currentUserServerState !== 'ringing') {
          console.log(`[CallModal] 🚨 GROUP CALL AUTO-ANSWER PROTECTION: Server state=${currentUserServerState}, local acceptance=${hasUserAccepted}`)
          console.log(`[CallModal] 📊 Participant states from server:`, participantStates)
          console.log(`[CallModal] 🛡️ FORCING current user state to 'ringing' to prevent auto-answer UI`)

          // Create corrected data to prevent auto-answer UI display
          const correctedParticipantStates = {
            ...participantStates,
            [currentUserId]: 'ringing'  // Force current user to ringing state
          }

          // Update the data object that will be processed
          ;(data as any).participantStates = correctedParticipantStates
          console.log(`[CallModal] ✅ Corrected participant states - current user forced to 'ringing'`)
        }
      }
      
      console.log(`[CallModal] Current state: ${callState.status} -> New state: ${data.status}`)
      
      // ENHANCED: Prevent duplicate state updates with better logic
      if (callState.status === data.status) {
        console.log('[CallModal] ✅ State already', data.status, '- ignoring duplicate update')
        return
      }
      
      // Prevent invalid state transitions - be more strict
      if (callState.status === 'connected' && (data.status === 'connecting' || data.status === 'ringing')) {
        console.log('[CallModal] ❌ Ignoring invalid backward transition:', callState.status, '->', data.status)
        return
      }
      
      // Also prevent going from disconnected back to earlier states unless it's a new call
      if (callState.status === 'disconnected' && data.status !== 'disconnected') {
        console.log('[CallModal] ❌ Ignoring transition from disconnected to', data.status, '- possible stale event')
        return
      }
      
      // CRITICAL: Stop ringing sound immediately on ANY state change away from ringing/dialing
      if ((callState.status === 'ringing' || callState.status === 'dialing') && 
          (data.status !== 'ringing' && data.status !== 'dialing')) {
        console.log('[CallModal] 🔇 FORCE STOPPING ringing due to state change:', callState.status, '->', data.status)
        stopOutgoingRingingSound()
      }
      
      // CRITICAL FIX: Update call state based on CURRENT USER's state, not global call state
      setCallState(prev => {
        const hasUserAccepted = userHasAcceptedCall.current
        const currentUserId = session?.user?.id
        
        // Determine the current user's individual state from server data
        let userSpecificStatus = data.status as CallState['status']
        
        // If server provides participant states, use current user's specific state
        if ((data as any).participantStates && currentUserId) {
          const currentUserServerState = (data as any).participantStates[currentUserId]
          console.log(`[CallModal] 🔍 Current user server state: ${currentUserServerState}, hasAccepted: ${hasUserAccepted}`)
          
          // Apply user acceptance logic to determine appropriate status
          if (currentUserServerState === 'connected' && hasUserAccepted) {
            userSpecificStatus = 'connected'
          } else if (currentUserServerState === 'connecting' && hasUserAccepted) {
            userSpecificStatus = 'connecting'
          } else if (isIncoming && !hasUserAccepted) {
            // Incoming calls: stay in ringing until user accepts, regardless of server state
            userSpecificStatus = 'ringing'
          } else if (!isIncoming && hasUserAccepted) {
            // Outgoing calls: follow server state if user has accepted
            userSpecificStatus = currentUserServerState || data.status as CallState['status']
          } else if (!isIncoming && !hasUserAccepted) {
            // Outgoing calls: should not happen (caller auto-accepts), but default to ringing
            userSpecificStatus = 'ringing'
          } else {
            // Fallback to server's individual state or global state
            userSpecificStatus = currentUserServerState || data.status as CallState['status']
          }
        } else {
          // No individual participant states available, apply acceptance logic to global state
          if (data.status === 'connecting' && isIncoming && !hasUserAccepted) {
            // Don't let incoming users show connecting if they haven't accepted
            userSpecificStatus = 'ringing'
          } else if (data.status === 'connected' && isIncoming && !hasUserAccepted) {
            // Don't let incoming users show connected if they haven't accepted
            userSpecificStatus = 'ringing'
          }
        }
        
        // ENHANCED FIX: Improved participant count accuracy logic
        let serverConnectedCount: number

        if (typeof data.connectedParticipants === 'number') {
          // Use explicit connected participants count when available
          serverConnectedCount = data.connectedParticipants
          console.log('[CallModal] 📊 Using server connectedParticipants:', serverConnectedCount)
        } else if (typeof data.participantCount === 'number') {
          // Fallback to total participant count
          serverConnectedCount = data.participantCount
          console.log('[CallModal] 📊 Using server participantCount as fallback:', serverConnectedCount)
        } else {
          // Final fallback: maintain current count
          serverConnectedCount = prev.connectedParticipants
          console.log('[CallModal] 📊 No server count provided, maintaining current:', serverConnectedCount)
        }

        // Additional validation: ensure count is reasonable for group calls
        if (isGroupCall && serverConnectedCount > 6) {
          console.warn('[CallModal] ⚠️ Server count exceeds group call limit, capping at 6:', serverConnectedCount)
          serverConnectedCount = 6
        } else if (!isGroupCall && serverConnectedCount > 2) {
          console.warn('[CallModal] ⚠️ Server count exceeds 1-on-1 limit, capping at 2:', serverConnectedCount)
          serverConnectedCount = 2
        }

        const newState = {
          ...prev,
          status: userSpecificStatus,
          connectedParticipants: Math.max(0, serverConnectedCount) // Ensure non-negative
        }
        
        debouncedLoggers.stateUpdate(prev.status, newState.status, {
          connectedParticipants: data.connectedParticipants,
          participantCount: data.participantCount,
          hasAccepted: hasUserAccepted,
          isIncoming,
          serverGlobal: data.status
        })

        console.log('[CallModal] ✅ SIMPLIFIED state applied: count=', serverConnectedCount)
        
        return newState
      })
      
      // FIXED: Initiate WebRTC connections when transitioning to connecting state
      if (data.status === 'connecting' && webrtcServiceRef.current && (participants?.length || 0) > 0) {
        console.log('[CallModal] 🔄 Call transitioning to connecting - initiating WebRTC connections')
        if (memoizedParticipantIds.length > 0) {
          console.log('[CallModal] Starting WebRTC connections with participants:', memoizedParticipantIds)
          
          // CRITICAL: Ensure local stream is available before initiating connections
          if (localStreamRef.current && localStreamRef.current.active) {
            console.log('[CallModal] ✅ Local stream confirmed active, checking which participants to create offers for')
            
            // FIXED: For group calls, use proper mesh networking - create offers only to participants with lower IDs
            // This prevents duplicate connections and ensures proper peer-to-peer mesh
            const participantsToOffer = memoizedParticipantIds.filter(participantId => 
              session?.user?.id && session.user.id > participantId
            );
            
            console.log('[CallModal] Participants to create offers for:', participantsToOffer, 'out of:', memoizedParticipantIds)
            
            if (participantsToOffer.length > 0) {
              webrtcServiceRef.current.initiateConnections(participantsToOffer).catch(error => {
                console.error('[CallModal] Failed to initiate WebRTC connections:', error)
                // If WebRTC fails, don't get stuck - set a fallback timeout
                setTimeout(() => {
                  console.log('[CallModal] WebRTC connection timeout, forcing connection state')
                  if (socket && callId) {
                    socket.emit('force_call_connected', { callId })
                  }
                }, 10000) // 10 second fallback - reduced to prevent stuck states
              })
            } else {
              console.log('[CallModal] No participants to create offers for - waiting for incoming offers')
            }
          } else {
            console.error('[CallModal] ❌ No active local stream available for WebRTC connections!')
            // Try to reinitialize local stream
            setTimeout(() => {
              console.log('[CallModal] Attempting to reinitialize local stream...')
              if (webrtcServiceRef.current && callId) {
                webrtcServiceRef.current.initializeCall(callId, callType === 'video').then(stream => {
                  localStreamRef.current = stream
                  webrtcServiceRef.current!.setLocalStream(stream)
                  console.log('[CallModal] ✅ Local stream reinitialized, retrying WebRTC connections')
                  return webrtcServiceRef.current!.initiateConnections(memoizedParticipantIds)
                }).catch(error => {
                  console.error('[CallModal] Failed to reinitialize local stream:', error)
                })
              }
            }, 2000)
          }
        }
      }
      
      // ENHANCED: Handle connecting state with improved timeout protection and user-specific ringing stop
      if (data.status === 'connecting') {
        console.log('[CallModal] 🔄 Call state updated to connecting - checking if current user should stop ringing')

        // CRITICAL FIX: Only stop ringing if current user has actually accepted
        const currentUserId = session?.user?.id
        const hasCurrentUserAccepted = userHasAcceptedCall.current
        const isCurrentUserCaller = !isIncoming && currentUserId

        if (hasCurrentUserAccepted || isCurrentUserCaller) {
          console.log('[CallModal] 🔇 Current user accepted or is caller - stopping ringing')
          stopOutgoingRingingSound()
        } else {
          console.log('[CallModal] 🔔 Current user has not accepted - keeping ringing despite global connecting state')
          console.log('[CallModal] 🔍 Ringing decision context:', {
            hasAccepted: hasCurrentUserAccepted,
            isIncoming,
            isCaller: isCurrentUserCaller,
            globalState: data.status
          })
        }
        
        // Set a more aggressive timeout to prevent getting stuck in connecting state
        const connectingTimeout = setTimeout(async () => {
          console.log('[CallModal] ⏰ Connecting timeout reached, checking if we should force connection')
          
          // Check if we still exist and are in connecting state
          if (callState.status === 'connecting') {
            console.log('[CallModal] Still in connecting state after timeout, forcing connected state')
            
            // ENHANCED: For group calls, be more aggressive about transitioning
            // Don't wait for ALL participants - transition when ready
            let shouldTransitionToConnected = false
            
            if (webrtcServiceRef.current) {
              const activePeerConnections = webrtcServiceRef.current.getActivePeerConnections()
              const connectionCount = Object.keys(activePeerConnections).length
              const hasLocalStream = webrtcServiceRef.current.hasLocalStream?.() ?? false
              
              console.log('[CallModal] Connection evaluation:', {
                connectionCount,
                hasLocalStream,
                isGroupCall,
                totalParticipants: participants?.length || 0
              })
              
              // AGGRESSIVE TRANSITION CONDITIONS for better UX:
              // 1. Has ANY peer connection (even one is enough)
              // 2. Has local stream ready (can proceed even without peers in group calls)
              // 3. Group calls: transition immediately if we have media OR connections
              if (connectionCount > 0 || hasLocalStream) {
                shouldTransitionToConnected = true
                console.log('[CallModal] ✅ Transition condition met:', {hasConnections: connectionCount > 0, hasMedia: hasLocalStream})
              }
            } else if (isGroupCall && localStreamRef.current) {
              // If no WebRTC service but we have local stream in group call, still transition
              // This handles cases where participants join but WebRTC initialization is pending
              shouldTransitionToConnected = true
              console.log('[CallModal] ✅ Transition condition met: Group call with local stream')
            }
            
            if (shouldTransitionToConnected) {
              console.log('[CallModal] ✅ Transitioning to connected state')
              setCallState(prev => ({ ...prev, status: 'connected' }))
              
              // Notify server of state change
              if (socket && callId) {
                socket.emit('force_call_connected', { callId })
              }
            } else {
              console.log('[CallModal] ⚠️ Not ready to transition, remaining in connecting state')
            }
          }
        }, 3000) // Further reduced to 3 seconds for much faster transitions
        
        // Store timeout ID to clear it if state changes
        return () => clearTimeout(connectingTimeout)
      }
    }

    // ENHANCED: Listen for individual participant connection state updates
    const handleParticipantStateUpdate = (data: {
      callId: string
      participantId: string
      state: 'ringing' | 'connecting' | 'connected' | 'disconnected'
    }) => {
      console.log('[CallModal] 👤 Participant state update:', data)
      
      // Only handle updates for our call
      if (data.callId !== callId) {
        console.log('[CallModal] Ignoring participant state update for different call')
        return
      }
      
      // Update individual participant connection state
      setParticipantConnectionStates(prev => {
        const newStates = new Map(prev)
        if (data.state === 'disconnected') {
          newStates.delete(data.participantId)
        } else {
          newStates.set(data.participantId, data.state)
        }
        console.log('[CallModal] 📊 Updated participant states:', Object.fromEntries(newStates))
        return newStates
      })
      
      // Update activeParticipants if participant is disconnecting
      if (data.state === 'disconnected') {
        setActiveParticipants(prev => {
          const filtered = prev.filter(p => p.id !== data.participantId)
          console.log('[CallModal] 🚫 Removed disconnected participant:', data.participantId)
          return filtered
        })
        
        // Clean up streams and connections
        setRemoteStreams(prev => {
          const newStreams = new Map(prev)
          newStreams.delete(data.participantId)
          return newStreams
        })
        
        if (webrtcServiceRef.current) {
          webrtcServiceRef.current.removePeerConnection(data.participantId)
        }
      } else {
        // Update participant status in activeParticipants (only for valid states)
        if (['ringing', 'connecting', 'connected'].includes(data.state)) {
          setActiveParticipants(prev => {
            return prev.map(p => 
              p.id === data.participantId 
                ? { ...p, participantStatus: data.state as 'ringing' | 'connecting' | 'connected', isConnected: data.state === 'connected' }
                : p
            )
          })
        }
      }
      
    }

    // NEW: Handle participant mute state changes
    const handleParticipantMuteChange = (data: {
      callId: string
      participantId: string
      isMuted: boolean
    }) => {
      console.log('[CallModal] 🔇 Participant mute change:', data)
      
      // Only handle updates for our call
      if (data.callId !== callId) {
        console.log('[CallModal] Ignoring participant mute change for different call')
        return
      }
      
      // Update participant mute state
      setParticipantMuteStates(prev => {
        const newStates = new Map(prev)
        newStates.set(data.participantId, data.isMuted)
        console.log('[CallModal] 🔇 Updated participant mute states:', Object.fromEntries(newStates))
        return newStates
      })
      
      console.log('[CallModal] Participant', data.participantId, 'mute state changed to:', data.isMuted)
    }

    // NEW: Handle participant camera state changes
    const handleParticipantCameraChange = (data: {
      callId: string
      participantId: string
      isCameraOff: boolean
    }) => {
      console.log('[CallModal] 📹 Participant camera change:', data)
      
      // Only handle updates for our call
      if (data.callId !== callId) {
        console.log('[CallModal] Ignoring participant camera change for different call')
        return
      }
      
      // Update participant camera state
      console.log('[CallModal] Participant', data.participantId, 'camera state changed to:', data.isCameraOff ? 'OFF' : 'ON')
    }

    // Handle connection recovery for stuck connections
    const handleConnectionRecovery = (data: {
      callId: string
      participantId: string
      action: string
      newState: string
      participantStates: Record<string, string>
    }) => {
      console.log('[CallModal] 🔄 Connection recovery received:', data)
      
      if (data.callId !== callId) {
        console.log('[CallModal] ❌ Ignoring recovery for different call:', data.callId)
        return
      }
      
      if (data.participantId === session?.user?.id && data.action === 'retry_connection') {
        console.log('[CallModal] 🔄 Retrying connection setup after recovery')
        
        // Reset local state to allow retry
        setCallState(prev => ({ ...prev, status: 'ringing' }))
        
        // Clean up any existing WebRTC connections
        if (webrtcServiceRef.current) {
          webrtcServiceRef.current.cleanup()
          webrtcServiceRef.current = null
        }
        
        // Clear local stream
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop())
          localStreamRef.current = null
        }
        
        console.log('[CallModal] ✅ Reset complete, ready for fresh connection attempt')
      }
    }

    // ENHANCED: Handle participant data updates (refreshed names)
    const handleParticipantDataUpdated = (data: {
      callId: string
      participantId: string
      participantData: {
        id: string
        name: string
        username: string
        avatar: string | null
      }
    }) => {
      console.log('[CallModal] 🔄 Participant data update received:', data)

      if (data.callId !== callId) {
        console.log('[CallModal] Ignoring data update for different call')
        return
      }

      // Update the participant in activeParticipants list
      setActiveParticipants(prev => {
        const existingIndex = prev.findIndex(p => p.id === data.participantId)
        if (existingIndex !== -1) {
          const updatedParticipants = [...prev]
          updatedParticipants[existingIndex] = {
            ...updatedParticipants[existingIndex],
            name: data.participantData.name,
            username: data.participantData.username,
            avatar: data.participantData.avatar
          }

          console.log(`[CallModal] ✅ Updated participant data: ${data.participantData.name} (${data.participantId})`)
          return updatedParticipants
        }

        console.log(`[CallModal] ⚠️ Participant ${data.participantId} not found for data update`)
        return prev
      })
    }


    console.log(`\n🔌 [CallModal] SETTING UP SOCKET LISTENERS`)
    console.log(`[CallModal] Call ID: ${callId}`)
    console.log(`[CallModal] Session User ID: ${session?.user?.id}`)
    console.log(`[CallModal] Socket Connected: ${socket?.connected}`)
    console.log(`[CallModal] Is Incoming: ${isIncoming}`)

    // PHASE 2 FIX: Handle stuck participant events from WebRTC
    const handleWebRTCParticipantStuck = (data: {
      participantId: string
      connectionState: string
      iceState: string
      connectionAge: number
    }) => {
      console.log(`[CallModal] 🚨 STUCK PARTICIPANT detected: ${data.participantId}`, data)

      // Update participant connection state to show stuck status
      setParticipantConnectionStates(prev => {
        const newStates = new Map(prev)
        newStates.set(data.participantId, 'connecting')
        return newStates
      })

      // Schedule recovery attempt after a short delay
      setTimeout(() => {
        console.log(`[CallModal] 🔄 Attempting recovery for stuck participant: ${data.participantId}`)

        // Force refresh the connection by triggering a new WebRTC stream ready event
        if (webrtcServiceRef.current) {
          // Remove the stuck participant and let them rejoin
          setParticipantConnectionStates(prev => {
            const newStates = new Map(prev)
            newStates.delete(data.participantId)
            return newStates
          })

          // Notify server about the stuck participant for recovery
          socket.emit('request_participant_recovery', {
            callId,
            participantId: data.participantId,
            reason: 'stuck_connection'
          })
        }
      }, 2000) // 2 second delay before recovery
    }

    socket.on('call_response', handleCallResponse)
    socket.on('participant_joined', handleParticipantJoined)
    socket.on('participant_left', handleParticipantLeft)
    socket.on('call_ended', handleCallEnded)
    socket.on('call_timeout', handleCallTimeout)
    socket.on('call_state_update', handleCallStateUpdate)
    socket.on('webrtc_stream_ready', handleWebRTCStreamReady)
    socket.on('participant_data_updated', handleParticipantDataUpdated)
    // Note: WebRTC signaling events handled directly by WebRTC service
    socket.on('participant_state_update', handleParticipantStateUpdate)
    socket.on('participant_mute_change', handleParticipantMuteChange)
    socket.on('participant_camera_change', handleParticipantCameraChange)
    socket.on('connection_recovery', handleConnectionRecovery)
    socket.on('call_start_time_sync', handleCallStartTimeSync)
    socket.on('webrtc_participant_stuck', handleWebRTCParticipantStuck)

    console.log('[CallModal] ✅ All socket listeners registered')

    // Auto-progress to ringing when modal opens for outgoing calls
    if (callState.status === 'dialing' && !isIncoming) {
      setTimeout(async () => {
        // ENHANCED: Only start ringing if we're still in a valid calling state
        if (callState.status === 'dialing' || callState.status === 'ringing') {
          setCallState(prev => ({ ...prev, status: 'ringing' }))
          // ENHANCED: Initialize AudioContext with user gesture and start ringing
          console.log('[CallModal] Starting outgoing ringing sound with proper user gesture handling')
          try {
            // Pre-initialize AudioContext to ensure it's ready
            await initializeAudioContext()

            // Use the global audio manager for ringing
            const audioManager = getGlobalAudioManager()
            if (audioManager) {
              await audioManager.playOutgoingRinging()
            } else {
              console.warn('[CallModal] AudioManager not available')
            }
          } catch (error) {
            console.warn('[CallModal] Failed to initialize audio for ringing:', error)
          }
        } else {
          console.log('[CallModal] Skipping ringing start - call state changed:', callState.status)
        }
      }, 1000) // Show dialing state briefly
    }


    return () => {
      socket.off('call_response', handleCallResponse)
      socket.off('participant_joined', handleParticipantJoined)
      socket.off('participant_left', handleParticipantLeft)
      socket.off('call_ended', handleCallEnded)
      socket.off('call_timeout', handleCallTimeout)
      socket.off('call_state_update', handleCallStateUpdate)
      socket.off('webrtc_stream_ready', handleWebRTCStreamReady)
      socket.off('participant_data_updated', handleParticipantDataUpdated)
      // Note: WebRTC signaling events handled directly by WebRTC service
      socket.off('participant_state_update', handleParticipantStateUpdate)
      socket.off('participant_mute_change', handleParticipantMuteChange)
      socket.off('participant_camera_change', handleParticipantCameraChange)
      socket.off('connection_recovery', handleConnectionRecovery)
      socket.off('call_start_time_sync', handleCallStartTimeSync)
      socket.off('webrtc_participant_stuck', handleWebRTCParticipantStuck)
    }
  }, [socket, callId])

  // ENHANCED: Call duration timer with server synchronization and coordination
  useEffect(() => {
    if (callState.status === 'connected') {
      // Initialize call start time if not already set
      if (!callStartTimeRef.current) {
        const now = Date.now()
        callStartTimeRef.current = now
        console.log('[CallModal] ⏰ Call start time initialized:', new Date(now).toISOString())

        // ENHANCED: Broadcast call start time to coordinate with other participants
        if (socket?.connected && callId && session?.user?.id) {
          const syncData = {
            callId,
            participantId: session.user.id,
            callStartTime: now,
            timestamp: now
          }
          console.log('[CallModal] 📡 Broadcasting call start time for coordination:', syncData)
          socket.emit('call_start_time_sync', syncData)
        }
      }

      // Start synchronized duration timer
      timerRef.current = setInterval(() => {
        setCallState(prev => {
          // CRITICAL: Prioritize server timestamp for authoritative timing
          let startTime: number

          if (serverCallStartTimeRef.current) {
            // Use server time as authoritative source
            startTime = serverCallStartTimeRef.current
          } else if (callStartTimeRef.current) {
            // Fallback to local time if no server time
            startTime = callStartTimeRef.current
          } else {
            // Emergency fallback - should not happen in connected state
            console.warn('[CallModal] ⚠️ No start time available in connected state, using current time')
            startTime = Date.now()
            callStartTimeRef.current = startTime
          }

          const elapsed = Math.max(0, Math.floor((Date.now() - startTime) / 1000))

          // Only update if duration actually changed to prevent unnecessary renders
          if (prev.duration !== elapsed) {
            // Log duration occasionally for debugging synchronization
            if (elapsed % 10 === 0 && elapsed > 0) {
              console.log(`[CallModal] ⏰ Duration: ${elapsed}s (start: ${new Date(startTime).toISOString()}, source: ${serverCallStartTimeRef.current ? 'server' : 'local'})`)
            }

            return { ...prev, duration: elapsed }
          }

          return prev
        })
      }, 1000)
      
      // CRITICAL: Verify WebRTC connections when transitioning to connected
      const verifyConnections = async () => {
        if (!webrtcServiceRef.current || !participants || participants.length <= 1) {
          console.log('[CallModal] Skipping connection verification - no WebRTC or participants')
          return
        }
        
        const activePeerConnections = webrtcServiceRef.current.getActivePeerConnections()
        const otherParticipantIds = participants.filter(p => p.id !== session?.user?.id).map(p => p.id)
        
        console.log('[CallModal] 🔍 Connection verification:')
        console.log('[CallModal] - Expected participants:', otherParticipantIds)
        console.log('[CallModal] - Active connections:', Array.from(activePeerConnections.keys()))
        
        // Check if we have connections to all expected participants
        const missingConnections = otherParticipantIds.filter(id => !activePeerConnections.get(id))
        
        if (missingConnections.length > 0) {
          console.log('[CallModal] 🚨 Missing WebRTC connections to:', missingConnections)
          console.log('[CallModal] 🔧 Attempting to establish missing connections')
          
          try {
            await webrtcServiceRef.current.initiateConnections(missingConnections)
            console.log('[CallModal] ✅ Attempted to establish missing connections')
          } catch (error) {
            console.error('[CallModal] ❌ Failed to establish missing connections:', error)
          }
        } else {
          console.log('[CallModal] ✅ All expected WebRTC connections are active')
        }
      }
      
      // Verify connections immediately and after a delay
      verifyConnections()
      setTimeout(verifyConnections, 2000) // Re-verify after 2 seconds
      
    } else {
      // Clear timer and reset timestamps when not connected
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }

      // Reset timestamps when call is no longer connected
      if (callState.status === 'disconnected' || callState.status === 'ended') {
        callStartTimeRef.current = null
        serverCallStartTimeRef.current = null
        console.log('[CallModal] ⏰ Call timestamps reset for ended call')
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [callState.status, participants, session?.user?.id])

  // ENHANCED: Proactive participant data refresh for fallback names
  useEffect(() => {
    const refreshParticipantData = async () => {
      if (!socket || !callId || !activeParticipants.length) return

      // Find participants with fallback names that need refreshing
      const participantsNeedingRefresh = activeParticipants.filter(participant =>
        participant.name.match(/^User[-\s][A-Z0-9]{6,8}$/i) ||
        participant.username.startsWith('user_') ||
        participant.username.startsWith('user') && participant.username.length <= 12
      )

      if (participantsNeedingRefresh.length === 0) return

      console.log('[CallModal] 🔄 Found participants needing data refresh:',
        participantsNeedingRefresh.map(p => `${p.name} (${p.id})`))

      // Request fresh participant data from server
      for (const participant of participantsNeedingRefresh) {
        try {
          console.log(`[CallModal] 🔍 Requesting fresh data for participant: ${participant.id}`)

          // Emit a request for participant data refresh
          socket.emit('refresh_participant_data', {
            callId,
            participantId: participant.id
          })
        } catch (error) {
          console.error(`[CallModal] ❌ Failed to request refresh for participant ${participant.id}:`, error)
        }
      }
    }

    // Debounce the refresh to avoid excessive requests
    const refreshTimeout = setTimeout(refreshParticipantData, 2000)

    return () => clearTimeout(refreshTimeout)
  }, [activeParticipants, socket, callId])

  // ENHANCED: Comprehensive call monitoring and debugging system
  useEffect(() => {
    const startMonitoring = () => {
      if (!callId || callState.status === 'ended') return

      const monitoringInterval = setInterval(() => {
        try {
          // Collect call state metrics
          const now = Date.now()
          const callDuration = callState.status === 'connected' ? callState.duration : 0
          const connectedParticipantCount = connectedParticipants.length
          const totalParticipantCount = activeParticipants.length
          const actualConnectedCount = actualConnectedParticipants

          // Collect WebRTC metrics
          let webrtcMetrics = {
            activePeerConnections: 0,
            totalConnections: 0,
            connectedConnections: 0,
            connectingConnections: 0,
            failedConnections: 0,
            hasLocalStream: false,
            remoteStreamCount: 0
          }

          if (webrtcServiceRef.current) {
            const peerConnections = webrtcServiceRef.current.getActivePeerConnections()
            webrtcMetrics.activePeerConnections = Object.keys(peerConnections).length
            webrtcMetrics.totalConnections = webrtcServiceRef.current.getActivePeerConnectionCount()
            webrtcMetrics.connectedConnections = webrtcServiceRef.current.getConnectedParticipantCount()
            webrtcMetrics.hasLocalStream = !!localStreamRef.current
            webrtcMetrics.remoteStreamCount = remoteStreams.size

            // Count connection states
            Object.values(peerConnections).forEach(pc => {
              const state = pc.connectionState
              if (state === 'connected') webrtcMetrics.connectedConnections++
              else if (state === 'connecting') webrtcMetrics.connectingConnections++
              else if (state === 'failed' || state === 'disconnected') webrtcMetrics.failedConnections++
            })
          }

          // Collect participant state metrics
          const participantStates = Array.from(participantConnectionStates.entries())
          const stateDistribution = {
            ringing: participantStates.filter(([, state]) => state === 'ringing').length,
            connecting: participantStates.filter(([, state]) => state === 'connecting').length,
            connected: participantStates.filter(([, state]) => state === 'connected').length
          }

          // Identify participants with fallback names
          const fallbackParticipants = activeParticipants.filter(p =>
            p.name.match(/^User[-\s][A-Z0-9]{6,8}$/i)
          ).length

          // Comprehensive monitoring log
          console.log(`[CallModal] 📊 CALL MONITORING - ${now}:`, {
            callId: callId,
            callStatus: callState.status,
            callDuration: callDuration,
            isIncoming: isIncoming,
            isGroupCall: isGroupCall,
            userAccepted: userHasAcceptedCall.current,
            participants: {
              total: totalParticipantCount,
              connected: connectedParticipantCount,
              actualConnected: actualConnectedCount,
              withFallbackNames: fallbackParticipants,
              stateDistribution: stateDistribution
            },
            webrtc: webrtcMetrics,
            audio: {
              isRinging: callState.status === 'ringing',
              hasLocalStream: !!localStreamRef.current,
              remoteStreams: remoteStreams.size
            },
            ui: {
              isVisible: true,
              lastUpdate: now
            }
          })

          // Performance warnings
          if (webrtcMetrics.failedConnections > 0) {
            console.warn(`[CallModal] ⚠️ PERFORMANCE WARNING: ${webrtcMetrics.failedConnections} failed WebRTC connections`)
          }

          if (fallbackParticipants > 0) {
            console.warn(`[CallModal] ⚠️ DATA WARNING: ${fallbackParticipants} participants have fallback names`)
          }

          if (totalParticipantCount !== actualConnectedCount && callState.status === 'connected') {
            console.warn(`[CallModal] ⚠️ COUNT MISMATCH: UI shows ${totalParticipantCount} total, but ${actualConnectedCount} actually connected`)
          }

          // Alert for long connecting states
          if (callState.status === 'connecting' && callDuration > 30) {
            console.warn(`[CallModal] ⚠️ LONG CONNECTING: Call has been connecting for ${callDuration}s`)
          }

        } catch (error) {
          console.error('[CallModal] ❌ Error in call monitoring:', error)
        }
      }, 5000) // Monitor every 5 seconds

      return monitoringInterval
    }

    const interval = startMonitoring()

    return () => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [callId, callState.status, callState.duration, isIncoming, isGroupCall, connectedParticipants, activeParticipants, actualConnectedParticipants, participantConnectionStates, remoteStreams])

  // ENHANCED: Heartbeat mechanism for participant health monitoring
  useEffect(() => {
    if (!callId || !socket || callState.status === 'disconnected' || callState.status === 'ended') {
      return
    }

    // Send heartbeat every 10 seconds during active call
    const heartbeatInterval = setInterval(() => {
      socket.emit('call_heartbeat', {
        callId,
        timestamp: Date.now()
      })
    }, 10000)

    console.log(`[CallModal] 💓 Started heartbeat monitoring for call ${callId}`)

    return () => {
      clearInterval(heartbeatInterval)
      console.log(`[CallModal] 💔 Stopped heartbeat monitoring for call ${callId}`)
    }
  }, [callId, socket, callState.status])

  // CRITICAL FIX: Only stop ringing based on CURRENT USER's individual state, not global call state
  useEffect(() => {
    const currentUserId = session?.user?.id
    if (!currentUserId) return

    // Get current user's individual participant state
    const currentUserState = participantConnectionStates.get(currentUserId)
    const hasUserAccepted = userHasAcceptedCall.current

    // CRITICAL FIX: Only stop ringing based on USER ACCEPTANCE, not participant state
    // Participant state can be corrupted by server/client bugs, so rely only on explicit user action
    const shouldStopRinging = hasUserAccepted

    // Additional check: For outgoing calls, caller should auto-accept
    const isCallerAutoAccept = !isIncoming && currentUserId
    const finalShouldStopRinging = shouldStopRinging || isCallerAutoAccept

    // Log detailed state information for debugging
    console.log('[CallModal] 🔍 Ringing state evaluation:', {
      globalCallState: callState.status,
      currentUserState,
      hasUserAccepted,
      shouldStopRinging,
      isCallerAutoAccept,
      finalShouldStopRinging,
      isIncoming,
      currentUserId
    })

    // Only stop ringing if this user has explicitly accepted or is making an outgoing call
    if (finalShouldStopRinging && (callState.status === 'connecting' || callState.status === 'connected')) {
      console.log('[CallModal] 🔇 Current user acceptance detected - stopping ringing:', {
        reason: hasUserAccepted ? 'user_accepted' : (isCallerAutoAccept ? 'caller_auto_accept' : 'unknown'),
        userState: currentUserState,
        hasAccepted: hasUserAccepted,
        isOutgoing: !isIncoming
      })
      requestStopRinging(`current_user_accepted_${hasUserAccepted ? 'manual' : 'auto'}`)
    } else if (!finalShouldStopRinging) {
      console.log('[CallModal] 🔔 Keeping ringing - current user has not explicitly accepted yet')
      console.log('[CallModal] 🔔 Ringing decision context:', {
        hasAccepted: hasUserAccepted,
        isIncoming,
        participantState: currentUserState,
        reason: 'waiting_for_explicit_user_action'
      })
    }
  }, [callState.status, participantConnectionStates, session?.user?.id, isIncoming, requestStopRinging])

  // ENHANCED: Comprehensive cleanup on component unmount
  useEffect(() => {
    return () => {
      console.log('[CallModal] 🧹 Component unmounting - performing comprehensive cleanup')

      // Stop all ringing
      requestStopRinging('component_unmount')

      // Clean up WebRTC connections
      if (webrtcServiceRef.current) {
        console.log('[CallModal] 🔧 Cleaning up WebRTC connections')
        try {
          webrtcServiceRef.current.cleanup()
        } catch (error) {
          console.warn('[CallModal] Error during WebRTC cleanup:', error)
        }
      }

      // Clear any remaining intervals
      if (outgoingRingingInterval) {
        clearInterval(outgoingRingingInterval)
      }

      // Cleanup audio context
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try {
          audioContextRef.current.close()
        } catch (error) {
          console.warn('[CallModal] Error closing audio context:', error)
        }
      }
    }
  }, [requestStopRinging, outgoingRingingInterval])

  // IMPROVED: Earlier WebRTC initialization with better error handling
  useEffect(() => {
    if (!isOpen || !callId || !socket || !session?.user?.id) {
      console.log('[CallModal] Skipping WebRTC initialization:', {
        isOpen,
        hasCallId: !!callId,
        hasSocket: !!socket,
        hasSession: !!session?.user?.id
      })
      return
    }

    // CRITICAL FIX: More robust WebRTC initialization logic  
    // ENHANCED: Multi-layer WebRTC initialization guard against auto-join bug
    const currentUserId = session?.user?.id
    const hasUserAcceptedCall = userHasAcceptedCall.current
    
    // Primary guard: Skip WebRTC for non-accepting incoming call participants
    const shouldSkipWebRTC = callState.status === 'ringing' || 
                           (callState.status === 'connecting' && !hasUserAcceptedCall && isIncoming) ||
                           (callState.status === 'connected' && !hasUserAcceptedCall && isIncoming)

    // Secondary guard: Additional checks for suspicious states that could indicate auto-join
    const suspiciousStates = ['connected', 'in_call']
    const isSuspiciousAutoJoin = isIncoming && 
                                suspiciousStates.includes(callState.status) && 
                                !hasUserAcceptedCall
    
    if (shouldSkipWebRTC || isSuspiciousAutoJoin) {
      const reason = isSuspiciousAutoJoin ? 'suspicious auto-join detected' : 'user has not accepted call'
      console.log(`[CallModal] 🔄 Skipping WebRTC - ${reason}:`, { 
        isIncoming, 
        callState: callState.status,
        hasUserAccepted: hasUserAcceptedCall,
        userId: currentUserId,
        suspiciousAutoJoin: isSuspiciousAutoJoin
      })
      
      // Extra logging for debugging auto-join issues
      if (isSuspiciousAutoJoin) {
        console.log(`[CallModal] 🚨 AUTO-JOIN PREVENTION: Blocked WebRTC initialization for non-accepting user`)
        console.log(`[CallModal] 🚨 Call details: {callId: ${callId}, status: ${callState.status}, participants: ${participants?.length}}`)
      }
      
      return
    }

    // CRITICAL FIX: Emergency WebRTC initialization only if current user has EXPLICITLY accepted the call
    const currentUserState = participantConnectionStates.get(session?.user?.id || '')
    const currentUserIsConnecting = currentUserState === 'connecting' || currentUserState === 'connected'
    
    // CRITICAL FIX: Strict validation to prevent emergency WebRTC for non-accepting users
    // Allow emergency init only if: (1) user explicitly accepted OR (2) user is the caller for outgoing calls
    const isOutgoingCallInitiator = !isIncoming && session?.user?.id
    const hasExplicitlyAccepted = userHasAcceptedCall.current || isOutgoingCallInitiator
    const isInValidParticipantState = currentUserIsConnecting && currentUserState !== undefined
    const shouldAllowEmergencyInit = hasExplicitlyAccepted && isInValidParticipantState
    
    const needsEmergencyInit = (callState.status === 'connected' || callState.status === 'connecting') && 
                              !webrtcServiceRef.current &&
                              shouldAllowEmergencyInit // Triple-validated acceptance check

    if (needsEmergencyInit) {
      console.log('[CallModal] 🆘 EMERGENCY WebRTC RECOVERY - Call is connected but WebRTC needs help!', {
        hasUserAccepted: hasExplicitlyAccepted,
        currentUserState,
        callState: callState.status,
        isIncoming,
        shouldAllowEmergencyInit
      })
    } else {
      // Log why emergency init was blocked for debugging
      if ((callState.status === 'connected' || callState.status === 'connecting') && !webrtcServiceRef.current) {
        console.log('[CallModal] 🚫 EMERGENCY WebRTC BLOCKED - User has not accepted call', {
          hasUserAccepted: hasExplicitlyAccepted,
          currentUserState,
          callState: callState.status,
          isIncoming,
          shouldAllowEmergencyInit
        })
      }
    }

    // CIRCUIT BREAKER: Prevent rapid WebRTC initialization attempts - ENHANCED for group calls
    const now = Date.now()
    const isGroupCall = activeParticipants.length > 2
    const MIN_INIT_INTERVAL = isGroupCall ? 1000 : 2000 // Shorter interval for group calls (need faster recovery)
    const timeSinceLastAttempt = now - lastRecoveryAttemptRef.current

    // Be more lenient for group calls and emergency situations
    if (lastRecoveryAttemptRef.current > 0 &&
        timeSinceLastAttempt < MIN_INIT_INTERVAL &&
        !shouldAllowEmergencyInit) {
      console.log('[CallModal] 🚫 Circuit breaker: WebRTC init too soon after last attempt:', {
        timeSinceLastAttempt,
        minInterval: MIN_INIT_INTERVAL,
        isGroupCall,
        emergencyOverride: shouldAllowEmergencyInit
      })
      return
    }
    
    lastRecoveryAttemptRef.current = now

    // Initialize WebRTC for outgoing calls immediately, or for any call that's past initial ringing
    console.log('[CallModal] 🚀 SHOULD initialize WebRTC - State:', callState.status, 'IsIncoming:', isIncoming, 'Connected participants:', callState.connectedParticipants, 'Emergency:', needsEmergencyInit)

    console.log('[CallModal] ✅ Initializing WebRTC - State:', callState.status, 'IsIncoming:', isIncoming)
    let isMounted = true
    let initializationTimeout: NodeJS.Timeout

    const initializeCall = async () => {
      try {
        console.log('[CallModal] 🔧 WEBRTC INITIALIZATION ATTEMPT:', {
          callId,
          callState: callState.status,
          isIncoming,
          hasExistingService: !!webrtcServiceRef.current,
          socketConnected: socket?.connected,
          sessionUserId: session?.user?.id
        })
        
        // ENHANCED: Prevent multiple initializations with better state checking
        if (webrtcServiceRef.current) {
          console.log('[CallModal] ⚠️ WebRTC service already exists, verifying state...')
          
          // Check if existing service is functional
          try {
            const hasLocalStream = webrtcServiceRef.current.hasLocalStream?.() ?? false
            if (hasLocalStream) {
              console.log('[CallModal] ✅ Existing WebRTC service is functional, skipping initialization')
              return
            } else {
              console.log('[CallModal] 🔧 Existing service has no local stream, reinitializing...')
              webrtcServiceRef.current?.cleanup?.()
              webrtcServiceRef.current = null
            }
          } catch (error) {
            console.warn('[CallModal] 🔧 Error checking existing service, reinitializing:', error)
            webrtcServiceRef.current?.cleanup?.()
            webrtcServiceRef.current = null
          }
        }

        console.log('[CallModal] 🚀 Creating WebRTC service for call:', callId)
        
        // Set timeout to prevent hanging
        initializationTimeout = setTimeout(() => {
          console.error('[CallModal] WebRTC initialization timeout - this may indicate permission issues')
          if (isMounted) {
            setConnectionErrors(prev => new Map(prev.set('init', 'Failed to initialize call - check camera/microphone permissions')))
          }
        }, 10000) // 10 second timeout

        // Initialize WebRTC service
        webrtcServiceRef.current = new WebRTCService(socket, session.user.id)

        // ENHANCED: Set up audio state synchronization callback
        webrtcServiceRef.current.onRemoteAudioStateChanged = (participantId: string, isMuted: boolean, isEnabled: boolean) => {
          console.log('[CallModal] 🔄 Remote audio state changed:', { participantId, isMuted, isEnabled })

          // Update participant mute states for UI indicators
          setParticipantMuteStates(prev => {
            const newStates = new Map(prev)
            // Use muted state from WebRTC track for more accurate indication
            newStates.set(participantId, isMuted || !isEnabled)
            return newStates
          })
        }
        
        // Initialize WebRTC and get local media stream with retry logic
        let stream: MediaStream
        try {
          stream = await webrtcServiceRef.current.initializeCall(callId, callType === 'video')
          console.log('[CallModal] ✅ WebRTC initialization successful on first attempt')
        } catch (firstAttemptError) {
          console.warn('[CallModal] ⚠️ First WebRTC initialization failed, trying graceful fallback:', firstAttemptError)
          
          // For video calls, try falling back to audio-only if video fails
          if (callType === 'video') {
            try {
              console.log('[CallModal] 🔄 Falling back to audio-only call due to video failure')
              stream = await webrtcServiceRef.current.initializeCall(callId, false)
              console.log('[CallModal] ✅ Fallback to audio-only successful')
              
              // Update call state to reflect audio-only mode
              setCallState(prev => ({ ...prev, isCameraOff: true }))
            } catch (fallbackError) {
              console.error('[CallModal] ❌ Audio fallback also failed:', fallbackError)
              throw fallbackError
            }
          } else {
            throw firstAttemptError
          }
        }
        
        // Clear timeout on success
        clearTimeout(initializationTimeout)

        if (!isMounted) {
          console.log('[CallModal] Component unmounted during initialization, cleaning up')
          if (stream && typeof stream.getTracks === 'function') {
            stream.getTracks().forEach(track => track.stop())
          }
          return
        }

        localStreamRef.current = stream
        
        // CRITICAL FIX: Notify WebRTC service that stream is set
        webrtcServiceRef.current.setLocalStream(stream)
        console.log('[CallModal] ✅ Notified WebRTC service of local stream')
        
        // VIDEO CALL FIX: Force refresh of local video element
        setTimeout(() => {
          if (localVideoRef.current && stream) {
            console.log('[CallModal] 🔄 Refreshing local video element for subsequent call')
            localVideoRef.current.srcObject = stream
            localVideoRef.current.play().catch(error => {
              console.warn('[CallModal] Error playing refreshed local video:', error)
            })
          }
        }, 500)
        
        // Initialize screen share manager safely
        try {
          screenShareManagerRef.current = new ScreenShareManager((screenStream) => {
            if (screenStream) {
              console.log('[CallModal] Screen share started')
            } else {
              console.log('[CallModal] Screen share stopped')
              if (isMounted) {
                setCallState(prev => ({ ...prev, isScreenSharing: false }))
              }
            }
          })
          screenShareManagerRef.current.setOriginalStream(stream)
        } catch (screenShareError) {
          console.warn('[CallModal] Screen share initialization failed:', screenShareError)
        }
        
        console.log('[CallModal] ✅ Local stream acquired:', stream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled })))

        // Immediately notify server about stream readiness with retry logic
        if (socket?.connected && session?.user?.id && callId) {
          const streamData = {
            callId,
            participantId: session.user.id,
            streamId: stream.id,
            hasAudio: stream.getAudioTracks().length > 0,
            hasVideo: stream.getVideoTracks().length > 0
          }
          
          console.log('[CallModal] 📡 Notifying server that local stream is ready:', streamData)
          socket.emit('webrtc_stream_ready', streamData)
          
          // Additional reliability: Retry notification after a short delay to ensure server receives it
          setTimeout(() => {
            if (socket?.connected && isMounted) {
              console.log('[CallModal] 📡 Sending backup stream ready notification')
              socket.emit('webrtc_stream_ready', streamData)
            }
          }, 1000)
        }

        // If call is already connected/connecting, wait for local stream then create offers
        if ((callState.status === 'connected' || callState.status === 'connecting') && (participants?.length || 0) > 0) {
          if (memoizedParticipantIds.length > 0) {
            console.log('[CallModal] ✅ Scheduling offer creation after stream is ready')
            
            // ENHANCED: Use group call optimization for multiple participants
            setTimeout(async () => {
              try {
                const streamReady = await webrtcServiceRef.current?.waitForLocalStream(2000)
                if (streamReady && memoizedParticipantIds.length > 0) {
                  console.log('[CallModal] 🚀 Setting up group call connections for participants:', memoizedParticipantIds)

                  if (memoizedParticipantIds.length === 1) {
                    // For single participant, use direct offer creation
                    const participantId = memoizedParticipantIds[0]
                    try {
                      await webrtcServiceRef.current?.safeCreateOffer(participantId)
                      console.log('[CallModal] ✅ Created direct offer for single participant:', participantId)
                    } catch (offerError) {
                      console.error('[CallModal] ❌ Failed to create offer for:', participantId, offerError)
                    }
                  } else {
                    // ENHANCED: For multiple participants, use group call optimization with duplicate prevention
                    const participantListKey = memoizedParticipantIds.sort().join(',')

                    if (lastGroupCallParticipants.current !== participantListKey) {
                      lastGroupCallParticipants.current = participantListKey
                      console.log('[CallModal] 🎯 New group call configuration detected:', memoizedParticipantIds)

                      try {
                        await webrtcServiceRef.current?.initializeGroupCallConnections(memoizedParticipantIds)
                        console.log('[CallModal] ✅ Group call connections setup completed')
                      } catch (groupError) {
                        console.error('[CallModal] ❌ Group call setup failed, falling back to individual offers:', groupError)

                        // Fallback to individual offers if group setup fails
                        for (const participantId of memoizedParticipantIds) {
                          try {
                            await webrtcServiceRef.current?.safeCreateOffer(participantId)
                            console.log('[CallModal] ✅ Fallback offer created for:', participantId)
                          } catch (offerError) {
                            console.error('[CallModal] ❌ Fallback offer failed for:', participantId, offerError)
                          }
                        }
                      }
                    } else {
                      console.log('[CallModal] 🔄 Group call already setup for current participants:', memoizedParticipantIds)
                    }
                  }
                } else {
                  console.error('[CallModal] ❌ Stream not ready or no participants - cannot create offers')
                }
              } catch (error) {
                console.error('[CallModal] ❌ Error during connection setup:', error)
              }
            }, 500)
          }
        }

        // Clear any initialization errors
        setConnectionErrors(prev => {
          const newErrors = new Map(prev)
          newErrors.delete('init')
          return newErrors
        })

      } catch (error) {
        clearTimeout(initializationTimeout)
        console.error('[CallModal] Failed to initialize call:', error)
        
        if (isMounted) {
          // Show user-friendly error message
          const errorMessage = error instanceof Error ? error.message : 'Failed to initialize call'
          setConnectionErrors(prev => new Map(prev.set('init', errorMessage)))
          
          // For permission errors, don't auto-close - let user try again
          if (error instanceof Error && !error.message.includes('permission')) {
            setTimeout(() => {
              if (isMounted) {
                setCallState(prev => ({ ...prev, status: 'disconnected' }))
                onClose()
              }
            }, 3000)
          }
        }
      }
    }

    // Start initialization immediately
    initializeCall()

    return () => {
      isMounted = false
      if (initializationTimeout) {
        clearTimeout(initializationTimeout)
      }
    }
  }, [isOpen, callType, socket, session?.user?.id, callId, callState.status, isIncoming])

  // CRITICAL FIX: Ensure WebRTC is initialized when call becomes active with improved timing
  useEffect(() => {
    if (!isOpen || !callId || !session?.user?.id || !socket) return
    
    // CRITICAL FIX: Only initialize WebRTC if current user has EXPLICITLY accepted the call
    // Allow WebRTC init for: (1) users who accepted OR (2) outgoing call initiators
    const currentUserState = participantConnectionStates.get(session?.user?.id || '')
    const isOutgoingCallInitiator = !isIncoming && session?.user?.id
    const currentUserAccepted = (userHasAcceptedCall.current || isOutgoingCallInitiator) && 
                               (currentUserState === 'connecting' || currentUserState === 'connected')
    
    const needsWebRTCInit = (callState.status === 'connected' || callState.status === 'connecting') && 
                           !webrtcServiceRef.current &&
                           currentUserAccepted // Only if current user accepted
                           
    // Also check if WebRTC exists but has no active connections when it should
    const needsConnectionRecovery = webrtcServiceRef.current && 
                                   (callState.status === 'connected' || callState.status === 'connecting') &&
                                   memoizedParticipantIds.length > 0 &&
                                   Object.keys(webrtcServiceRef.current.getActivePeerConnections()).length === 0 &&
                                   currentUserAccepted // Only if current user accepted
    
    // Add cooldown mechanism to prevent infinite recovery loops
    const now = Date.now()
    const timeSinceLastRecovery = now - lastRecoveryAttemptRef.current
    const RECOVERY_COOLDOWN = 10000 // 10 seconds cooldown between recovery attempts
    
    const shouldAttemptRecovery = (needsWebRTCInit || needsConnectionRecovery) && 
                                  timeSinceLastRecovery > RECOVERY_COOLDOWN
    
    if (shouldAttemptRecovery) {
      lastRecoveryAttemptRef.current = now
      console.log('[CallModal] 🆘 EMERGENCY WebRTC RECOVERY - Call is connected but WebRTC needs help!')
      console.log('[CallModal] 🔧 Emergency details:', {
        needsInit: needsWebRTCInit,
        needsConnectionRecovery,
        callState: callState.status,
        isIncoming,
        participants: memoizedParticipantIds,
        hasWebRTC: !!webrtcServiceRef.current,
        activePeerConnections: webrtcServiceRef.current ? Object.keys(webrtcServiceRef.current.getActivePeerConnections()).length : 0
      })
      
      const emergencyInit = async () => {
        try {
          // If we need complete init and WebRTC already exists, clean it up first
          if (needsWebRTCInit && webrtcServiceRef.current) {
            console.log('[CallModal] 🧹 Cleaning up existing WebRTC service before emergency init')
            try {
              webrtcServiceRef.current.cleanup()
            } catch (cleanupError) {
              console.warn('[CallModal] Error during WebRTC cleanup:', cleanupError)
            }
            webrtcServiceRef.current = null
          }
          
          // Initialize WebRTC service if needed
          if (!webrtcServiceRef.current) {
            console.log('[CallModal] 🚨 Creating emergency WebRTC service for call:', callId)
            webrtcServiceRef.current = new WebRTCService(socket, session.user.id)

            // Set up audio state synchronization callback
            webrtcServiceRef.current.onRemoteAudioStateChanged = (participantId: string, isMuted: boolean, isEnabled: boolean) => {
              setParticipantMuteStates(prev => {
                const newStates = new Map(prev)
                newStates.set(participantId, isMuted || !isEnabled)
                return newStates
              })
            }
            
            const stream = await webrtcServiceRef.current.initializeCall(callId, callType === 'video')
            localStreamRef.current = stream
            webrtcServiceRef.current.setLocalStream(stream)
            
            // Notify server about stream readiness
            if (socket?.connected) {
              const streamData = {
                callId,
                participantId: session.user.id,
                streamId: stream.id,
                hasAudio: stream.getAudioTracks().length > 0,
                hasVideo: stream.getVideoTracks().length > 0
              }
              socket.emit('webrtc_stream_ready', streamData)
            }
            
            console.log('[CallModal] ✅ Emergency WebRTC initialization complete!')
          }
          
          // If there are participants, initiate connections
          if (memoizedParticipantIds.length > 0 && webrtcServiceRef.current) {
            console.log('[CallModal] 🔗 Emergency connecting to participants:', memoizedParticipantIds)
            await webrtcServiceRef.current.initiateConnections(memoizedParticipantIds)
          }
          
        } catch (error) {
          console.error('[CallModal] 💥 Emergency WebRTC recovery failed:', error)
          
          // Set error state to inform user
          setConnectionErrors(prev => new Map(prev.set('emergency', 'Connection recovery failed - please try ending and starting the call again')))
        }
      }
      
      // Small delay to prevent race conditions
      const emergencyTimeout = setTimeout(emergencyInit, 500)
      return () => clearTimeout(emergencyTimeout)
    }
  }, [callState.status, callId, isOpen, socket, session?.user?.id, callType, memoizedParticipantIds])

  // Cleanup outgoing ringing interval on unmount
  useEffect(() => {
    return () => {
      if (outgoingRingingInterval) {
        clearInterval(outgoingRingingInterval)
      }
    }
  }, [outgoingRingingInterval])

  // Keyboard navigation and accessibility - placed with other useEffects to follow Rules of Hooks
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Prevent default browser behavior for our keyboard shortcuts
      switch (event.code) {
        case 'Space':
          if (event.target === document.body) {
            event.preventDefault()
            if (callState.status === 'connected') {
              toggleMute()
            }
          }
          break
        case 'KeyM':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault()
            if (callState.status === 'connected') {
              toggleMute()
            }
          }
          break
        case 'KeyV':
          if ((event.ctrlKey || event.metaKey) && callType === 'video') {
            event.preventDefault()
            if (callState.status === 'connected') {
              toggleCamera()
            }
          }
          break
        case 'KeyS':
          if ((event.ctrlKey || event.metaKey) && callType === 'video') {
            event.preventDefault()
            if (callState.status === 'connected') {
              toggleScreenShare()
            }
          }
          break
        case 'Escape':
          event.preventDefault()
          handleEndCall()
          break
        case 'Enter':
          if (isIncoming && callState.status === 'ringing') {
            event.preventDefault()
            handleAcceptCall()
          }
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [callState.status, callType, isIncoming]) // Removed function dependencies to avoid stale closures

  // Centralized cleanup function with crash prevention - stabilized with useCallback
  const cleanupCallResources = useCallback((forceCleanup = false) => {
    console.log('\n🧽 [CallModal] CLEANUP STARTING - force:', forceCleanup)
    console.log('[CallModal] Current call state:', callState.status)
    console.log('[CallModal] Call ID:', callId)
    console.log('[CallModal] Session User ID:', session?.user?.id)
    
    try {
      // Stop any ongoing sounds immediately
      stopOutgoingRingingSound()
      console.log('[CallModal] ✅ Stopped ringing sounds')
    } catch (error) {
      console.warn('[CallModal] Error stopping ringing:', error)
    }
    
    // SUBSEQUENT CALL FIX: Less aggressive cleanup to preserve state for next calls
    const isCallEnding = forceCleanup || 
                        callState.status === 'disconnected' || 
                        callState.status === 'declined' ||
                        callState.status === 'ended'
    
    if (isCallEnding) {
      console.log('[CallModal] 🧹 Performing controlled cleanup - preserving WebRTC service for subsequent calls')
      
      try {
        // ENHANCED: Comprehensive WebRTC cleanup with memory management
        if (webrtcServiceRef.current) {
          console.log('[CallModal] 🔄 Performing enhanced WebRTC cleanup')

          try {
            // Get active connections count before cleanup for logging
            const activePeerConnections = webrtcServiceRef.current.getActivePeerConnections()
            console.log(`[CallModal] Cleaning up ${activePeerConnections.size} active peer connections`)

            // Use enhanced cleanup if available, otherwise fallback to standard
            if (typeof webrtcServiceRef.current.clearPeerConnections === 'function') {
              webrtcServiceRef.current.clearPeerConnections()
              console.log('[CallModal] ✅ WebRTC peer connections cleared, service preserved')
            } else {
              // Fallback to full cleanup
              webrtcServiceRef.current.cleanup()
              webrtcServiceRef.current = null
              console.log('[CallModal] ⚠️ Full WebRTC cleanup performed (no clearPeerConnections available)')
            }
          } catch (webrtcError) {
            console.error('[CallModal] Error during WebRTC cleanup:', webrtcError)
            // Force cleanup on error
            try {
              if (webrtcServiceRef.current) {
                webrtcServiceRef.current.cleanup()
                webrtcServiceRef.current = null
              }
            } catch (forceError) {
              console.error('[CallModal] Error during force cleanup:', forceError)
            }
          }
        }

        // SUBSEQUENT CALL FIX: Preserve local stream but stop tracks only when truly ending
        if (localStreamRef.current && forceCleanup) {
          console.log('[CallModal] 🎬 Stopping local stream tracks (forced cleanup)')
          localStreamRef.current.getTracks().forEach(track => {
            console.log('[CallModal] Stopping track:', track.kind, track.readyState)
            track.stop()
            console.log('[CallModal] ✅ Stopped track:', track.kind, track.readyState)
          })
          localStreamRef.current = null
        } else if (localStreamRef.current) {
          console.log('[CallModal] 🔄 Preserving local stream for subsequent calls')
        }

        // SUBSEQUENT CALL FIX: Clean remote stream UI state but preserve capability
        if (remoteStreams.size > 0) {
          console.log('[CallModal] 🎭 Cleaning remote streams UI state')
          if (forceCleanup) {
            // Only stop tracks on forced cleanup (modal closing)
            remoteStreams.forEach((stream, participantId) => {
              if (stream && typeof stream.getTracks === 'function') {
                stream.getTracks().forEach(track => {
                  console.log('[CallModal] Stopping remote track:', track.kind, 'for', participantId)
                  track.stop()
                })
              }
            })
          }
          setRemoteStreams(new Map())
        }

        // SUBSEQUENT CALL FIX: Only clean video elements on forced cleanup
        if (forceCleanup) {
          const videos = document.querySelectorAll('video')
          videos.forEach((video, index) => {
            if (video.srcObject) {
              console.log(`[CallModal] 📹 Cleaning video element ${index}`)
              video.srcObject = null
              video.load()
            }
          })
        }

        console.log('[CallModal] ✅ Simple cleanup completed')
      } catch (error) {
        console.warn('[CallModal] Error during aggressive media cleanup:', error)
      }
    }
    
    // SUBSEQUENT CALL FIX: Only cleanup screen share on forced cleanup
    if (forceCleanup) {
      try {
        // Cleanup screen share manager only on modal close
        if (screenShareManagerRef.current) {
          screenShareManagerRef.current.cleanup()
          screenShareManagerRef.current = null
          console.log('[CallModal] ✅ Cleaned up screen share manager (forced)')
        }
      } catch (error) {
        console.warn('[CallModal] Error cleaning screen share:', error)
      }
    } else {
      console.log('[CallModal] 🔄 Preserving screen share manager for subsequent calls')
    }
    
    console.log('[CallModal] ✅ CLEANUP COMPLETED')
  }, [stopOutgoingRingingSound, remoteStreams, callState.status, callId, session?.user?.id])

  // ENHANCED: Global cleanup on page unload to prevent resource leaks
  useEffect(() => {
    const handleBeforeUnload = () => {
      console.log('[CallModal] 🚨 Page unloading - emergency media cleanup')
      
      // Emergency media cleanup
      if (localStreamRef.current) {
        try {
          const tracks = localStreamRef.current.getTracks()
          console.log('[CallModal] Emergency stopping', tracks.length, 'tracks')
          tracks.forEach(track => track.stop())
          localStreamRef.current = null
        } catch (error) {
          console.error('[CallModal] Emergency cleanup error:', error)
        }
      }
    }
    
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const handleEndCall = () => {
    console.log('[CallModal] 🔴 ENDING CALL - User initiated via End Call button')
    console.log('[CallModal] Call ID:', callId)
    console.log('[CallModal] Call State:', callState.status) 
    console.log('[CallModal] Connected Participants:', callState.connectedParticipants)
    console.log('[CallModal] Stack trace:', new Error().stack?.split('\n').slice(1, 4).join('\n'))
    
    // Mark this as a user-initiated close
    userInitiatedCloseRef.current = true
    
    // Immediately cleanup resources to stop ringing and release microphone
    cleanupCallResources(true)
    
    // Emit end_call event to server with the correct callId
    if (socket && conversationId && callId && session?.user?.id) {
      console.log('[CallModal] Emitting end_call event')
      socket.emit('end_call', {
        conversationId,
        callId: callId, // Use the actual callId
        participantId: session.user.id
      })
    } else {
      console.warn('[CallModal] Missing required data for end_call:', {
        socket: !!socket,
        conversationId,
        callId,
        userId: session?.user?.id
      })
    }

    setCallState(prev => ({ ...prev, status: 'disconnected' }))
    onClose()
    
    // Refresh/reload the app after call ends
    setTimeout(() => {
      console.log('[CallModal] Refreshing app after call end')
      window.location.reload()
    }, 500) // Small delay to ensure cleanup is complete
  }

  const handleMinimize = () => {
    console.log('[CallModal] Minimizing call')
    setIsMinimized(!isMinimized)
  }

  const toggleMute = () => {
    const newMuted = !callState.isMuted

    // ENHANCED: Use WebRTC service for proper mute handling
    if (webrtcServiceRef.current) {
      const success = webrtcServiceRef.current.toggleLocalAudio(newMuted)
      if (success) {
        setCallState(prev => ({ ...prev, isMuted: newMuted }))
        console.log('[CallModal] ✅ Successfully toggled mute via WebRTC service:', newMuted)
      } else {
        console.error('[CallModal] ❌ Failed to toggle mute via WebRTC service')
        return // Don't update UI state if WebRTC toggle failed
      }
    } else {
      // Fallback: Direct track manipulation (legacy behavior)
      console.warn('[CallModal] ⚠️ WebRTC service not available, using fallback mute toggle')
      setCallState(prev => ({ ...prev, isMuted: newMuted }))

      if (localStreamRef.current) {
        const audioTracks = localStreamRef.current.getAudioTracks()
        audioTracks.forEach(track => {
          track.enabled = !newMuted
        })
        console.log('[CallModal] Fallback mute toggle:', newMuted, 'Audio tracks:', audioTracks.length)
      }

      // Manual broadcast for fallback mode
      if (socket && callId && session?.user?.id) {
        socket.emit('participant_mute_change', {
          callId,
          participantId: session.user.id,
          isMuted: newMuted
        })
      }
    }
  }

  const toggleCamera = () => {
    const newCameraOff = !callState.isCameraOff
    setCallState(prev => ({ ...prev, isCameraOff: newCameraOff }))
    
    // Enable/disable video tracks
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks()
      videoTracks.forEach(track => {
        track.enabled = !newCameraOff
      })
      
      console.log('[CallModal] Toggled camera:', newCameraOff, 'Video tracks:', videoTracks.length)
    }
    
    // CRITICAL: Notify other participants about camera state change
    if (socket && callId && session?.user?.id) {
      console.log('[CallModal] Broadcasting camera state change to other participants')
      socket.emit('participant_camera_change', {
        callId,
        participantId: session.user.id,
        isCameraOff: newCameraOff
      })
    }
  }

  const toggleScreenShare = async () => {
    try {
      if (!screenShareManagerRef.current) {
        console.error('[CallModal] Screen share manager not initialized')
        return
      }

      const { supported } = getScreenShareCapabilities()
      if (!supported) {
        console.error('[CallModal] Screen sharing not supported')
        return
      }

      if (callState.isScreenSharing) {
        // Stop screen sharing
        screenShareManagerRef.current.stopScreenShare()
        
        // AUTOMATICALLY RESTORE CAMERA if it was on before screen sharing
        const shouldRestoreCamera = (callState as CallState & { cameraOffBeforeScreenShare?: boolean }).cameraOffBeforeScreenShare
        if (shouldRestoreCamera) {
          console.log('[CallModal] 📷 Automatically restoring camera after screen sharing')
          setCallState(prev => ({ 
            ...prev, 
            isCameraOff: false,
            cameraOffBeforeScreenShare: undefined // Clear the flag
          }))
        }
        
        // SCREEN SHARING FIX: Replace video tracks back to camera for all peer connections
        if (webrtcServiceRef.current) {
          const peerConnections = webrtcServiceRef.current.getActivePeerConnections()
          console.log('[CallModal] 🔄 Restoring camera for', peerConnections.size, 'peer connections')
          
          // Use Promise.all to wait for all track replacements to complete
          const restorePromises = Array.from(peerConnections.entries()).map(async ([participantId, peerConn]) => {
            try {
              console.log(`[CallModal] Restoring camera for participant ${participantId}`)
              await screenShareManagerRef.current?.replaceVideoTrack(peerConn.connection, false)
              console.log(`[CallModal] ✅ Camera restored for participant ${participantId}`)
            } catch (error) {
              console.error(`[CallModal] Failed to restore camera for participant ${participantId}:`, error)
            }
          })
          
          await Promise.all(restorePromises)
        }
        
        // SCREEN SHARING FIX: Restore local video display with proper loading
        if (localVideoRef.current && localStreamRef.current) {
          console.log('[CallModal] 🔄 Restoring local video display')
          try {
            // Clear any existing stream first
            if (localVideoRef.current.srcObject) {
              localVideoRef.current.pause()
              localVideoRef.current.srcObject = null
            }
            
            // Wait a brief moment for cleanup
            await new Promise(resolve => setTimeout(resolve, 100))
            
            // Restore the original camera stream
            localVideoRef.current.srcObject = localStreamRef.current
            
            // Force video element to reload and play
            localVideoRef.current.load()
            localVideoRef.current.play().catch(error => {
              console.warn('[CallModal] Failed to play restored video:', error)
            })
            
            console.log('[CallModal] ✅ Local video display restored')
          } catch (error) {
            console.warn('[CallModal] Error restoring local video:', error)
          }
        }
        
        setCallState(prev => ({ ...prev, isScreenSharing: false }))
      } else {
        // Start screen sharing
        console.log('[CallModal] 🖥️ Starting screen share...')
        const screenStream = await screenShareManagerRef.current.startScreenShare({
          video: true,
          audio: false,
          systemAudio: false
        })
        
        console.log('[CallModal] ✅ Screen stream acquired:', {
          id: screenStream.id,
          active: screenStream.active,
          videoTracks: screenStream.getVideoTracks().length,
          videoTrack: screenStream.getVideoTracks()[0]?.readyState
        })
        
        // AUTOMATICALLY TURN OFF CAMERA when screen sharing starts
        const wasUsingCamera = !callState.isCameraOff
        if (wasUsingCamera) {
          console.log('[CallModal] 📷 Automatically turning off camera for screen sharing')
          setCallState(prev => ({ 
            ...prev, 
            isCameraOff: true,
            cameraOffBeforeScreenShare: true // Remember camera was on
          }))
        }
        
        // SCREEN SHARING FIX: Replace video tracks with screen share for all peer connections
        if (webrtcServiceRef.current) {
          const peerConnections = webrtcServiceRef.current.getActivePeerConnections()
          console.log('[CallModal] 📡 Sharing screen with', peerConnections.size, 'peer connections')
          
          // Use Promise.all to wait for all track replacements to complete
          const sharePromises = Array.from(peerConnections.entries()).map(async ([participantId, peerConn]) => {
            try {
              console.log(`[CallModal] Sharing screen with participant ${participantId}`)
              await screenShareManagerRef.current?.replaceVideoTrack(peerConn.connection, true)
              console.log(`[CallModal] ✅ Screen shared with participant ${participantId}`)
            } catch (error) {
              console.error(`[CallModal] Failed to share screen with participant ${participantId}:`, error)
            }
          })
          
          await Promise.all(sharePromises)
        }
        
        // SCREEN SHARING FIX: Update local video display with proper loading
        if (localVideoRef.current) {
          console.log('[CallModal] 🔄 Updating local video display with screen share')
          try {
            localVideoRef.current.srcObject = screenStream
            // Force video element to load the new stream
            localVideoRef.current.load()
            console.log('[CallModal] ✅ Local screen preview updated')
          } catch (error) {
            console.warn('[CallModal] Error updating local screen preview:', error)
          }
        }
        
        setCallState(prev => ({ ...prev, isScreenSharing: true }))
      }
    } catch (error) {
      console.error('[CallModal] Screen share toggle failed:', error)
      // Show user-friendly error message
      setConnectionErrors(prev => new Map(prev.set('screenShare', 
        error instanceof Error ? error.message : 'Failed to toggle screen sharing'
      )))
      
      // Clear error after 5 seconds
      setTimeout(() => {
        setConnectionErrors(prev => {
          const newErrors = new Map(prev)
          newErrors.delete('screenShare')
          return newErrors
        })
      }, 5000)
    }
  }

  // Accept incoming call
  const handleAcceptCall = useCallback(async () => {
    console.log('[CallModal] 📞 handleAcceptCall called for', callType, 'call')
    console.log('[CallModal] Socket available:', !!socket)
    console.log('[CallModal] CallId:', callId)
    console.log('[CallModal] Session user ID:', session?.user?.id)
    console.log('[CallModal] ConversationId:', conversationId)
    
    if (socket && callId && session?.user?.id && conversationId) {
      console.log(`[CallModal] ✅ All requirements met, accepting ${callType} call:`, callId)
      
      // CRITICAL: Accept the call FIRST, then initialize media
      // This prevents WebRTC failures from blocking call acceptance
      console.log('[CallModal] 🚀 STEP 1: Sending call acceptance to server...')
      
      // Mark that this user has explicitly accepted the call
      userHasAcceptedCall.current = true
      
      socket.emit('call_response', {
        callId,
        conversationId,
        accepted: true,
        participantId: session.user.id
      })
      
      console.log('[CallModal] ✅ Call acceptance sent successfully!')
      console.log('[CallModal] 🎥 STEP 2: Now initializing media streams...')
      
      // Update state to reflect acceptance before media initialization
      setCallState(prev => ({ 
        ...prev, 
        status: 'connecting',
        connectedParticipants: prev.connectedParticipants || 1
      }))
      
      // CRITICAL: Immediately stop ringing when accepting call
      stopOutgoingRingingSound()
      
      // Update our own participant state
      setParticipantConnectionStates(prev => {
        const updated = new Map(prev)
        if (session?.user?.id) {
          updated.set(session.user.id, 'connecting')
        }
        return updated
      })
      
      // Now try to initialize WebRTC - if it fails, call is still accepted
      try {
        if (!webrtcServiceRef.current && callId) {
          console.log(`[CallModal] Initializing WebRTC for accepted ${callType} call`)

          webrtcServiceRef.current = new WebRTCService(socket, session.user.id)

          // Set up audio state synchronization callback
          webrtcServiceRef.current.onRemoteAudioStateChanged = (participantId: string, isMuted: boolean, isEnabled: boolean) => {
            setParticipantMuteStates(prev => {
              const newStates = new Map(prev)
              newStates.set(participantId, isMuted || !isEnabled)
              return newStates
            })
          }
          
          // ENHANCED: Try video first, gracefully fall back to audio-only
          let stream: MediaStream | null = null
          let mediaType = callType
          
          try {
            console.log(`[CallModal] 🎥 Attempting ${callType} stream initialization...`)
            stream = await webrtcServiceRef.current.initializeCall(callId, callType === 'video')
            
            const hasVideo = stream.getVideoTracks().length > 0
            const hasAudio = stream.getAudioTracks().length > 0
            
            console.log(`[CallModal] ✅ Stream initialized successfully:`, {
              requestedType: callType,
              hasVideo,
              hasAudio,
              trackCount: stream.getTracks().length
            })
            
            if (callType === 'video' && !hasVideo) {
              console.warn('[CallModal] ⚠️ Video requested but not available - using audio only')
              mediaType = 'voice' // Effectively downgrade to voice call
              setConnectionErrors(prev => new Map(prev.set('video', 'Camera not available - joined with audio only')))
            }
            
          } catch (streamError) {
            console.error(`[CallModal] ❌ ${callType} stream failed:`, streamError instanceof Error ? streamError.message : String(streamError))
            
            // For video calls, try audio-only fallback
            if (callType === 'video') {
              console.log('[CallModal] 🔄 Attempting audio-only fallback...')
              try {
                stream = await webrtcServiceRef.current.initializeCall(callId, false)
                mediaType = 'voice'
                console.log('[CallModal] ✅ Audio-only fallback successful')
                setConnectionErrors(prev => new Map(prev.set('video', 'Camera failed - joined with audio only')))
              } catch (fallbackError) {
                console.error('[CallModal] ❌ Audio fallback failed:', fallbackError instanceof Error ? fallbackError.message : String(fallbackError))
                throw new Error('Cannot access microphone: ' + (fallbackError instanceof Error ? fallbackError.message : String(fallbackError)))
              }
            } else {
              throw new Error('Cannot access microphone: ' + (streamError instanceof Error ? streamError.message : String(streamError)))
            }
          }
          
          if (stream) {
            localStreamRef.current = stream
            
            // CRITICAL FIX: Notify WebRTC service that stream is set
            webrtcServiceRef.current.setLocalStream(stream)
            console.log('[CallModal] ✅ Notified WebRTC service of local stream (incoming call)')
            
            // Immediately notify server about stream readiness for incoming call
            if (socket?.connected) {
              const streamData = {
                callId,
                participantId: session.user.id,
                streamId: stream.id,
                hasAudio: stream.getAudioTracks().length > 0,
                hasVideo: stream.getVideoTracks().length > 0
              }
              
              console.log('[CallModal] 📡 Notifying server that accepted call stream is ready:', streamData)
              socket.emit('webrtc_stream_ready', streamData)
              
              // Additional reliability: retry after delay
              setTimeout(() => {
                if (socket?.connected) {
                  console.log('[CallModal] 📡 Sending backup stream ready notification for accepted call')
                  socket.emit('webrtc_stream_ready', streamData)
                }
              }, 1000)
            }
            
            // Initialize screen share manager for video calls
            if (mediaType === 'video' && !screenShareManagerRef.current) {
              try {
                screenShareManagerRef.current = new ScreenShareManager((screenStream) => {
                  if (screenStream) {
                    console.log('[CallModal] Screen share started')
                  } else {
                    console.log('[CallModal] Screen share stopped')
                    setCallState(prev => ({ ...prev, isScreenSharing: false }))
                  }
                })
                screenShareManagerRef.current.setOriginalStream(stream)
              } catch (screenShareError) {
                console.warn('[CallModal] Screen share setup failed:', screenShareError instanceof Error ? screenShareError.message : String(screenShareError))
              }
            }
            
            console.log(`[CallModal] 🎵 Local ${mediaType} stream ready:`, stream.getTracks().map(t => t.kind))
            
            // Notify server about stream readiness (with delay for proper setup)
            setTimeout(() => {
              if (socket?.connected && session?.user?.id && callId && webrtcServiceRef.current) {
                const streamData = {
                  callId,
                  participantId: session.user.id,
                  streamId: stream!.id,
                  hasAudio: stream!.getAudioTracks().length > 0,
                  hasVideo: stream!.getVideoTracks().length > 0
                }
                
                console.log('[CallModal] 📡 Notifying server about stream readiness:', streamData)
                
                // Enhanced debugging for video call acceptance issues
                console.log('[CallModal] 🔍 DEBUG - Stream diagnostic info:', {
                  streamId: stream!.id,
                  audioTracks: stream!.getAudioTracks().map(t => ({
                    kind: t.kind,
                    enabled: t.enabled,
                    readyState: t.readyState,
                    muted: t.muted,
                    label: t.label
                  })),
                  videoTracks: stream!.getVideoTracks().map(t => ({
                    kind: t.kind,
                    enabled: t.enabled,
                    readyState: t.readyState,
                    muted: t.muted,
                    label: t.label
                  })),
                  callType,
                  callId,
                  participantId: session.user.id
                })
                
                socket.emit('webrtc_stream_ready', streamData)
                
              } else {
                console.warn('[CallModal] ⚠️ Cannot notify server about stream - connection lost')
              }
            }, 300) // Reduced delay for faster connection
          }
          
        } else {
          console.log('[CallModal] WebRTC already initialized')
        }
        
        console.log('[CallModal] 🎉 Call acceptance and media initialization completed!')
        
        // Removed auto-transition test mode logic that was causing auto-join issues
        
      } catch (mediaError) {
        console.error('[CallModal] ❌ Media initialization failed after call acceptance:', mediaError instanceof Error ? mediaError.message : String(mediaError))
        
        // Set error but don't fail the call acceptance
        setConnectionErrors(prev => new Map(prev.set('media', 
          `Media access failed: ${mediaError instanceof Error ? mediaError.message : String(mediaError)}. You're in the call but others may not hear/see you.`
        )))
        
        // Still continue with the call, just without local media
        console.log('[CallModal] ⚠️ Continuing with call despite media failure')
      }
      
    } else {
      console.error('[CallModal] ❌ Cannot accept call - missing requirements:', {
        hasSocket: !!socket,
        hasCallId: !!callId,
        hasSession: !!session?.user?.id,
        hasConversationId: !!conversationId
      })
    }
  }, [socket, callId, session?.user?.id, conversationId, callType])

  // Decline incoming call
  const handleDeclineCall = useCallback(() => {
    console.log('[CallModal] Declining call:', callId)
    
    // Mark this as a user-initiated close
    userInitiatedCloseRef.current = true
    
    // Mark that this user has explicitly declined the call
    userHasAcceptedCall.current = false
    
    // Immediately cleanup resources to stop ringing
    cleanupCallResources(true)
    
    if (socket && callId && session?.user?.id) {
      socket.emit('call_response', {
        callId,
        conversationId,
        accepted: false,
        participantId: session.user.id
      })
    }
    onClose()
  }, [callId, socket, session?.user?.id, conversationId, onClose])

  // Enhanced error boundary and validation
  if (!isOpen) {
    return null
  }

  if (!callId || !conversationId) {
    console.error('[CallModal] Missing required props:', {
      hasCallId: !!callId,
      hasConversationId: !!conversationId
    })
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-8">
          <div className="text-center">
            <p className="text-red-600 mb-4">Call Error</p>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Unable to initialize call. Missing required information.
            </p>
            <button 
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Wait for session to load with timeout
  if (!session?.user?.id) {
    console.log('[CallModal] Waiting for session to load...')
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-400">Loading call...</p>
            <button 
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }


  // Component for individual participant with voice activity detection
  const VoiceParticipant = ({ 
    participant, 
    stream 
  }: { 
    participant: CallParticipant, 
    stream?: MediaStream 
  }) => {
    // AUDIO INDICATOR FIX: Use remoteStreams directly to ensure latest stream reference
    const latestStream = remoteStreams.get(participant.id) || stream
    
    const { isSpeaking } = useVoiceActivity({ 
      stream: latestStream || null,
      threshold: -40 // More sensitive threshold for better detection
    })

    // Get server-provided mute state with fallback to stream-based detection
    const serverMuteState = participantMuteStates.get(participant.id)
    const streamBasedMuted = useMemo(() => {
      if (!latestStream) return false // AUDIO INDICATOR FIX: Use latest stream reference
      const audioTracks = latestStream.getAudioTracks()
      return audioTracks.length === 0 || audioTracks.every(track => !track.enabled)
    }, [latestStream])
    
    // AUDIO INDICATOR FIX: Use server state if available, otherwise assume unmuted during connection setup
    const isActuallyMuted = serverMuteState !== undefined ? serverMuteState : (latestStream ? streamBasedMuted : false)
    
    // PERFORMANCE FIX: Reduced logging frequency to prevent browser slowdown
    // Only log when there are significant state changes or issues
    const shouldLogDebug = React.useRef(0)
    if (shouldLogDebug.current % 50 === 0) { // Log every 50th render to reduce noise
      console.log(`[VoiceParticipant] ${participant.name} voice activity debug:`, {
        participantId: participant.id,
        hasOriginalStream: !!stream,
        hasLatestStream: !!latestStream,
        streamActive: latestStream?.active,
        audioTracksCount: latestStream?.getAudioTracks().length || 0,
        isSpeaking,
        serverMuteState,
        streamBasedMuted,
        finalMuteState: isActuallyMuted,
        renderCount: shouldLogDebug.current
      })
    }
    shouldLogDebug.current++

    return (
      <div className="flex flex-col items-center relative bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-2xl p-6 backdrop-blur-sm border border-slate-700/50 transition-all duration-300 hover:scale-105">
        {/* Connection Status Indicator */}
        <div className={`absolute top-2 right-2 w-3 h-3 rounded-full ${
          participant.participantStatus === 'connected' ? 'bg-green-500' :
          participant.participantStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
          participant.participantStatus === 'ringing' ? 'bg-blue-500 animate-pulse' :
          'bg-gray-500'
        }`} />

        <div className="relative">
          {participant.avatar ? (
            <img
              src={participant.avatar}
              alt={participant.name}
              className={`w-24 h-24 rounded-2xl object-cover mb-3 transition-all duration-200 shadow-lg ${
                isSpeaking && !isActuallyMuted ? 'ring-4 ring-green-500 ring-opacity-75 shadow-green-500/25' : 
                'shadow-slate-900/50'
              }`}
            />
          ) : (
            <div className={`w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mb-3 transition-all duration-200 shadow-lg ${
              isSpeaking && !isActuallyMuted ? 'ring-4 ring-green-500 ring-opacity-75 shadow-green-500/25' : 
              'shadow-slate-900/50'
            }`}>
              <span className="text-white text-2xl font-bold">
                {participant.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          
          {/* Enhanced mute indicator with modern design */}
          {(participant.isMuted || isActuallyMuted) && (
            <div className="absolute -bottom-1 -right-1 bg-red-500 text-white p-2 rounded-xl border-2 border-slate-900 shadow-lg">
              <MicOff className="w-3 h-3" />
            </div>
          )}

          {/* Speaking indicator */}
          {isSpeaking && !isActuallyMuted && (
            <div className="absolute -top-1 -left-1 bg-green-500 text-white p-2 rounded-xl border-2 border-slate-900 shadow-lg animate-pulse">
              <Mic className="w-3 h-3" />
            </div>
          )}
        </div>
        
        <div className="text-center">
          <p className="text-white text-sm font-medium mb-1">
            {participant.name || participant.username}
          </p>
          
          {/* Status text with better styling */}
          <div className="flex items-center justify-center space-x-2 text-xs">
            {participant.participantStatus !== 'connected' ? (
              <span className={`px-2 py-1 rounded-full ${
                participant.participantStatus === 'ringing' ? 'bg-blue-500/20 text-blue-300' :
                participant.participantStatus === 'connecting' ? 'bg-yellow-500/20 text-yellow-300' : 
                participant.participantStatus === 'connected' ? 'bg-green-500/20 text-green-300' :
                'bg-gray-500/20 text-gray-300'
              }`}>
                {participant.participantStatus === 'ringing' ? 'Ringing' :
                 participant.participantStatus === 'connecting' ? 'Connecting' : 
                 participant.participantStatus === 'connected' ? 'Connected' :
                 'Waiting'}
              </span>
            ) : (
              <>
                {(participant.isMuted || isActuallyMuted) && (
                  <span className="px-2 py-1 rounded-full bg-red-500/20 text-red-300">
                    Muted
                  </span>
                )}
                {!participant.isMuted && !isActuallyMuted && (
                  <span className="px-2 py-1 rounded-full bg-green-500/20 text-green-300">
                    Active
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="call-modal-title" aria-describedby="call-modal-description">
      {/* Screen reader announcements */}
      <div 
        className="sr-only" 
        role="status" 
        aria-live="polite" 
        aria-atomic="true"
      >
        {screenReaderAnnouncement}
      </div>
      
      {/* Keyboard shortcuts help */}
      <div className="sr-only">
        <p>Keyboard shortcuts: Space or Ctrl+M to mute, Ctrl+V to toggle camera, Ctrl+S to share screen, Escape to end call, Enter to accept incoming call</p>
      </div>

      <div className="flex items-center justify-center min-h-screen">
        {/* Background overlay with blur effect */}
        <div className="fixed inset-0 backdrop-blur-sm bg-black/80 transition-all duration-300" onClick={handleEndCall} />

        {/* Modern Call Interface */}
        <div className={`relative mx-auto flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 shadow-2xl overflow-hidden transition-all duration-300 ${
          isMinimized 
            ? 'fixed bottom-4 right-4 w-80 h-60 rounded-2xl z-50' 
            : 'w-full h-full max-w-7xl md:h-auto md:max-h-[90vh] md:rounded-3xl md:my-4'
        }`}>
          {/* Modern Header with improved layout */}
          <div className="flex-shrink-0 px-4 py-4 md:px-8 md:py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  {isGroupCall ? (
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
                      <Users className="w-5 h-5 text-white" />
                    </div>
                  ) : (
                    <div className="relative">
                      {participants[0]?.avatar ? (
                        <img 
                          src={participants[0].avatar} 
                          alt={participants[0].name}
                          className="w-10 h-10 rounded-xl object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center">
                          <span className="text-white text-sm font-medium">
                            {participants[0]?.name?.charAt(0)?.toUpperCase() || 'U'}
                          </span>
                        </div>
                      )}
                      <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-slate-900 ${
                        callState.status === 'connected' ? 'bg-green-500' :
                        callState.status === 'connecting' ? 'bg-yellow-500' :
                        callState.status === 'ringing' ? 'bg-blue-500 animate-pulse' :
                        'bg-gray-500'
                      }`} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h1 id="call-modal-title" className="text-lg md:text-xl font-semibold text-white truncate">
                    {isGroupCall ? (conversationName || 'Group Call') : 
                     (participants[0]?.name || participants[0]?.username || 'Call')}
                  </h1>
                  <div id="call-modal-description" className="sr-only">
                    {callType === 'video' ? 'Video call' : 'Voice call'} 
                    {isGroupCall ? ` with ${participants.length} participants` : 
                     ` with ${participants[0]?.name || 'unknown participant'}`}.
                    Current status: {callState.status}. 
                    {callState.status === 'connected' ? `Duration: ${formatDuration(callState.duration)}` : ''}
                  </div>
                  <div className="flex items-center space-x-2 text-sm">
                    <span className={`text-sm ${
                      callState.status === 'connected' ? 'text-green-400' :
                      callState.status === 'connecting' ? 'text-yellow-400' :
                      callState.status === 'ringing' ? 'text-blue-400' :
                      'text-gray-400'
                    }`}>
                      {statusText}
                    </span>
                    {isGroupCall && (
                      <>
                        <span className="text-gray-500">•</span>
                        <span className="text-gray-400">{totalInvitedCount} invited</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Timer and control buttons */}
              <div className="flex items-center space-x-3">
                {callState.status === 'connected' && (
                  <div className="text-right">
                    <div className="text-lg md:text-xl font-mono font-medium text-white">
                      {formatDuration(callState.duration)}
                    </div>
                    <div className="text-xs text-gray-400">Call duration</div>
                  </div>
                )}
                
                {/* Minimize button */}
                <button
                  onClick={handleMinimize}
                  className="w-8 h-8 bg-slate-700/50 hover:bg-slate-600/70 rounded-lg flex items-center justify-center transition-colors"
                  aria-label={isMinimized ? "Maximize call" : "Minimize call"}
                >
                  <Minimize2 className="w-4 h-4 text-gray-300" />
                </button>
              </div>
            </div>
          </div>

          {/* Enhanced Error Messages - Hidden when minimized */}
          {!isMinimized && connectionErrors.size > 0 && (
            <div className="px-4 md:px-8 pb-4">
              <div className="space-y-3">
                {Array.from(connectionErrors.entries()).map(([key, error]) => (
                  <div key={key} className="relative overflow-hidden bg-red-500/10 border border-red-500/20 rounded-xl p-4 backdrop-blur-sm">
                    <div className="flex items-start space-x-3">
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 bg-red-500/20 rounded-lg flex items-center justify-center">
                          <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-red-200 text-sm font-medium">{error}</p>
                      </div>
                      <button 
                        onClick={() => setConnectionErrors(prev => {
                          const newErrors = new Map(prev)
                          newErrors.delete(key)
                          return newErrors
                        })}
                        className="flex-shrink-0 w-6 h-6 bg-red-500/20 hover:bg-red-500/30 rounded-md flex items-center justify-center transition-colors"
                        aria-label="Dismiss error"
                      >
                        <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Connection status indicator - Hidden when minimized */}
          {!isMinimized && (callState.status === 'connecting' || callState.status === 'ringing') && (
            <div className="px-4 md:px-8 pb-4">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 backdrop-blur-sm">
                <div className="flex items-center justify-center space-x-3">
                  <div className="relative">
                    <div className="w-4 h-4 bg-blue-500 rounded-full animate-pulse" />
                    <div className="absolute inset-0 w-4 h-4 bg-blue-500 rounded-full animate-ping" />
                  </div>
                  <span className="text-blue-200 text-sm font-medium">
                    {callState.status === 'connecting' ? 'Connecting to participants...' : 'Calling...'}
                  </span>
                </div>
              </div>
            </div>
          )}


          {/* Video/Participants Area - Hidden when minimized */}
          {!isMinimized && (
          <div className="mb-8">
            {callType === 'video' ? (
              <VideoGrid
                localStream={localStreamRef.current}
                remoteStreams={remoteStreams}
                participants={(() => {
                  const filteredParticipants = connectedParticipants.filter(p => p.id !== session?.user?.id)
                  console.log('[CallModal] VideoGrid participants:', {
                    total: connectedParticipants.length,
                    filtered: filteredParticipants.length,
                    currentUserId: session?.user?.id,
                    participantNames: filteredParticipants.map(p => `${p.name} (${p.id})`)
                  })
                  return filteredParticipants
                })()}
                currentUserId={session?.user?.id || ''}
                isLocalCameraOff={callState.isCameraOff}
                isLocalMuted={callState.isMuted}
                onVideoRef={(participantId, element) => {
                  if (element) {
                    remoteVideoRefs.current.set(participantId, element)
                  } else {
                    remoteVideoRefs.current.delete(participantId)
                  }
                }}
              />
            ) : (
              /* Voice call or waiting participants */
              <>
                {/* Hidden audio elements for voice calls */}
                {remoteStreams.size > 0 && Array.from(remoteStreams.entries()).map(([participantId, stream]) => (
                  <audio
                    key={participantId}
                    ref={(element) => {
                      if (element && stream) {
                        // SUBSEQUENT CALL FIX: Always refresh audio element setup for reliable audio reception
                        console.log(`[CallModal] 🔊 Setting up audio element for participant ${participantId}`)
                        console.log(`[CallModal] Stream details:`, {
                          id: stream.id,
                          active: stream.active,
                          audioTracks: stream.getAudioTracks().map(t => ({
                            kind: t.kind,
                            enabled: t.enabled,
                            readyState: t.readyState,
                            label: t.label,
                            muted: t.muted
                          }))
                        })
                        
                        // SUBSEQUENT CALL FIX: Always reset audio element to ensure clean state
                        const existingElement = remoteAudioRefs.current.get(participantId)
                        console.log(`[CallModal] Previous audio element for ${participantId}:`, !!existingElement)
                        
                        remoteAudioRefs.current.set(participantId, element)
                        
                        // CRITICAL: Always clear any previous srcObject to prevent conflicts
                        if (element.srcObject) {
                          element.pause()
                          element.srcObject = null
                          element.load()
                          console.log(`[CallModal] Cleared previous srcObject for ${participantId}`)
                        }
                        
                        // FIRST CALL FIX: Ensure audio tracks are properly enabled before setting srcObject
                        const audioTracks = stream.getAudioTracks()
                        audioTracks.forEach(track => {
                          if (!track.enabled) {
                            console.log(`[CallModal] 🔧 Enabling disabled remote audio track for ${participantId}`)
                            track.enabled = true
                          }
                        })
                        
                        // Set up audio element with proper configuration
                        element.srcObject = stream
                        element.volume = 1.0
                        element.muted = false
                        element.autoplay = true
                        
                        // CRITICAL FIX: Prevent audio play race conditions
                        let playAttemptInProgress = false

                        const attemptPlay = async () => {
                          // Prevent multiple concurrent play attempts
                          if (playAttemptInProgress) {
                            console.log(`[CallModal] ⏸️ Play attempt already in progress for ${participantId}, skipping`)
                            return
                          }

                          playAttemptInProgress = true

                          try {
                            // Pause any existing playback first to prevent conflicts
                            if (!element.paused) {
                              element.pause()
                              await new Promise(resolve => setTimeout(resolve, 50)) // Brief pause
                            }

                            // Wait for stream to be ready
                            if (stream.active && audioTracks.length > 0) {
                              await element.play()
                              console.log(`[CallModal] ✅ Audio playing immediately for participant ${participantId}`)
                            } else {
                              console.log(`[CallModal] 🔄 Stream not ready, waiting...`)
                              throw new Error('Stream not ready')
                            }
                          } catch (error) {
                            console.warn(`[CallModal] ❌ Initial audio play failed for ${participantId}:`, error)

                            // Single retry strategy after ensuring element is ready
                            if (!stream.active || audioTracks.length === 0) {
                              console.log(`[CallModal] 🔄 Waiting for stream to become active for ${participantId}`)

                              // Wait for stream with timeout
                              const streamReadyPromise = new Promise<void>((resolve, reject) => {
                                const checkActiveStream = () => {
                                  if (stream.active && stream.getAudioTracks().length > 0) {
                                    resolve()
                                  } else {
                                    setTimeout(checkActiveStream, 100)
                                  }
                                }
                                setTimeout(() => reject(new Error('Stream timeout')), 5000) // 5 second timeout
                                checkActiveStream()
                              })

                              try {
                                await streamReadyPromise
                                await element.play()
                                console.log(`[CallModal] ✅ Audio playing after stream became active for ${participantId}`)
                              } catch (streamError) {
                                console.warn(`[CallModal] Stream wait or play failed for ${participantId}:`, streamError)
                              }
                            }
                          } finally {
                            playAttemptInProgress = false
                          }
                        }
                        
                        // Try immediate play
                        attemptPlay()
                        
                        // Set up event listeners for additional play attempts
                        element.addEventListener('loadeddata', () => {
                          console.log(`[CallModal] Audio loadeddata event for ${participantId}`)
                          if (!playAttemptInProgress) {
                            attemptPlay()
                          }
                        }, { once: true })

                        element.addEventListener('canplay', () => {
                          console.log(`[CallModal] Audio canplay event for ${participantId}`)
                          if (!playAttemptInProgress) {
                            attemptPlay()
                          }
                        }, { once: true })
                      } else {
                        remoteAudioRefs.current.delete(participantId)
                      }
                    }}
                    autoPlay
                    playsInline
                    controls={false}
                    style={{ display: 'none' }}
                    onCanPlay={() => console.log(`[CallModal] Audio can play for ${participantId}`)}
                    onPlaying={() => console.log(`[CallModal] Audio is playing for ${participantId}`)}
                    onError={(e) => console.error(`[CallModal] Audio error for ${participantId}:`, e)}
                  />
                ))}
                
                <div className="py-12">
                {callState.status === 'connected' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {/* Current user with modern interface matching participants */}
                    <div className="flex flex-col items-center relative bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-2xl p-6 backdrop-blur-sm border border-slate-700/50 transition-all duration-300 hover:scale-105">
                      {/* Connection Status Indicator - Always green for current user */}
                      <div className="absolute top-2 right-2 w-3 h-3 rounded-full bg-green-500" />
                      
                      <div className="relative">
                        {session?.user?.image ? (
                          <img
                            src={session.user.image}
                            alt="You"
                            className={`w-24 h-24 rounded-2xl object-cover mb-3 transition-all duration-200 shadow-lg ${
                              isLocalSpeaking && !callState.isMuted ? 'ring-4 ring-green-500 ring-opacity-75 shadow-green-500/25' : 
                              'shadow-slate-900/50'
                            }`}
                          />
                        ) : (
                          <div className={`w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mb-3 transition-all duration-200 shadow-lg ${
                            isLocalSpeaking && !callState.isMuted ? 'ring-4 ring-green-500 ring-opacity-75 shadow-green-500/25' : 
                            'shadow-slate-900/50'
                          }`}>
                            <span className="text-white text-2xl font-bold">
                              {session?.user?.name?.charAt(0)?.toUpperCase() || 'Y'}
                            </span>
                          </div>
                        )}
                        
                        {/* Enhanced mute indicator with modern design */}
                        {callState.isMuted && (
                          <div className="absolute -bottom-1 -right-1 bg-red-500 text-white p-2 rounded-xl border-2 border-slate-900 shadow-lg">
                            <MicOff className="w-3 h-3" />
                          </div>
                        )}

                        {/* Speaking indicator */}
                        {isLocalSpeaking && !callState.isMuted && (
                          <div className="absolute -top-1 -left-1 bg-green-500 text-white p-2 rounded-xl border-2 border-slate-900 shadow-lg animate-pulse">
                            <Mic className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                      
                      <div className="text-center">
                        <p className="text-white text-sm font-medium mb-1">
                          {session?.user?.name || 'You'}
                        </p>
                        
                        {/* Status text with better styling */}
                        <div className="flex items-center justify-center space-x-2 text-xs">
                          {callState.isMuted ? (
                            <span className="px-2 py-1 rounded-full bg-red-500/20 text-red-300">
                              Muted
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded-full bg-green-500/20 text-green-300">
                              Active
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Connected participants with voice activity */}
                    {connectedParticipants.filter(p => p.id !== session?.user?.id).map((participant) => (
                      <VoiceParticipant 
                        key={participant.id}
                        participant={participant}
                        stream={remoteStreams.get(participant.id)}
                      />
                    ))}
                  </div>
                ) : (
                  /* Calling state */
                  <div className="flex flex-col items-center">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                      {connectedParticipants.filter(p => p.id !== session?.user?.id).map((participant) => (
                        <VoiceParticipant 
                          key={participant.id}
                          participant={participant}
                          stream={remoteStreams.get(participant.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
                </div>
              </>
            )}
          </div>
          )}

          {/* Modern Call Controls - Hidden when minimized */}
          {!isMinimized && (
          <div className="flex-shrink-0 px-4 py-6 md:px-8">
            {/* Incoming call controls - show for all incoming calls including group calls */}
            {isIncoming && callState.status === 'ringing' && (
              <div className="flex justify-center items-center space-x-8">
                <div className="flex flex-col items-center space-y-3">
                  <button
                    onClick={handleDeclineCall}
                    className="group relative w-16 h-16 md:w-18 md:h-18 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 rounded-full flex items-center justify-center transition-all duration-200 transform hover:scale-105 active:scale-95 shadow-lg hover:shadow-red-500/25"
                    aria-label="Decline call"
                    role="button"
                  >
                    <PhoneOff className="w-7 h-7 md:w-8 md:h-8 text-white" />
                    <div className="absolute inset-0 rounded-full bg-white/0 group-hover:bg-white/10 transition-colors" />
                  </button>
                  <span className="text-sm text-gray-400 font-medium">Decline</span>
                </div>
                
                <div className="flex flex-col items-center space-y-3">
                  <button
                    onClick={handleAcceptCall}
                    className="group relative w-16 h-16 md:w-18 md:h-18 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 rounded-full flex items-center justify-center transition-all duration-200 transform hover:scale-105 active:scale-95 shadow-lg hover:shadow-green-500/25"
                    aria-label="Accept call"
                    role="button"
                  >
                    <svg className="w-7 h-7 md:w-8 md:h-8 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                    </svg>
                    <div className="absolute inset-0 rounded-full bg-white/0 group-hover:bg-white/10 transition-colors" />
                  </button>
                  <span className="text-sm text-gray-400 font-medium">Accept</span>
                </div>
              </div>
            )}
            
            {/* Connected call controls */}
            {!(isIncoming && callState.status === 'ringing') && (
              <div className="flex justify-center items-center space-x-3 md:space-x-4">
                {/* Mute control */}
                {callState.status === 'connected' && (
                  <div className="flex flex-col items-center space-y-2">
                    <button
                      onClick={toggleMute}
                      className={`group relative w-12 h-12 md:w-14 md:h-14 rounded-xl flex items-center justify-center transition-all duration-200 transform hover:scale-105 active:scale-95 ${
                        callState.isMuted
                          ? 'bg-red-500/90 hover:bg-red-500 shadow-lg shadow-red-500/25'
                          : 'bg-slate-700/90 hover:bg-slate-600 shadow-lg shadow-slate-500/25'
                      }`}
                      aria-label={callState.isMuted ? 'Unmute microphone' : 'Mute microphone'}
                      aria-pressed={callState.isMuted}
                    >
                      {callState.isMuted ? (
                        <MicOff className="w-5 h-5 md:w-6 md:h-6 text-white" aria-hidden="true" />
                      ) : (
                        <Mic className="w-5 h-5 md:w-6 md:h-6 text-white" aria-hidden="true" />
                      )}
                      <div className="absolute inset-0 rounded-xl bg-white/0 group-hover:bg-white/10 transition-colors" />
                    </button>
                    <span className="text-xs text-gray-400 font-medium hidden md:block">
                      {callState.isMuted ? 'Muted' : 'Mic'}
                    </span>
                  </div>
                )}

                {/* Camera control (video calls only) */}
                {callType === 'video' && callState.status === 'connected' && (
                  <div className="flex flex-col items-center space-y-2">
                    <button
                      onClick={toggleCamera}
                      className={`group relative w-12 h-12 md:w-14 md:h-14 rounded-xl flex items-center justify-center transition-all duration-200 transform hover:scale-105 active:scale-95 ${
                        callState.isCameraOff
                          ? 'bg-red-500/90 hover:bg-red-500 shadow-lg shadow-red-500/25'
                          : 'bg-slate-700/90 hover:bg-slate-600 shadow-lg shadow-slate-500/25'
                      }`}
                      aria-label={callState.isCameraOff ? 'Turn on camera' : 'Turn off camera'}
                      aria-pressed={callState.isCameraOff}
                    >
                      {callState.isCameraOff ? (
                        <CameraOff className="w-5 h-5 md:w-6 md:h-6 text-white" aria-hidden="true" />
                      ) : (
                        <Camera className="w-5 h-5 md:w-6 md:h-6 text-white" aria-hidden="true" />
                      )}
                      <div className="absolute inset-0 rounded-xl bg-white/0 group-hover:bg-white/10 transition-colors" />
                    </button>
                    <span className="text-xs text-gray-400 font-medium hidden md:block">
                      {callState.isCameraOff ? 'Camera off' : 'Camera'}
                    </span>
                  </div>
                )}

                {/* Screen share control (video calls only) */}
                {callType === 'video' && callState.status === 'connected' && (
                  <div className="flex flex-col items-center space-y-2">
                    <button
                      onClick={toggleScreenShare}
                      className={`group relative w-12 h-12 md:w-14 md:h-14 rounded-xl flex items-center justify-center transition-all duration-200 transform hover:scale-105 active:scale-95 ${
                        callState.isScreenSharing
                          ? 'bg-blue-500/90 hover:bg-blue-500 shadow-lg shadow-blue-500/25'
                          : 'bg-slate-700/90 hover:bg-slate-600 shadow-lg shadow-slate-500/25'
                      }`}
                      aria-label={callState.isScreenSharing ? 'Stop screen sharing' : 'Start screen sharing'}
                      aria-pressed={callState.isScreenSharing}
                      title={callState.isScreenSharing ? "Stop Screen Recording" : "Start Screen Recording/Live Screen Share"}
                    >
                      <Monitor className="w-5 h-5 md:w-6 md:h-6 text-white" aria-hidden="true" />
                      <div className="absolute inset-0 rounded-xl bg-white/0 group-hover:bg-white/10 transition-colors" />
                    </button>
                    <span className="text-xs text-gray-400 font-medium hidden md:block">
                      {callState.isScreenSharing ? 'Sharing' : 'Share'}
                    </span>
                  </div>
                )}

                {/* End call button */}
                <div className="flex flex-col items-center space-y-2">
                  <button
                    onClick={handleEndCall}
                    className="group relative w-12 h-12 md:w-14 md:h-14 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 rounded-xl flex items-center justify-center transition-all duration-200 transform hover:scale-105 active:scale-95 shadow-lg hover:shadow-red-500/25"
                    aria-label="End call"
                  >
                    <PhoneOff className="w-5 h-5 md:w-6 md:h-6 text-white" aria-hidden="true" />
                    <div className="absolute inset-0 rounded-xl bg-white/0 group-hover:bg-white/10 transition-colors" />
                  </button>
                  <span className="text-xs text-gray-400 font-medium hidden md:block">End</span>
                </div>
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  )
}