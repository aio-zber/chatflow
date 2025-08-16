'use client'

import { useState, useEffect, useRef } from 'react'
import { PhoneOff, Mic, MicOff, Camera, CameraOff, Monitor, Users } from 'lucide-react'
import { useSocketContext } from '@/context/SocketContext'
import { useSession } from 'next-auth/react'

interface CallParticipant {
  id: string
  name: string
  username: string
  avatar?: string | null
  isMuted: boolean
  isCameraOff: boolean
  isConnected: boolean
}

interface CallModalProps {
  isOpen: boolean
  onClose: () => void
  callType: 'voice' | 'video'
  conversationId: string
  conversationName?: string | null
  isGroupCall?: boolean
  participants?: CallParticipant[]
}

interface CallState {
  status: 'calling' | 'ringing' | 'connected' | 'ended'
  duration: number
  isMuted: boolean
  isCameraOff: boolean
  isScreenSharing: boolean
  connectedParticipants: number
}

export function CallModal({
  isOpen,
  onClose,
  callType,
  conversationId,
  conversationName,
  isGroupCall = false,
  participants = [],
}: CallModalProps) {
  const { socket } = useSocketContext()
  const { data: session } = useSession()
  const [callState, setCallState] = useState<CallState>({
    status: 'calling',
    duration: 0,
    isMuted: false,
    isCameraOff: callType === 'voice',
    isScreenSharing: false,
    connectedParticipants: 0,
  })
  
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map())

  // Socket-based call state management
  useEffect(() => {
    if (!socket || !isOpen) return

    // Listen for call response events
    const handleCallResponse = (data: { 
      accepted: boolean
      participantId: string
      participantCount: number
      callStatus: string
    }) => {
      if (data.accepted && data.callStatus === 'connected') {
        setCallState(prev => ({ 
          ...prev, 
          status: 'connected',
          connectedParticipants: data.participantCount
        }))
      }
    }

    // Listen for participant joined events
    const handleParticipantJoined = (data: {
      participantId: string
      participantCount: number
    }) => {
      setCallState(prev => ({ 
        ...prev, 
        status: 'connected',
        connectedParticipants: data.participantCount
      }))
    }

    // Listen for call ended events
    const handleCallEnded = () => {
      setCallState(prev => ({ ...prev, status: 'ended' }))
      setTimeout(() => onClose(), 1500)
    }

    // Listen for call timeout
    const handleCallTimeout = () => {
      setCallState(prev => ({ ...prev, status: 'ended' }))
      setTimeout(() => onClose(), 1500)
    }

    socket.on('call_response', handleCallResponse)
    socket.on('participant_joined', handleParticipantJoined)
    socket.on('call_ended', handleCallEnded)
    socket.on('call_timeout', handleCallTimeout)

    // Auto-progress to ringing when modal opens
    if (callState.status === 'calling') {
      setCallState(prev => ({ ...prev, status: 'ringing' }))
    }

    // For testing: Auto-connect after 3 seconds if no real response
    const testAutoConnect = setTimeout(() => {
      if (callState.status === 'ringing') {
        console.log('Auto-connecting call for testing purposes')
        setCallState(prev => ({ 
          ...prev, 
          status: 'connected',
          connectedParticipants: Math.max(1, participants.length)
        }))
      }
    }, 3000)

    return () => {
      clearTimeout(testAutoConnect)
      socket.off('call_response', handleCallResponse)
      socket.off('participant_joined', handleParticipantJoined)
      socket.off('call_ended', handleCallEnded)
      socket.off('call_timeout', handleCallTimeout)
    }
  }, [socket, isOpen, callState.status, onClose])

  // Call duration timer
  useEffect(() => {
    if (callState.status === 'connected') {
      timerRef.current = setInterval(() => {
        setCallState(prev => ({ ...prev, duration: prev.duration + 1 }))
      }, 1000)
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
  }, [callState.status])

  // Initialize media stream when call opens
  useEffect(() => {
    let isMounted = true

    const initializeMediaStream = async () => {
      try {
        const constraints: MediaStreamConstraints = {
          audio: true,
          video: callType === 'video' ? {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 }
          } : false
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        
        if (isMounted) {
          localStreamRef.current = stream
          
          // Set video stream to video element
          if (localVideoRef.current && callType === 'video') {
            localVideoRef.current.srcObject = stream
          }
        }
      } catch (error) {
        console.error('Failed to access media devices:', error)
        // Handle permission denied or device not available
        if (isMounted) {
          setCallState(prev => ({ ...prev, status: 'ended' }))
          setTimeout(() => onClose(), 1000)
        }
      }
    }

    if (isOpen && !localStreamRef.current) {
      initializeMediaStream()
    }

    return () => {
      isMounted = false
    }
  }, [isOpen, callType, callState.status, participants.length, onClose])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop all tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          track.stop()
        })
      }
      
      // Close all peer connections
      peerConnectionsRef.current.forEach(pc => {
        pc.close()
      })
      peerConnectionsRef.current.clear()
    }
  }, [])

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const handleEndCall = () => {
    // Emit end_call event to server
    if (socket && conversationId && session?.user?.id) {
      socket.emit('end_call', {
        conversationId,
        callId: `call-${Date.now()}`, // This should be the actual call ID in a real implementation
        participantId: session.user.id
      })
    }

    setCallState(prev => ({ ...prev, status: 'ended' }))
    if (timerRef.current) {
      clearInterval(timerRef.current)
    }
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
    }
  }

  const toggleScreenShare = () => {
    setCallState(prev => ({ ...prev, isScreenSharing: !prev.isScreenSharing }))
  }

  if (!isOpen) return null

  const getStatusText = () => {
    switch (callState.status) {
      case 'calling':
        return 'Initiating call...'
      case 'ringing':
        return isGroupCall ? 'Calling participants...' : 'Ringing...'
      case 'connected':
        return isGroupCall ? 
          `${callState.connectedParticipants} participant${callState.connectedParticipants > 1 ? 's' : ''} connected` :
          'Connected'
      case 'ended':
        return 'Call ended'
      default:
        return ''
    }
  }

  const connectedParticipants = participants.slice(0, callState.connectedParticipants)

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

          {/* Video/Participants Area */}
          <div className="mb-8">
            {callType === 'video' && callState.status === 'connected' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {/* Local video */}
                <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video">
                  {!callState.isCameraOff ? (
                    <video
                      ref={localVideoRef}
                      className="w-full h-full object-cover"
                      autoPlay
                      muted
                      playsInline
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="w-16 h-16 bg-gray-600 rounded-full flex items-center justify-center">
                        <span className="text-white text-xl font-medium">You</span>
                      </div>
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                    You {callState.isMuted && '(muted)'}
                  </div>
                </div>

                {/* Remote participants */}
                {connectedParticipants.map((participant) => (
                  <div key={participant.id} className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video">
                    {participant.isCameraOff ? (
                      <div className="w-full h-full bg-gray-700 flex items-center justify-center">
                        <span className="text-gray-400 text-sm">Camera off</span>
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        {/* Placeholder for remote video - would be populated by WebRTC */}
                        <video 
                          className="w-full h-full object-cover"
                          autoPlay
                          playsInline
                          // Remote video streams would be set via WebRTC
                        />
                        {/* Fallback to avatar when video not available */}
                        <div className="absolute inset-0 flex items-center justify-center bg-gray-700">
                          {participant.avatar ? (
                            <img
                              src={participant.avatar}
                              alt={participant.name}
                              className="w-16 h-16 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center">
                              <span className="text-white text-xl font-medium">
                                {participant.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                      {participant.name} {participant.isMuted && '(muted)'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Voice call or waiting participants */
              <div className="py-12">
                {callState.status === 'connected' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {/* Current user */}
                    <div className="flex flex-col items-center">
                      <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mb-2">
                        <span className="text-white text-xl font-medium">You</span>
                      </div>
                      <p className="text-white text-sm">You</p>
                      {callState.isMuted && <p className="text-gray-400 text-xs">(muted)</p>}
                    </div>

                    {/* Connected participants */}
                    {connectedParticipants.map((participant) => (
                      <div key={participant.id} className="flex flex-col items-center">
                        {participant.avatar ? (
                          <img
                            src={participant.avatar}
                            alt={participant.name}
                            className="w-20 h-20 rounded-full object-cover mb-2"
                          />
                        ) : (
                          <div className="w-20 h-20 bg-gray-600 rounded-full flex items-center justify-center mb-2">
                            <span className="text-white text-xl font-medium">
                              {participant.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                        <p className="text-white text-sm">{participant.name}</p>
                        {participant.isMuted && <p className="text-gray-400 text-xs">(muted)</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Calling state */
                  <div className="flex flex-col items-center">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                      {participants.map((participant) => (
                        <div key={participant.id} className="flex flex-col items-center">
                          {participant.avatar ? (
                            <img
                              src={participant.avatar}
                              alt={participant.name}
                              className="w-20 h-20 rounded-full object-cover mb-2"
                            />
                          ) : (
                            <div className="w-20 h-20 bg-gray-600 rounded-full flex items-center justify-center mb-2">
                              <span className="text-white text-xl font-medium">
                                {participant.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                          )}
                          <p className="text-white text-sm">{participant.name}</p>
                          <p className="text-gray-400 text-xs">
                            {callState.status === 'calling' ? 'Calling...' : 'Ringing...'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex justify-center space-x-4">
            {/* Mute */}
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

            {/* Camera (video calls only) */}
            {callType === 'video' && (
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

            {/* Screen Share (video calls only) */}
            {callType === 'video' && (
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

            {/* End Call */}
            <button
              onClick={handleEndCall}
              className="w-12 h-12 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center transition-colors"
            >
              <PhoneOff className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}