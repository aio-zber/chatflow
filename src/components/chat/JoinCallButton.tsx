'use client'

import React, { memo } from 'react'
import { Phone, Video, Users } from 'lucide-react'
import { useSocketContext } from '@/context/SocketContext'

interface JoinCallButtonProps {
  callId: string
  conversationId: string
  callType: 'voice' | 'video'
  participantCount: number
  isGroupCall: boolean
  onJoinClick?: () => void
}

export const JoinCallButton = memo(({
  callId,
  conversationId,
  callType,
  participantCount,
  isGroupCall,
  onJoinClick
}: JoinCallButtonProps) => {
  const { socket } = useSocketContext()

  const handleJoinCall = () => {
    if (!socket) {
      console.error('[JoinCallButton] Socket not available')
      return
    }

    console.log(`[JoinCallButton] Joining call ${callId}`)
    
    // Emit join call event
    socket.emit('join_ongoing_call', {
      callId,
      conversationId
    })

    // Notify parent component
    onJoinClick?.()
  }

  // Don't show for 1-on-1 calls
  if (!isGroupCall) {
    return null
  }

  return (
    <div className="mb-4 p-3 bg-viber-primary/10 border border-viber-primary/20 rounded-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-viber-primary/20 flex items-center justify-center">
            {callType === 'video' ? (
              <Video className="w-5 h-5 text-viber-primary" />
            ) : (
              <Phone className="w-5 h-5 text-viber-primary" />
            )}
          </div>
          
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-medium text-viber-text">
                {callType === 'video' ? 'Video call' : 'Voice call'} ongoing
              </span>
              <div className="flex items-center gap-1 text-viber-text-secondary text-sm">
                <Users className="w-3 h-3" />
                <span>{participantCount}</span>
              </div>
            </div>
            <span className="text-sm text-viber-text-secondary">
              Group call in progress - Join anytime
            </span>
          </div>
        </div>

        <button
          onClick={handleJoinCall}
          className="px-4 py-2 bg-viber-primary hover:bg-viber-primary/90 text-white rounded-lg font-medium transition-colors duration-200 flex items-center gap-2"
        >
          <Phone className="w-4 h-4" />
          Join Call
        </button>
      </div>
    </div>
  )
})

JoinCallButton.displayName = 'JoinCallButton'