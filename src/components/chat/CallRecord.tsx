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

  const getViberCallMessage = () => {
    const duration = callRecord.duration > 0 ? ` (${formatDuration(callRecord.duration)})` : ''
    
    // Direction arrow icons - matching Viber design
    const getDirectionIcon = () => {
      if (callRecord.isOutgoing) {
        // Right arrow (→) for outgoing calls - user initiated the call
        return (
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        )
      } else {
        // Left arrow (←) for incoming calls - other person initiated the call  
        return (
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
        </svg>
        )
      }
    }
    
    const callTypeIcon = callRecord.callType === 'video' ? 
      <Video className="w-4 h-4" /> : 
      <Phone className="w-4 h-4" />
    
    if (callRecord.status === 'missed' || callRecord.status === 'cancelled') {
      return {
        text: callRecord.status === 'missed' && !callRecord.isOutgoing ? 'Missed call' : 'Cancelled call',
        bgColor: 'bg-red-50 dark:bg-red-900/30',
        borderColor: 'border-red-200 dark:border-red-800/50',
        textColor: 'text-red-700 dark:text-red-300',
        directionIcon: getDirectionIcon(),
        callIcon: callTypeIcon,
        duration
      }
    } else {
      return {
        text: `${callRecord.isOutgoing ? 'Outgoing call' : 'Incoming call'}`,
        bgColor: 'bg-gray-50 dark:bg-gray-800/50',
        borderColor: 'border-gray-200 dark:border-gray-700/50',
        textColor: 'text-gray-700 dark:text-gray-300',
        directionIcon: getDirectionIcon(),
        callIcon: callTypeIcon,
        duration
      }
    }
  }

  const viberMessage = getViberCallMessage()

  return (
    <div className="flex justify-center my-3">
      <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${viberMessage.bgColor} ${viberMessage.borderColor} shadow-sm max-w-sm`}>
        {/* Direction Arrow */}
        <div className={`${viberMessage.textColor} flex-shrink-0`}>
          {viberMessage.directionIcon}
        </div>
        
        {/* Call Text */}
        <div className="flex-1 min-w-0">
          <span className={`text-sm font-medium ${viberMessage.textColor}`}>
            {viberMessage.text}
          </span>
          {viberMessage.duration && (
            <span className={`text-sm ${viberMessage.textColor} ml-1`}>
              {viberMessage.duration}
            </span>
          )}
        </div>
        
        {/* Call Type Icon */}
        <div className={`${viberMessage.textColor} flex-shrink-0`}>
          {viberMessage.callIcon}
        </div>
      </div>
    </div>
  )
}