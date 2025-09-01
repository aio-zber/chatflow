'use client'

import { useSession } from 'next-auth/react'
import { useNotifications } from '@/context/NotificationContext'
import { Volume2, VolumeX } from 'lucide-react'

export function NotificationBadge() {
  const { data: session } = useSession()
  const {
    soundEnabled,
    setSoundEnabled,
  } = useNotifications()


  // Note: Socket notification handling is done globally by GlobalNotificationListener
  // This component only provides the notification toggle UI

  if (!session?.user?.id) return null

  return (
    <div className="relative">
      {/* Sound Control Button - Only show sound toggle, no notification badge or history */}
      <button
        onClick={() => setSoundEnabled(!soundEnabled)}
        className="p-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
        title={soundEnabled ? 'Disable notification sounds' : 'Enable notification sounds'}
        aria-label={soundEnabled ? 'Disable notification sounds' : 'Enable notification sounds'}
      >
        {soundEnabled ? (
          <Volume2 className="w-6 h-6" />
        ) : (
          <VolumeX className="w-6 h-6" />
        )}
      </button>
    </div>
  )
}