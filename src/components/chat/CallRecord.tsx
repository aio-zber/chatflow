'use client'

import { Phone, Video, PhoneOff, Clock, Users, User } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

export interface CallRecordData {
  id: string
  callType: 'voice' | 'video'
  status: 'completed' | 'missed' | 'cancelled'
  duration: number // in seconds
  startedAt: Date
  endedAt?: Date
  caller: {
    id: string
    name: string
    username: string
    avatar?: string
  }
  participants: Array<{
    id: string
    name: string
    username: string
    avatar?: string
  }>
  isOutgoing: boolean
}

interface CallRecordProps {
  callRecord: CallRecordData
  onCallBack?: (callType: 'voice' | 'video') => void
}

export function CallRecord({ callRecord, onCallBack }: CallRecordProps) {
  const formatDuration = (seconds: number) => {
    if (seconds === 0) return ''
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const getCallIcon = () => {
    if (callRecord.callType === 'video') {
      return <Video className="w-4 h-4" />
    }
    return <Phone className="w-4 h-4" />
  }

  const getCallStatus = () => {
    switch (callRecord.status) {
      case 'completed':
        return {
          text: callRecord.isOutgoing ? 'Outgoing call' : 'Incoming call',
          color: 'text-green-600 dark:text-green-400'
        }
      case 'missed':
        return {
          text: callRecord.isOutgoing ? 'Cancelled call' : 'Missed call',
          color: 'text-red-600 dark:text-red-400'
        }
      case 'cancelled':
        return {
          text: 'Cancelled call',
          color: 'text-gray-600 dark:text-gray-400'
        }
      default:
        return {
          text: 'Call',
          color: 'text-gray-600 dark:text-gray-400'
        }
    }
  }

  const getCallDirection = () => {
    if (callRecord.status === 'missed' && !callRecord.isOutgoing) {
      return <PhoneOff className="w-3 h-3 text-red-500" />
    }
    
    if (callRecord.isOutgoing) {
      return (
        <div className="w-3 h-3 relative">
          {getCallIcon()}
          <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-500 rounded-full border border-white dark:border-gray-800" />
        </div>
      )
    }
    
    return (
      <div className="w-3 h-3 relative">
        {getCallIcon()}
        <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full border border-white dark:border-gray-800" />
      </div>
    )
  }

  const callStatus = getCallStatus()
  const isGroupCall = callRecord.participants.length > 1

  return (
    <div className="flex items-center space-x-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-colors">
      {/* Call direction and type indicator */}
      <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700">
        {getCallDirection()}
      </div>

      {/* Call details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center space-x-2">
          <p className={`text-sm font-medium ${callStatus.color}`}>
            {callStatus.text}
          </p>
          {isGroupCall && (
            <div className="flex items-center space-x-1">
              <Users className="w-3 h-3 text-gray-400" />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {callRecord.participants.length}
              </span>
            </div>
          )}
        </div>
        
        <div className="flex items-center space-x-2 mt-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {formatDistanceToNow(callRecord.startedAt, { addSuffix: true })}
          </span>
          {callRecord.duration > 0 && (
            <>
              <span className="text-xs text-gray-400">•</span>
              <div className="flex items-center space-x-1">
                <Clock className="w-3 h-3 text-gray-400" />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formatDuration(callRecord.duration)}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Participants (for group calls) */}
        {isGroupCall && (
          <div className="flex items-center space-x-1 mt-1">
            {callRecord.participants.slice(0, 3).map((participant, index) => (
              <div key={participant.id} className="flex items-center">
                {participant.avatar ? (
                  <img
                    src={participant.avatar}
                    alt={participant.name}
                    className="w-4 h-4 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                    <User className="w-2 h-2 text-white" />
                  </div>
                )}
                {index < Math.min(callRecord.participants.length - 1, 2) && (
                  <span className="text-xs text-gray-400 mx-1">•</span>
                )}
              </div>
            ))}
            {callRecord.participants.length > 3 && (
              <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                +{callRecord.participants.length - 3} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* Call back button */}
      {onCallBack && callRecord.status !== 'missed' && (
        <div className="flex space-x-1">
          <button
            onClick={() => onCallBack('voice')}
            className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-full transition-colors"
            title="Voice call"
          >
            <Phone className="w-4 h-4" />
          </button>
          <button
            onClick={() => onCallBack('video')}
            className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-full transition-colors"
            title="Video call"
          >
            <Video className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}