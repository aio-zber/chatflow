'use client'

import React, { memo, useMemo, useCallback, useRef, useEffect, lazy, Suspense } from 'react'
import { CALL_CONFIG } from '@/lib/call-config'

// Lazy load react-window for better performance and fallback support
const Grid = lazy(() => import('react-window').then(module => ({ default: module.FixedSizeGrid })))

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

interface OptimizedVideoGridProps {
  participants: VideoParticipant[]
  localStream: MediaStream | null
  remoteStreams: Map<string, MediaStream>
  currentUserId: string
  isLocalCameraOff: boolean
  isLocalMuted: boolean
  maxVisibleParticipants?: number
  onVideoRef?: (participantId: string, element: HTMLVideoElement | null) => void
}

// Memoized individual video component to prevent unnecessary re-renders
const VideoParticipantCard = memo(({ 
  participant, 
  stream, 
  isLocal = false,
  onVideoRef 
}: {
  participant: VideoParticipant
  stream: MediaStream | null
  isLocal?: boolean
  onVideoRef?: (participantId: string, element: HTMLVideoElement | null) => void
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  
  // Memoize expensive operations
  const streamId = useMemo(() => stream?.id || 'no-stream', [stream])
  
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
      onVideoRef?.(participant.id, videoRef.current)
    }
    
    return () => {
      onVideoRef?.(participant.id, null)
    }
  }, [stream, participant.id, onVideoRef])

  // Memoized connection status styles
  const statusStyles = useMemo(() => {
    const baseClasses = 'relative w-full h-full rounded-xl overflow-hidden bg-viber-surface border-2 transition-all duration-200'
    
    switch (participant.participantStatus) {
      case 'connected':
        return `${baseClasses} border-green-500/50 shadow-lg shadow-green-500/20`
      case 'connecting':
        return `${baseClasses} border-yellow-500/50 shadow-lg shadow-yellow-500/20 animate-pulse`
      case 'ringing':
        return `${baseClasses} border-blue-500/50 shadow-lg shadow-blue-500/20 animate-pulse`
      case 'disconnected':
        return `${baseClasses} border-red-500/50 shadow-lg shadow-red-500/20`
      default:
        return `${baseClasses} border-viber-border`
    }
  }, [participant.participantStatus])

  return (
    <div className={statusStyles} data-stream-id={streamId}>
      {/* Video Element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className="w-full h-full object-cover"
      />
      
      {/* Camera Off Overlay */}
      {participant.isCameraOff && (
        <div className="absolute inset-0 bg-gradient-to-br from-viber-primary/20 to-viber-secondary/20 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-viber-surface border-2 border-viber-border flex items-center justify-center">
            {participant.avatar ? (
              <img 
                src={participant.avatar} 
                alt={participant.name}
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              <div className="w-8 h-8 text-viber-text-secondary">
                📹
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Participant Info */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
        <div className="flex items-center gap-2 text-white text-sm">
          <span className="font-medium truncate">{participant.name}</span>
          
          {/* Mute Status */}
          {participant.isMuted && (
            <div className="flex-shrink-0 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center">
              <span className="text-xs">🔇</span>
            </div>
          )}
          
          {/* Connection Status */}
          <div className={`flex-shrink-0 w-2 h-2 rounded-full ${
            participant.participantStatus === 'connected' ? 'bg-green-500' :
            participant.participantStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
            participant.participantStatus === 'ringing' ? 'bg-blue-500 animate-pulse' :
            'bg-red-500'
          }`} />
        </div>
      </div>
    </div>
  )
})

VideoParticipantCard.displayName = 'VideoParticipantCard'

// Virtualized grid for large participant counts using react-window
const VirtualizedVideoGrid = memo(({ participants, gridConfig, onVideoRef }: any) => {
  const cellRenderer = useCallback(({ columnIndex, rowIndex, style }: any) => {
    const participantIndex = rowIndex * gridConfig.cols + columnIndex
    const participant = participants[participantIndex]
    
    if (!participant) return null
    
    return (
      <div style={style} className="p-1">
        <VideoParticipantCard
          participant={participant}
          stream={participant.stream}
          isLocal={participant.isLocal}
          onVideoRef={onVideoRef}
        />
      </div>
    )
  }, [participants, gridConfig.cols, onVideoRef])

  // Fallback grid for when react-window is loading or fails
  const FallbackGrid = () => (
    <div className={`w-full h-full p-4 grid gap-2 place-items-center auto-rows-fr max-h-[600px] overflow-y-auto viber-scrollbar
      ${gridConfig.cols === 1 ? 'grid-cols-1' :
        gridConfig.cols === 2 ? 'grid-cols-2' :
        gridConfig.cols === 3 ? 'grid-cols-3' :
        'grid-cols-4'}`}>
      {participants.map((participant: any) => (
        <div key={participant.id} className="w-full max-w-[300px] h-[225px]">
          <VideoParticipantCard
            participant={participant}
            stream={participant.stream}
            isLocal={participant.isLocal}
            onVideoRef={onVideoRef}
          />
        </div>
      ))}
    </div>
  )

  return (
    <div className="w-full h-full flex items-center justify-center">
      <Suspense fallback={<FallbackGrid />}>
        <Grid
          columnCount={gridConfig.cols}
          rowCount={gridConfig.rows}
          columnWidth={300}
          rowHeight={225}
          height={Math.min(600, gridConfig.rows * 225)}
          width={Math.min(1200, gridConfig.cols * 300)}
          className="viber-scrollbar"
        >
          {cellRenderer}
        </Grid>
      </Suspense>
    </div>
  )
})

VirtualizedVideoGrid.displayName = 'VirtualizedVideoGrid'

// Error boundary for virtualized grid
class VirtualGridErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: () => React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[OptimizedVideoGrid] Virtualization error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback()
    }

    return this.props.children
  }
}

// Main optimized video grid component
export const OptimizedVideoGrid = memo(({
  participants,
  localStream,
  remoteStreams,
  currentUserId,
  isLocalCameraOff,
  isLocalMuted,
  maxVisibleParticipants = 9,
  onVideoRef
}: OptimizedVideoGridProps) => {
  // Memoize grid calculations to prevent unnecessary recalculations
  const gridConfig = useMemo(() => {
    const totalParticipants = participants.length + 1 // +1 for local user
    const cols = Math.min(Math.ceil(Math.sqrt(totalParticipants)), 4)
    const rows = Math.ceil(totalParticipants / cols)
    
    return { cols, rows, totalParticipants }
  }, [participants.length])

  // Memoize participant data with local user included
  const allParticipants = useMemo(() => {
    const localParticipant: VideoParticipant & { stream: MediaStream | null; isLocal: boolean } = {
      id: 'local',
      name: 'You',
      username: 'local',
      avatar: null,
      isMuted: isLocalMuted,
      isCameraOff: isLocalCameraOff,
      isConnected: true,
      participantStatus: 'connected',
      stream: localStream,
      isLocal: true
    }
    
    const remoteParticipants = participants.map(p => ({
      ...p,
      stream: remoteStreams.get(p.id) || null,
      isLocal: false
    }))
    
    return [localParticipant, ...remoteParticipants]
  }, [participants, localStream, remoteStreams, isLocalMuted, isLocalCameraOff])

  // Create fallback regular grid component
  const RegularGrid = useCallback(() => (
    <div className={`w-full h-full p-4 grid gap-2 place-items-center auto-rows-fr
      ${gridConfig.cols === 1 ? 'grid-cols-1' :
        gridConfig.cols === 2 ? 'grid-cols-2' :
        gridConfig.cols === 3 ? 'grid-cols-3' :
        'grid-cols-4'}`}>
      {allParticipants.map((participant) => (
        <VideoParticipantCard
          key={participant.id}
          participant={participant}
          stream={participant.stream}
          isLocal={participant.isLocal}
          onVideoRef={onVideoRef}
        />
      ))}
    </div>
  ), [allParticipants, gridConfig.cols, onVideoRef])

  // Use virtualization for large groups to improve performance (if enabled)
  if (CALL_CONFIG.UI.VIRTUALIZATION_ENABLED && gridConfig.totalParticipants > maxVisibleParticipants) {
    return (
      <div className="w-full h-full bg-viber-background">
        <VirtualGridErrorBoundary fallback={RegularGrid}>
          <VirtualizedVideoGrid 
            participants={allParticipants}
            gridConfig={gridConfig}
            onVideoRef={onVideoRef}
          />
        </VirtualGridErrorBoundary>
      </div>
    )
  }

  // Regular grid for small groups - better UX for small calls
  return (
    <div className={`w-full h-full p-4 grid gap-2 place-items-center auto-rows-fr
      ${gridConfig.cols === 1 ? 'grid-cols-1' :
        gridConfig.cols === 2 ? 'grid-cols-2' :
        gridConfig.cols === 3 ? 'grid-cols-3' :
        'grid-cols-4'}`}>
      {allParticipants.map((participant) => (
        <VideoParticipantCard
          key={participant.id}
          participant={participant}
          stream={participant.stream}
          isLocal={participant.isLocal}
          onVideoRef={onVideoRef}
        />
      ))}
    </div>
  )
})

OptimizedVideoGrid.displayName = 'OptimizedVideoGrid'