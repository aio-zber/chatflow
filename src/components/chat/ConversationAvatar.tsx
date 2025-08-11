import { Users } from 'lucide-react'
import { useSocketContext } from '@/context/SocketContext'

interface ConversationAvatarProps {
  conversation: {
    isGroup: boolean
    otherParticipants: {
      user?: {
        id?: string
        avatar?: string | null
        name?: string | null
        username?: string
        isOnline?: boolean
      }
    }[]
  }
}

export function ConversationAvatar({ conversation }: ConversationAvatarProps) {
  const { userStatuses } = useSocketContext()
  if (conversation.isGroup) {
    return (
      <div className="relative">
        <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
          <Users className="w-5 h-5 text-white" />
        </div>
      </div>
    )
  } else {
    const otherParticipant = conversation.otherParticipants[0]
    const avatar = otherParticipant?.user?.avatar
    const name = otherParticipant?.user?.name || otherParticipant?.user?.username || 'U'
    const userId = otherParticipant?.user?.id
    const liveStatus = userId ? userStatuses[userId] : undefined
    const isOnline = liveStatus?.isOnline ?? otherParticipant?.user?.isOnline
    
    return (
      <div className="relative">
        {avatar ? (
          <img
            src={avatar}
            alt={name}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 bg-gray-500 rounded-full flex items-center justify-center">
            <span className="text-white text-sm font-medium">
              {name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        {isOnline && (
          <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
        )}
      </div>
    )
  }
}