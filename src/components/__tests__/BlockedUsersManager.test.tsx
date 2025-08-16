import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import { BlockedUsersManager } from '../BlockedUsersManager'
import { useBlockedUsers } from '@/hooks/useBlockedUsers'

// Mock the hooks
jest.mock('next-auth/react', () => ({
  useSession: jest.fn()
}))
jest.mock('@/hooks/useBlockedUsers')

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>
const mockUseBlockedUsers = useBlockedUsers as jest.MockedFunction<typeof useBlockedUsers>

const mockBlockedUsers = [
  {
    id: '1',
    blockedAt: '2023-10-01T10:00:00Z',
    user: {
      id: 'user1',
      username: 'johndoe',
      name: 'John Doe',
      avatar: null,
      status: 'online',
      isOnline: true,
      lastSeen: new Date('2023-10-01T10:00:00Z'),
    }
  },
  {
    id: '2',
    blockedAt: '2023-09-30T10:00:00Z',
    user: {
      id: 'user2',
      username: 'janedoe',
      name: 'Jane Doe',
      avatar: 'https://example.com/avatar.jpg',
      status: 'offline',
      isOnline: false,
      lastSeen: new Date('2023-09-30T10:00:00Z'),
    }
  }
]

describe('BlockedUsersManager', () => {
  beforeEach(() => {
    mockUseSession.mockReturnValue({
      data: {
        user: { id: 'current-user', name: 'Current User', email: 'current@example.com' }
      },
      status: 'authenticated'
    })

    mockUseBlockedUsers.mockReturnValue({
      blockedUsers: mockBlockedUsers,
      loading: false,
      error: null,
      refetch: jest.fn(),
      unblockUser: jest.fn().mockResolvedValue(true),
      isUnblocking: null,
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('renders blocked users list', async () => {
    render(<BlockedUsersManager />)

    // Check header
    expect(screen.getByText('Blocked Users')).toBeInTheDocument()
    expect(screen.getByText('Manage users you\'ve blocked from contacting you')).toBeInTheDocument()

    // Check users are displayed
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText('@johndoe')).toBeInTheDocument()
      expect(screen.getByText('Jane Doe')).toBeInTheDocument()
      expect(screen.getByText('@janedoe')).toBeInTheDocument()
    })

    // Check count badge
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    mockUseBlockedUsers.mockReturnValue({
      blockedUsers: [],
      loading: true,
      error: null,
      refetch: jest.fn(),
      unblockUser: jest.fn(),
      isUnblocking: null,
    })

    render(<BlockedUsersManager />)
    expect(screen.getByText('Loading blocked users...')).toBeInTheDocument()
  })

  it('shows empty state when no blocked users', () => {
    mockUseBlockedUsers.mockReturnValue({
      blockedUsers: [],
      loading: false,
      error: null,
      refetch: jest.fn(),
      unblockUser: jest.fn(),
      isUnblocking: null,
    })

    render(<BlockedUsersManager />)
    expect(screen.getByText('No blocked users')).toBeInTheDocument()
    expect(screen.getByText('You haven\'t blocked anyone yet. When you block users, they\'ll appear here.')).toBeInTheDocument()
  })

  it('shows error message', () => {
    mockUseBlockedUsers.mockReturnValue({
      blockedUsers: [],
      loading: false,
      error: 'Failed to load blocked users',
      refetch: jest.fn(),
      unblockUser: jest.fn(),
      isUnblocking: null,
    })

    render(<BlockedUsersManager />)
    expect(screen.getByText('Failed to load blocked users')).toBeInTheDocument()
  })

  it('filters users by search query', async () => {
    render(<BlockedUsersManager />)

    const searchInput = screen.getByPlaceholderText('Search blocked users...')
    fireEvent.change(searchInput, { target: { value: 'john' } })

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument()
    })
  })

  it('calls unblock function when unblock button is clicked', async () => {
    const mockUnblock = jest.fn().mockResolvedValue(true)
    mockUseBlockedUsers.mockReturnValue({
      blockedUsers: mockBlockedUsers,
      loading: false,
      error: null,
      refetch: jest.fn(),
      unblockUser: mockUnblock,
      isUnblocking: null,
    })

    render(<BlockedUsersManager />)

    const unblockButtons = screen.getAllByText('Unblock')
    fireEvent.click(unblockButtons[0])

    await waitFor(() => {
      expect(mockUnblock).toHaveBeenCalledWith('user1')
    })
  })

  it('shows filters when filter button is clicked', () => {
    render(<BlockedUsersManager />)

    const filterButton = screen.getByText('Filters')
    fireEvent.click(filterButton)

    expect(screen.getByLabelText('Sort by')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by status')).toBeInTheDocument()
  })

  it('displays online status indicators', () => {
    render(<BlockedUsersManager />)

    // Check that both users are rendered with their status indicators
    const onlineIndicators = screen.getAllByText('John Doe')
    const offlineIndicators = screen.getAllByText('Jane Doe')
    
    expect(onlineIndicators).toHaveLength(1)
    expect(offlineIndicators).toHaveLength(1)
  })
})