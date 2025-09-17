'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSocketContext } from '@/context/SocketContext'
import { useSession } from 'next-auth/react'
import { CallModal } from './chat/CallModal'

interface IncomingCall {
  callId: string
  callType: 'voice' | 'video'
  conversationId: string
  callerId: string
  callerName: string
  callerAvatar?: string | null
  conversationName?: string | null
  isGroupCall: boolean
  participantCount: number
  // Enhanced: Store complete participant data for consistent display
  participants?: Array<{
    id: string
    name: string
    username: string
    avatar: string | null
  }>
}

export function GlobalCallManager() {
  const { socket } = useSocketContext()
  const { data: session } = useSession()
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null)
  const [showCallModal, setShowCallModal] = useState(false)
  const [ringingInterval, setRingingInterval] = useState<NodeJS.Timeout | null>(null)
  
  // ENHANCED: Singleton AudioContext management for better resource handling
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioContextCleanupTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // ENHANCED: Event deduplication and state management
  const lastProcessedEventRef = useRef<{ type: string; id: string; timestamp: number } | null>(null)
  const eventProcessingLockRef = useRef<boolean>(false)
  
  // ENHANCED: Debouncing for browser stop events to prevent rapid-fire execution
  const lastStopRingingEventRef = useRef<{ callId: string; reason: string; timestamp: number } | null>(null)
  
  // ENHANCED: Audio operation mutex to prevent conflicts
  const audioOperationLockRef = useRef<boolean>(false)

  // Enhanced: Fetch complete participant data for incoming calls
  const fetchParticipantData = useCallback(async (conversationId: string): Promise<Array<{
    id: string
    name: string
    username: string
    avatar: string | null
  }>> => {
    try {
      const response = await fetch(`/api/conversations/${conversationId}/members`)
      if (!response.ok) {
        console.warn('[GlobalCallManager] Failed to fetch conversation members:', response.status)
        return []
      }

      const data = await response.json()
      const participants = data.participants?.map((p: { user: { id: string; username: string; name: string; avatar: string | null } }) => ({
        id: p.user.id,
        name: p.user.name || p.user.username,
        username: p.user.username,
        avatar: p.user.avatar
      })) || []

      console.log('[GlobalCallManager] ✅ Fetched complete participant data:', participants.map(p => `${p.name} (${p.id})`))
      return participants
    } catch (error) {
      console.error('[GlobalCallManager] Error fetching participant data:', error)
      return []
    }
  }, [])

  // ENHANCED: Function to stop ringing sound with mutex protection
  const stopRingingSound = useCallback((reason?: string) => {
    // ENHANCED: Audio operation mutex to prevent conflicts
    if (audioOperationLockRef.current) {
      console.log(`[GlobalCallManager] 🔒 Audio operation in progress, deferring stop request: ${reason}`)
      // Defer the operation slightly to avoid conflicts
      setTimeout(() => stopRingingSound(reason), 50)
      return
    }
    
    audioOperationLockRef.current = true
    
    try {
      console.log(`[GlobalCallManager] 🔇 FORCE STOP ringing sound - reason: ${reason || 'unspecified'} - current interval:`, !!ringingInterval)
    
    // Stop current interval
    if (ringingInterval) {
      clearInterval(ringingInterval)
      setRingingInterval(null)
      console.log('[GlobalCallManager] ✅ Cleared ringing interval')
    }
    
    // ENHANCED: Coordinate with global AudioManager for better ringing control
    try {
      const audioManager = getGlobalAudioManager()
      if (audioManager) {
        // Use the enhanced AudioManager stopOutgoingRinging method
        if (audioManager.stopOutgoingRinging) {
          audioManager.stopOutgoingRinging()
          console.log('[GlobalCallManager] ✅ Stopped AudioManager outgoing ringing')
        } else {
          // Fallback to legacy stop method
          audioManager.stop()
          console.log('[GlobalCallManager] ✅ Stopped AudioManager (legacy)')
        }
      }
    } catch (error) {
      console.warn('[GlobalCallManager] Error stopping AudioManager:', error)
    }

    // ENHANCED: Properly close our managed AudioContext with delayed cleanup
    try {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        console.log('[GlobalCallManager] Scheduling AudioContext cleanup...')

        // Cancel any existing cleanup timeout
        if (audioContextCleanupTimeoutRef.current) {
          clearTimeout(audioContextCleanupTimeoutRef.current)
          audioContextCleanupTimeoutRef.current = null
        }

        // Schedule cleanup after a short delay to prevent rapid create/destroy cycles
        audioContextCleanupTimeoutRef.current = setTimeout(() => {
          if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            console.log('[GlobalCallManager] Closing managed AudioContext...')
            const contextToClose = audioContextRef.current
            audioContextRef.current = null // Clear reference immediately to prevent reuse

            contextToClose.close().then(() => {
              console.log('[GlobalCallManager] ✅ AudioContext closed successfully')
            }).catch(error => {
              console.warn('[GlobalCallManager] Error closing AudioContext:', error)
            })
          }
          audioContextCleanupTimeoutRef.current = null
        }, 2000) // 2 second delay to allow for potential reuse
      }
    } catch (error) {
      console.warn('[GlobalCallManager] Error during AudioContext cleanup:', error)
    }

    // ENHANCED: Clear any lingering browser notifications
    try {
      if ('Notification' in window) {
        // Close any notifications with our call tag
        // Note: This requires notifications to be created with a tag
        console.log('[GlobalCallManager] Attempting to clear call notifications')
      }
    } catch (error) {
      console.warn('[GlobalCallManager] Error clearing notifications:', error)
    }
    
    } catch (error) {
      console.error('[GlobalCallManager] Error during ringing stop operation:', error)
    } finally {
      // ENHANCED: Always release the audio operation mutex
      audioOperationLockRef.current = false
    }
  }, [ringingInterval])

  // ENHANCED: Event deduplication helper - OPTIMIZED for group calls
  const shouldProcessEvent = useCallback((eventType: string, eventId: string) => {
    const now = Date.now()
    const lastEvent = lastProcessedEventRef.current

    // ENHANCED: More lenient deduplication for group call events
    const isGroupCallEvent = eventType.includes('call_state_update') || eventType.includes('call_response')
    const deduplicationWindow = isGroupCallEvent ? 200 : 1000 // Shorter window for group call events

    // Check for duplicate events within a short time window
    if (lastEvent &&
        lastEvent.type === eventType &&
        lastEvent.id === eventId &&
        (now - lastEvent.timestamp) < deduplicationWindow) {
      console.log(`[GlobalCallManager] 🔄 Duplicate event detected, skipping ${eventType}:${eventId} (window: ${deduplicationWindow}ms)`)
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
    const lockTimeout = isGroupCallEvent ? 100 : 500 // Shorter locks for group calls

    // Check if already locked, but be more permissive for critical events
    if (eventProcessingLockRef.current && !eventType.includes('call_ended') && !eventType.includes('call_timeout')) {
      console.log(`[GlobalCallManager] 🔒 Event processing locked, skipping ${eventType}:${eventId}`)
      return
    }

    eventProcessingLockRef.current = true
    const lockStart = Date.now()

    try {
      await handler()
    } finally {
      eventProcessingLockRef.current = false

      // DEBUGGING: Log excessive lock times
      const lockDuration = Date.now() - lockStart
      if (lockDuration > lockTimeout) {
        console.warn(`[GlobalCallManager] ⏱️ Long event processing: ${eventType} took ${lockDuration}ms (expected <${lockTimeout}ms)`)
      }
    }
  }, [shouldProcessEvent])

  // ENHANCED: Singleton AudioContext initialization with better resource management
  const initializeAudioContext = useCallback(async () => {
    // Cancel any pending cleanup if we're reusing the context
    if (audioContextCleanupTimeoutRef.current) {
      console.log('[GlobalCallManager] Canceling AudioContext cleanup - context being reused')
      clearTimeout(audioContextCleanupTimeoutRef.current)
      audioContextCleanupTimeoutRef.current = null
    }
    
    // Return existing context only if it's still usable
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      console.log('[GlobalCallManager] Reusing existing AudioContext')
      
      // Ensure context is active
      if (audioContextRef.current.state === 'suspended') {
        console.log('[GlobalCallManager] Resuming suspended AudioContext...')
        await audioContextRef.current.resume()
      }
      
      return audioContextRef.current
    }
    
    // If previous context was closed, clear the reference
    if (audioContextRef.current && audioContextRef.current.state === 'closed') {
      console.log('[GlobalCallManager] Previous AudioContext was closed, creating new one')
      audioContextRef.current = null
    }
    
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) {
        console.warn('[GlobalCallManager] AudioContext not supported')
        return null
      }
      
      console.log('[GlobalCallManager] Creating new singleton AudioContext')
      const audioContext = new AudioContextClass()
      
      // Resume if suspended (required for autoplay policy compliance)
      if (audioContext.state === 'suspended') {
        console.log('[GlobalCallManager] New AudioContext suspended, resuming...')
        await audioContext.resume()
        console.log('[GlobalCallManager] New AudioContext resumed')
      }
      
      audioContextRef.current = audioContext
      return audioContext
    } catch (error) {
      console.warn('[GlobalCallManager] Failed to initialize AudioContext:', error)
      return null
    }
  }, [])

  // ENHANCED: Ringing sound with proper AudioContext handling and fallback
  const playRingingSound = useCallback(async () => {
    // Stop any existing ringing first to prevent multiple intervals
    if (ringingInterval) {
      console.log('[GlobalCallManager] Clearing existing ringing interval before starting new one')
      clearInterval(ringingInterval)
      setRingingInterval(null)
    }

    try {
      // Enhanced audio fallback with multiple ring tone options
      const playAudioFallback = () => {
        try {
          // Try multiple audio sources for better compatibility
          const ringTones = [
            // Standard ring tone (short beep pattern)
            'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+Dx0GopAgBSs+fsx2MgBjiOzfHRdy0EH3HA7t6OSgkNVq/q88mIQArKOdcvJjb/lJdNKlnRYe1sOBqIcjIGJJfKTHj/SfJyQgNzI+vBJJfKZjU2MhIGGFzJw',
            // Backup: Simple sine wave data
            'data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQ4AAAAyMjIyMjIyMjIyMjI='
          ]
          
          const tryPlayAudio = async (src: string): Promise<boolean> => {
            return new Promise((resolve) => {
              const audio = new Audio()
              audio.preload = 'auto'
              audio.volume = 0.7
              audio.loop = false
              audio.src = src
              
              const cleanup = () => {
                audio.removeEventListener('canplaythrough', onCanPlay)
                audio.removeEventListener('error', onError)
                audio.removeEventListener('ended', onEnded)
              }
              
              const onCanPlay = () => {
                cleanup()
                audio.play().then(() => {
                  console.log('[GlobalCallManager] ✅ Audio ringing played successfully')
                  resolve(true)
                }).catch((playError) => {
                  console.warn('[GlobalCallManager] Audio play failed:', playError)
                  resolve(false)
                })
              }
              
              const onError = (error: Event) => {
                console.warn('[GlobalCallManager] Audio loading error:', error)
                cleanup()
                resolve(false)
              }
              
              const onEnded = () => {
                cleanup()
              }
              
              audio.addEventListener('canplaythrough', onCanPlay)
              audio.addEventListener('error', onError)
              audio.addEventListener('ended', onEnded)
              
              // Fallback timeout
              setTimeout(() => {
                if (audio.readyState >= 2) { // HAVE_CURRENT_DATA
                  cleanup()
                  audio.play().then(() => resolve(true)).catch(() => resolve(false))
                } else {
                  cleanup()
                  resolve(false)
                }
              }, 1000)
            })
          }
          
          // Try each ring tone until one works
          return (async () => {
            for (const src of ringTones) {
              const success = await tryPlayAudio(src)
              if (success) return true
            }
            return false
          })()
        } catch {
          return Promise.resolve(false)
        }
      }

      // Try AudioContext first for better control
      let audioContextSuccess = false
      const audioContext = await initializeAudioContext()
      
      const playTone = async () => {
        try {
          if (audioContext) {
            // Ensure AudioContext is running
            if (audioContext.state === 'suspended') {
              await audioContext.resume()
            }
            
            const oscillator = audioContext.createOscillator()
            const gainNode = audioContext.createGain()
            
            oscillator.connect(gainNode)
            gainNode.connect(audioContext.destination)
            
            // Create a more pleasant ringing tone (two-tone pattern)
            oscillator.frequency.setValueAtTime(880, audioContext.currentTime) // A5 note
            oscillator.frequency.setValueAtTime(1108, audioContext.currentTime + 0.3) // C#6 note
            gainNode.gain.setValueAtTime(0, audioContext.currentTime)
            gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.1)
            gainNode.gain.linearRampToValueAtTime(0.2, audioContext.currentTime + 0.5)
            gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.8)
            
            oscillator.start()
            oscillator.stop(audioContext.currentTime + 0.8)
            audioContextSuccess = true
          }
        } catch (toneError) {
          console.warn('[GlobalCallManager] AudioContext tone error:', toneError)
          audioContextSuccess = false
        }
        
        // Fallback to Audio API if AudioContext fails
        if (!audioContextSuccess) {
          await playAudioFallback()
        }
      }
      
      // Play immediately
      await playTone()
      
      // Set up interval to repeat every 3 seconds for more pleasant ringing
      const interval = setInterval(async () => {
        // CRITICAL: Only stop ringing if call is explicitly ended, not on state changes
        // Check if we still have the same incoming call
        if (incomingCall && showCallModal) {
          console.log('[GlobalCallManager] Continuing to ring for incoming call:', incomingCall.callId)
          await playTone()
        } else {
          console.log('[GlobalCallManager] Stopping ringing - call state changed:', {
            hasIncomingCall: !!incomingCall,
            showModal: showCallModal,
            callId: incomingCall?.callId
          })
          clearInterval(interval)
          setRingingInterval(null)
        }
      }, 3000)
      
      setRingingInterval(interval)
      console.log('[GlobalCallManager] Started new ringing interval with enhanced audio support')
    } catch (error) {
      console.warn('[GlobalCallManager] Error with ringing sound:', error)
      // Final fallback: try simple notification
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('Incoming Call', {
            body: `${incomingCall?.callerName} is calling...`,
            icon: '/favicon.ico',
            tag: 'call-notification'
          })
        } catch (notifError) {
          console.warn('[GlobalCallManager] Notification fallback failed:', notifError)
        }
      }
    }
  }, [ringingInterval, incomingCall, showCallModal, initializeAudioContext])

  useEffect(() => {
    if (!socket || !session?.user?.id) return

    // ENHANCED: Listen for direct browser events from CallModal to stop ringing
    const handleStopRingingEvent = (event: CustomEvent) => {
      const { callId: eventCallId, reason, callerId, priority } = event.detail
      console.log('[GlobalCallManager] 🔔 Received stop ringing event:', { eventCallId, reason, callerId, priority })
      
      // ENHANCED: Priority events bypass debouncing for immediate response
      if (!priority) {
        // ENHANCED: Debounce rapid-fire stop events to prevent audio conflicts
        const now = Date.now()
        const lastEvent = lastStopRingingEventRef.current
        
        if (lastEvent && 
            lastEvent.callId === eventCallId && 
            lastEvent.reason === reason &&
            (now - lastEvent.timestamp) < 200) { // 200ms debounce window
          console.log('[GlobalCallManager] 🚫 Debouncing duplicate stop ringing event')
          return
        }
        
        lastStopRingingEventRef.current = { callId: eventCallId, reason, timestamp: now }
      } else {
        console.log('[GlobalCallManager] ⚡ PRIORITY event - bypassing debouncing')
      }
      
      // Only stop if it matches our current incoming call or if we are the caller
      if ((incomingCall?.callId === eventCallId) || callerId === session?.user?.id) {
        console.log('[GlobalCallManager] 🔇 Stopping ringing due to browser event:', reason)
        stopRingingSound(`browser event: ${reason}`)
        
        // For callers, we might also want to update the UI state
        if (callerId === session?.user?.id && !incomingCall) {
          console.log('[GlobalCallManager] 📞 Caller ringing stopped - no UI changes needed')
        }
      } else {
        console.log('[GlobalCallManager] ❌ Ignoring stop ringing event for different call')
      }
    }

    window.addEventListener('stopGlobalCallManagerRinging', handleStopRingingEvent as EventListener)
    
    // ENHANCED: Listen for audio context coordination events from CallModal
    const handleSuspendAudioEvent = (event: CustomEvent) => {
      const { callId: eventCallId, reason, callerId } = event.detail
      console.log('[GlobalCallManager] 🔇 Received suspend audio context event:', { eventCallId, reason, callerId })
      
      // Suspend our audio context if it matches the call or caller
      if ((incomingCall?.callId === eventCallId) || callerId === session?.user?.id) {
        try {
          if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            console.log('[GlobalCallManager] 🔇 Suspending GlobalCallManager AudioContext for coordination')
            audioContextRef.current.suspend()
          }
        } catch (error) {
          console.warn('[GlobalCallManager] Error suspending audio context for coordination:', error)
        }
      }
    }
    
    window.addEventListener('suspendGlobalAudioContext', handleSuspendAudioEvent as EventListener)

    // ENHANCED: Handle incoming call events with deduplication
    const handleIncomingCall = (data: IncomingCall) => {
      processEventWithLock('incoming_call', data.callId, async () => {
        console.log('[GlobalCallManager] Incoming call received:', {
          callId: data.callId,
          callType: data.callType,
          callerId: data.callerId,
          callerName: data.callerName,
          conversationId: data.conversationId,
          currentUserId: session.user.id
        })
        
        // Don't show incoming call to the caller
        if (data.callerId === session.user.id) {
          console.log('[GlobalCallManager] Ignoring call from self')
          return
        }
        
        console.log('[GlobalCallManager] Setting incoming call state')

        // ENHANCED: Fetch complete participant data for group calls
        let enhancedCallData = data
        if (data.isGroupCall) {
          console.log('[GlobalCallManager] 🔍 Fetching complete participant data for group call...')
          const participants = await fetchParticipantData(data.conversationId)
          enhancedCallData = {
            ...data,
            participants
          }
        }

        setIncomingCall(enhancedCallData)
        setShowCallModal(true)
      
      // Enhanced ringing system with immediate user interaction
      console.log('[GlobalCallManager] Starting enhanced ringing system')
      
      // Try to get user permission for audio if not already granted
      if ('permissions' in navigator && 'query' in navigator.permissions) {
        navigator.permissions.query({ name: 'notifications' as PermissionName }).then(result => {
          if (result.state === 'granted') {
            console.log('[GlobalCallManager] Notifications permitted, using enhanced audio')
          }
        }).catch(() => {
          console.log('[GlobalCallManager] Permissions API not available')
        })
      }
      
        // Start ringing sound immediately
        playRingingSound()
        
        // Also trigger browser notification as backup
        if ('Notification' in window) {
          if (Notification.permission === 'granted') {
            try {
              const notification = new Notification('Incoming Call', {
                body: `${data.callerName} is calling...`,
                icon: '/favicon.ico',
                tag: 'call-notification',
                requireInteraction: true,
                actions: [
                  { action: 'answer', title: 'Answer' },
                  { action: 'decline', title: 'Decline' }
                ]
              })
              
              // Auto-close notification after 30 seconds
              setTimeout(() => {
                notification.close()
              }, 30000)
            } catch (notifError) {
              console.warn('[GlobalCallManager] Notification creation failed:', notifError)
            }
          } else if (Notification.permission !== 'denied') {
            // Request permission for future calls
            Notification.requestPermission().then(permission => {
              console.log('[GlobalCallManager] Notification permission:', permission)
            })
          }
        }
      })
    }

    // ENHANCED: Handle call ended events with deduplication
    const handleCallEnded = (data?: { callId?: string; reason?: string }) => {
      const callId = data?.callId || 'unknown'
      processEventWithLock('call_ended', callId, () => {
        console.log('[GlobalCallManager] Call ended event received:', data)
        
        // Only handle if it's for our current incoming call
        if (data?.callId && incomingCall?.callId && data.callId !== incomingCall.callId) {
          console.log('[GlobalCallManager] Ignoring call_ended for different call:', data.callId, 'vs', incomingCall.callId)
          return
        }
        
        console.log('[GlobalCallManager] Processing call_ended for current call')
        stopRingingSound('call ended')
        setIncomingCall(null)
        setShowCallModal(false)
      })
    }

    // Handle call timeout events
    const handleCallTimeout = (data?: { callId?: string }) => {
      console.log('[GlobalCallManager] Call timeout event received:', data)
      
      // Only handle if it's for our current incoming call
      if (data?.callId && incomingCall?.callId && data.callId !== incomingCall.callId) {
        console.log('[GlobalCallManager] Ignoring call_timeout for different call:', data.callId, 'vs', incomingCall.callId)
        return
      }
      
      console.log('[GlobalCallManager] Processing call_timeout for current call')
      stopRingingSound('call timeout')
      setIncomingCall(null)
      setShowCallModal(false)
    }

    // Handle call response events (when someone accepts/declines)
    const handleCallResponse = (data: { accepted: boolean; callId: string; participantId: string }) => {
      console.log('[GlobalCallManager] Call response received:', data)
      
      // Only handle if it's for our current incoming call
      if (data.callId && incomingCall?.callId && data.callId !== incomingCall.callId) {
        console.log('[GlobalCallManager] Ignoring call_response for different call:', data.callId, 'vs', incomingCall.callId)
        return
      }
      
      // CRITICAL FIX: Don't handle call_response events if current user is the caller
      // Outgoing calls should be handled entirely by CallModal, not GlobalCallManager
      if (incomingCall && incomingCall.callerId === session?.user?.id) {
        console.log('[GlobalCallManager] Ignoring call_response - current user is the caller (outgoing call)')
        return
      }
      
      // ENHANCED: Different logic for incoming vs outgoing calls
      const isCurrentUserResponse = data.participantId === session?.user?.id
      const isOutgoingCall = !incomingCall  // If no incoming call, this is outgoing call ringing
      
      if (isCurrentUserResponse) {
        console.log('[GlobalCallManager] Current user response received - stopping ringing sound')
        stopRingingSound(data.accepted ? 'current user accepted' : 'current user declined')
        
        if (data.accepted) {
          console.log('[GlobalCallManager] Current user accepted call')
          // Don't close modal yet - let CallModal handle the call
        } else {
          console.log('[GlobalCallManager] Current user declined call - closing incoming call')
          setIncomingCall(null)
          setShowCallModal(false)
        }
      } else if (isOutgoingCall && data.accepted) {
        // CRITICAL FIX: For outgoing calls, stop ringing when ANYONE accepts
        console.log('[GlobalCallManager] 🎯 OUTGOING CALL ANSWERED - stopping caller ringing')
        console.log('[GlobalCallManager] Participant who answered:', data.participantId)
        stopRingingSound('outgoing call answered')
      } else {
        // For incoming calls, keep ringing until current user responds
        console.log(`[GlobalCallManager] Other participant (${data.participantId}) responded - keeping ringing for current user`)
        console.log(`[GlobalCallManager] Call type: ${isOutgoingCall ? 'OUTGOING' : 'INCOMING'}`)
        
        if (data.accepted) {
          console.log('[GlobalCallManager] Other participant accepted call - current user still ringing')
        } else {
          console.log('[GlobalCallManager] Other participant declined call - current user still ringing')
        }
      }
    }

    // ENHANCED: Handle call state updates with deduplication
    const handleCallStateUpdate = (data: { 
      callId: string; 
      status: string; 
      participantCount?: number;
      connectedParticipants?: number;
      participantStates?: Record<string, string>;
    }) => {
      const stateId = `${data.callId}-${data.status}-${Date.now()}`
      processEventWithLock('call_state_update', stateId, () => {
        console.log('[GlobalCallManager] ✅ CALL_STATE_UPDATE received:', data)
        console.log('[GlobalCallManager] Current incoming call:', incomingCall?.callId)
        console.log('[GlobalCallManager] Match?', data.callId === incomingCall?.callId)
        
        // ENHANCED: Handle both incoming and outgoing calls for ringing management
        const isIncomingCallUpdate = data.callId === incomingCall?.callId
        const isCurrentUserCaller = incomingCall && incomingCall.callerId === session?.user?.id
        
        if (!isIncomingCallUpdate) {
          // This might be an outgoing call state update - check if we should stop ringing
          const currentUserId = session?.user?.id
          const currentUserState = data.participantStates?.[currentUserId]
          
          console.log('[GlobalCallManager] 📞 Checking outgoing call state update for ringing management')
          console.log('[GlobalCallManager] Current user state:', currentUserState)
          console.log('[GlobalCallManager] Data status:', data.status)
          
          // CRITICAL FIX: For outgoing calls, stop ringing when others connect
          if ((data.status === 'connecting' || data.status === 'connected') && 
              data.participantStates && currentUserId) {
            
            // Check if anyone OTHER than current user has connected
            const otherParticipantsConnected = Object.entries(data.participantStates)
              .filter(([participantId, state]) => 
                participantId !== currentUserId && 
                (state === 'connected' || state === 'connecting')
              )
            
            if (otherParticipantsConnected.length > 0) {
              console.log('[GlobalCallManager] 🎯 OUTGOING CALL: Other participants connected, stopping caller ringing')
              console.log('[GlobalCallManager] Connected participants:', otherParticipantsConnected.map(([id, state]) => ({id, state})))
              stopRingingSound('outgoing call answered by others')
            } else {
              console.log('[GlobalCallManager] 🔔 OUTGOING CALL: No other participants connected yet, continuing ringing')
            }
          }
          
          return // Don't process further for non-matching calls
        }
      
        console.log('[GlobalCallManager] 🎯 Processing state update for OUR incoming call')
        
        // Skip further processing if current user is the caller (this is handled above for outgoing calls)
        if (isCurrentUserCaller) {
          console.log('[GlobalCallManager] Current user is caller - outgoing call ringing handled above')
          return
        }
      
      // ENHANCED: Check if current user is in participant states
      const currentUserId = session?.user?.id
      const currentUserState = data.participantStates?.[currentUserId]
      
      console.log('[GlobalCallManager] Current user state in participant states:', currentUserState)
      console.log('[GlobalCallManager] Participant states:', data.participantStates)
      
      // CRITICAL FIX: Only stop ringing when current user explicitly accepts or call ends globally
      if (data.status === 'connected' || data.status === 'connecting') {
        // Check if current user has actually connected/accepted
        if (currentUserState === 'connected' || currentUserState === 'accepted') {
          console.log('[GlobalCallManager] 🎯 Current user has accepted/connected - stopping ringing')
          stopRingingSound('current user accepted via state update')
          // Don't close modal - let CallModal handle the call UI
        } else {
          console.log('[GlobalCallManager] 🚀 Other participants connected - KEEPING ringing for current user')
          console.log(`[GlobalCallManager] Current user (${currentUserId}) state: ${currentUserState}`)
          // DON'T stop ringing - current user hasn't responded yet
        }
      } else if (data.status === 'disconnected' || data.status === 'ended') {
        console.log('[GlobalCallManager] 🚫 Call DISCONNECTED/ENDED globally - stopping ringing and cleaning up')
        stopRingingSound('call disconnected/ended')
        setTimeout(() => {
          setIncomingCall(null)
          setShowCallModal(false)
        }, 1000)
      } else if (data.status === 'declined') {
        // Check if ALL participants declined or if call was declined globally
        if (!data.participantStates || Object.keys(data.participantStates).length === 0) {
          console.log('[GlobalCallManager] ❌ Call DECLINED globally - stopping ringing and cleaning up')
          stopRingingSound('call declined globally')
          setTimeout(() => {
            setIncomingCall(null)
            setShowCallModal(false)
          }, 500)
        } else {
          console.log('[GlobalCallManager] ⏳ Some participants declined - continuing to ring for current user')
        }
      } else {
          // For other states like 'dialing', 'ringing', keep ringing
          console.log('[GlobalCallManager] ⏳ Call state:', data.status, '- continuing to ring')
        }
      })
    }
    
    socket.on('incoming_call', handleIncomingCall)
    socket.on('call_ended', handleCallEnded)
    socket.on('call_timeout', handleCallTimeout)
    socket.on('call_response', handleCallResponse)
    socket.on('call_state_update', handleCallStateUpdate)

    return () => {
      console.log('[GlobalCallManager] Cleaning up socket event listeners')
      
      // Clear event processing lock on cleanup
      eventProcessingLockRef.current = false
      lastProcessedEventRef.current = null
      
      // Remove browser event listeners
      window.removeEventListener('stopGlobalCallManagerRinging', handleStopRingingEvent as EventListener)
      window.removeEventListener('suspendGlobalAudioContext', handleSuspendAudioEvent as EventListener)
      
      socket.off('incoming_call', handleIncomingCall)
      socket.off('call_ended', handleCallEnded)
      socket.off('call_timeout', handleCallTimeout)
      socket.off('call_response', handleCallResponse)
      socket.off('call_state_update', handleCallStateUpdate)
      
      console.log('[GlobalCallManager] ✅ Socket and browser event listeners cleaned up')
    }
  }, [socket, session?.user?.id, incomingCall, playRingingSound, stopRingingSound, processEventWithLock, fetchParticipantData])

  const handleCloseCall = useCallback(() => {
    console.log('[GlobalCallManager] Closing call modal')
    stopRingingSound('call modal closed')
    setShowCallModal(false)
    setIncomingCall(null)
  }, [stopRingingSound])

  // ENHANCED: Comprehensive cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('[GlobalCallManager] Component unmounting - performing cleanup')
      
      // Clear ringing interval
      if (ringingInterval) {
        clearInterval(ringingInterval)
        console.log('[GlobalCallManager] Cleared ringing interval on unmount')
      }
      
      // Clear AudioContext cleanup timeout
      if (audioContextCleanupTimeoutRef.current) {
        clearTimeout(audioContextCleanupTimeoutRef.current)
        console.log('[GlobalCallManager] Cleared AudioContext cleanup timeout on unmount')
      }
      
      // Force close AudioContext immediately on unmount
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        console.log('[GlobalCallManager] Force closing AudioContext on unmount')
        audioContextRef.current.close().catch(error => {
          console.warn('[GlobalCallManager] Error force closing AudioContext on unmount:', error)
        })
      }
    }
  }, [ringingInterval])



  return (
    <>
      {/* Incoming Call Modal */}
      {incomingCall && showCallModal && (
        <CallModal
          isOpen={showCallModal}
          onClose={handleCloseCall}
          callType={incomingCall.callType}
          callId={incomingCall.callId}
          conversationId={incomingCall.conversationId}
          conversationName={incomingCall.conversationName}
          isGroupCall={incomingCall.isGroupCall}
          participants={
            // ENHANCED: Use complete participant data for group calls, fallback to caller for direct calls
            incomingCall.isGroupCall && incomingCall.participants && incomingCall.participants.length > 0
              ? incomingCall.participants.map(p => ({
                  id: p.id,
                  name: p.name,
                  username: p.username,
                  avatar: p.avatar,
                  isMuted: false,
                  isCameraOff: false,
                  isConnected: false
                }))
              : [
                  {
                    id: incomingCall.callerId,
                    name: incomingCall.callerName,
                    username: incomingCall.callerName,
                    avatar: incomingCall.callerAvatar,
                    isMuted: false,
                    isCameraOff: false,
                    isConnected: false
                  }
                ]
          }
          isIncoming={true}
        />
      )}
    </>
  )
}