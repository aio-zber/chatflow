'use client'

import React, { useRef, useEffect } from 'react'
import { useVoiceActivity } from '@/hooks/useVoiceActivity'

interface VideoParticipant {
  id: string
  name: string
  username: string
  avatar?: string | null
  isMuted: boolean
  isCameraOff: boolean
  isConnected: boolean
  participantStatus: 'connecting' | 'connected' | 'ringing' | 'disconnected'
  stream?: MediaStream | null
}

interface VideoGridProps {
  localStream: MediaStream | null
  remoteStreams: Map<string, MediaStream>
  participants: VideoParticipant[]
  currentUserId: string
  isLocalCameraOff: boolean
  isLocalMuted: boolean
  onVideoRef?: (participantId: string, element: HTMLVideoElement | null) => void
}

export function VideoGrid({
  localStream,
  remoteStreams,
  participants,
  currentUserId,
  isLocalCameraOff,
  isLocalMuted,
  onVideoRef
}: VideoGridProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null)
  
  // Voice activity detection for local user
  const { isSpeaking: isLocalSpeaking } = useVoiceActivity({ 
    stream: localStream,
    threshold: -40 // More sensitive threshold for better detection
  })

  // Set up local video stream
  useEffect(() => {
    console.log('[VideoGrid] Local stream effect triggered:', {
      hasVideoRef: !!localVideoRef.current,
      hasLocalStream: !!localStream,
      localStreamTracks: localStream?.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, readyState: t.readyState })),
      isLocalCameraOff
    })
    
    if (localVideoRef.current && localStream) {
      console.log('[VideoGrid] Setting up local video stream')
      console.log('[VideoGrid] Local stream details:', {
        id: localStream.id,
        active: localStream.active,
        videoTracks: localStream.getVideoTracks().map(t => ({ 
          id: t.id, 
          kind: t.kind, 
          enabled: t.enabled, 
          readyState: t.readyState, 
          label: t.label 
        })),
        audioTracks: localStream.getAudioTracks().map(t => ({ 
          id: t.id, 
          kind: t.kind, 
          enabled: t.enabled, 
          readyState: t.readyState, 
          label: t.label 
        }))
      })
      
      // VIDEO CALL FIX: Clear any previous srcObject to prevent stuck video
      if (localVideoRef.current.srcObject) {
        console.log('[VideoGrid] Clearing previous srcObject for fresh video setup')
        localVideoRef.current.pause()
        localVideoRef.current.srcObject = null
        localVideoRef.current.load()
      }
      
      // Set video source
      localVideoRef.current.srcObject = localStream
      localVideoRef.current.muted = true // Prevent audio feedback
      
      // Force video attributes
      localVideoRef.current.autoplay = true
      localVideoRef.current.playsInline = true
      localVideoRef.current.controls = false
      
      // Add event listeners for debugging
      localVideoRef.current.onloadedmetadata = () => {
        console.log('[VideoGrid] ✅ Local video metadata loaded:', {
          videoWidth: localVideoRef.current?.videoWidth,
          videoHeight: localVideoRef.current?.videoHeight,
          duration: localVideoRef.current?.duration
        })
      }
      
      localVideoRef.current.onplaying = () => {
        console.log('[VideoGrid] ✅ Local video started playing')
      }
      
      localVideoRef.current.onerror = (error) => {
        console.error('[VideoGrid] ❌ Local video error:', error)
      }
      
      // Force play
      localVideoRef.current.play().then(() => {
        console.log('[VideoGrid] ✅ Local video play() succeeded')
      }).catch(error => {
        console.error('[VideoGrid] ❌ Failed to play local video:', error)
        // Try to play again after a short delay
        setTimeout(() => {
          if (localVideoRef.current) {
            localVideoRef.current.play().catch(e => console.error('[VideoGrid] Retry play failed:', e))
          }
        }, 1000)
      })
    } else {
      console.log('[VideoGrid] Not setting up local video:', {
        hasVideoRef: !!localVideoRef.current,
        hasLocalStream: !!localStream,
        streamActive: localStream?.active,
        videoTrackCount: localStream?.getVideoTracks().length || 0
      })
    }
  }, [localStream, isLocalCameraOff])

  // Calculate grid layout based on participant count
  const getGridLayout = (participantCount: number) => {
    if (participantCount <= 1) return 'grid-cols-1'
    if (participantCount <= 2) return 'grid-cols-1 md:grid-cols-2'
    if (participantCount <= 4) return 'grid-cols-2'
    if (participantCount <= 6) return 'grid-cols-2 lg:grid-cols-3'
    return 'grid-cols-3 lg:grid-cols-4'
  }

  const totalParticipants = participants.length + 1 // +1 for local user
  const gridLayout = getGridLayout(totalParticipants)

  return (
    <div className={`grid ${gridLayout} gap-4 h-full max-h-[70vh]`}>
      {/* Local video */}
      <div className={`relative bg-gray-800 rounded-lg overflow-hidden aspect-video ${
        isLocalSpeaking && !isLocalMuted ? 'ring-4 ring-green-500' : ''
      }`}>
        {!isLocalCameraOff && localStream && localStream.getVideoTracks().length > 0 ? (
          <video
            ref={localVideoRef}
            className="w-full h-full object-cover"
            autoPlay
            muted
            playsInline
            controls={false}
            style={{ transform: 'scaleX(-1)' }} // Mirror local video
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-700">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-2">
                <span className="text-white text-xl font-medium">You</span>
              </div>
              <p className="text-white text-sm font-medium mb-1">You</p>
              {isLocalCameraOff && (
                <div className="flex flex-col items-center justify-center space-y-2">
                  <div className="flex items-center justify-center space-x-2 text-gray-300 bg-black bg-opacity-50 px-3 py-1 rounded-full">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" />
                    </svg>
                    <span className="text-sm font-medium">Camera off</span>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-medium text-gray-300 bg-black bg-opacity-50 px-3 py-2 rounded-lg">
                      You
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded flex items-center">
          You{isLocalMuted ? ' (muted)' : ''}
          {isLocalSpeaking && !isLocalMuted && (
            <span className="ml-1 text-green-400">🎤</span>
          )}
          {isLocalMuted && (
            <svg className="w-3 h-3 ml-1" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          )}
        </div>
        {/* Local connection indicator */}
        <div className="absolute top-2 right-2">
          <div className="w-2 h-2 rounded-full bg-green-500" />
        </div>
      </div>

      {/* Remote participants */}
      {participants.map((participant) => {
        const hasRemoteStream = remoteStreams.has(participant.id)
        const remoteStream = remoteStreams.get(participant.id)
        
        return (
          <RemoteParticipantVideo
            key={participant.id}
            participant={participant}
            stream={remoteStream}
            hasRemoteStream={hasRemoteStream}
            onVideoRef={onVideoRef}
          />
        )
      })}
    </div>
  )
}

// Component for remote participants with voice activity
function RemoteParticipantVideo({
  participant,
  stream,
  hasRemoteStream,
  onVideoRef
}: {
  participant: VideoParticipant
  stream?: MediaStream
  hasRemoteStream: boolean
  onVideoRef?: (participantId: string, element: HTMLVideoElement | null) => void
}) {
  // Voice activity detection for remote participant
  const { isSpeaking } = useVoiceActivity({ 
    stream: stream || null,
    threshold: -40 // More sensitive threshold for better detection
  })

  // Detect if remote participant is actually muted based on stream
  const isActuallyMuted = React.useMemo(() => {
    if (!stream) return true
    const audioTracks = stream.getAudioTracks()
    return audioTracks.length === 0 || audioTracks.every(track => !track.enabled)
  }, [stream])

  return (
    <div className={`relative bg-gray-800 rounded-lg overflow-hidden aspect-video ${
      isSpeaking && !isActuallyMuted ? 'ring-4 ring-green-500' : ''
    }`}>
            {participant.isCameraOff || !hasRemoteStream ? (
              <div className="w-full h-full bg-gray-700 flex items-center justify-center">
                {/* CRITICAL FIX: Add audio element for voice calls */}
                {stream && (
                  <audio 
                    ref={(el) => {
                      if (el && stream && el.srcObject !== stream) {
                        console.log('[VideoGrid] Setting up audio for voice call participant:', participant.name)
                        el.srcObject = stream
                        el.play().catch(error => {
                          console.error('[VideoGrid] Failed to play remote audio:', error)
                        })
                      }
                    }}
                    autoPlay
                    playsInline
                    controls={false}
                  />
                )}
                <div className="text-center">
                  {participant.avatar ? (
                    <img
                      src={participant.avatar}
                      alt={participant.name}
                      className="w-16 h-16 rounded-full object-cover mx-auto mb-2"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-2">
                      <span className="text-white text-xl font-medium">
                        {participant.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <p className="text-white text-sm font-medium mb-1">{participant.name}</p>
                  
                  {/* Enhanced camera off indicator matching the design */}
                  {participant.isCameraOff ? (
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <div className="flex items-center justify-center space-x-2 text-gray-300 bg-black bg-opacity-50 px-3 py-1 rounded-full">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" />
                        </svg>
                        <span className="text-sm font-medium">Camera off</span>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-medium text-gray-300 bg-black bg-opacity-50 px-3 py-2 rounded-lg">
                          {participant.name}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center space-x-1 text-gray-400">
                      <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-xs">
                        {participant.participantStatus === 'ringing' ? 'Ringing...' :
                         participant.participantStatus === 'connecting' ? 'Connecting...' : 
                         participant.participantStatus === 'connected' && !stream ? 'Loading stream...' :
                         participant.participantStatus === 'connected' && stream ? 'Connected' :
                         'Waiting...'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <video 
                ref={(el) => {
                  onVideoRef?.(participant.id, el)
                  if (el && stream) {
                    // VIDEO CALL FIX: Always clear previous srcObject to prevent stuck video
                    if (el.srcObject && el.srcObject !== stream) {
                      console.log(`[VideoGrid] Clearing previous video stream for ${participant.name}`)
                      el.pause()
                      el.srcObject = null
                      el.load()
                    }
                    
                    // Set the new stream
                    if (el.srcObject !== stream) {
                      console.log(`[VideoGrid] Setting up video stream for ${participant.name}:`, {
                        streamId: stream.id,
                        active: stream.active,
                        videoTracks: stream.getVideoTracks().length
                      })
                      el.srcObject = stream
                    }
                    
                    el.play().catch(error => {
                      console.error('[VideoGrid] Failed to play remote video:', error)
                    })
                  }
                }}
                className="w-full h-full object-cover"
                autoPlay
                playsInline
                muted={false}
              />
            )}
            
            {/* Participant info overlay */}
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded flex items-center">
              {participant.name}{(participant.isMuted || isActuallyMuted) ? ' (muted)' : ''}
              {isSpeaking && !isActuallyMuted && (
                <span className="ml-1 text-green-400">🎤</span>
              )}
              {(participant.isMuted || isActuallyMuted) && (
                <svg className="w-3 h-3 ml-1 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              )}
            </div>

            {/* Enhanced mute indicator - large visual indicator */}
            {(participant.isMuted || isActuallyMuted) && (
              <div className="absolute top-2 left-2 bg-red-600 bg-opacity-90 text-white p-1.5 rounded-full">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>
            )}

            {/* Connection status indicator */}
            <div className="absolute top-2 right-2">
              <div className={`w-2 h-2 rounded-full ${
                hasRemoteStream && !participant.isCameraOff ? 'bg-green-500' : 
                hasRemoteStream ? 'bg-yellow-500' : 'bg-red-500'
              }`} title={
                hasRemoteStream && !participant.isCameraOff ? 'Connected' :
                hasRemoteStream ? 'Connected (no video)' : 'Connecting...'
              } />
            </div>

            {/* Network quality indicator */}
            <div className="absolute top-2 left-2">
              <div className="flex space-x-1">
                <div className="w-1 h-2 bg-green-500 rounded-sm" />
                <div className={`w-1 h-3 rounded-sm ${hasRemoteStream ? 'bg-green-500' : 'bg-gray-500'}`} />
                <div className={`w-1 h-4 rounded-sm ${hasRemoteStream ? 'bg-green-500' : 'bg-gray-500'}`} />
              </div>
            </div>
    </div>
  )
}
