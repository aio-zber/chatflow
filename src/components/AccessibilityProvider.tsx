'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface AccessibilityContextType {
  announceToScreenReader: (message: string, priority?: 'polite' | 'assertive') => void
  reducedMotion: boolean
  highContrast: boolean
  largeText: boolean
  setHighContrast: (enabled: boolean) => void
  setLargeText: (enabled: boolean) => void
}

const AccessibilityContext = createContext<AccessibilityContextType | null>(null)

interface AccessibilityProviderProps {
  children: ReactNode
}

export function AccessibilityProvider({ children }: AccessibilityProviderProps) {
  const [reducedMotion, setReducedMotion] = useState(false)
  const [highContrast, setHighContrast] = useState(false)
  const [largeText, setLargeText] = useState(false)

  useEffect(() => {
    // Check for reduced motion preference
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(motionQuery.matches)
    
    const handleMotionChange = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches)
    }
    
    motionQuery.addEventListener('change', handleMotionChange)

    // Load accessibility preferences from localStorage
    const savedHighContrast = localStorage.getItem('accessibility-high-contrast') === 'true'
    const savedLargeText = localStorage.getItem('accessibility-large-text') === 'true'
    
    setHighContrast(savedHighContrast)
    setLargeText(savedLargeText)

    // Apply accessibility classes to document
    if (savedHighContrast) {
      document.documentElement.classList.add('high-contrast')
    }
    if (savedLargeText) {
      document.documentElement.classList.add('large-text')
    }

    return () => {
      motionQuery.removeEventListener('change', handleMotionChange)
    }
  }, [])

  const announceToScreenReader = (message: string, priority: 'polite' | 'assertive' = 'polite') => {
    const announcement = document.createElement('div')
    announcement.setAttribute('aria-live', priority)
    announcement.setAttribute('aria-atomic', 'true')
    announcement.className = 'sr-only'
    announcement.textContent = message
    
    document.body.appendChild(announcement)
    
    // Remove after announcement
    setTimeout(() => {
      document.body.removeChild(announcement)
    }, 1000)
  }

  const handleSetHighContrast = (enabled: boolean) => {
    setHighContrast(enabled)
    localStorage.setItem('accessibility-high-contrast', enabled.toString())
    
    if (enabled) {
      document.documentElement.classList.add('high-contrast')
    } else {
      document.documentElement.classList.remove('high-contrast')
    }
  }

  const handleSetLargeText = (enabled: boolean) => {
    setLargeText(enabled)
    localStorage.setItem('accessibility-large-text', enabled.toString())
    
    if (enabled) {
      document.documentElement.classList.add('large-text')
    } else {
      document.documentElement.classList.remove('large-text')
    }
  }

  const value: AccessibilityContextType = {
    announceToScreenReader,
    reducedMotion,
    highContrast,
    largeText,
    setHighContrast: handleSetHighContrast,
    setLargeText: handleSetLargeText,
  }

  return (
    <AccessibilityContext.Provider value={value}>
      {children}
      {/* Screen reader only status region */}
      <div 
        aria-live="polite" 
        aria-atomic="true" 
        className="sr-only"
        id="screen-reader-status"
      />
    </AccessibilityContext.Provider>
  )
}

export function useAccessibility() {
  const context = useContext(AccessibilityContext)
  if (!context) {
    throw new Error('useAccessibility must be used within an AccessibilityProvider')
  }
  return context
}
