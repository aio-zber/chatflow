// Mobile utility functions for React Native considerations

export const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false
  
  // Use a more reliable method that doesn't cause hydration issues
  const hasTouchPoints = navigator.maxTouchPoints > 0
  const hasUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  const hasSmallScreen = window.innerWidth <= 768
  
  return hasTouchPoints || hasUserAgent || hasSmallScreen
}

export const isTouchDevice = (): boolean => {
  if (typeof window === 'undefined') return false
  
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

export const getViewportHeight = (): number => {
  if (typeof window === 'undefined') return 0
  
  // Use visualViewport if available (better for mobile keyboards)
  if (window.visualViewport) {
    return window.visualViewport.height
  }
  
  return window.innerHeight
}

export const adjustForKeyboard = (callback: (height: number) => void): (() => void) => {
  if (typeof window === 'undefined') return () => {}
  
  const handleResize = () => {
    const height = getViewportHeight()
    callback(height)
  }
  
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleResize)
    return () => window.visualViewport?.removeEventListener('resize', handleResize)
  } else {
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }
}

// Mobile-specific touch event helpers - use in useEffect only
export const handleTouchFeedback = (element: HTMLElement | null) => {
  if (!element || typeof window === 'undefined' || !isTouchDevice()) return
  
  element.style.webkitTapHighlightColor = 'rgba(116, 96, 242, 0.1)'
  element.style.userSelect = 'none'
  
  const addTouchActiveClass = () => {
    element.classList.add('touch-active')
  }
  
  const removeTouchActiveClass = () => {
    element.classList.remove('touch-active')
  }
  
  element.addEventListener('touchstart', addTouchActiveClass, { passive: true })
  element.addEventListener('touchend', removeTouchActiveClass, { passive: true })
  element.addEventListener('touchcancel', removeTouchActiveClass, { passive: true })
  
  return () => {
    element.removeEventListener('touchstart', addTouchActiveClass)
    element.removeEventListener('touchend', removeTouchActiveClass)
    element.removeEventListener('touchcancel', removeTouchActiveClass)
  }
}

// Haptic feedback for mobile devices
export const triggerHapticFeedback = (type: 'light' | 'medium' | 'heavy' = 'light') => {
  if (typeof window === 'undefined') return
  
  // Check if device supports haptic feedback
  if ('vibrate' in navigator) {
    switch (type) {
      case 'light':
        navigator.vibrate(10)
        break
      case 'medium':
        navigator.vibrate(25)
        break
      case 'heavy':
        navigator.vibrate(50)
        break
    }
  }
}

// Safe area insets for mobile devices
export const getSafeAreaInsets = () => {
  if (typeof window === 'undefined') {
    return { top: 0, right: 0, bottom: 0, left: 0 }
  }
  
  const style = getComputedStyle(document.documentElement)
  
  return {
    top: parseInt(style.getPropertyValue('--safe-area-inset-top') || '0'),
    right: parseInt(style.getPropertyValue('--safe-area-inset-right') || '0'), 
    bottom: parseInt(style.getPropertyValue('--safe-area-inset-bottom') || '0'),
    left: parseInt(style.getPropertyValue('--safe-area-inset-left') || '0')
  }
}

// Get mobile-specific CSS classes without side effects
export const getMobileClasses = () => ({
  pollContainer: 'mobile:margin-0 mobile:border-radius-0',
  touchActive: 'active:bg-violet-100 active:scale-98 transition-all duration-100',
  pollOption: 'mobile:min-h-11 mobile:text-base mobile:px-4 mobile:py-3',
  shareMenu: 'mobile:fixed mobile:bottom-0 mobile:left-0 mobile:right-0 mobile:rounded-t-2xl'
})