'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
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
  Users
} from 'lucide-react'

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

interface GroupSettingsProps {
  conversationId: string
  isOpen: boolean
  onClose: () => void
  onGroupUpdated?: (group: Group) => void
  onLeftGroup?: () => void
}

export function GroupSettings({ 
  conversationId, 
  isOpen, 
  onClose, 
  onGroupUpdated, 
  onLeftGroup 
}: GroupSettingsProps) {
  const { data: session } = useSession()
  const [group, setGroup] = useState<Group | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'info' | 'members' | 'settings'>('info')
  
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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Group Settings
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"
          >
            <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
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
                </div>
              )}

              {activeTab === 'members' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                      Members ({group.participants.length})
                    </h3>
                    {isAdmin && (
                      <button className="flex items-center space-x-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
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
    </div>
  )
}