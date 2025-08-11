import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]'
import { z } from 'zod'
import { generalLimiter } from '@/lib/rateLimit'

const createChannelSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  isPrivate: z.boolean().default(false),
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Rate limiting
  const rateLimitResult = generalLimiter.check(req, 10)
  if (!rateLimitResult.success) {
    return res.status(429).json({ error: 'Too many requests' })
  }

  if (req.method === 'GET') {
    try {
      // Get all public channels and private channels user is a member of
      const channels = await prisma.channel.findMany({
        where: {
          OR: [
            { isPrivate: false },
            {
              isPrivate: true,
              members: {
                some: { userId: session.user.id }
              }
            }
          ]
        },
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              name: true,
              avatar: true,
            }
          },
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  name: true,
                  avatar: true,
                  isOnline: true,
                }
              }
            }
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              sender: {
                select: {
                  username: true,
                  name: true,
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      })

      // Add unread count for each channel
      const channelsWithUnread = await Promise.all(
        channels.map(async (channel) => {
          const memberInfo = channel.members.find(m => m.userId === session.user.id)
          const unreadCount = await prisma.message.count({
            where: {
              channelId: channel.id,
              createdAt: {
                gt: memberInfo?.joinedAt || new Date(0)
              },
              senderId: { not: session.user.id }
            }
          })

          return {
            ...channel,
            unreadCount,
            memberCount: channel.members.length,
            isMember: !!memberInfo,
            userRole: memberInfo?.role || null,
          }
        })
      )

      res.json({ channels: channelsWithUnread })
    } catch (error) {
      console.error('Get channels error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else if (req.method === 'POST') {
    try {
      const { name, description, isPrivate } = createChannelSchema.parse(req.body)

      // Check if channel name already exists
      const existingChannel = await prisma.channel.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } }
      })

      if (existingChannel) {
        return res.status(400).json({ error: 'Channel name already exists' })
      }

      const channel = await prisma.channel.create({
        data: {
          name,
          description,
          isPrivate,
          createdBy: session.user.id,
          members: {
            create: {
              userId: session.user.id,
              role: 'admin'
            }
          }
        },
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              name: true,
              avatar: true,
            }
          },
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  name: true,
                  avatar: true,
                  isOnline: true,
                }
              }
            }
          }
        }
      })

      res.status(201).json({ channel })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.issues })
      }
      console.error('Create channel error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}