import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../../auth/[...nextauth]'
import { z } from 'zod'

const updateChannelSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(500).optional(),
  isPrivate: z.boolean().optional(),
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { channelId } = req.query

  if (req.method === 'GET') {
    try {
      const channel = await prisma.channel.findUnique({
        where: { id: channelId as string },
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
            },
            orderBy: [
              { role: 'desc' }, // admins first
              { joinedAt: 'asc' }
            ]
          }
        }
      })

      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' })
      }

      // Check if user is a member
      const userMembership = channel.members.find(m => m.userId === session.user.id)
      if (!userMembership) {
        return res.status(403).json({ error: 'Not a member of this channel' })
      }

      res.json({ 
        channel: {
          ...channel,
          userRole: userMembership.role,
          canModerate: userMembership.role === 'admin' || channel.createdBy === session.user.id
        }
      })
    } catch (error) {
      console.error('Get channel settings error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else if (req.method === 'PATCH') {
    try {
      const updates = updateChannelSchema.parse(req.body)

      // Check if user is admin or creator
      const channel = await prisma.channel.findUnique({
        where: { id: channelId as string },
        include: {
          members: {
            where: { userId: session.user.id }
          }
        }
      })

      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' })
      }

      const userMembership = channel.members[0]
      if (!userMembership || (userMembership.role !== 'admin' && channel.createdBy !== session.user.id)) {
        return res.status(403).json({ error: 'Insufficient permissions' })
      }

      // Check if new name is unique (if provided)
      if (updates.name && updates.name !== channel.name) {
        const existingChannel = await prisma.channel.findFirst({
          where: { 
            name: { equals: updates.name, mode: 'insensitive' },
            id: { not: channelId as string }
          }
        })
        if (existingChannel) {
          return res.status(400).json({ error: 'Channel name already exists' })
        }
      }

      const updatedChannel = await prisma.channel.update({
        where: { id: channelId as string },
        data: updates,
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              name: true,
              avatar: true,
            }
          }
        }
      })

      res.json({ channel: updatedChannel })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.issues })
      }
      console.error('Update channel settings error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}
