export function getConversationName(conversation: { 
  name?: string | null
  isGroup: boolean
  otherParticipants: { user?: { name?: string | null; username?: string } }[] 
}) {
  if (conversation.name) return conversation.name
  if (conversation.isGroup) return 'Group Chat'
  
  const otherParticipant = conversation.otherParticipants[0]
  return otherParticipant?.user?.name || otherParticipant?.user?.username || 'Unknown'
}

export function formatTime(date: Date | string) {
  const messageDate = new Date(date)
  const now = new Date()
  const diffInHours = Math.floor((now.getTime() - messageDate.getTime()) / (1000 * 60 * 60))
  
  if (diffInHours < 1) {
    const diffInMinutes = Math.floor((now.getTime() - messageDate.getTime()) / (1000 * 60))
    return diffInMinutes < 1 ? 'now' : `${diffInMinutes}m`
  } else if (diffInHours < 24) {
    return `${diffInHours}h`
  } else {
    const diffInDays = Math.floor(diffInHours / 24)
    return diffInDays === 1 ? '1d' : `${diffInDays}d`
  }
}

export function getLastMessagePreview(
  conversation: { 
    messages: { 
      senderId: string
      sender?: { name?: string | null; username?: string }
      content: string 
    }[]
    isGroup: boolean 
  }, 
  sessionUserId?: string
) {
  const lastMessage = conversation.messages[0]
  if (!lastMessage) return 'No messages yet'

  const isOwn = lastMessage.senderId === sessionUserId
  const senderName = isOwn ? 'You' : (lastMessage.sender?.name || lastMessage.sender?.username || 'Someone')
  
  if (conversation.isGroup && !isOwn) {
    return `${senderName}: ${lastMessage.content}`
  }
  
  return lastMessage.content
}