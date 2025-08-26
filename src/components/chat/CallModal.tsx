'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { PhoneOff, Mic, MicOff, Camera, CameraOff, Monitor, Users } from 'lucide-react'
import { useSocketContext } from '@/context/SocketContext'
import { useSession } from 'next-auth/react'
import { WebRTCService } from '@/lib/webrtc'
import { VideoGrid } from '@/components/video/VideoGrid'
import { ScreenShareManager, getScreenShareCapabilities } from '@/utils/screenShare'
import { useCallPerformance } from '@/hooks/useCallPerformance'
import { useVoiceActivity } from '@/hooks/useVoiceActivity'

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
  status: 'dialing' | 'ringing' | 'connecting' | 'connected' | 'disconnected'
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
  console.log(`\n📺 [CallModal] RENDERING`, {
    isOpen,
    callType,
    conversationId,
    callId,
    isIncoming,
    participantsCount: participants?.length,
    sessionUserId: session?.user?.id
  })
  
  const [callState, setCallState] = useState<CallState>({
    status: isIncoming ? 'ringing' : 'dialing',
    duration: 0,
    isMuted: false,
    isCameraOff: callType === 'voice',
    isScreenSharing: false,
    connectedParticipants: 0,
  })
  const [outgoingRingingInterval, setOutgoingRingingInterval] = useState<NodeJS.Timeout | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const [participantConnectionStates, setParticipantConnectionStates] = useState<Map<string, 'ringing' | 'connecting' | 'connected'>>(new Map())
  const [offerCreationAttempts, setOfferCreationAttempts] = useState<Set<string>>(new Set())
  
  // Memoize participant IDs to prevent unnecessary re-renders
  const memoizedParticipantIds = useMemo(() => {
    return participants?.map(p => p.id).filter(id => id !== session?.user?.id) || []
  }, [participants, session?.user?.id])

  // CRITICAL FIX: Add stability check to prevent immediate unmounting
  const [isInitializing, setIsInitializing] = useState(true)
  
  useEffect(() => {
    // Mark as stable after initial render to prevent premature unmounting
    // EXTENDED timeout to give WebRTC more time to establish connections
    const stabilityTimeout = setTimeout(() => {
      console.log('[CallModal] 🛡️ Initialization stability timeout complete - component now stable')
      setIsInitializing(false)
    }, 2000) // Extended from 100ms to 2 seconds for better stability
    
    return () => {
      console.log('[CallModal] 🧹 Component unmounting - performing thorough cleanup')
      clearTimeout(stabilityTimeout)
      
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

  // Mark participants based on their actual individual state, not just overall call state
  // Use useMemo to ensure re-computation when participant states change
  const connectedParticipants = useMemo(() => {
    if (!session?.user?.id) return []
    return participants.map(participant => {
    const hasRemoteStream = remoteStreams.has(participant.id)
    const remoteStream = remoteStreams.get(participant.id)
    
    // Determine if remote participant's camera is off
    let isCameraOff = false
    if (callType === 'video' && hasRemoteStream && remoteStream) {
      const videoTracks = remoteStream.getVideoTracks()
      isCameraOff = videoTracks.length === 0 || videoTracks.every(track => !track.enabled)
    } else if (callType === 'voice') {
      isCameraOff = true // Voice calls don't have video
    }
    
    // FIXED: Use server-provided participant state instead of inferring from local call state
    let participantStatus: 'ringing' | 'connecting' | 'connected' = 'connecting' // Default state
    
    // First, check if we have explicit state from server
    const serverParticipantState = participantConnectionStates.get(participant.id)
    if (serverParticipantState) {
      participantStatus = serverParticipantState
      console.log(`[CallModal] Using server state for ${participant.id}: ${participantStatus}`)
    } else {
      // SIMPLIFIED: Basic fallback logic based on stream state
      const streamActive = remoteStream && remoteStream.active
      const streamHasLiveTracks = remoteStream && typeof remoteStream.getTracks === 'function' 
        ? remoteStream.getTracks().some(t => t.readyState === 'live') 
        : false
      
      console.log(`[CallModal] 🔍 Status analysis for ${participant.id}:`, {
        hasRemoteStream: !!hasRemoteStream,
        remoteStream: !!remoteStream,
        streamActive,
        streamHasLiveTracks,
        callState: callState.status,
        participantCount: callState.connectedParticipants
      })
      
      // Simplified logic: active stream > call state
      if (streamActive && streamHasLiveTracks) {
        participantStatus = 'connected'
        console.log(`[CallModal] ✅ Using stream-based status for ${participant.id}: connected`)
      } else if (callState.status === 'connected' && callState.connectedParticipants > 1) {
        participantStatus = 'connecting' // Show connecting if call is connected but no WebRTC yet
        console.log(`[CallModal] 🔄 Using call-state-based status for ${participant.id}: connecting`)
      } else {
        participantStatus = callState.status === 'connecting' ? 'connecting' : 'ringing'
        console.log(`[CallModal] 🔔 Using fallback status for ${participant.id}: ${participantStatus}`)
      }
    }
    
      return {
        ...participant,
        isConnected: participantStatus === 'connected',
        participantStatus, // Add status for display
        isCameraOff // Override with actual camera state from stream
      }
    })
  }, [participants, remoteStreams, callState.status, callState.connectedParticipants, session?.user?.id, participantConnectionStates, callType])
  
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const remoteAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const webrtcServiceRef = useRef<WebRTCService | null>(null)
  const screenShareManagerRef = useRef<ScreenShareManager | null>(null)
  const userInitiatedCloseRef = useRef<boolean>(false)
  const lastStateUpdateRef = useRef<string>('') // Track last processed state update
  const lastRecoveryAttemptRef = useRef<number>(0) // Track last recovery attempt timestamp
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

  const { performanceState, getOverallNetworkQuality } = useCallPerformance(peerConnections, callType)
  
  // Voice activity detection for local user
  const { isSpeaking: isLocalSpeaking } = useVoiceActivity({ 
    stream: localStreamRef.current,
    threshold: -50 
  })

  // ENHANCED: Audio context with proper user gesture handling
  const audioContextRef = useRef<AudioContext | null>(null)
  const ringingAudioRef = useRef<HTMLAudioElement | null>(null)
  
  // Create a persistent ringing audio element
  const createRingingAudio = useCallback(() => {
    if (ringingAudioRef.current) {
      return ringingAudioRef.current
    }
    
    // Create ringing tone audio element
    const audio = new Audio()
    audio.loop = true
    audio.volume = 0.5
    
    // Create ringing tone using Web Audio API for better control
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const audioContext = new AudioContextClass()
      
      // Create a simple ringing tone
      const createRingingTone = () => {
        const duration = 3 // 3 seconds
        const sampleRate = audioContext.sampleRate
        const length = sampleRate * duration
        const buffer = audioContext.createBuffer(1, length, sampleRate)
        const data = buffer.getChannelData(0)
        
        // Generate ringing pattern: 1 second tone, 2 seconds silence
        for (let i = 0; i < length; i++) {
          const time = i / sampleRate
          if (time < 1) {
            // First second: ringing tone
            data[i] = Math.sin(2 * Math.PI * 440 * time) * 0.3 * Math.exp(-time * 2)
          } else {
            // Remaining 2 seconds: silence
            data[i] = 0
          }
        }
        
        return buffer
      }
      
      const buffer = createRingingTone()
      const source = audioContext.createBufferSource()
      source.buffer = buffer
      source.loop = true
      
      const gainNode = audioContext.createGain()
      gainNode.gain.value = 0.5
      
      source.connect(gainNode)
      gainNode.connect(audioContext.destination)
      
      // Store references for cleanup
      audio.audioContext = audioContext
      audio.source = source
      audio.gainNode = gainNode
      
      // Custom play method
      audio.customPlay = async () => {
        if (audioContext.state === 'suspended') {
          await audioContext.resume()
        }
        source.start()
      }
      
      // Custom stop method
      audio.customStop = () => {
        try {
          if (source) {
            source.stop()
            source.disconnect()
          }
          if (audioContext && audioContext.state !== 'closed') {
            audioContext.close()
          }
        } catch (error) {
          console.warn('[CallModal] Error stopping custom audio:', error)
        }
      }
      
    } catch {
      console.warn('[CallModal] Web Audio API not available, using fallback')
      
      // Fallback: Create data URL for ringing tone
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (ctx) {
        // This is a placeholder - in a real implementation you'd generate audio data
        audio.src = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+H2v2AaBDKJ2fLNeSsFKHXJ8N+ROQ=='
      }
    }
    
    ringingAudioRef.current = audio
    return audio
  }, [])
  
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
  // ENHANCED: Outgoing call ringing sound with proper audio handling
  const playOutgoingRingingSound = async () => {
    try {
      console.log('[CallModal] Starting outgoing ringing sound')
      
      // Stop any existing ringing first
      stopOutgoingRingingSound()
      
      const audio = createRingingAudio()
      
      // Try to play the ringing sound
      try {
        if (audio.customPlay) {
          await audio.customPlay()
        } else {
          await audio.play()
        }
        console.log('[CallModal] ✅ Ringing sound started successfully')
      } catch (playError) {
        console.warn('[CallModal] Failed to play ringing sound:', playError)
        
        // Fallback: Try to play after a user interaction
        const playAfterInteraction = () => {
          if (audio.customPlay) {
            audio.customPlay().catch(console.warn)
          } else {
            audio.play().catch(console.warn)
          }
          document.removeEventListener('click', playAfterInteraction)
          document.removeEventListener('touchstart', playAfterInteraction)
        }
        
        document.addEventListener('click', playAfterInteraction, { once: true })
        document.addEventListener('touchstart', playAfterInteraction, { once: true, passive: true })
        
        console.log('[CallModal] Waiting for user interaction to play ringing sound')
      }
      
    } catch (error) {
      console.warn('[CallModal] Error with outgoing ringing sound:', error)
    }
  }

  const stopOutgoingRingingSound = useCallback(() => {
    console.log('[CallModal] 🔇 FORCE STOP outgoing ringing sound')
    
    // Stop current interval if exists
    if (outgoingRingingInterval) {
      clearInterval(outgoingRingingInterval)
      setOutgoingRingingInterval(null)
      console.log('[CallModal] ✅ Cleared outgoing ringing interval')
    }
    
    // Stop the ringing audio
    try {
      if (ringingAudioRef.current) {
        console.log('[CallModal] Stopping ringing audio...')
        
        // Use custom stop if available
        if (ringingAudioRef.current.customStop) {
          ringingAudioRef.current.customStop()
        } else {
          ringingAudioRef.current.pause()
          ringingAudioRef.current.currentTime = 0
        }
        
        // Clear the reference
        ringingAudioRef.current = null
        console.log('[CallModal] ✅ Ringing audio stopped and cleared')
      }
    } catch (error) {
      console.warn('[CallModal] Error stopping ringing audio:', error)
    }
    
    // ENHANCED: Properly close our AudioContext
    try {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        console.log('[CallModal] Closing AudioContext...')
        const contextToClose = audioContextRef.current
        audioContextRef.current = null // Clear reference immediately to prevent reuse
        contextToClose.close().then(() => {
          console.log('[CallModal] ✅ AudioContext closed successfully')
        }).catch(error => {
          console.warn('[CallModal] Error closing AudioContext:', error)
        })
      }
    } catch (error) {
      console.warn('[CallModal] Error during AudioContext cleanup:', error)
    }
  }, [outgoingRingingInterval])

  useEffect(() => {
    if (!socket || !isOpen || !callId) {
      console.log('[CallModal] Missing requirements for socket setup:', { 
        socket: !!socket, 
        isOpen, 
        callId
      })
      return
    }

    // Listen for call response events
    const handleCallResponse = (data: { 
      accepted: boolean
      participantId: string
      participantCount: number
      callStatus: string
      callId?: string
    }) => {
      console.log('[CallModal] Received call_response:', data)
      console.log('[CallModal] Current call state:', callState.status)
      console.log('[CallModal] Is incoming call:', isIncoming)
      
      // For outgoing calls, check if someone accepted
      if (data.accepted) {
        console.log('[CallModal] Call accepted by participant:', data.participantId)
        console.log('[CallModal] Call status from server:', data.callStatus)
        console.log('[CallModal] Participant count:', data.participantCount)
        
        // Stop outgoing ringing sound immediately
        stopOutgoingRingingSound()
        
        // State will be updated via call_state_update event from server
        console.log('[CallModal] Call accepted, waiting for server state synchronization...')
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
        }
      }
    }

    // Listen for participant joined events
    const handleParticipantJoined = (data: {
      callId: string
      participantId: string
      participantCount: number
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
      
      console.log('[CallModal] Participant joined, waiting for server state updates...')
      
      // Initiate WebRTC connection with the new participant if we're not the one who just joined
      if (webrtcServiceRef.current && data.participantId !== session?.user?.id) {
        console.log('[CallModal] Initiating WebRTC offer to:', data.participantId)
        console.log('[CallModal] WebRTC service callId:', (webrtcServiceRef.current as WebRTCService & { callId: string | null }).callId)
        console.log('[CallModal] Our callId:', callId)
        
        // FIXED: Use deterministic offer creation based on user ID comparison
        // This prevents both participants from creating offers simultaneously
        // Use localeCompare for proper string comparison
        const shouldCreateOffer = session?.user?.id && session.user.id.localeCompare(data.participantId) > 0;
        console.log('[CallModal] Offer creation decision:', {
          ourUserId: session?.user?.id,
          theirUserId: data.participantId,
          shouldCreateOffer,
          reason: shouldCreateOffer ? 'Our ID is higher' : 'Their ID is higher, they will create offer'
        });
        
        if (shouldCreateOffer && !offerCreationAttempts.has(data.participantId)) {
          // Mark that we're attempting to create offer for this participant
          setOfferCreationAttempts(prev => new Set([...prev, data.participantId]))
          
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
              setOfferCreationAttempts(prev => new Set([...prev, data.participantId]))
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
      setTimeout(() => onClose(), 1500)
    }

    // Listen for WebRTC stream ready events
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
      
      console.log('[CallModal] ✅ Processing REMOTE stream ready event')
      console.log('[CallModal] 🆔 Our session ID:', session?.user?.id)
      console.log('[CallModal] 🆔 Remote participant ID:', data.participantId)
      console.log('[CallModal] 🔍 Stream data:', {
        callId: data.callId,
        participantId: data.participantId,
        streamId: data.streamId,
        hasAudio: data.hasAudio,
        hasVideo: data.hasVideo
      })
      
      console.log('[CallModal] 🚀 INITIATING PEER CONNECTION for remote participant:', data.participantId)
      console.log('[CallModal] 🚀 WebRTC service available:', !!webrtcServiceRef.current)
      
      // DEVELOPMENT FIX: If no remote participants (single-user testing), transition to connected
      const isTestMode = process.env.NODE_ENV !== 'production'
      if (isTestMode && callState.status === 'ringing') {
        console.log('[CallModal] 🧪 TEST MODE: No remote participants detected, transitioning to connected state for testing')
        setTimeout(() => {
          setCallState(prev => ({ ...prev, status: 'connected' }))
        }, 1000)
      }
      
      console.log('[CallModal] 🎥 Processing webrtc_stream_ready for REMOTE participant:', data.participantId)
      
      if (webrtcServiceRef.current) {
        // CRITICAL FIX: Initiate peer connection with remote participant if not already connected
        const activePeerConnections = webrtcServiceRef.current.getActivePeerConnections()
        const hasConnectionToParticipant = Object.keys(activePeerConnections).includes(data.participantId)
        
        console.log('[CallModal] 🔗 Active peer connections:', Object.keys(activePeerConnections))
        console.log('[CallModal] 🔗 Has connection to', data.participantId, ':', hasConnectionToParticipant)
        
        if (!hasConnectionToParticipant) {
          console.log('[CallModal] 🚀 Creating peer connection to', data.participantId)
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
          
          // CRITICAL FIX: Retry stream retrieval after a delay
          console.log('[CallModal] 🔄 Scheduling retry for remote stream retrieval')
          setTimeout(() => {
            if (webrtcServiceRef.current) {
              const retryRemoteStream = webrtcServiceRef.current.getRemoteStream(data.participantId)
              console.log('[CallModal] 🔄 Retry - Retrieved remote stream for', data.participantId, ':', !!retryRemoteStream)
              
              if (retryRemoteStream && typeof retryRemoteStream.getTracks === 'function') {
                console.log('[CallModal] 🔄 Retry successful - Remote stream tracks:', retryRemoteStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled })))
                setRemoteStreams(prev => {
                  const newStreams = new Map(prev)
                  newStreams.set(data.participantId, retryRemoteStream)
                  console.log('[CallModal] 🔄 Retry - Updated remote streams map, now has:', Array.from(newStreams.keys()))
                  return newStreams
                })
                console.log('[CallModal] ✅ Retry - Remote stream added to state for VideoGrid')
              } else {
                console.warn('[CallModal] ❌ Retry failed - Remote stream still not available for:', data.participantId)
              }
            }
          }, 200) // Retry after 200ms
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
    }) => {
      // Create unique key for this update
      const updateKey = `${data.callId}-${data.status}-${data.participantCount}-${Date.now()}`
      
      // CRITICAL: Prevent duplicate processing using timestamps 
      const timeSinceLastUpdate = Date.now() - parseInt(lastStateUpdateRef.current.split('-').pop() || '0')
      const isSameUpdate = lastStateUpdateRef.current.includes(`${data.callId}-${data.status}`)
      
      if (isSameUpdate && timeSinceLastUpdate < 100) { // 100ms deduplication window
        console.log('[CallModal] 🚫 Ignoring duplicate CALL_STATE_UPDATE within 100ms:', data.status)
        return
      }
      
      lastStateUpdateRef.current = updateKey
      
      console.log(`[CallModal] Data:`, data)
      
      if (data.callId !== callId) {
        console.log('[CallModal] ❌ Ignoring state update for different call:', data.callId, 'vs', callId)
        return
      }
      
      console.log(`[CallModal] Current state: ${callState.status} -> New state: ${data.status}`)
      
      // ENHANCED: Prevent duplicate state updates with better logic
      if (callState.status === data.status) {
        console.log('[CallModal] ✅ State already', data.status, '- ignoring duplicate update')
        return
      }
      
      // Prevent invalid state transitions
      if (callState.status === 'connected' && data.status === 'connecting') {
        console.log('[CallModal] ❌ Ignoring invalid transition: connected -> connecting')
        return
      }
      
      // CRITICAL: Stop ringing sound immediately on ANY state change away from ringing/dialing
      if ((callState.status === 'ringing' || callState.status === 'dialing') && 
          (data.status !== 'ringing' && data.status !== 'dialing')) {
        console.log('[CallModal] 🔇 FORCE STOPPING ringing due to state change:', callState.status, '->', data.status)
        stopOutgoingRingingSound()
      }
      
      // Force update call state based on server authoritative state
      setCallState(prev => {
        const newState = {
          ...prev, 
          status: data.status as CallState['status'],
          connectedParticipants: data.participantCount
        }
        console.log('[CallModal] 🔄 State FORCEFULLY updated from server:', prev.status, '->', newState.status)
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
            
            // FIXED: Only create offers to participants with lower IDs to prevent conflicts
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
                }, 15000) // 15 second fallback
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
      
      // Handle connecting state with timeout protection
      if (data.status === 'connecting') {
        console.log('[CallModal] 🔄 Call state updated to connecting - WebRTC should be starting')
        
        // Set a fallback timeout to prevent getting stuck in connecting state
        const connectingTimeout = setTimeout(async () => {
          console.log('[CallModal] ⏰ Connecting timeout reached, checking if we should force connection')
          
          // Check if we still exist and are in connecting state
          if (callState.status === 'connecting') {
            console.log('[CallModal] Still in connecting state after timeout, forcing connected state')
            
            // CRITICAL: Verify WebRTC connections before marking as connected
            let hasValidConnections = false
            if (webrtcServiceRef.current) {
              const activePeerConnections = webrtcServiceRef.current.getActivePeerConnections()
              hasValidConnections = Object.keys(activePeerConnections).length > 0
              console.log('[CallModal] Active peer connections before transition:', Object.keys(activePeerConnections).length)
            }
            
            // Force connection establishment if needed before transitioning to connected
            if (!hasValidConnections && webrtcServiceRef.current && participants && participants.length > 0) {
              const otherParticipantIds = participants.filter(p => p.id !== session?.user?.id).map(p => p.id)
              if (otherParticipantIds.length > 0) {
                console.log('[CallModal] 🚀 Forcing peer connection establishment before connected transition')
                try {
                  await webrtcServiceRef.current.initiateConnections(otherParticipantIds)
                  // Wait a moment for connections to establish
                  setTimeout(() => {
                    const newConnections = webrtcServiceRef.current?.getActivePeerConnections() || {}
                    console.log('[CallModal] Post-initiation peer connections:', Object.keys(newConnections).length)
                    
                    setCallState(prev => ({ ...prev, status: 'connected' }))
                    
                    // Also emit to server to sync state
                    if (socket && callId) {
                      socket.emit('force_call_connected', { callId })
                    }
                  }, 1000)
                  return // Skip immediate transition, wait for connection establishment
                } catch (error) {
                  console.error('[CallModal] Failed to force peer connections:', error)
                }
              }
            }
            
            setCallState(prev => ({ ...prev, status: 'connected' }))
            
            // Also emit to server to sync state
            if (socket && callId) {
              socket.emit('force_call_connected', { callId })
            }
          }
        }, 15000) // 15 second timeout for connecting state
        
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

    console.log(`\n🔌 [CallModal] SETTING UP SOCKET LISTENERS`)
    console.log(`[CallModal] Call ID: ${callId}`)
    console.log(`[CallModal] Session User ID: ${session?.user?.id}`)
    console.log(`[CallModal] Socket Connected: ${socket?.connected}`)
    console.log(`[CallModal] Is Incoming: ${isIncoming}`)
    
    socket.on('call_response', handleCallResponse)
    socket.on('participant_joined', handleParticipantJoined)
    socket.on('participant_left', handleParticipantLeft)
    socket.on('call_ended', handleCallEnded)
    socket.on('call_timeout', handleCallTimeout)
    socket.on('call_state_update', handleCallStateUpdate)
    socket.on('webrtc_stream_ready', handleWebRTCStreamReady)
    // Note: WebRTC signaling events handled directly by WebRTC service
    socket.on('participant_state_update', handleParticipantStateUpdate)
    socket.on('participant_mute_change', handleParticipantMuteChange)
    socket.on('participant_camera_change', handleParticipantCameraChange)
    
    console.log('[CallModal] ✅ All socket listeners registered')

    // Auto-progress to ringing when modal opens for outgoing calls
    if (callState.status === 'dialing' && !isIncoming) {
      setTimeout(async () => {
        setCallState(prev => ({ ...prev, status: 'ringing' }))
        // ENHANCED: Initialize AudioContext with user gesture and start ringing
        console.log('[CallModal] Starting outgoing ringing sound with proper user gesture handling')
        try {
          // Pre-initialize AudioContext to ensure it's ready
          await initializeAudioContext()
          playOutgoingRingingSound()
        } catch (error) {
          console.warn('[CallModal] Failed to initialize audio for ringing:', error)
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
      // Note: WebRTC signaling events handled directly by WebRTC service
      socket.off('participant_state_update', handleParticipantStateUpdate)
      socket.off('participant_mute_change', handleParticipantMuteChange)
      socket.off('participant_camera_change', handleParticipantCameraChange)
    }
  }, [socket, isOpen, callId])

  // Call duration timer and connection verification
  useEffect(() => {
    if (callState.status === 'connected') {
      // Start duration timer
      timerRef.current = setInterval(() => {
        setCallState(prev => ({ ...prev, duration: prev.duration + 1 }))
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
        console.log('[CallModal] - Active connections:', Object.keys(activePeerConnections))
        
        // Check if we have connections to all expected participants
        const missingConnections = otherParticipantIds.filter(id => !activePeerConnections[id])
        
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
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [callState.status, participants, session?.user?.id])

  // CRITICAL: Stop ringing when call state changes away from ringing/dialing
  useEffect(() => {
    if (callState.status !== 'ringing' && callState.status !== 'dialing') {
      console.log('[CallModal] 🔇 State changed away from ringing/dialing, ensuring ringing is stopped:', callState.status)
      stopOutgoingRingingSound()
    }
  }, [callState.status, stopOutgoingRingingSound])

  // CRITICAL: Cleanup ringing on component unmount
  useEffect(() => {
    return () => {
      console.log('[CallModal] 🔇 Component unmounting, stopping all ringing sounds')
      stopOutgoingRingingSound()
      if (outgoingRingingInterval) {
        clearInterval(outgoingRingingInterval)
      }
    }
  }, [stopOutgoingRingingSound, outgoingRingingInterval])

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
    // Skip WebRTC for ALL calls that are still in ringing state (both incoming and outgoing)
    // This ensures users get proper answer/decline flow before WebRTC starts
    const shouldSkipWebRTC = callState.status === 'ringing'

    if (shouldSkipWebRTC) {
      console.log('[CallModal] 🔄 Skipping WebRTC for ringing call - waiting for acceptance:', { 
        isIncoming, 
        callState: callState.status 
      })
      return
    }

    // CRITICAL: Emergency WebRTC initialization for connected/connecting states without WebRTC service
    const needsEmergencyInit = (callState.status === 'connected' || callState.status === 'connecting') && 
                              !webrtcServiceRef.current

    if (needsEmergencyInit) {
      console.log('[CallModal] 🆘 EMERGENCY WebRTC initialization needed - call is active but no WebRTC service!')
    }

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
              webrtcServiceRef.current.cleanup?.()
              webrtcServiceRef.current = null
            }
          } catch (error) {
            console.warn('[CallModal] 🔧 Error checking existing service, reinitializing:', error)
            webrtcServiceRef.current.cleanup?.()
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
            
            // Wait a brief moment for stream to be fully set, then create offers
            setTimeout(async () => {
              try {
                const streamReady = await webrtcServiceRef.current.waitForLocalStream(2000)
                if (streamReady) {
                  for (const participantId of memoizedParticipantIds) {
                    try {
                      await webrtcServiceRef.current.safeCreateOffer(participantId)
                      console.log('[CallModal] ✅ Created offer for:', participantId)
                    } catch (offerError) {
                      console.error('[CallModal] ❌ Failed to create offer for:', participantId, offerError)
                    }
                  }
                } else {
                  console.error('[CallModal] ❌ Stream not ready - cannot create offers')
                }
              } catch (error) {
                console.error('[CallModal] ❌ Error during delayed offer creation:', error)
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
    
    // Enhanced conditions for when we need emergency WebRTC initialization
    const needsWebRTCInit = (callState.status === 'connected' || callState.status === 'connecting') && 
                           !webrtcServiceRef.current
                           
    // Also check if WebRTC exists but has no active connections when it should
    const needsConnectionRecovery = webrtcServiceRef.current && 
                                   (callState.status === 'connected' || callState.status === 'connecting') &&
                                   memoizedParticipantIds.length > 0 &&
                                   Object.keys(webrtcServiceRef.current.getActivePeerConnections()).length === 0
    
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
    
    // CRITICAL FIX: Only do aggressive cleanup when call is truly ending
    const isCallEnding = forceCleanup || 
                        callState.status === 'disconnected' || 
                        callState.status === 'declined' ||
                        callState.status === 'ended'
    
    if (isCallEnding) {
      console.log('[CallModal] 🧹 Performing simple cleanup - call is ending')
      
      try {
        // 1. Clean up WebRTC service first
        if (webrtcServiceRef.current) {
          console.log('[CallModal] 🧹 Cleaning up WebRTC service')
          webrtcServiceRef.current.cleanup()
          webrtcServiceRef.current = null
        }

        // 2. Stop local stream tracks immediately
        if (localStreamRef.current) {
          console.log('[CallModal] 🎬 Stopping local stream tracks')
          localStreamRef.current.getTracks().forEach(track => {
            console.log('[CallModal] Stopping track:', track.kind, track.readyState)
            track.stop()
            console.log('[CallModal] ✅ Stopped track:', track.kind, track.readyState)
          })
          localStreamRef.current = null
        }

        // 3. Clean remote streams
        if (remoteStreams.size > 0) {
          console.log('[CallModal] 🎭 Cleaning remote streams')
          remoteStreams.forEach((stream, participantId) => {
            if (stream && typeof stream.getTracks === 'function') {
              stream.getTracks().forEach(track => {
                console.log('[CallModal] Stopping remote track:', track.kind, 'for', participantId)
                track.stop()
              })
            }
          })
          setRemoteStreams(new Map())
        }

        // 4. Clean up DOM video elements
        const videos = document.querySelectorAll('video')
        videos.forEach((video, index) => {
          if (video.srcObject) {
            console.log(`[CallModal] 📹 Cleaning video element ${index}`)
            video.srcObject = null
            video.load()
          }
        })

        console.log('[CallModal] ✅ Simple cleanup completed')
      } catch (error) {
        console.warn('[CallModal] Error during aggressive media cleanup:', error)
      }
    }
    
    try {
      // Cleanup screen share manager
      if (screenShareManagerRef.current) {
        screenShareManagerRef.current.cleanup()
        screenShareManagerRef.current = null
        console.log('[CallModal] ✅ Cleaned up screen share manager')
      }
    } catch (error) {
      console.warn('[CallModal] Error cleaning screen share:', error)
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
  }

  const toggleMute = () => {
    const newMuted = !callState.isMuted
    setCallState(prev => ({ ...prev, isMuted: newMuted }))
    
    // Mute/unmute audio tracks
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks()
      audioTracks.forEach(track => {
        track.enabled = !newMuted
      })
      
      console.log('[CallModal] Toggled mute:', newMuted, 'Audio tracks:', audioTracks.length)
    }
    
    // CRITICAL: Notify other participants about mute state change
    if (socket && callId && session?.user?.id) {
      console.log('[CallModal] Broadcasting mute state change to other participants')
      socket.emit('participant_mute_change', {
        callId,
        participantId: session.user.id,
        isMuted: newMuted
      })
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
        
        // Replace video tracks back to camera for all peer connections
        if (webrtcServiceRef.current) {
          const peerConnections = webrtcServiceRef.current.getActivePeerConnections()
          peerConnections.forEach(async (peerConn, participantId) => {
            try {
              await screenShareManagerRef.current?.replaceVideoTrack(peerConn.connection, false)
            } catch (error) {
              console.error('[CallModal] Failed to restore camera for participant:', participantId, error)
            }
          })
        }
        
        // Restore local video display
        if (localVideoRef.current && localStreamRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current
        }
        
        setCallState(prev => ({ ...prev, isScreenSharing: false }))
      } else {
        // Start screen sharing
        const screenStream = await screenShareManagerRef.current.startScreenShare({
          video: true,
          audio: false,
          systemAudio: false
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
        
        // Replace video tracks with screen share for all peer connections
        if (webrtcServiceRef.current) {
          const peerConnections = webrtcServiceRef.current.getActivePeerConnections()
          peerConnections.forEach(async (peerConn, participantId) => {
            try {
              await screenShareManagerRef.current?.replaceVideoTrack(peerConn.connection, true)
            } catch (error) {
              console.error('[CallModal] Failed to share screen with participant:', participantId, error)
            }
          })
        }
        
        // Update local video display
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream
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
      
      // Now try to initialize WebRTC - if it fails, call is still accepted
      try {
        if (!webrtcServiceRef.current && callId) {
          console.log(`[CallModal] Initializing WebRTC for accepted ${callType} call`)
          
          webrtcServiceRef.current = new WebRTCService(socket, session.user.id)
          
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
            console.error(`[CallModal] ❌ ${callType} stream failed:`, streamError.message)
            
            // For video calls, try audio-only fallback
            if (callType === 'video') {
              console.log('[CallModal] 🔄 Attempting audio-only fallback...')
              try {
                stream = await webrtcServiceRef.current.initializeCall(callId, false)
                mediaType = 'voice'
                console.log('[CallModal] ✅ Audio-only fallback successful')
                setConnectionErrors(prev => new Map(prev.set('video', 'Camera failed - joined with audio only')))
              } catch (fallbackError) {
                console.error('[CallModal] ❌ Audio fallback failed:', fallbackError.message)
                throw new Error('Cannot access microphone: ' + fallbackError.message)
              }
            } else {
              throw new Error('Cannot access microphone: ' + streamError.message)
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
                console.warn('[CallModal] Screen share setup failed:', screenShareError.message)
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
        
        // DEVELOPMENT FIX: Force transition to connected state for single-user testing
        if (process.env.NODE_ENV !== 'production') {
          setTimeout(() => {
            console.log('[CallModal] 🧪 TEST MODE: Force transitioning to connected state after media setup')
            setCallState(prev => ({ ...prev, status: 'connected' }))
          }, 3000) // Wait 3 seconds for server state sync
        }
        
      } catch (mediaError) {
        console.error('[CallModal] ❌ Media initialization failed after call acceptance:', mediaError.message)
        
        // Set error but don't fail the call acceptance
        setConnectionErrors(prev => new Map(prev.set('media', 
          `Media access failed: ${mediaError.message}. You're in the call but others may not hear/see you.`
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

  const getStatusText = () => {
    switch (callState.status) {
      case 'dialing':
        return 'Dialing...'
      case 'ringing':
        return isIncoming ? 'Incoming call...' : (isGroupCall ? 'Calling participants...' : 'Ringing...')
      case 'connecting':
        return 'Connecting...'
      case 'connected':
        return isGroupCall ? 
          `${callState.connectedParticipants} participant${callState.connectedParticipants > 1 ? 's' : ''} connected` :
          'Connected'
      case 'disconnected':
        return 'Call ended'
      default:
        return ''
    }
  }

  // Component for individual participant with voice activity detection
  const VoiceParticipant = ({ 
    participant, 
    stream 
  }: { 
    participant: CallParticipant, 
    stream?: MediaStream 
  }) => {
    const { isSpeaking } = useVoiceActivity({ 
      stream: stream || null,
      threshold: -40 // More sensitive threshold for better detection
    })

    // Get server-provided mute state with fallback to stream-based detection
    const serverMuteState = participantMuteStates.get(participant.id)
    const streamBasedMuted = useMemo(() => {
      if (!stream) return false // FIXED: Default to unmuted when no stream (connecting state)
      const audioTracks = stream.getAudioTracks()
      return audioTracks.length === 0 || audioTracks.every(track => !track.enabled)
    }, [stream])
    
    // ENHANCED: Use server state if available, otherwise assume unmuted during connection setup
    const isActuallyMuted = serverMuteState !== undefined ? serverMuteState : (stream ? streamBasedMuted : false)
    
    console.log(`[VoiceParticipant] ${participant.name} mute state:`, {
      participantId: participant.id,
      serverMuteState,
      streamBasedMuted,
      finalMuteState: isActuallyMuted
    })

    return (
      <div className="flex flex-col items-center relative">
        <div className="relative">
          {participant.avatar ? (
            <img
              src={participant.avatar}
              alt={participant.name}
              className={`w-20 h-20 rounded-full object-cover mb-2 transition-all duration-200 ${
                isSpeaking && !isActuallyMuted ? 'ring-4 ring-green-500' : ''
              }`}
            />
          ) : (
            <div className={`w-20 h-20 bg-gray-600 rounded-full flex items-center justify-center mb-2 transition-all duration-200 ${
              isSpeaking && !isActuallyMuted ? 'ring-4 ring-green-500' : ''
            }`}>
              <span className="text-white text-xl font-medium">
                {participant.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          
          {/* Enhanced mute indicator for voice calls */}
          {(participant.isMuted || isActuallyMuted) && (
            <div className="absolute -bottom-1 -right-1 bg-red-600 text-white p-1 rounded-full border-2 border-gray-900">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </div>
          )}
        </div>
        
        <p className="text-white text-sm">
          {participant.name}{(participant.isMuted || isActuallyMuted) ? ' (muted)' : ''}
        </p>
        
        {participant.participantStatus !== 'connected' && (
          <p className="text-gray-400 text-xs">
            {participant.participantStatus === 'ringing' ? 'Ringing...' :
             participant.participantStatus === 'connecting' ? 'Connecting...' : 
             'Waiting...'}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div className="fixed inset-0 transition-opacity bg-black bg-opacity-90" />

        {/* Modal */}
        <div className="inline-block w-full max-w-4xl p-6 my-8 overflow-hidden text-center align-middle transition-all transform bg-gray-900 shadow-xl rounded-2xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="text-left">
              <h3 className="text-xl font-semibold text-white">
                {isGroupCall ? (conversationName || 'Group Call') : 
                 (participants[0]?.name || participants[0]?.username || 'Call')}
              </h3>
              <p className="text-sm text-gray-300">
                {getStatusText()}
              </p>
            </div>
            <div className="text-right">
              {callState.status === 'connected' && (
                <p className="text-lg font-mono text-white">
                  {formatDuration(callState.duration)}
                </p>
              )}
              {isGroupCall && (
                <div className="flex items-center text-sm text-gray-300 mt-1">
                  <Users className="w-4 h-4 mr-1" />
                  {participants.length} invited
                </div>
              )}
            </div>
          </div>

          {/* Error Messages */}
          {connectionErrors.size > 0 && (
            <div className="mb-4 space-y-2">
              {Array.from(connectionErrors.entries()).map(([key, error]) => (
                <div key={key} className="bg-red-600 bg-opacity-20 border border-red-500 rounded-lg p-3">
                  <p className="text-red-200 text-sm">{error}</p>
                </div>
              ))}
            </div>
          )}

          {/* Performance Recommendations */}
          {performanceState.recommendations.length > 0 && callState.status === 'connected' && (
            <div className="mb-4">
              <div className="bg-yellow-600 bg-opacity-20 border border-yellow-500 rounded-lg p-3">
                <div className="flex items-center mb-2">
                  <div className={`w-2 h-2 rounded-full mr-2 ${
                    getOverallNetworkQuality() === 'excellent' ? 'bg-green-500' :
                    getOverallNetworkQuality() === 'good' ? 'bg-blue-500' :
                    getOverallNetworkQuality() === 'fair' ? 'bg-yellow-500' : 'bg-red-500'
                  }`} />
                  <span className="text-yellow-200 text-xs font-medium">
                    Network Quality: {getOverallNetworkQuality().toUpperCase()}
                  </span>
                </div>
                {performanceState.recommendations.slice(0, 2).map((rec, index) => (
                  <p key={index} className="text-yellow-200 text-xs">{rec}</p>
                ))}
              </div>
            </div>
          )}

          {/* Video/Participants Area */}
          <div className="mb-8">
            {callType === 'video' ? (
              <VideoGrid
                localStream={localStreamRef.current}
                remoteStreams={remoteStreams}
                participants={connectedParticipants}
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
                        const existingElement = remoteAudioRefs.current.get(participantId)
                        
                        // CRITICAL FIX: Only set srcObject if it's different to prevent interruption
                        if (existingElement !== element || element.srcObject !== stream) {
                          console.log(`[CallModal] 🔊 Setting up audio element for participant ${participantId}`)
                          console.log(`[CallModal] Stream details:`, {
                            id: stream.id,
                            active: stream.active,
                            audioTracks: stream.getAudioTracks().map(t => ({
                              kind: t.kind,
                              enabled: t.enabled,
                              readyState: t.readyState,
                              label: t.label
                            }))
                          })
                          
                          remoteAudioRefs.current.set(participantId, element)
                          element.srcObject = stream
                          element.volume = 1.0
                          element.muted = false
                          
                          // CRITICAL FIX: Immediately attempt to play, then add loadeddata fallback
                          const attemptPlay = () => {
                            element.play().then(() => {
                              console.log(`[CallModal] ✅ Audio playing for participant ${participantId}`)
                            }).catch(error => {
                              console.warn(`[CallModal] ❌ Failed to play audio for ${participantId}:`, error)
                              console.log(`[CallModal] 🔄 Attempting to play audio with user interaction bypass`)
                              
                              // Try with user interaction context
                              setTimeout(() => {
                                element.play().then(() => {
                                  console.log(`[CallModal] ✅ Audio playing after retry for participant ${participantId}`)
                                }).catch(retryError => {
                                  console.warn(`[CallModal] Retry audio play failed for ${participantId}:`, retryError)
                                })
                              }, 500)
                            })
                          }
                          
                          // Try immediate play
                          attemptPlay()
                          
                          // Also set up loadeddata event as backup
                          element.addEventListener('loadeddata', attemptPlay, { once: true })
                        }
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
                    {/* Current user with voice activity */}
                    <div className="flex flex-col items-center relative">
                      <div className="relative">
                        <div className={`w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mb-2 transition-all duration-200 ${
                          isLocalSpeaking && !callState.isMuted ? 'ring-4 ring-green-500' : ''
                        }`}>
                          <span className="text-white text-xl font-medium">You</span>
                        </div>
                        
                        {/* Enhanced mute indicator for current user */}
                        {callState.isMuted && (
                          <div className="absolute -bottom-1 -right-1 bg-red-600 text-white p-1.5 rounded-full border-2 border-gray-900">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                      </div>
                      
                      <p className="text-white text-sm">
                        {callState.isMuted ? 'You (muted)' : 'You'}
                      </p>
                    </div>

                    {/* Connected participants with voice activity */}
                    {connectedParticipants.map((participant) => (
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
                      {connectedParticipants.map((participant) => (
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

          {/* Controls */}
          <div className="flex justify-center space-x-4">
            {/* Accept/Decline buttons for incoming calls */}
            {isIncoming && callState.status === 'ringing' && (
              <>
                <button
                  onClick={handleDeclineCall}
                  className="w-14 h-14 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center transition-colors"
                >
                  <PhoneOff className="w-6 h-6 text-white" />
                </button>
                <button
                  onClick={handleAcceptCall}
                  className="w-14 h-14 bg-green-600 hover:bg-green-700 rounded-full flex items-center justify-center transition-colors"
                >
                  <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                  </svg>
                </button>
              </>
            )}
            
            {/* Regular call controls - show for outgoing calls or after accepting incoming */}
            {!(isIncoming && callState.status === 'ringing') && (
              <>
                {/* Mute - only show when connected */}
                {callState.status === 'connected' && (
                  <button
                    onClick={toggleMute}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                      callState.isMuted
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    {callState.isMuted ? (
                      <MicOff className="w-5 h-5 text-white" />
                    ) : (
                      <Mic className="w-5 h-5 text-white" />
                    )}
                  </button>
                )}

                {/* Camera (video calls only) - show when connected */}
                {callType === 'video' && callState.status === 'connected' && (
                  <button
                    onClick={toggleCamera}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                      callState.isCameraOff
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    {callState.isCameraOff ? (
                      <CameraOff className="w-5 h-5 text-white" />
                    ) : (
                      <Camera className="w-5 h-5 text-white" />
                    )}
                  </button>
                )}

                {/* Screen Share (video calls only) - show when connected */}
                {callType === 'video' && callState.status === 'connected' && (
                  <button
                    onClick={toggleScreenShare}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                      callState.isScreenSharing
                        ? 'bg-blue-600 hover:bg-blue-700'
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    <Monitor className="w-5 h-5 text-white" />
                  </button>
                )}

                {/* End Call - always show except for incoming ringing */}
                <button
                  onClick={handleEndCall}
                  className="w-12 h-12 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center transition-colors"
                >
                  <PhoneOff className="w-5 h-5 text-white" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}