'use client'

import { useState, useEffect } from 'react'
import { Heart } from 'lucide-react'
import { isMobileDevice, triggerHapticFeedback } from '@/utils/mobile'
import { useTheme } from '@/context/ThemeContext'

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
  const { actualTheme } = useTheme()
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set())
  const [isVoting, setIsVoting] = useState(false)
  const [timeLeft, setTimeLeft] = useState<string | null>(null)
  // OPTIMIZATION MARK START: On-demand poll details loading
  const [pollDetails, setPollDetails] = useState<PollData | null>(null)
  const [showingDetails, setShowingDetails] = useState(false)
  const [loadingDetails, setLoadingDetails] = useState(false)
  // OPTIMIZATION MARK END
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

  // OPTIMIZATION MARK START: Load detailed poll data on demand
  const loadPollDetails = async () => {
    if (loadingDetails || pollDetails) return
    
    setLoadingDetails(true)
    try {
      const response = await fetch(`/api/polls/details/${poll.id}`)
      if (response.ok) {
        const details = await response.json()
        setPollDetails(details)
        setShowingDetails(true)
      } else {
        console.error('Failed to load poll details')
      }
    } catch (error) {
      console.error('Error loading poll details:', error)
    } finally {
      setLoadingDetails(false)
    }
  }

  const togglePollDetails = () => {
    if (!showingDetails && !pollDetails) {
      loadPollDetails()
    } else {
      setShowingDetails(!showingDetails)
    }
  }
  // OPTIMIZATION MARK END

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


  return (
    <div className={`w-full ${className}`}>
      {/* Simple poll layout - directly integrated into message container */}
      <div className="w-full">
        {/* Poll Question with underline - matches Viber design */}
        <div className="mb-3">
          <h3 className={`text-[16px] font-medium mb-2 ${
            actualTheme === 'dark'
              ? 'text-white' 
              : 'text-gray-900'
          }`}>
            {poll.question}
          </h3>
          {/* Underline separator below question */}
          <div className={`h-px ${
            actualTheme === 'dark'
              ? 'bg-gray-900' 
              : 'bg-gray-200'
          }`} />
        </div>

        {/* Poll Options - Simple list layout with full width utilization */}
        <div className="space-y-2 mb-3 w-full">
          {poll.options.map((option) => {
            const percentage = getVotePercentage(option.voteCount)
            const isSelected = selectedOptions.has(option.id)
            const isVoted = hasVoted && option.hasVoted
            
            return (
              <div key={option.id} className="relative w-full">
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
                  <div className="space-y-1 w-full">
                    {/* Option text at top */}
                    <div className="flex items-center justify-between gap-3">
                      <span className={`text-[15px] font-normal flex-1 ${
                        actualTheme === 'dark'
                          ? 'text-white' 
                          : 'text-gray-900'
                      }`}>
                        {option.text}
                      </span>
                      
                      {/* Heart icon - purple when voted, gray when not, larger size */}
                      <Heart 
                        className={`w-5 h-5 transition-all duration-200 flex-shrink-0 ${
                          isVoted || isSelected
                            ? 'text-[#7360F2] fill-[#7360F2]' 
                            : actualTheme === 'dark'
                              ? 'text-gray-400'
                              : 'text-gray-400'
                        }`}
                      />
                    </div>
                    
                    {/* Progress bar - always visible, thicker design, full width container */}
                    <div className="relative w-full">
                      {/* Progress bar background - always visible, ensure full width */}
                      <div className={`h-1.5 w-full rounded-full ${
                        actualTheme === 'dark'
                          ? 'bg-[#000000]' 
                          : 'bg-gray-200'
                      }`}>
                        {/* Progress bar fill */}
                        <div 
                          className="h-1.5 bg-[#7360F2] rounded-full transition-all duration-500 ease-out"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                    
                    {/* Percentage and vote count below progress bar - horizontal layout */}
                    <div className="flex justify-between items-center">
                      {/* Percentage display - left aligned */}
                      <div className={`text-[13px] font-normal ${
                        actualTheme === 'dark'
                          ? 'text-gray-400' 
                          : 'text-gray-600'
                      }`}>
                        {percentage.toFixed(0)}%
                      </div>
                      {/* Vote count - right aligned */}
                      <div className={`text-[13px] font-normal ${
                        actualTheme === 'dark'
                          ? 'text-gray-400' 
                          : 'text-gray-600'
                      }`}>
                        {option.voteCount} {option.voteCount !== 1 ? '' : ''}
                      </div>
                    </div>
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

        {/* OPTIMIZATION MARK START: Poll details toggle */}
        {!poll.isAnonymous && poll.totalVotes > 0 && (
          <div className="pt-2 pb-2 text-center">
            <button
              onClick={togglePollDetails}
              disabled={loadingDetails}
              className={`text-sm px-3 py-1 rounded-full transition-all duration-200 ${
                actualTheme === 'dark'
                  ? 'text-blue-400 hover:bg-gray-800 disabled:text-gray-500'
                  : 'text-blue-600 hover:bg-gray-100 disabled:text-gray-400'
              } ${loadingDetails ? 'opacity-50' : 'hover:opacity-80'}`}
            >
              {loadingDetails ? 'Loading...' : (showingDetails ? 'Hide Details' : 'Show Voters')}
            </button>
          </div>
        )}
        
        {/* Show detailed poll information when requested */}
        {showingDetails && pollDetails && (
          <div className={`mt-2 p-3 rounded-lg border ${
            actualTheme === 'dark'
              ? 'bg-gray-900 border-gray-800'
              : 'bg-gray-50 border-gray-200'
          }`}>
            {pollDetails.options.map((option) => (
              <div key={option.id} className="mb-3 last:mb-0">
                <div className={`text-sm font-medium mb-1 ${
                  actualTheme === 'dark' ? 'text-white' : 'text-gray-900'
                }`}>
                  {option.text} ({option.voteCount} vote{option.voteCount !== 1 ? 's' : ''})
                </div>
                {option.voters && option.voters.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {option.voters.map((voter) => (
                      <span
                        key={voter.id}
                        className={`text-xs px-2 py-1 rounded-full ${
                          actualTheme === 'dark'
                            ? 'bg-gray-800 text-gray-300'
                            : 'bg-white text-gray-600'
                        }`}
                      >
                        {voter.name || voter.username}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {/* OPTIMIZATION MARK END */}

        {/* Poll Status - Simple format matching poll4.png */}
        <div className="flex text-center justify-end">
          <div className={`text-[13px] mb-1 ${
            isExpired 
              ? 'text-red-500 font-medium' 
              : actualTheme === 'dark'
                ? 'text-gray-400' 
                : 'text-gray-500'
          }`}>
            {isExpired ? 'Expired' : timeLeft || ''} {poll.totalVotes} vote{poll.totalVotes !== 1 ? 's' : ''}
          </div>
        
        </div>
      </div>
    </div>
  )
}