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
}

export function GlobalCallManager() {
  const { socket } = useSocketContext()
  const { data: session } = useSession()
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null)
  const [showCallModal, setShowCallModal] = useState(false)
  const [ringingInterval, setRingingInterval] = useState<NodeJS.Timeout | null>(null)
  
  // ENHANCED: Audio context reference for proper cleanup
  const audioContextRef = useRef<AudioContext | null>(null)

  // Function to stop ringing sound with comprehensive cleanup
  const stopRingingSound = useCallback(() => {
    console.log('[GlobalCallManager] 🔇 FORCE STOP ringing sound - current interval:', !!ringingInterval)
    
    // Stop current interval
    if (ringingInterval) {
      clearInterval(ringingInterval)
      setRingingInterval(null)
      console.log('[GlobalCallManager] ✅ Cleared incoming ringing interval')
    }
    
    // ENHANCED: Properly close our managed AudioContext
    try {
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
    } catch (error) {
      console.warn('[GlobalCallManager] Error during AudioContext cleanup:', error)
    }
  }, [ringingInterval])

  // Initialize audio context with proper user gesture handling
  const initializeAudioContext = useCallback(async () => {
    // Return existing context only if it's still usable
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
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
      
      const audioContext = new AudioContextClass()
      
      // Resume if suspended (required for autoplay policy compliance)
      if (audioContext.state === 'suspended') {
        console.log('[GlobalCallManager] AudioContext suspended, resuming...')
        await audioContext.resume()
        console.log('[GlobalCallManager] AudioContext resumed')
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

    // Handle incoming call events
    const handleIncomingCall = (data: IncomingCall) => {
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
      setIncomingCall(data)
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
    }

    // Handle call ended events
    const handleCallEnded = (data?: { callId?: string; reason?: string }) => {
      console.log('[GlobalCallManager] Call ended event received:', data)
      
      // Only handle if it's for our current incoming call
      if (data?.callId && incomingCall?.callId && data.callId !== incomingCall.callId) {
        console.log('[GlobalCallManager] Ignoring call_ended for different call:', data.callId, 'vs', incomingCall.callId)
        return
      }
      
      console.log('[GlobalCallManager] Processing call_ended for current call')
      stopRingingSound()
      setIncomingCall(null)
      setShowCallModal(false)
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
      stopRingingSound()
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
      
      // Always stop ringing immediately when any call response is received
      console.log('[GlobalCallManager] Call response received - stopping ringing sound immediately')
      stopRingingSound()
      
      if (data.accepted) {
        console.log('[GlobalCallManager] Call was accepted')
        // Don't close modal yet - let CallModal handle the call
      } else {
        console.log('[GlobalCallManager] Call was declined - closing incoming call')
        setIncomingCall(null)
        setShowCallModal(false)
      }
    }

    // Handle call state updates for global call management
    const handleCallStateUpdate = (data: { callId: string; status: string }) => {
      console.log('[GlobalCallManager] ✅ CALL_STATE_UPDATE received:', data)
      console.log('[GlobalCallManager] Current incoming call:', incomingCall?.callId)
      console.log('[GlobalCallManager] Match?', data.callId === incomingCall?.callId)
      
      // If our incoming call is now connected or disconnected, handle it
      if (data.callId === incomingCall?.callId) {
        console.log('[GlobalCallManager] 🎯 Processing state update for OUR incoming call')
        
        // ENHANCED: Only stop ringing on specific state changes
        if (data.status === 'connected') {
          console.log('[GlobalCallManager] 🚀 Call CONNECTED - stopping ringing and keeping modal open')
          stopRingingSound()
          // Keep modal open for active call
        } else if (data.status === 'connecting') {
          console.log('[GlobalCallManager] 🔄 Call CONNECTING - stopping ringing but keeping modal open')
          stopRingingSound()
          // Keep modal open during connection process
        } else if (data.status === 'disconnected' || data.status === 'ended') {
          console.log('[GlobalCallManager] 🚫 Call DISCONNECTED/ENDED - stopping ringing and cleaning up')
          stopRingingSound()
          // Add delay to prevent UI flashing
          setTimeout(() => {
            setIncomingCall(null)
            setShowCallModal(false)
          }, 1000)
        } else if (data.status === 'declined') {
          console.log('[GlobalCallManager] ❌ Call DECLINED - stopping ringing and cleaning up')
          stopRingingSound()
          setTimeout(() => {
            setIncomingCall(null)
            setShowCallModal(false)
          }, 500)
        } else {
          // For other states like 'dialing', keep ringing
          console.log('[GlobalCallManager] ⏳ Call state:', data.status, '- continuing to ring')
        }
      } else {
        console.log('[GlobalCallManager] ❌ State update for different call (outgoing calls handled by CallModal)')
      }
    }
    
    socket.on('incoming_call', handleIncomingCall)
    socket.on('call_ended', handleCallEnded)
    socket.on('call_timeout', handleCallTimeout)
    socket.on('call_response', handleCallResponse)
    socket.on('call_state_update', handleCallStateUpdate)

    return () => {
      socket.off('incoming_call', handleIncomingCall)
      socket.off('call_ended', handleCallEnded)
      socket.off('call_timeout', handleCallTimeout)
      socket.off('call_response', handleCallResponse)
      socket.off('call_state_update', handleCallStateUpdate)
    }
  }, [socket, session?.user?.id, incomingCall?.callId, playRingingSound, stopRingingSound])

  const handleCloseCall = useCallback(() => {
    console.log('[GlobalCallManager] Closing call modal')
    stopRingingSound()
    setShowCallModal(false)
    setIncomingCall(null)
  }, [stopRingingSound])

  // Cleanup ringing sound on unmount
  useEffect(() => {
    return () => {
      if (ringingInterval) {
        clearInterval(ringingInterval)
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
          participants={[
            {
              id: incomingCall.callerId,
              name: incomingCall.callerName,
              username: incomingCall.callerName,
              avatar: incomingCall.callerAvatar,
              isMuted: false,
              isCameraOff: false,
              isConnected: false // Set to false initially, will be true when connected
            }
          ]}
          isIncoming={true}
        />
      )}
    </>
  )
}