import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AccessibilityProvider, useAccessibility } from '../AccessibilityProvider'

// Test component that uses the accessibility context
function TestComponent() {
  const { 
    announceToScreenReader, 
    highContrast, 
    largeText, 
    setHighContrast, 
    setLargeText 
  } = useAccessibility()
  
  return (
    <div>
      <div data-testid="high-contrast">{highContrast.toString()}</div>
      <div data-testid="large-text">{largeText.toString()}</div>
      <button 
        data-testid="toggle-contrast" 
        onClick={() => setHighContrast(!highContrast)}
      >
        Toggle Contrast
      </button>
      <button 
        data-testid="toggle-text" 
        onClick={() => setLargeText(!largeText)}
      >
        Toggle Text
      </button>
      <button 
        data-testid="announce" 
        onClick={() => announceToScreenReader('Test announcement')}
      >
        Announce
      </button>
    </div>
  )
}

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

describe('AccessibilityProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    localStorageMock.getItem.mockReturnValue(null)
  })

  it('provides default accessibility state', () => {
    render(
      <AccessibilityProvider>
        <TestComponent />
      </AccessibilityProvider>
    )

    expect(screen.getByTestId('high-contrast')).toHaveTextContent('false')
    expect(screen.getByTestId('large-text')).toHaveTextContent('false')
  })

  it('toggles high contrast mode', () => {
    render(
      <AccessibilityProvider>
        <TestComponent />
      </AccessibilityProvider>
    )

    const toggleButton = screen.getByTestId('toggle-contrast')
    fireEvent.click(toggleButton)

    expect(screen.getByTestId('high-contrast')).toHaveTextContent('true')
    expect(localStorageMock.setItem).toHaveBeenCalledWith('accessibility-high-contrast', 'true')
  })

  it('toggles large text mode', () => {
    render(
      <AccessibilityProvider>
        <TestComponent />
      </AccessibilityProvider>
    )

    const toggleButton = screen.getByTestId('toggle-text')
    fireEvent.click(toggleButton)

    expect(screen.getByTestId('large-text')).toHaveTextContent('true')
    expect(localStorageMock.setItem).toHaveBeenCalledWith('accessibility-large-text', 'true')
  })

  it('announces to screen reader', async () => {
    render(
      <AccessibilityProvider>
        <TestComponent />
      </AccessibilityProvider>
    )

    const announceButton = screen.getByTestId('announce')
    fireEvent.click(announceButton)

    // Check that announcement element was created
    await waitFor(() => {
      const announcement = document.querySelector('[aria-live="polite"]')
      expect(announcement).toBeInTheDocument()
    })
  })

  it('loads saved preferences from localStorage', () => {
    localStorageMock.getItem.mockImplementation((key) => {
      if (key === 'accessibility-high-contrast') return 'true'
      if (key === 'accessibility-large-text') return 'true'
      return null
    })

    render(
      <AccessibilityProvider>
        <TestComponent />
      </AccessibilityProvider>
    )

    expect(screen.getByTestId('high-contrast')).toHaveTextContent('true')
    expect(screen.getByTestId('large-text')).toHaveTextContent('true')
  })

  it('applies CSS classes when accessibility features are enabled', () => {
    localStorageMock.getItem.mockImplementation((key) => {
      if (key === 'accessibility-high-contrast') return 'true'
      if (key === 'accessibility-large-text') return 'true'
      return null
    })

    render(
      <AccessibilityProvider>
        <TestComponent />
      </AccessibilityProvider>
    )

    expect(document.documentElement).toHaveClass('high-contrast')
    expect(document.documentElement).toHaveClass('large-text')
  })
})
