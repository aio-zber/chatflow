'use client'

import { useState, useEffect } from 'react'
import { Phone, Video, PhoneOff, X } from 'lucide-react'

interface IncomingCallModalProps {
  isOpen: boolean
  onAccept: () => void
  onDecline: () => void
  callType: 'voice' | 'video'
  callerName: string
  callerAvatar?: string | null
  conversationName?: string | null
  isGroupCall?: boolean
  participantCount?: number
}

export function IncomingCallModal({
  isOpen,
  onAccept,
  onDecline,
  callType,
  callerName,
  callerAvatar,
  conversationName,
  isGroupCall = false,
  participantCount = 0,
}: IncomingCallModalProps) {
  const [isRinging, setIsRinging] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setIsRinging(true)
      const interval = setInterval(() => {
        setIsRinging(prev => !prev)
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div className="fixed inset-0 transition-opacity bg-black bg-opacity-75" />

        {/* Modal */}
        <div className="inline-block w-full max-w-md p-6 my-8 overflow-hidden text-center align-middle transition-all transform bg-white dark:bg-gray-800 shadow-xl rounded-2xl">
          {/* Caller Avatar */}
          <div className={`mx-auto mb-4 ${isRinging ? 'animate-pulse' : ''}`}>
            {callerAvatar ? (
              <img
                src={callerAvatar}
                alt={callerName}
                className="w-24 h-24 rounded-full object-cover mx-auto"
              />
            ) : (
              <div className="w-24 h-24 bg-blue-600 rounded-full flex items-center justify-center mx-auto">
                <span className="text-white text-2xl font-medium">
                  {callerName.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>

          {/* Call Info */}
          <div className="mb-6">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              {isGroupCall ? `Incoming ${callType} call` : `${callerName} is calling`}
            </h3>
            
            {isGroupCall ? (
              <div className="space-y-1">
                <p className="text-gray-600 dark:text-gray-400">
                  {conversationName || 'Group Chat'}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-500">
                  Started by {callerName}
                  {participantCount > 0 && ` • ${participantCount} participant${participantCount > 1 ? 's' : ''}`}
                </p>
              </div>
            ) : (
              <p className="text-gray-600 dark:text-gray-400">
                {callType === 'video' ? 'Video call' : 'Voice call'}
              </p>
            )}
          </div>

          {/* Call Type Indicator */}
          <div className="flex justify-center mb-6">
            <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-full">
              {callType === 'video' ? (
                <Video className="w-6 h-6 text-gray-600 dark:text-gray-400" />
              ) : (
                <Phone className="w-6 h-6 text-gray-600 dark:text-gray-400" />
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-center space-x-8">
            {/* Decline Button */}
            <button
              onClick={onDecline}
              className="w-16 h-16 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center text-white focus:outline-none focus:ring-4 focus:ring-red-300 transition-all duration-200 transform hover:scale-105"
            >
              <PhoneOff className="w-6 h-6" />
            </button>

            {/* Accept Button */}
            <button
              onClick={onAccept}
              className="w-16 h-16 bg-green-600 hover:bg-green-700 rounded-full flex items-center justify-center text-white focus:outline-none focus:ring-4 focus:ring-green-300 transition-all duration-200 transform hover:scale-105"
            >
              <Phone className="w-6 h-6" />
            </button>
          </div>

          {/* Hint text */}
          <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            Tap to answer or decline
          </p>
        </div>
      </div>
    </div>
  )
}