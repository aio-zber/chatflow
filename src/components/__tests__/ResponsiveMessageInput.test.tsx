import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResponsiveMessageInput } from '../ResponsiveMessageInput'

describe('ResponsiveMessageInput', () => {
  const mockOnSendMessage = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders message input correctly', () => {
    render(<ResponsiveMessageInput onSendMessage={mockOnSendMessage} />)
    
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument()
  })

  it('sends message when send button is clicked', async () => {
    const user = userEvent.setup()
    render(<ResponsiveMessageInput onSendMessage={mockOnSendMessage} />)
    
    const input = screen.getByPlaceholderText('Type a message...')
    const sendButton = screen.getByRole('button', { name: /send/i })
    
    await user.type(input, 'Hello world!')
    await user.click(sendButton)
    
    expect(mockOnSendMessage).toHaveBeenCalledWith('Hello world!', [])
  })

  it('sends message when Enter is pressed', async () => {
    const user = userEvent.setup()
    render(<ResponsiveMessageInput onSendMessage={mockOnSendMessage} />)
    
    const input = screen.getByPlaceholderText('Type a message...')
    
    await user.type(input, 'Hello world!')
    await user.keyboard('{Enter}')
    
    expect(mockOnSendMessage).toHaveBeenCalledWith('Hello world!', [])
  })

  it('creates new line when Shift+Enter is pressed', async () => {
    const user = userEvent.setup()
    render(<ResponsiveMessageInput onSendMessage={mockOnSendMessage} />)
    
    const input = screen.getByPlaceholderText('Type a message...')
    
    await user.type(input, 'Line 1')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    await user.type(input, 'Line 2')
    
    expect(input).toHaveValue('Line 1\nLine 2')
    expect(mockOnSendMessage).not.toHaveBeenCalled()
  })

  it('disables send button when input is empty', () => {
    render(<ResponsiveMessageInput onSendMessage={mockOnSendMessage} />)
    
    const sendButton = screen.getByRole('button', { name: /send/i })
    expect(sendButton).toBeDisabled()
  })

  it('enables send button when input has content', async () => {
    const user = userEvent.setup()
    render(<ResponsiveMessageInput onSendMessage={mockOnSendMessage} />)
    
    const input = screen.getByPlaceholderText('Type a message...')
    const sendButton = screen.getByRole('button', { name: /send/i })
    
    await user.type(input, 'Hello')
    
    expect(sendButton).toBeEnabled()
  })

  it('clears input after sending message', async () => {
    const user = userEvent.setup()
    render(<ResponsiveMessageInput onSendMessage={mockOnSendMessage} />)
    
    const input = screen.getByPlaceholderText('Type a message...')
    const sendButton = screen.getByRole('button', { name: /send/i })
    
    await user.type(input, 'Hello world!')
    await user.click(sendButton)
    
    expect(input).toHaveValue('')
  })

  it('shows attachment menu when attachment button is clicked', async () => {
    const user = userEvent.setup()
    render(<ResponsiveMessageInput onSendMessage={mockOnSendMessage} />)
    
    const attachButton = screen.getByRole('button', { name: /attach/i })
    await user.click(attachButton)
    
    expect(screen.getByText('Attach File')).toBeInTheDocument()
  })

  it('handles file attachments', async () => {
    const user = userEvent.setup()
    render(<ResponsiveMessageInput onSendMessage={mockOnSendMessage} />)
    
    const file = new File(['test content'], 'test.txt', { type: 'text/plain' })
    
    // Mock file input
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.files = { 0: file, length: 1 } as any
    
    // Simulate file selection
    const attachButton = screen.getByRole('button', { name: /attach/i })
    await user.click(attachButton)
    
    const fileInputButton = screen.getByText('Attach File')
    fireEvent.click(fileInputButton)
    
    // The file would be selected through the hidden input
    // This test verifies the UI elements are present
    expect(screen.getByText('Attach File')).toBeInTheDocument()
  })

  it('respects disabled state', () => {
    render(<ResponsiveMessageInput onSendMessage={mockOnSendMessage} disabled />)
    
    const input = screen.getByPlaceholderText('Type a message...')
    const sendButton = screen.getByRole('button', { name: /send/i })
    const attachButton = screen.getByRole('button', { name: /attach/i })
    
    expect(input).toBeDisabled()
    expect(sendButton).toBeDisabled()
    expect(attachButton).toBeDisabled()
  })

  it('supports custom placeholder text', () => {
    render(
      <ResponsiveMessageInput 
        onSendMessage={mockOnSendMessage} 
        placeholder="Custom placeholder" 
      />
    )
    
    expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument()
  })
})
