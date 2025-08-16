import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSession } from 'next-auth/react'
import { MessageBubble } from '../chat/MessageBubble'

// Mock next-auth
jest.mock('next-auth/react', () => ({
  useSession: jest.fn()
}))

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>

const mockMessage = {
  id: 'test-message-1',
  content: 'Hello, world!',
  senderId: 'test-user-1',
  senderName: 'Test User',
  senderImage: 'https://example.com/avatar.jpg',
  timestamp: new Date(),
  status: 'sent' as const,
  reactions: [],
  attachments: [],
}

const mockProps = {
  message: mockMessage,
  onReply: jest.fn(),
  onReact: jest.fn(),
}

describe('MessageBubble', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseSession.mockReturnValue({
      data: {
        user: { id: 'test-user-id', name: 'Current User', email: 'current@example.com' }
      },
      status: 'authenticated'
    })
  })

  it('renders message content correctly', () => {
    render(<MessageBubble {...mockProps} />)
    expect(screen.getByText('Hello, world!')).toBeInTheDocument()
  })

  it('displays sender name and timestamp', () => {
    render(<MessageBubble {...mockProps} />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(screen.getByText(/\d+:\d+/)).toBeInTheDocument() // timestamp format
  })

  it('shows actions on hover', async () => {
    const user = userEvent.setup()
    render(<MessageBubble {...mockProps} />)
    
    const messageContainer = screen.getByRole('article')
    const messageContent = messageContainer.querySelector('.message-content')
    if (messageContent) {
      await user.hover(messageContent)
      // Wait a bit for the hover state to be processed
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    // Actions should be visible after hover
    expect(screen.queryByLabelText('Add reaction')).toBeInTheDocument()
    expect(screen.queryByLabelText('Reply to message')).toBeInTheDocument()
  })

  it('calls onReply when reply button is clicked', async () => {
    const user = userEvent.setup()
    render(<MessageBubble {...mockProps} />)
    
    const messageContainer = screen.getByRole('article')
    const messageContent = messageContainer.querySelector('.message-content')
    if (messageContent) {
      await user.hover(messageContent)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    const replyButton = screen.getByLabelText('Reply to message')
    await user.click(replyButton)
    
    expect(mockProps.onReply).toHaveBeenCalledWith(mockMessage)
  })

  it('displays reactions when present', () => {
    const messageWithReactions = {
      ...mockMessage,
      reactions: [
        { emoji: '👍', count: 2, users: ['user1', 'user2'], hasReacted: false },
        { emoji: '❤️', count: 1, users: ['user3'], hasReacted: true },
      ],
    }

    render(<MessageBubble {...mockProps} message={messageWithReactions} />)
    
    expect(screen.getByText('👍')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('❤️')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('handles reply messages correctly', () => {
    const messageWithReply = {
      ...mockMessage,
      replyTo: {
        id: 'original-message',
        content: 'Original message',
        senderName: 'Original Sender',
      },
    }

    render(<MessageBubble {...mockProps} message={messageWithReply} />)
    
    expect(screen.getByText('Original message')).toBeInTheDocument()
    expect(screen.getByText('Original Sender')).toBeInTheDocument()
  })

  it('displays message status indicator', () => {
    const ownMessageWithStatus = {
      ...mockMessage,
      senderId: 'test-user-id', // Make it an own message
      status: 'read' as const,
    }

    render(<MessageBubble {...mockProps} message={ownMessageWithStatus} />)
    
    // Check for read status indicator (double check marks)
    expect(screen.getByTestId('message-status')).toBeInTheDocument()
  })

  it('renders attachments when present', () => {
    const messageWithAttachment = {
      ...mockMessage,
      attachments: [
        {
          id: 'attachment-1',
          name: 'test-image.jpg',
          url: 'https://example.com/image.jpg',
          type: 'image' as const,
        },
      ],
    }

    render(<MessageBubble {...mockProps} message={messageWithAttachment} />)
    
    expect(screen.getByRole('img', { name: 'test-image.jpg' })).toBeInTheDocument()
  })

  it('applies correct styling for own messages', () => {
    // Mock the session to make this an own message
    const ownMessage = {
      ...mockMessage,
      senderId: 'test-user-id', // This matches the mocked session user ID
    }

    render(<MessageBubble {...mockProps} message={ownMessage} />)
    
    const messageContainer = screen.getByRole('article')
    expect(messageContainer).toHaveClass('justify-end') // Own messages align right
  })

  it('formats timestamp correctly', () => {
    const specificTime = new Date('2024-01-01T10:30:00Z')
    const messageWithTime = {
      ...mockMessage,
      timestamp: specificTime,
    }

    render(<MessageBubble {...mockProps} message={messageWithTime} />)
    
    // Check that time is formatted correctly
    expect(screen.getByText(/10:30/)).toBeInTheDocument()
  })
})