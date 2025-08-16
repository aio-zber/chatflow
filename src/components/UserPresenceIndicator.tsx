'use client'

import { useSocketContext } from '@/context/SocketContext'
import { formatDistanceToNow } from 'date-fns'

interface UserPresenceIndicatorProps {
  userId: string
  userIsOnline?: boolean
  userLastSeen?: Date | string
  showText?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function UserPresenceIndicator({ 
  userId, 
  userIsOnline, 
  userLastSeen, 
  showText = false,
  size = 'md',
  className = '' 
}: UserPresenceIndicatorProps) {
  const { userStatuses } = useSocketContext()
  
  // Get live status from socket context, fallback to props
  const liveStatus = userStatuses[userId]
  const isOnline = liveStatus?.isOnline ?? userIsOnline ?? false
  const lastSeen = liveStatus?.lastSeen ?? (userLastSeen ? new Date(userLastSeen) : null)
  
  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4'
  }
  
  const dotSize = sizeClasses[size]
  
  if (showText) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <div className={`${dotSize} rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
        <span className={`text-sm ${isOnline ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
          {isOnline ? 'Online' : lastSeen ? `Last seen ${formatDistanceToNow(lastSeen, { addSuffix: true })}` : 'Offline'}
        </span>
      </div>
    )
  }
  
  if (!isOnline) {
    return null // Don't show indicator when offline unless showText is true
  }
  
  return (
    <div className={`${dotSize} rounded-full bg-green-500 border-2 border-white dark:border-gray-800 ${className}`} />
  )
}