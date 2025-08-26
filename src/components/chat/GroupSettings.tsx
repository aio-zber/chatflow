'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useSocketContext } from '@/context/SocketContext'
import { 
  X, 
  Edit3, 
  Save, 
  UserPlus, 
  UserMinus, 
  Crown, 
  User,
  LogOut,
  Trash2,
  Settings,
  Users,
  Search,
  Image
} from 'lucide-react'
import { MediaHistory } from './MediaHistory'

interface GroupMember {
  id: string
  userId: string
  role: 'admin' | 'member'
  joinedAt: string
  user: {
    id: string
    username: string
    name: string | null
    avatar: string | null
    isOnline: boolean
    lastSeen: string
  }
}

interface Group {
  id: string
  name: string | null
  description: string | null
  avatar: string | null
  participants: GroupMember[]
}

interface User {
  id: string
  username: string
  name: string | null
  avatar: string | null
  isOnline: boolean
  lastSeen: string
}

interface GroupSettingsProps {
  conversationId: string
  isOpen: boolean
  onClose: () => void
  onGroupUpdated?: (group: Group) => void
  onLeftGroup?: () => void
  onSearchConversation?: () => void
}

export function GroupSettings({ 
  conversationId, 
  isOpen, 
  onClose, 
  onGroupUpdated, 
  onLeftGroup,
  onSearchConversation 
}: GroupSettingsProps) {
  const { data: session } = useSession()
  const { socket } = useSocketContext()
  const [group, setGroup] = useState<Group | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'info' | 'members' | 'settings'>('info')
  const [showAddMember, setShowAddMember] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<User[]>([])
  const [searching, setSearching] = useState(false)
  const [showMediaHistory, setShowMediaHistory] = useState(false)
  const [addingMember, setAddingMember] = useState('')
  
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
  })

  const currentUserRole = group?.participants.find(p => p.userId === session?.user?.id)?.role
  const isAdmin = currentUserRole === 'admin'

  useEffect(() => {
    if (isOpen && conversationId) {
      fetchGroupSettings()
    }
  }, [isOpen, conversationId])

  // Socket event listeners for real-time group updates
  useEffect(() => {
    if (!socket || !isOpen || !conversationId) return

    const handleGroupMemberAdded = (data: { conversationId: string; member: GroupMember }) => {
      if (data.conversationId === conversationId) {
        console.log('Group member added event received:', data.member)
        setGroup(prev => {
          if (!prev) return prev
          const updatedGroup = {
            ...prev,
            participants: [...prev.participants, data.member]
          }
          onGroupUpdated?.(updatedGroup)
          return updatedGroup
        })
      }
    }

    const handleGroupMemberRemoved = (data: { conversationId: string; memberId: string; removedBy: string }) => {
      if (data.conversationId === conversationId) {
        console.log('Group member removed event received:', data)
        setGroup(prev => {
          if (!prev) return prev
          const updatedGroup = {
            ...prev,
            participants: prev.participants.filter(p => p.userId !== data.memberId)
          }
          onGroupUpdated?.(updatedGroup)
          return updatedGroup
        })
      }
    }

    const handleGroupMemberLeft = (data: { conversationId: string; memberId: string }) => {
      if (data.conversationId === conversationId) {
        console.log('Group member left event received:', data)
        setGroup(prev => {
          if (!prev) return prev
          const updatedGroup = {
            ...prev,
            participants: prev.participants.filter(p => p.userId !== data.memberId)
          }
          onGroupUpdated?.(updatedGroup)
          return updatedGroup
        })
        
        // If current user left, notify parent
        if (data.memberId === session?.user?.id) {
          onLeftGroup?.()
        }
      }
    }

    const handleGroupMemberRoleUpdated = (data: { conversationId: string; memberId: string; newRole: 'admin' | 'member'; updatedBy: string }) => {
      if (data.conversationId === conversationId) {
        console.log('Group member role updated event received:', data)
        setGroup(prev => {
          if (!prev) return prev
          const updatedGroup = {
            ...prev,
            participants: prev.participants.map(p => 
              p.userId === data.memberId 
                ? { ...p, role: data.newRole }
                : p
            )
          }
          onGroupUpdated?.(updatedGroup)
          return updatedGroup
        })
      }
    }

    const handleGroupDeleted = (data: { conversationId: string; deletedBy: string }) => {
      if (data.conversationId === conversationId) {
        console.log('Group deleted event received:', data)
        onLeftGroup?.()
        onClose()
      }
    }

    socket.on('group-member-added', handleGroupMemberAdded)
    socket.on('group-member-removed', handleGroupMemberRemoved)
    socket.on('group-member-left', handleGroupMemberLeft)
    socket.on('group-member-role-updated', handleGroupMemberRoleUpdated)
    socket.on('group-deleted', handleGroupDeleted)

    return () => {
      socket.off('group-member-added', handleGroupMemberAdded)
      socket.off('group-member-removed', handleGroupMemberRemoved)
      socket.off('group-member-left', handleGroupMemberLeft)
      socket.off('group-member-role-updated', handleGroupMemberRoleUpdated)
      socket.off('group-deleted', handleGroupDeleted)
    }
  }, [socket, isOpen, conversationId, onGroupUpdated, onLeftGroup, onClose, session?.user?.id])

  const fetchGroupSettings = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/conversations/${conversationId}/settings`)
      if (response.ok) {
        const data = await response.json()
        setGroup(data.group)
        setEditForm({
          name: data.group.name || '',
          description: data.group.description || '',
        })
      }
    } catch (error) {
      console.error('Error fetching group settings:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveGroup = async () => {
    if (!isAdmin || saving) return

    setSaving(true)
    try {
      const response = await fetch(`/api/conversations/${conversationId}/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: editForm.name.trim() || null,
          description: editForm.description.trim() || null,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setGroup(data.group)
        setEditing(false)
        onGroupUpdated?.(data.group)
      }
    } catch (error) {
      console.error('Error updating group:', error)
    } finally {
      setSaving(false)
    }
  }

  const handlePromoteMember = async (userId: string) => {
    if (!isAdmin) return

    try {
      const response = await fetch(`/api/conversations/${conversationId}/members`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          role: 'admin',
        }),
      })

      if (response.ok) {
        await fetchGroupSettings()
      }
    } catch (error) {
      console.error('Error promoting member:', error)
    }
  }

  const handleDemoteMember = async (userId: string) => {
    if (!isAdmin) return

    try {
      const response = await fetch(`/api/conversations/${conversationId}/members`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          role: 'member',
        }),
      })

      if (response.ok) {
        await fetchGroupSettings()
      }
    } catch (error) {
      console.error('Error demoting member:', error)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!isAdmin) return

    if (confirm('Are you sure you want to remove this member?')) {
      try {
        const response = await fetch(`/api/conversations/${conversationId}/members?userId=${userId}`, {
          method: 'DELETE',
        })

        if (response.ok) {
          await fetchGroupSettings()
        }
      } catch (error) {
        console.error('Error removing member:', error)
      }
    }
  }

  const handleLeaveGroup = async () => {
    if (confirm('Are you sure you want to leave this group?')) {
      try {
        const response = await fetch(`/api/conversations/${conversationId}/leave`, {
          method: 'POST',
        })

        if (response.ok) {
          onClose()
          onLeftGroup?.()
        }
      } catch (error) {
        console.error('Error leaving group:', error)
      }
    }
  }

  const handleDeleteGroup = async () => {
    if (!isAdmin) return

    if (confirm('Are you sure you want to delete this group? This action cannot be undone.')) {
      try {
        const response = await fetch(`/api/conversations/${conversationId}/settings`, {
          method: 'DELETE',
        })

        if (response.ok) {
          onClose()
          onLeftGroup?.()
        }
      } catch (error) {
        console.error('Error deleting group:', error)
      }
    }
  }

  const searchUsers = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      return
    }

    setSearching(true)
    try {
      const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`)
      if (response.ok) {
        const data = await response.json()
        // Filter out users who are already in the group
        const existingUserIds = group?.participants.map(p => p.userId) || []
        const filteredUsers = data.users.filter((user: User) => 
          !existingUserIds.includes(user.id)
        )
        setSearchResults(filteredUsers)
      }
    } catch (error) {
      console.error('Error searching users:', error)
    } finally {
      setSearching(false)
    }
  }

  const handleAddMember = async (userId: string) => {
    if (!isAdmin || addingMember) return

    setAddingMember(userId)
    try {
      const response = await fetch(`/api/conversations/${conversationId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        console.log('Member added successfully:', data.message)
        
        // Don't immediately fetch group settings - let socket events handle the update
        // This allows the real-time updates to work properly
        setTimeout(async () => {
          await fetchGroupSettings()
        }, 500) // Give socket events time to propagate
        
        setSearchQuery('')
        setSearchResults([])
        setShowAddMember(false)
      }
    } catch (error) {
      console.error('Error adding member:', error)
    } finally {
      setAddingMember('')
    }
  }

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery && showAddMember) {
        searchUsers(searchQuery)
      } else {
        setSearchResults([])
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, showAddMember])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Group Settings
          </h2>
          <div className="flex items-center space-x-2">
            {onSearchConversation && (
              <button
                onClick={onSearchConversation}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"
                title="Search messages in this group"
              >
                <Search className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"
            >
              <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin mx-auto"></div>
            <p className="mt-2 text-gray-500 dark:text-gray-400">Loading group settings...</p>
          </div>
        ) : group ? (
          <>
            {/* Tabs */}
            <div className="flex border-b border-gray-200 dark:border-gray-700">
              {[
                { id: 'info', label: 'Info', icon: Settings },
                { id: 'members', label: 'Members', icon: Users },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id as any)}
                  className={`flex-1 flex items-center justify-center space-x-2 py-3 px-4 text-sm font-medium border-b-2 ${
                    activeTab === id
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {activeTab === 'info' && (
                <div className="space-y-6">
                  {/* Group Avatar */}
                  <div className="text-center">
                    <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Users className="w-10 h-10 text-white" />
                    </div>
                    {isAdmin && (
                      <button className="text-sm text-blue-600 hover:text-blue-700">
                        Change Photo
                      </button>
                    )}
                  </div>

                  {/* Group Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Group Name
                    </label>
                    {editing ? (
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        placeholder="Enter group name"
                      />
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-900 dark:text-white">
                          {group.name || 'Untitled Group'}
                        </span>
                        {isAdmin && (
                          <button
                            onClick={() => setEditing(true)}
                            className="p-2 text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Group Description */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Description
                    </label>
                    {editing ? (
                      <textarea
                        value={editForm.description}
                        onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        placeholder="Enter group description"
                        rows={3}
                      />
                    ) : (
                      <p className="text-gray-900 dark:text-white">
                        {group.description || 'No description'}
                      </p>
                    )}
                  </div>

                  {editing && isAdmin && (
                    <div className="flex space-x-2">
                      <button
                        onClick={handleSaveGroup}
                        disabled={saving}
                        className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      >
                        <Save className="w-4 h-4" />
                        <span>{saving ? 'Saving...' : 'Save'}</span>
                      </button>
                      <button
                        onClick={() => {
                          setEditing(false)
                          setEditForm({
                            name: group.name || '',
                            description: group.description || '',
                          })
                        }}
                        className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* Group Stats */}
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Members</p>
                      <p className="text-lg font-semibold text-gray-900 dark:text-white">
                        {group.participants.length}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Admins</p>
                      <p className="text-lg font-semibold text-gray-900 dark:text-white">
                        {group.participants.filter(p => p.role === 'admin').length}
                      </p>
                    </div>
                  </div>

                  {/* Media History Button */}
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                    <button
                      onClick={() => setShowMediaHistory(true)}
                      className="w-full flex items-center justify-center px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
                    >
                      <Image className="w-4 h-4 mr-2" />
                      View Media History
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'members' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                      Members ({group.participants.length})
                    </h3>
                    {isAdmin && (
                      <button 
                        onClick={() => setShowAddMember(true)}
                        className="flex items-center space-x-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        <UserPlus className="w-4 h-4" />
                        <span>Add Member</span>
                      </button>
                    )}
                  </div>

                  <div className="space-y-3">
                    {group.participants.map((member) => (
                      <div key={member.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center space-x-3">
                          {member.user.avatar ? (
                            <img
                              src={member.user.avatar}
                              alt={member.user.name || member.user.username}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 bg-gray-400 rounded-full flex items-center justify-center">
                              <span className="text-white text-sm font-medium">
                                {(member.user.name || member.user.username).charAt(0).toUpperCase()}
                              </span>
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white">
                              {member.user.name || member.user.username}
                              {member.userId === session?.user?.id && ' (You)'}
                            </p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              @{member.user.username}
                            </p>
                          </div>
                          {member.role === 'admin' && (
                            <Crown className="w-4 h-4 text-yellow-500" title="Admin" />
                          )}
                        </div>

                        {isAdmin && member.userId !== session?.user?.id && (
                          <div className="flex items-center space-x-2">
                            {member.role === 'member' ? (
                              <button
                                onClick={() => handlePromoteMember(member.userId)}
                                className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg"
                                title="Promote to admin"
                              >
                                <Crown className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleDemoteMember(member.userId)}
                                className="p-2 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg"
                                title="Demote to member"
                              >
                                <User className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleRemoveMember(member.userId)}
                              className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                              title="Remove member"
                            >
                              <UserMinus className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleLeaveGroup}
                className="flex items-center space-x-2 px-4 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
              >
                <LogOut className="w-4 h-4" />
                <span>Leave Group</span>
              </button>

              {isAdmin && (
                <button
                  onClick={handleDeleteGroup}
                  className="flex items-center space-x-2 px-4 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete Group</span>
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">Failed to load group settings</p>
          </div>
        )}
      </div>

      {/* Add Member Modal */}
      {showAddMember && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-60 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full max-h-[70vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Add Member
              </h3>
              <button
                onClick={() => {
                  setShowAddMember(false)
                  setSearchQuery('')
                  setSearchResults([])
                }}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"
              >
                <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search users by name or username..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                {searching && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
                  </div>
                )}
              </div>
            </div>

            {/* Search Results */}
            <div className="p-4 overflow-y-auto max-h-[40vh]">
              {searchQuery.trim() === '' ? (
                <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                  <UserPlus className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>Search for users to add to the group</p>
                </div>
              ) : searchResults.length === 0 && !searching ? (
                <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                  <p>No users found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {searchResults.map((user) => (
                    <div key={user.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <div className="flex items-center space-x-3">
                        {user.avatar ? (
                          <img
                            src={user.avatar}
                            alt={user.name || user.username}
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-gray-400 rounded-full flex items-center justify-center">
                            <span className="text-white text-sm font-medium">
                              {(user.name || user.username).charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {user.name || user.username}
                          </p>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            @{user.username}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleAddMember(user.id)}
                        disabled={addingMember === user.id}
                        className="flex items-center space-x-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {addingMember === user.id ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <UserPlus className="w-4 h-4" />
                        )}
                        <span>Add</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Media History Modal */}
      <MediaHistory
        isOpen={showMediaHistory}
        onClose={() => setShowMediaHistory(false)}
        conversationId={conversationId}
        title="Group Media History"
      />
    </div>
  )
}