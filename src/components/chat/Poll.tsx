'use client'

import { useState, useEffect } from 'react'
import { Heart } from 'lucide-react'
import { isMobileDevice, triggerHapticFeedback } from '@/utils/mobile'
import { useTheme } from '@/context/ThemeContext'
import { getCompatibleFileUrl } from '@/utils/fileProxy'

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
  const [isMobile, setIsMobile] = useState(false)
  const [expandedVoters, setExpandedVoters] = useState<Set<string>>(new Set())

  // Detect mobile device on client side only
  useEffect(() => {
    setIsMobile(isMobileDevice())
  }, [])

  // ENHANCED: Initialize selected options based on current user votes
  useEffect(() => {
    const currentlyVotedOptions = poll.options
      .filter(option => option.hasVoted)
      .map(option => option.id)

    if (currentlyVotedOptions.length > 0) {
      setSelectedOptions(new Set(currentlyVotedOptions))
      console.log('[Poll] Initialized with existing votes:', currentlyVotedOptions)
    } else {
      setSelectedOptions(new Set()) // Clear if no votes
    }
  }, [poll.options, poll.id]) // Re-run when poll options or poll ID changes

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
    const votingOptions = Array.from(selectedOptions)

    try {
      await onVote(poll.id, votingOptions)

      // ENHANCED: Don't clear selection immediately - let the poll update handle it
      // The useEffect above will update selectedOptions when the poll data changes
      console.log('[Poll] Voted for options:', votingOptions)

      // Success haptic feedback
      if (isMobile) {
        setTimeout(() => triggerHapticFeedback('light'), 100)
      }
    } catch (error) {
      console.error('[Poll] Error voting:', error)
      // On error, revert to previous state if needed
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
                    
                    {/* Percentage, voters avatars, and vote count below progress bar */}
                    <div className="flex justify-between items-center">
                      {/* Left side: Percentage and voter avatars */}
                      <div className="flex items-center space-x-2">
                        <div className={`text-[13px] font-normal ${
                          actualTheme === 'dark'
                            ? 'text-gray-400' 
                            : 'text-gray-600'
                        }`}>
                          {percentage.toFixed(0)}%
                        </div>
                        
                        {/* Voter avatars */}
                        {option.voters && option.voters.length > 0 && (
                          <div className="flex -space-x-1">
                            {(() => {
                              const isExpanded = expandedVoters.has(option.id)
                              const maxVisible = isExpanded ? option.voters.length : 5
                              const visibleVoters = option.voters.slice(0, maxVisible)
                              const remainingCount = option.voters.length - 5
                              
                              return (
                                <>
                                  {visibleVoters.map((voter, index) => (
                                    <div
                                      key={voter.id}
                                      className="relative"
                                    >
                                      {voter.avatar ? (
                                        <img
                                          src={getCompatibleFileUrl(voter.avatar)}
                                          alt={voter.name || voter.username}
                                          className="w-4 h-4 rounded-full border border-white dark:border-gray-600 object-cover hover:scale-110 transition-transform cursor-help"
                                          style={{ zIndex: maxVisible - index }}
                                          onError={(e) => {
                                            // Fallback to initials if avatar fails to load
                                            const target = e.currentTarget as HTMLImageElement
                                            const parent = target.parentElement
                                            if (parent) {
                                              const fallback = document.createElement('div')
                                              fallback.className = 'w-4 h-4 rounded-full border border-white dark:border-gray-600 bg-gray-400 flex items-center justify-center text-[8px] text-white font-medium hover:scale-110 transition-transform cursor-help'
                                              fallback.style.zIndex = target.style.zIndex
                                              fallback.textContent = (voter.name || voter.username).charAt(0).toUpperCase()
                                              
                                              // Copy event handlers
                                              fallback.onmouseenter = target.onmouseenter
                                              fallback.onmouseleave = target.onmouseleave
                                              
                                              parent.replaceChild(fallback, target)
                                            }
                                          }}
                                          onMouseEnter={(e) => {
                                            // Create and show tooltip
                                            const tooltip = document.createElement('div')
                                            tooltip.className = 'fixed px-2 py-1 bg-black text-white text-xs rounded pointer-events-none whitespace-nowrap z-[9999]'
                                            tooltip.textContent = voter.name || voter.username
                                            
                                            // Position tooltip
                                            const rect = e.currentTarget.getBoundingClientRect()
                                            tooltip.style.left = `${rect.left + rect.width / 2}px`
                                            tooltip.style.top = `${rect.top - 30}px`
                                            tooltip.style.transform = 'translateX(-50%)'
                                            
                                            document.body.appendChild(tooltip)
                                            e.currentTarget.setAttribute('data-tooltip', 'true')
                                          }}
                                          onMouseLeave={(e) => {
                                            // Remove tooltip
                                            if (e.currentTarget.getAttribute('data-tooltip')) {
                                              const tooltips = document.querySelectorAll('div[class*="fixed"][class*="bg-black"]')
                                              tooltips.forEach(tooltip => {
                                                if (tooltip.textContent === (voter.name || voter.username)) {
                                                  tooltip.remove()
                                                }
                                              })
                                              e.currentTarget.removeAttribute('data-tooltip')
                                            }
                                          }}
                                        />
                                      ) : (
                                        <div 
                                          className="w-4 h-4 rounded-full border border-white dark:border-gray-600 bg-gray-400 flex items-center justify-center text-[8px] text-white font-medium hover:scale-110 transition-transform cursor-help"
                                          style={{ zIndex: maxVisible - index }}
                                          onMouseEnter={(e) => {
                                            // Create and show tooltip
                                            const tooltip = document.createElement('div')
                                            tooltip.className = 'fixed px-2 py-1 bg-black text-white text-xs rounded pointer-events-none whitespace-nowrap z-[9999]'
                                            tooltip.textContent = voter.name || voter.username
                                            
                                            // Position tooltip
                                            const rect = e.currentTarget.getBoundingClientRect()
                                            tooltip.style.left = `${rect.left + rect.width / 2}px`
                                            tooltip.style.top = `${rect.top - 30}px`
                                            tooltip.style.transform = 'translateX(-50%)'
                                            
                                            document.body.appendChild(tooltip)
                                            e.currentTarget.setAttribute('data-tooltip', 'true')
                                          }}
                                          onMouseLeave={(e) => {
                                            // Remove tooltip
                                            if (e.currentTarget.getAttribute('data-tooltip')) {
                                              const tooltips = document.querySelectorAll('div[class*="fixed"][class*="bg-black"]')
                                              tooltips.forEach(tooltip => {
                                                if (tooltip.textContent === (voter.name || voter.username)) {
                                                  tooltip.remove()
                                                }
                                              })
                                              e.currentTarget.removeAttribute('data-tooltip')
                                            }
                                          }}
                                        >
                                          {(voter.name || voter.username).charAt(0).toUpperCase()}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  
                                  {/* Show "..." indicator if there are more than 5 voters and not expanded */}
                                  {remainingCount > 0 && !isExpanded && (
                                    <div className="relative">
                                      <button
                                        onClick={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          setExpandedVoters(prev => new Set([...prev, option.id]))
                                        }}
                                        className="w-4 h-4 rounded-full border border-white dark:border-gray-600 bg-gray-500 hover:bg-gray-600 flex items-center justify-center text-[7px] text-white font-bold transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        style={{ zIndex: 0 }}
                                        title={`Show ${remainingCount} more voter${remainingCount !== 1 ? 's' : ''}`}
                                      >
                                        ...
                                      </button>
                                    </div>
                                  )}
                                  
                                  {/* Show collapse button if expanded and there were hidden voters */}
                                  {isExpanded && remainingCount > 0 && (
                                    <div className="relative">
                                      <button
                                        onClick={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          setExpandedVoters(prev => {
                                            const newSet = new Set(prev)
                                            newSet.delete(option.id)
                                            return newSet
                                          })
                                        }}
                                        className="w-4 h-4 rounded-full border border-white dark:border-gray-600 bg-gray-600 hover:bg-gray-700 flex items-center justify-center text-[7px] text-white font-bold transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        style={{ zIndex: 0 }}
                                        title="Show fewer voters"
                                      >
                                        ×
                                      </button>
                                    </div>
                                  )}
                                </>
                              )
                            })()}
                          </div>
                        )}
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
            {isVoting
              ? 'Voting...'
              : hasVoted
                ? `Update Vote${poll.allowMultiple && selectedOptions.size > 1 ? ` (${selectedOptions.size})` : ''}`
                : `Vote${poll.allowMultiple && selectedOptions.size > 1 ? ` (${selectedOptions.size})` : ''}`
            }
          </button>
        )}


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