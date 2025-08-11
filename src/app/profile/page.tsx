'use client'

import { useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Camera, Save, ArrowLeft, User, Mail, AtSign, MessageCircle, UserX, Settings, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { BlockedUsersManager } from '@/components/BlockedUsersManager'

export default function ProfilePage() {
  const { data: session, update } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [activeTab, setActiveTab] = useState<'profile' | 'blocked'>('profile')
  
  const [formData, setFormData] = useState({
    name: session?.user?.name || '',
    bio: '',
    status: 'online',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const response = await fetch(`/api/users/${session?.user?.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update profile')
      }

      const data = await response.json()
      await update({ ...session, user: { ...session?.user, ...data.user } })
      setSuccess('Profile updated successfully!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = () => {
    signOut({ callbackUrl: '/auth/signin' })
  }

  if (!session) {
    router.push('/auth/signin')
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/chat"
            className="inline-flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Chat
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Profile Settings</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Manage your ChatFlow profile and preferences</p>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg mb-6">
          <div className="border-b border-gray-200 dark:border-gray-700">
            <nav className="-mb-px flex">
              <button
                onClick={() => setActiveTab('profile')}
                className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'profile'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                <Settings className="w-4 h-4 inline mr-2" />
                Profile Settings
              </button>
              <button
                onClick={() => setActiveTab('blocked')}
                className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'blocked'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                <UserX className="w-4 h-4 inline mr-2" />
                Blocked Users
              </button>
            </nav>
          </div>
        </div>

        {activeTab === 'profile' ? (
          <div className="bg-white dark:bg-gray-800 shadow rounded-lg">
            {/* Profile Header */}
            <div className="px-6 py-8 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center space-x-6">
              <div className="relative">
                <div className="w-24 h-24 bg-blue-600 rounded-full flex items-center justify-center overflow-hidden">
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt="Preview"
                      className="w-24 h-24 rounded-full object-cover"
                    />
                  ) : session.user.avatar ? (
                    <img
                      src={`${session.user.avatar}?${new Date().getTime()}`}
                      alt={session.user.name || 'Profile'}
                      className="w-24 h-24 rounded-full object-cover"
                    />
                  ) : (
                    <span className="text-3xl font-bold text-white">
                      {(session.user.name || session.user.email || 'U').charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <label className="absolute bottom-0 right-0 bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-full shadow-lg transition-colors cursor-pointer">
                  <Camera className="w-4 h-4" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      try {
                        setAvatarUploading(true)
                        const reader = new FileReader()
                        const fileAsDataUrl: string = await new Promise((resolve, reject) => {
                          reader.onload = () => resolve(reader.result as string)
                          reader.onerror = reject
                          reader.readAsDataURL(file)
                        })
                        // Immediate local preview
                        setAvatarPreview(fileAsDataUrl)
                        const resp = await fetch('/api/upload/avatar', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ imageBase64: fileAsDataUrl }),
                        })
                        if (!resp.ok) {
                          const err = await resp.json().catch(() => ({}))
                          throw new Error(err.error || 'Failed to upload avatar')
                        }
                        const data = await resp.json()
                        // Update session with new avatar URL
                        await update({ ...session, user: { ...session?.user, avatar: data.user.avatar, image: data.user.avatar } })
                        // Replace preview with CDN URL to ensure transformations/caching are reflected
                        setAvatarPreview(`${data.user.avatar}?${new Date().getTime()}`)
                      } catch (err) {
                        console.error('Avatar upload failed:', err)
                        // Revert preview on failure
                        setAvatarPreview(null)
                      } finally {
                        setAvatarUploading(false)
                      }
                    }}
                  />
                </label>
                {avatarUploading && (
                  <div className="absolute -bottom-2 -right-2 bg-white dark:bg-gray-800 rounded-full p-1 shadow">
                    <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white truncate">
                  {session.user.name || 'Unnamed User'}
                </h2>
                <p className="text-gray-600 dark:text-gray-400">@{session.user.username || 'username'}</p>
                <p className="text-gray-600 dark:text-gray-400 mt-1">{session.user.email}</p>
                <div className="flex items-center mt-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
                  <span className="text-sm text-gray-600 dark:text-gray-400">Online</span>
                </div>
              </div>
            </div>
          </div>

          {/* Profile Form */}
          <form onSubmit={handleSubmit} className="px-6 py-6 space-y-6">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-800 rounded-md p-4">
                <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
              </div>
            )}

            {success && (
              <div className="bg-green-50 dark:bg-green-900/50 border border-green-200 dark:border-green-800 rounded-md p-4">
                <p className="text-green-600 dark:text-green-400 text-sm">{success}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <User className="w-4 h-4 inline mr-2" />
                Display Name
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter your display name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <MessageCircle className="w-4 h-4 inline mr-2" />
                Bio
              </label>
              <textarea
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white resize-none"
                value={formData.bio}
                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                placeholder="Tell others about yourself..."
                maxLength={160}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {formData.bio.length}/160 characters
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Status
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              >
                <option value="online">🟢 Online</option>
                <option value="away">🟡 Away</option>
                <option value="busy">🔴 Busy</option>
                <option value="invisible">⚫ Invisible</option>
              </select>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Account Information</h3>
              <div className="space-y-3">
                <div className="flex items-center text-sm">
                  <Mail className="w-4 h-4 text-gray-400 mr-3" />
                  <span className="text-gray-600 dark:text-gray-400">Email:</span>
                  <span className="ml-2 text-gray-900 dark:text-white">{session.user.email}</span>
                </div>
                <div className="flex items-center text-sm">
                  <AtSign className="w-4 h-4 text-gray-400 mr-3" />
                  <span className="text-gray-600 dark:text-gray-400">Username:</span>
                  <span className="ml-2 text-gray-900 dark:text-white">@{session.user.username || 'Not set'}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-6 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={handleSignOut}
                className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
              >
                Sign Out
              </button>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4 mr-2" />
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
        ) : (
          <BlockedUsersManager />
        )}
      </div>
    </div>
  )
}