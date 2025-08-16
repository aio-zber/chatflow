'use client'

import { useState } from 'react'
import { X, Smile } from 'lucide-react'

interface StickerPickerProps {
  isOpen: boolean
  onClose: () => void
  onStickerSelect: (sticker: string) => void
}

// Predefined sticker sets
const stickerCategories = {
  emotions: {
    name: 'Emotions',
    stickers: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
      '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩',
      '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪',
      '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨',
      '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥',
      '😔', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩',
      '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯',
      '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓'
    ]
  },
  gestures: {
    name: 'Gestures',
    stickers: [
      '👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🤟',
      '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️',
      '👋', '🤚', '🖐️', '✋', '🖖', '👏', '🙌', '🤲',
      '🤝', '🙏', '✍️', '💪', '🦾', '🦿', '🦵', '🦶'
    ]
  },
  hearts: {
    name: 'Hearts & Love',
    stickers: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
      '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖',
      '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️',
      '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈'
    ]
  },
  animals: {
    name: 'Animals',
    stickers: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
      '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵',
      '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤',
      '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗'
    ]
  },
  food: {
    name: 'Food & Drink',
    stickers: [
      '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓',
      '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝',
      '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑',
      '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🥐'
    ]
  },
  nature: {
    name: 'Nature',
    stickers: [
      '🌱', '🌿', '🍀', '🍁', '🍂', '🍃', '🌾', '🌵',
      '🌲', '🌳', '🌴', '🌸', '🌺', '🌻', '🌹', '🥀',
      '🌷', '💐', '🌼', '🌙', '🌛', '🌜', '🌚', '🌕',
      '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔', '⭐'
    ]
  }
}

export function StickerPicker({ isOpen, onClose, onStickerSelect }: StickerPickerProps) {
  const [activeCategory, setActiveCategory] = useState<keyof typeof stickerCategories>('emotions')

  if (!isOpen) return null

  const handleStickerClick = (sticker: string) => {
    onStickerSelect(sticker)
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
        <div className="grid grid-cols-8 gap-2">
          {stickerCategories[activeCategory].stickers.map((sticker, index) => (
            <button
              key={index}
              onClick={() => handleStickerClick(sticker)}
              className="w-8 h-8 text-xl hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              title={`Send ${sticker} sticker`}
            >
              {sticker}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}