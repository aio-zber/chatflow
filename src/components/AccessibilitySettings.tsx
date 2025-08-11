'use client'

import { Settings, Eye, Type, Contrast, Volume2, VolumeX } from 'lucide-react'
import { useAccessibility } from './AccessibilityProvider'
import { useState } from 'react'

interface AccessibilitySettingsProps {
  onClose: () => void
}

export function AccessibilitySettings({ onClose }: AccessibilitySettingsProps) {
  const { 
    highContrast, 
    largeText, 
    setHighContrast, 
    setLargeText,
    announceToScreenReader 
  } = useAccessibility()
  
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('accessibility-sounds') !== 'false'
  })

  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled)
    localStorage.setItem('accessibility-sounds', enabled.toString())
    announceToScreenReader(`Sound notifications ${enabled ? 'enabled' : 'disabled'}`)
  }

  const handleHighContrastToggle = (enabled: boolean) => {
    setHighContrast(enabled)
    announceToScreenReader(`High contrast mode ${enabled ? 'enabled' : 'disabled'}`)
  }

  const handleLargeTextToggle = (enabled: boolean) => {
    setLargeText(enabled)
    announceToScreenReader(`Large text mode ${enabled ? 'enabled' : 'disabled'}`)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div 
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md max-w-[90vw] max-h-[calc(100vh-2rem)] overflow-auto"
        role="dialog"
        aria-labelledby="accessibility-settings-title"
        aria-describedby="accessibility-settings-description"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <Settings className="w-5 h-5 text-blue-600" aria-hidden="true" />
            <h2 
              id="accessibility-settings-title"
              className="text-lg font-semibold text-gray-900 dark:text-white"
            >
              Accessibility Settings
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-2 rounded-md focus-ring"
            aria-label="Close accessibility settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <p 
            id="accessibility-settings-description"
            className="text-sm text-gray-600 dark:text-gray-400 mb-6"
          >
            Customize the interface to meet your accessibility needs.
          </p>

          <div className="space-y-6">
            {/* High Contrast */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Contrast className="w-5 h-5 text-gray-500" aria-hidden="true" />
                <div>
                  <label 
                    htmlFor="high-contrast-toggle"
                    className="text-sm font-medium text-gray-900 dark:text-white"
                  >
                    High Contrast
                  </label>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Increase color contrast for better visibility
                  </p>
                </div>
              </div>
              <button
                id="high-contrast-toggle"
                role="switch"
                aria-checked={highContrast}
                onClick={() => handleHighContrastToggle(!highContrast)}
                className={`
                  relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-ring
                  ${highContrast ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}
                `}
              >
                <span className="sr-only">Toggle high contrast mode</span>
                <span
                  className={`
                    inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                    ${highContrast ? 'translate-x-6' : 'translate-x-1'}
                  `}
                />
              </button>
            </div>

            {/* Large Text */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Type className="w-5 h-5 text-gray-500" aria-hidden="true" />
                <div>
                  <label 
                    htmlFor="large-text-toggle"
                    className="text-sm font-medium text-gray-900 dark:text-white"
                  >
                    Large Text
                  </label>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Increase text size for better readability
                  </p>
                </div>
              </div>
              <button
                id="large-text-toggle"
                role="switch"
                aria-checked={largeText}
                onClick={() => handleLargeTextToggle(!largeText)}
                className={`
                  relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-ring
                  ${largeText ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}
                `}
              >
                <span className="sr-only">Toggle large text mode</span>
                <span
                  className={`
                    inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                    ${largeText ? 'translate-x-6' : 'translate-x-1'}
                  `}
                />
              </button>
            </div>

            {/* Sound Notifications */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                {soundEnabled ? (
                  <Volume2 className="w-5 h-5 text-gray-500" aria-hidden="true" />
                ) : (
                  <VolumeX className="w-5 h-5 text-gray-500" aria-hidden="true" />
                )}
                <div>
                  <label 
                    htmlFor="sound-toggle"
                    className="text-sm font-medium text-gray-900 dark:text-white"
                  >
                    Sound Notifications
                  </label>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Play sounds for notifications and alerts
                  </p>
                </div>
              </div>
              <button
                id="sound-toggle"
                role="switch"
                aria-checked={soundEnabled}
                onClick={() => handleSoundToggle(!soundEnabled)}
                className={`
                  relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-ring
                  ${soundEnabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}
                `}
              >
                <span className="sr-only">Toggle sound notifications</span>
                <span
                  className={`
                    inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                    ${soundEnabled ? 'translate-x-6' : 'translate-x-1'}
                  `}
                />
              </button>
            </div>
          </div>

          {/* Keyboard Shortcuts Info */}
          <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
              Keyboard Shortcuts
            </h3>
            <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
              <div className="flex justify-between">
                <span>Send message</span>
                <code className="px-2 py-1 bg-white dark:bg-gray-600 rounded">Enter</code>
              </div>
              <div className="flex justify-between">
                <span>New line</span>
                <code className="px-2 py-1 bg-white dark:bg-gray-600 rounded">Shift + Enter</code>
              </div>
              <div className="flex justify-between">
                <span>Open search</span>
                <code className="px-2 py-1 bg-white dark:bg-gray-600 rounded">Ctrl + K</code>
              </div>
              <div className="flex justify-between">
                <span>Toggle sidebar</span>
                <code className="px-2 py-1 bg-white dark:bg-gray-600 rounded">Ctrl + B</code>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750 rounded-b-lg">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            For additional accessibility support, contact our support team.
          </p>
        </div>
      </div>
    </div>
  )
}
