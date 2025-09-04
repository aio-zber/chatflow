'use client'

import { useState } from 'react'
import { X, Plus, Trash2, BarChart3, Clock, Users } from 'lucide-react'

interface PollModalProps {
  isOpen: boolean
  onClose: () => void
  onCreatePoll: (pollData: {
    question: string
    options: string[]
    allowMultiple: boolean
    isAnonymous: boolean
    expiresInMinutes?: number
  }) => Promise<void>
  conversationId: string
}

export function PollModal({ isOpen, onClose, onCreatePoll, conversationId }: PollModalProps) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [allowMultiple, setAllowMultiple] = useState(false)
  const [hasExpiration, setHasExpiration] = useState(false)
  const [expirationHours, setExpirationHours] = useState(24)
  const [isCreating, setIsCreating] = useState(false)

  const handleAddOption = () => {
    if (options.length < 10) {
      setOptions([...options, ''])
    }
  }

  const handleRemoveOption = (index: number) => {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== index))
    }
  }

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...options]
    newOptions[index] = value
    setOptions(newOptions)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    const trimmedQuestion = question.trim()
    const trimmedOptions = options.map(opt => opt.trim()).filter(opt => opt.length > 0)
    
    if (!trimmedQuestion || trimmedOptions.length < 2) return

    setIsCreating(true)
    try {
      await onCreatePoll({
        question: trimmedQuestion,
        options: trimmedOptions,
        allowMultiple,
        isAnonymous: false,
        expiresInMinutes: hasExpiration ? expirationHours * 60 : undefined
      })
      
      // Reset form
      setQuestion('')
      setOptions(['', ''])
      setAllowMultiple(false)
      setHasExpiration(false)
      setExpirationHours(24)
      onClose()
    } catch (error) {
      console.error('Error creating poll:', error)
    } finally {
      setIsCreating(false)
    }
  }

  const isValid = question.trim().length > 0 && 
                  options.filter(opt => opt.trim().length > 0).length >= 2

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-2">
            <BarChart3 className="w-5 h-5 text-[#7360F2]" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Create Poll
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"
          >
            <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Question */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Poll Question *
            </label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What would you like to ask?"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7360F2] dark:bg-gray-700 dark:text-white resize-none"
              rows={2}
              maxLength={500}
              required
            />
            <div className="text-xs text-gray-500 mt-1">
              {question.length}/500 characters
            </div>
          </div>

          {/* Options */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Poll Options *
            </label>
            <div className="space-y-2">
              {options.map((option, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={option}
                      onChange={(e) => handleOptionChange(index, e.target.value)}
                      placeholder={`Option ${index + 1}`}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7360F2] dark:bg-gray-700 dark:text-white"
                      maxLength={200}
                    />
                  </div>
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveOption(index)}
                      className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            
            {options.length < 10 && (
              <button
                type="button"
                onClick={handleAddOption}
                className="mt-2 flex items-center space-x-2 px-3 py-2 text-[#7360F2] hover:bg-[#7360F2]/10 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Add Option</span>
              </button>
            )}
          </div>

          {/* Poll Settings */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Poll Settings
            </h3>
            
            {/* Multiple Choice */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Allow multiple choices
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowMultiple}
                  onChange={(e) => setAllowMultiple(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#7360F2]/20 dark:peer-focus:ring-[#7360F2]/20 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#7360F2]"></div>
              </label>
            </div>


            {/* Expiration */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Set expiration time
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasExpiration}
                    onChange={(e) => setHasExpiration(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#7360F2]/20 dark:peer-focus:ring-[#7360F2]/20 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#7360F2]"></div>
                </label>
              </div>
              
              {hasExpiration && (
                <div className="ml-6">
                  <select
                    value={expirationHours}
                    onChange={(e) => setExpirationHours(Number(e.target.value))}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7360F2] dark:bg-gray-700 dark:text-white text-sm"
                  >
                    <option value={1}>1 hour</option>
                    <option value={6}>6 hours</option>
                    <option value={12}>12 hours</option>
                    <option value={24}>1 day</option>
                    <option value={168}>1 week</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isValid || isCreating}
              className="flex-1 px-4 py-2 bg-[#7360F2] text-white rounded-lg hover:bg-[#6854E8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isCreating ? 'Creating...' : 'Create Poll'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}