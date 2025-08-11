import NextAuth, { AuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import GitHubProvider from 'next-auth/providers/github'
import { PrismaAdapter } from '@auth/prisma-adapter'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { v2 as cloudinary } from 'cloudinary'

function sanitizeAvatarForToken(avatar?: string | null): string | null {
  if (!avatar) return null
  if (avatar.startsWith('data:')) return null
  if (avatar.length > 512) return null
  return avatar
}

async function migrateAvatarIfNeeded(avatar?: string | null): Promise<string | null> {
  try {
    if (!avatar || !avatar.startsWith('data:')) return avatar || null
    // Upload legacy data-URI to Cloudinary if env available
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return null
    }
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    })
    const uploadResult = await cloudinary.uploader.upload(avatar, {
      folder: 'chatflow/avatars',
      transformation: [
        { width: 512, height: 512, crop: 'fill', gravity: 'auto' },
        { fetch_format: 'auto', quality: 'auto' },
      ],
      overwrite: true,
      invalidate: true,
    })
    return uploadResult.secure_url
  } catch (e) {
    console.error('Failed to migrate legacy avatar to Cloudinary:', e)
    return null
  }
}

export const authOptions: AuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email }
        })

        if (!user || !user.password) {
          return null
        }

        const isPasswordValid = await bcrypt.compare(credentials.password, user.password)

        if (!isPasswordValid) {
          return null
        }

        // Ensure online status
        await prisma.user.update({
          where: { id: user.id },
          data: { 
            isOnline: true,
            lastSeen: new Date()
          }
        })

        // Migrate legacy data-URI avatar to Cloudinary if needed (best-effort)
        let safeAvatar: string | null = sanitizeAvatarForToken(user.avatar)
        if (!safeAvatar && user.avatar && user.avatar.startsWith('data:')) {
          const migrated = await migrateAvatarIfNeeded(user.avatar)
          if (migrated) {
            await prisma.user.update({ where: { id: user.id }, data: { avatar: migrated } })
            safeAvatar = migrated
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
          // Do NOT return large avatar payloads; only a small URL
          avatar: safeAvatar,
        }
      }
    }),
    ...(process.env.GOOGLE_CLIENT_ID ? [
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      })
    ] : []),
    ...(process.env.GITHUB_ID ? [
      GitHubProvider({
        clientId: process.env.GITHUB_ID,
        clientSecret: process.env.GITHUB_SECRET!,
      })
    ] : []),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },
  jwt: {
    maxAge: 24 * 60 * 60, // 24 hours
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.username = (user as { username?: string }).username
        // Keep avatar out of the JWT if it's large or data-URI to avoid cookie bloat
        token.avatar = sanitizeAvatarForToken((user as { avatar?: string | null }).avatar) || undefined
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
        session.user.username = token.username as string
        // Only propagate sanitized avatar to session
        session.user.avatar = (token.avatar as string | undefined) || null
      }
      return session
    },
    async signIn({ user, account }) {
      if (account?.provider === 'google' || account?.provider === 'github') {
        const existingUser = await prisma.user.findUnique({
          where: { email: user.email! }
        })

        if (existingUser) {
          // If existing avatar is a legacy data-URI, migrate to Cloudinary asynchronously
          if (existingUser.avatar && existingUser.avatar.startsWith('data:')) {
            try {
              const migrated = await migrateAvatarIfNeeded(existingUser.avatar)
              if (migrated) {
                await prisma.user.update({ where: { id: existingUser.id }, data: { avatar: migrated } })
              }
            } catch (e) {
              console.error('OAuth avatar migration failed:', e)
            }
          }
          await prisma.user.update({
            where: { id: existingUser.id },
            data: { 
              isOnline: true,
              lastSeen: new Date()
            }
          })
        } else {
          const username = user.email!.split('@')[0] + Math.random().toString(36).substr(2, 4)
          await prisma.user.create({
            data: {
              email: user.email!,
              username,
              name: user.name || username,
              avatar: sanitizeAvatarForToken(user.image) || null,
              isOnline: true,
              lastSeen: new Date()
            }
          })
        }
      }
      return true
    }
  },
  pages: {
    signIn: '/auth/signin',
  },
}

export default NextAuth(authOptions)