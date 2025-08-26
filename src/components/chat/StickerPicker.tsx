'use client'

import { useState } from 'react'
import { X, Smile } from 'lucide-react'

interface StickerPickerProps {
  isOpen: boolean
  onClose: () => void
  onStickerSelect: (sticker: string) => void
}

// Proper sticker library with sticker data
const stickerCategories = {
  reactions: {
    name: 'Reactions',
    stickers: [
      { id: 'thumbs_up', text: '👍 Thumbs Up!', emoji: '👍' },
      { id: 'clap', text: '👏 Great Job!', emoji: '👏' },
      { id: 'heart', text: '❤️ Love it!', emoji: '❤️' },
      { id: 'laugh', text: '😂 LMAO!', emoji: '😂' },
      { id: 'wow', text: '😮 Wow!', emoji: '😮' },
      { id: 'sad', text: '😢 So sad...', emoji: '😢' },
      { id: 'party', text: '🎉 Party time!', emoji: '🎉' },
      { id: 'fire', text: '🔥 On fire!', emoji: '🔥' },
      { id: 'hundred', text: '💯 Perfect!', emoji: '💯' },
      { id: 'mind_blown', text: '🤯 Mind blown!', emoji: '🤯' },
      { id: 'cool', text: '😎 So cool!', emoji: '😎' },
      { id: 'thinking', text: '🤔 Hmm...', emoji: '🤔' }
    ]
  },
  greetings: {
    name: 'Greetings',
    stickers: [
      { id: 'hello', text: '👋 Hello there!', emoji: '👋' },
      { id: 'good_morning', text: '🌅 Good morning!', emoji: '🌅' },
      { id: 'good_night', text: '🌙 Good night!', emoji: '🌙' },
      { id: 'welcome', text: '🤗 Welcome!', emoji: '🤗' },
      { id: 'bye', text: '👋 Goodbye!', emoji: '👋' },
      { id: 'see_you', text: '👀 See you later!', emoji: '👀' },
      { id: 'miss_you', text: '😘 Miss you!', emoji: '😘' },
      { id: 'hugs', text: '🤗 Sending hugs!', emoji: '🤗' }
    ]
  },
  celebrations: {
    name: 'Celebrations',
    stickers: [
      { id: 'birthday', text: '🎂 Happy Birthday!', emoji: '🎂' },
      { id: 'congrats', text: '🎊 Congratulations!', emoji: '🎊' },
      { id: 'cheers', text: '🥂 Cheers!', emoji: '🥂' },
      { id: 'winner', text: '🏆 You won!', emoji: '🏆' },
      { id: 'success', text: '✨ Success!', emoji: '✨' },
      { id: 'achievement', text: '🎯 Achievement unlocked!', emoji: '🎯' },
      { id: 'celebration', text: '🎈 Let\'s celebrate!', emoji: '🎈' },
      { id: 'gift', text: '🎁 Gift for you!', emoji: '🎁' }
    ]
  },
  support: {
    name: 'Support',
    stickers: [
      { id: 'sorry', text: '😔 Sorry about that...', emoji: '😔' },
      { id: 'support', text: '🤝 I\'m here for you', emoji: '🤝' },
      { id: 'get_well', text: '🌟 Get well soon!', emoji: '🌟' },
      { id: 'strength', text: '💪 Stay strong!', emoji: '💪' },
      { id: 'peace', text: '☮️ Peace and love', emoji: '☮️' },
      { id: 'prayer', text: '🙏 Thoughts and prayers', emoji: '🙏' },
      { id: 'hope', text: '🌈 Hope things get better', emoji: '🌈' },
      { id: 'care', text: '💝 Take care!', emoji: '💝' }
    ]
  },
  fun: {
    name: 'Fun & Games',
    stickers: [
      { id: 'gaming', text: '🎮 Game time!', emoji: '🎮' },
      { id: 'music', text: '🎵 Good vibes!', emoji: '🎵' },
      { id: 'dance', text: '💃 Let\'s dance!', emoji: '💃' },
      { id: 'coffee', text: '☕ Coffee break!', emoji: '☕' },
      { id: 'pizza', text: '🍕 Pizza party!', emoji: '🍕' },
      { id: 'vacation', text: '🏖️ Vacation mode!', emoji: '🏖️' },
      { id: 'weekend', text: '🛋️ Weekend vibes!', emoji: '🛋️' },
      { id: 'movie', text: '🎬 Movie night!', emoji: '🎬' }
    ]
  }
}

export function StickerPicker({ isOpen, onClose, onStickerSelect }: StickerPickerProps) {
  const [activeCategory, setActiveCategory] = useState<keyof typeof stickerCategories>('reactions')

  if (!isOpen) return null

  const handleStickerClick = (stickerText: string) => {
    onStickerSelect(stickerText)
    onClose()
  }

  return (
    <div className="absolute bottom-full left-0 mb-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">
          Choose a sticker
        </h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Category Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {Object.entries(stickerCategories).map(([key, category]) => (
          <button
            key={key}
            onClick={() => setActiveCategory(key as keyof typeof stickerCategories)}
            className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 focus:outline-none ${
              activeCategory === key
                ? 'text-blue-600 border-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'text-gray-500 border-transparent hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            {category.name}
          </button>
        ))}
      </div>

      {/* Stickers Grid */}
      <div className="p-3 h-64 overflow-y-auto">
        <div className="grid grid-cols-2 gap-2">
          {stickerCategories[activeCategory].stickers.map((sticker, index) => (
            <button
              key={sticker.id}
              onClick={() => handleStickerClick(sticker.text)}
              className="p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors text-left"
              title={`Send "${sticker.text}" sticker`}
            >
              <div className="flex items-center space-x-2">
                <span className="text-2xl">{sticker.emoji}</span>
                <span className="text-sm text-gray-700 dark:text-gray-300 font-medium truncate">
                  {sticker.text.split(' ').slice(1).join(' ')}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}