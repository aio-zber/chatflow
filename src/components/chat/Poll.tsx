'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { BarChart3, Clock, Users, Eye, EyeOff, Share2, Copy, Check, Heart } from 'lucide-react'
import { isMobileDevice, isTouchDevice, triggerHapticFeedback, handleTouchFeedback } from '@/utils/mobile'

interface PollOption {
  id: string
  text: string
  order: number
  voteCount: number
  hasVoted: boolean
  voters?: Array<{
    id: string
    username: string
    name: string | null
    avatar: string | null
  }>
}

interface PollData {
  id: string
  question: string
  allowMultiple: boolean
  isAnonymous: boolean
  expiresAt: string | null
  createdAt: string
  createdBy: {
    id: string
    username: string
    name: string | null
    avatar: string | null
  }
  options: PollOption[]
  totalVotes: number
  messageId: string
}

interface PollProps {
  poll: PollData
  onVote: (pollId: string, optionIds: string[]) => void
  className?: string
  isOwnMessage?: boolean // Add prop to determine message ownership
}

export function Poll({ poll, onVote, className = '', isOwnMessage = false }: PollProps) {
  const { data: session } = useSession()
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set())
  const [isVoting, setIsVoting] = useState(false)
  const [timeLeft, setTimeLeft] = useState<string | null>(null)
  const [showShareMenu, setShowShareMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Detect mobile device on client side only
  useEffect(() => {
    setIsMobile(isMobileDevice())
  }, [])

  // Calculate time remaining
  useEffect(() => {
    if (!poll.expiresAt) return

    const interval = setInterval(() => {
      const now = new Date()
      const expires = new Date(poll.expiresAt!)
      const diff = expires.getTime() - now.getTime()

      if (diff <= 0) {
        setTimeLeft('Expired')
        clearInterval(interval)
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60))
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
        
        if (hours > 0) {
          setTimeLeft(`${hours}h ${minutes}m left`)
        } else {
          setTimeLeft(`${minutes}m left`)
        }
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [poll.expiresAt])

  const isExpired = poll.expiresAt && new Date() > new Date(poll.expiresAt)
  const hasVoted = poll.options.some(option => option.hasVoted)
  const canVote = !isExpired && !isVoting

  const handleOptionToggle = (optionId: string) => {
    if (!canVote) return

    // Haptic feedback on mobile
    if (isMobile) {
      triggerHapticFeedback('light')
    }

    setSelectedOptions(prev => {
      const newSelection = new Set(prev)
      
      if (newSelection.has(optionId)) {
        newSelection.delete(optionId)
      } else {
        if (!poll.allowMultiple) {
          newSelection.clear()
        }
        newSelection.add(optionId)
      }
      
      return newSelection
    })
  }

  const handleVote = async () => {
    if (selectedOptions.size === 0 || !canVote) return

    // Haptic feedback on mobile
    if (isMobile) {
      triggerHapticFeedback('medium')
    }

    setIsVoting(true)
    try {
      await onVote(poll.id, Array.from(selectedOptions))
      setSelectedOptions(new Set())
      
      // Success haptic feedback
      if (isMobile) {
        setTimeout(() => triggerHapticFeedback('light'), 100)
      }
    } catch (error) {
      console.error('Error voting:', error)
    } finally {
      setIsVoting(false)
    }
  }

  const getVotePercentage = (voteCount: number): number => {
    return poll.totalVotes > 0 ? (voteCount / poll.totalVotes) * 100 : 0
  }

  const handleShare = async () => {
    try {
      const response = await fetch(`/api/polls/${poll.id}/share`)
      if (response.ok) {
        const data = await response.json()
        const shareUrl = data.poll.shareUrl
        
        if (navigator.share && /mobile/i.test(navigator.userAgent)) {
          await navigator.share({
            title: poll.question,
            text: `Check out this poll: ${poll.question}`,
            url: shareUrl
          })
        } else {
          await navigator.clipboard.writeText(shareUrl)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }
      }
    } catch (error) {
      console.error('Error sharing poll:', error)
    }
    setShowShareMenu(false)
  }

  const copyPollText = async () => {
    try {
      const pollText = `📊 ${poll.question}\n\n${poll.options.map((option, index) => 
        `${index + 1}. ${option.text} (${option.voteCount} votes)`
      ).join('\n')}\n\nTotal votes: ${poll.totalVotes}`
      
      await navigator.clipboard.writeText(pollText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Error copying poll text:', error)
    }
    setShowShareMenu(false)
  }

  return (
    <div className={`w-full ${className}`}>
      {/* Simple poll layout - directly integrated into message container */}
      <div className="w-full">
        {/* Poll Question with underline - matches Viber design */}
        <div className="mb-3">
          <h3 className={`text-[16px] font-medium mb-2 ${
            isOwnMessage 
              ? 'text-white' 
              : 'text-gray-900 dark:text-white'
          }`}>
            {poll.question}
          </h3>
          {/* Underline separator below question */}
          <div className={`h-px ${
            isOwnMessage 
              ? 'bg-white/20' 
              : 'bg-gray-200 dark:bg-gray-700'
          }`} />
        </div>

        {/* Poll Options - Simple list layout */}
        <div className="space-y-2 mb-3">
          {poll.options.map((option) => {
            const percentage = getVotePercentage(option.voteCount)
            const isSelected = selectedOptions.has(option.id)
            const isVoted = hasVoted && option.hasVoted
            
            return (
              <div key={option.id} className="relative">
                <button
                  onClick={() => handleOptionToggle(option.id)}
                  disabled={!canVote}
                  className={`w-full text-left transition-all duration-200 ${
                    !canVote 
                      ? 'cursor-not-allowed' 
                      : 'cursor-pointer hover:opacity-90'
                  }`}
                >
                  {/* Viber-style option layout with proper progress bar structure */}
                  <div className="space-y-1">
                    {/* Option text at top */}
                    <div className="flex items-center justify-between">
                      <span className={`text-[15px] font-normal ${
                        isOwnMessage 
                          ? 'text-white' 
                          : 'text-gray-900 dark:text-white'
                      }`}>
                        {option.text}
                      </span>
                      
                      {/* Heart icon - purple when voted, gray when not */}
                      <Heart 
                        className={`w-4 h-4 transition-all duration-200 ${
                          isVoted || isSelected
                            ? 'text-[#7360F2] fill-[#7360F2]' 
                            : isOwnMessage
                              ? 'text-white/40'
                              : 'text-gray-400 dark:text-gray-500'
                        }`}
                      />
                    </div>
                    
                    {/* Progress bar - always visible when voted, thicker design */}
                    {hasVoted && (
                      <div className="relative">
                        {/* Progress bar background - always visible */}
                        <div className={`h-1.5 rounded-full ${
                          isOwnMessage 
                            ? 'bg-white/20' 
                            : 'bg-gray-200 dark:bg-gray-700'
                        }`}>
                          {/* Progress bar fill */}
                          <div 
                            className="h-1.5 bg-[#7360F2] rounded-full transition-all duration-500 ease-out"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    )}
                    
                    {/* Percentage below progress bar */}
                    {hasVoted && (
                      <div className="text-left">
                        <span className={`text-[13px] font-normal ${
                          isOwnMessage 
                            ? 'text-white/70' 
                            : 'text-gray-600 dark:text-gray-400'
                        }`}>
                          {Math.round(percentage)}%
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              </div>
            )
          })}
        </div>

        {/* Vote Button - Show when can vote and has selections */}
        {canVote && selectedOptions.size > 0 && (
          <button
            onClick={handleVote}
            disabled={isVoting}
            className="w-full bg-[#7360F2] text-white py-2.5 px-4 rounded-lg font-medium hover:bg-[#6350E9] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 text-[14px] mb-3 shadow-sm"
          >
            {isVoting ? 'Voting...' : `Vote${poll.allowMultiple && selectedOptions.size > 1 ? ` (${selectedOptions.size})` : ''}`}
          </button>
        )}

        {/* Poll Status - Simple format matching poll4.png */}
        <div className="text-center">
          <div className={`text-[13px] mb-1 ${
            isExpired 
              ? 'text-red-500 font-medium' 
              : isOwnMessage 
                ? 'text-white/60' 
                : 'text-gray-500 dark:text-gray-400'
          }`}>
            {isExpired ? 'Expired' : timeLeft || ''} {poll.totalVotes} vote{poll.totalVotes !== 1 ? 's' : ''}
          </div>
          <div className={`text-[12px] ${
            isOwnMessage 
              ? 'text-white/50' 
              : 'text-gray-400 dark:text-gray-500'
          }`}>
            {new Date(poll.createdAt).toLocaleDateString('en-US', {
              weekday: 'short',
              hour: '2-digit',
              minute: '2-digit'
            }).replace(',', '')}
          </div>
        </div>
      </div>
    </div>
  )
}