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
}

export function Poll({ poll, onVote, className = '' }: PollProps) {
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
    <div className={`bg-blue-50 dark:bg-blue-950/30 rounded-2xl border border-blue-100 dark:border-blue-800/30 ${isMobile ? 'p-4' : 'p-5'} max-w-sm ${className} ${isMobile ? 'poll-container' : ''} shadow-sm`}>

      {/* Poll Question */}
      <h3 className="font-medium text-gray-900 dark:text-white mb-3 text-base leading-relaxed">
        {poll.question}
      </h3>
      
      {/* Gray separator line */}
      <div className="w-full h-px bg-gray-300 dark:bg-gray-600 mb-4"></div>

      {/* Poll Options */}
      <div className="space-y-3 mb-5">
        {poll.options.map((option) => {
          const percentage = getVotePercentage(option.voteCount)
          const isSelected = selectedOptions.has(option.id)
          const isVoted = hasVoted && option.hasVoted
          
          return (
            <div key={option.id} className="relative">
              <button
                onClick={() => handleOptionToggle(option.id)}
                disabled={!canVote}
                className={`w-full text-left p-3 bg-white dark:bg-gray-800 rounded-lg transition-all duration-200 ${
                  !canVote 
                    ? 'cursor-not-allowed opacity-75' 
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer'
                } ${
                  isSelected 
                    ? 'ring-2 ring-[#7360F2] bg-purple-50 dark:bg-purple-900/30' 
                    : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  {/* Option text */}
                  <span className="text-gray-900 dark:text-white font-normal text-sm flex-1">
                    {option.text}
                  </span>
                  
                  {/* Heart icon and percentage */}
                  <div className="flex items-center space-x-2 ml-3">
                    {hasVoted && (
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                        {Math.round(percentage)}%
                      </span>
                    )}
                    
                    {/* Heart icon */}
                    <Heart 
                      className={`w-5 h-5 transition-colors ${
                        isVoted || isSelected
                          ? 'text-[#7360F2] fill-[#7360F2]' 
                          : 'text-gray-400 dark:text-gray-500'
                      }`}
                    />
                  </div>
                </div>
                
                {/* Progress bar under text */}
                {hasVoted && percentage > 0 && (
                  <div className="mt-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1">
                    <div 
                      className="h-1 bg-[#7360F2] rounded-full transition-all duration-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* Vote Button */}
      {!hasVoted && canVote && selectedOptions.size > 0 && (
        <button
          onClick={handleVote}
          disabled={isVoting}
          className="w-full bg-[#7360F2] text-white py-3 px-4 rounded-lg font-medium hover:bg-[#6350E9] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 text-sm"
        >
          {isVoting ? 'Voting...' : `Vote${poll.allowMultiple && selectedOptions.size > 1 ? ` (${selectedOptions.size})` : ''}`}
        </button>
      )}

      {/* Poll Stats */}
      <div className="mt-4 pt-3">
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center space-x-2">
            {timeLeft && (
              <div className="flex items-center space-x-1">
                <Clock className="w-3 h-3" />
                <span className={isExpired ? 'text-red-500' : 'text-gray-500'}>{timeLeft}</span>
              </div>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <span className="font-medium">{poll.totalVotes} vote{poll.totalVotes !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>
    </div>
  )
}