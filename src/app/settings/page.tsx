'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Camera, RefreshCw, Save, User, MessageCircle } from 'lucide-react'

export default function SettingsPage() {
  const { data: session, update } = useSession()
  const router = useRouter()
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [name, setName] = useState(session?.user?.name || '')
  const [bio, setBio] = useState('')
  const [saving, setSaving] = useState(false)

  // Update local state when session changes
  useEffect(() => {
    if (session?.user?.name) {
      setName(session.user.name)
    }
  }, [session?.user?.name])

  if (!session) {
    router.push('/auth/signin')
    return null
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setSaving(true)
      console.log('Settings: Saving profile changes:', { name, bio })
      
      const resp = await fetch(`/api/users/${session.user?.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, bio }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to save settings')
      }
      const data = await resp.json()
      console.log('Settings: API response received:', data.user)
      
      // Update the session with the new data
      console.log('Settings: Current session before update:', session.user)
      console.log('Settings: Data received from API:', data.user)
      
      // Try updating the session with just the changed data
      console.log('Settings: Triggering session update with new data')
      const result = await update({
        user: {
          ...session.user,
          ...data.user
        }
      })
      console.log('Settings: Session update result:', result)
      
      // Also try a simple refresh to force NextAuth to re-read from the database
      console.log('Settings: Forcing session refresh')
      const refreshResult = await update()
      console.log('Settings: Session refresh result:', refreshResult)
      
      // Wait for session to propagate and socket events to process
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Verify the session was updated
      console.log('Settings: Session after update:', session.user)
      console.log('Settings: Profile changes saved and broadcasted')
      
      // Update local state to reflect changes immediately
      setName(data.user.name || name)
      if (data.user.bio !== undefined) setBio(data.user.bio || bio)
      
      // Broadcast a custom event to notify components of profile changes
      console.log('Settings: Broadcasting profile change event')
      window.dispatchEvent(new CustomEvent('profileUpdated', {
        detail: {
          userId: session.user.id,
          userData: data.user
        }
      }))
    } catch (err) {
      console.error('Save settings failed:', err)
      alert('Failed to save settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <Link
            href="/chat"
            className="inline-flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Chat
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Manage your account settings and profile</p>
        </div>

        <div className="bg-white dark:bg-gray-800 shadow rounded-lg">
          <div className="px-6 py-8 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center space-x-6">
              <div className="relative">
                <div className="w-24 h-24 bg-blue-600 rounded-full flex items-center justify-center overflow-hidden">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Preview" className="w-24 h-24 object-cover" />
                  ) : session.user.avatar ? (
                    <img src={`${session.user.avatar}?${new Date().getTime()}`} alt={session.user.name || 'Profile'} className="w-24 h-24 object-cover" />
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
                        await update({ ...session, user: { ...session?.user, avatar: data.user.avatar, image: data.user.avatar } })
                        // Replace preview with CDN URL to ensure transformations/caching are reflected
                        setAvatarPreview(data.user.avatar)
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
                <div className="flex items-center mt-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
                  <span className="text-sm text-gray-600 dark:text-gray-400">Online</span>
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={handleSave} className="px-6 py-6 space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <User className="w-4 h-4 inline mr-2" />
                Display Name
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                value={name}
                onChange={(e) => setName(e.target.value)}
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
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell others about yourself..."
                maxLength={160}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{bio.length}/160 characters</p>
            </div>

            <div className="flex items-center justify-end pt-6 border-t border-gray-200 dark:border-gray-700">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}


