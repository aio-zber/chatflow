'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Camera, RefreshCw, Save, User, MessageCircle } from 'lucide-react'

export default function SettingsPage() {
  const { data: session, update } = useSession()
  const router = useRouter()
  const [name, setName] = useState(session?.user?.name || '')
  const [bio, setBio] = useState(session?.user?.bio || '')
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Update local state when session changes
  useEffect(() => {
    if (session?.user?.name) {
      setName(session.user.name)
    }
    if (session?.user?.bio !== undefined) {
      setBio(session.user.bio || '')
    }
  }, [session?.user?.name, session?.user?.bio])

  if (!session) {
    router.push('/auth/signin')
    return null
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !session?.user?.id) return

    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      alert('File size must be less than 5MB')
      return
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file')
      return
    }

    try {
      setUploadingAvatar(true)
      console.log('Settings: Uploading avatar:', file.name)
      
      // Convert file to base64 since the API expects base64 data
      const reader = new FileReader()
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string
          resolve(result)
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      
      const imageBase64 = await base64Promise
      
      const response = await fetch('/api/upload/avatar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imageBase64 }),
      })
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Upload failed' }))
        throw new Error(error.error || 'Failed to upload avatar')
      }
      
      const data = await response.json()
      console.log('Settings: Avatar upload response:', data)
      
      // Force session update with new avatar data to clear cache
      console.log('Settings: Updating session with new avatar')
      await update({
        user: {
          ...session.user,
          avatar: data.user.avatar
        }
      })
      
      // Force a complete session refresh to ensure data is current
      await update()
      
      // Broadcast the profile update event
      window.dispatchEvent(new CustomEvent('profileUpdated', {
        detail: {
          userId: session.user.id,
          userData: { avatar: data.user.avatar }
        }
      }))
      
      // Add a small delay to ensure DOM updates
      await new Promise(resolve => setTimeout(resolve, 100))
      
      console.log('Settings: Avatar updated successfully')
    } catch (error) {
      console.error('Avatar upload failed:', error)
      alert('Failed to upload avatar. Please try again.')
    } finally {
      setUploadingAvatar(false)
      // Clear the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
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
    <div className="min-h-screen bg-viber-surface-container dark:bg-viber-surface-container">
      <div className="max-w-lg mx-auto py-8 px-4">
        <div className="mb-6">
          <Link
            href="/chat"
            className="inline-flex items-center text-viber-text-secondary dark:text-viber-text-secondary hover:text-viber-text-primary dark:hover:text-viber-text-primary mb-4"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Chat
          </Link>
          <h1 className="text-2xl font-semibold text-viber-text-primary dark:text-viber-text-primary">Settings</h1>
          <p className="text-viber-text-secondary dark:text-viber-text-secondary mt-1 text-sm">Manage your account settings and profile</p>
        </div>

        <div className="bg-viber-surface dark:bg-viber-surface rounded-2xl shadow-viber overflow-hidden">
          <div className="px-6 py-6 border-b border-viber-border dark:border-viber-border">
            <div className="flex items-center space-x-4">
              <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                <div className="w-16 h-16 bg-viber-primary rounded-full flex items-center justify-center overflow-hidden relative">
                  {session.user.avatar ? (
                    <img 
                      src={`${session.user.avatar}?v=${Date.now()}`} 
                      alt={session.user.name || 'Profile'} 
                      className="w-16 h-16 object-cover" 
                      key={session.user.avatar} // Force re-render when avatar changes
                    />
                  ) : (
                    <span className="text-xl font-semibold text-viber-text-inverse">
                      {(session.user.name || session.user.email || 'U').charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                
                {/* Single purple camera overlay - only upload method */}
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#7360F2] rounded-full flex items-center justify-center shadow-lg hover:bg-[#6854E8] transition-colors duration-200">
                  {uploadingAvatar ? (
                    <RefreshCw className="w-3.5 h-3.5 text-white animate-spin" />
                  ) : (
                    <Camera className="w-3.5 h-3.5 text-white" />
                  )}
                </div>
                
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                  title="Change profile picture"
                />
              </div>

              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-semibold text-viber-text-primary dark:text-viber-text-primary truncate">
                  {session.user.name || 'Tester2'}
                </h2>
                <p className="text-viber-text-secondary dark:text-viber-text-secondary">@{session.user.username || 'Tester2'}</p>
                <div className="flex items-center mt-1">
                  <div className="w-2 h-2 bg-viber-green rounded-full mr-2"></div>
                  <span className="text-xs text-viber-text-secondary dark:text-viber-text-secondary">Online</span>
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={handleSave} className="px-6 py-6 space-y-5">
            <div>
              <label className="flex items-center text-sm font-medium text-viber-text-primary dark:text-viber-text-primary mb-2">
                <User className="w-4 h-4 mr-2" />
                Display Name
              </label>
              <input
                type="text"
                className="w-full px-4 py-3 border border-viber-border dark:border-viber-border rounded-lg bg-viber-surface-container dark:bg-viber-surface-bright text-viber-text-primary dark:text-viber-text-primary focus:outline-none focus:ring-2 focus:ring-viber-primary focus:border-viber-primary transition-all"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tester2"
              />
            </div>

            <div>
              <label className="flex items-center text-sm font-medium text-viber-text-primary dark:text-viber-text-primary mb-2">
                <MessageCircle className="w-4 h-4 mr-2" />
                Bio
              </label>
              <textarea
                rows={3}
                className="w-full px-4 py-3 border border-viber-border dark:border-viber-border rounded-lg bg-viber-surface-container dark:bg-viber-surface-bright text-viber-text-primary dark:text-viber-text-primary placeholder-viber-text-tertiary focus:outline-none focus:ring-2 focus:ring-viber-primary focus:border-viber-primary resize-none transition-all"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell others about yourself..."
                maxLength={160}
              />
              <p className="text-xs text-viber-text-tertiary dark:text-viber-text-tertiary mt-1">{bio.length}/160 characters</p>
            </div>

            <div className="flex items-center justify-end pt-4">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center space-x-2 px-3 py-2 bg-[#7360F2] text-white rounded-lg hover:bg-[#6854E8]"
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


