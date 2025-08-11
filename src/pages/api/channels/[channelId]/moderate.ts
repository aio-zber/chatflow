import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../../auth/[...nextauth]'
import { z } from 'zod'

const moderateSchema = z.object({
  action: z.enum(['kick', 'ban', 'promote', 'demote', 'invite']),
  targetUserId: z.string(),
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { channelId } = req.query

  try {
    const { action, targetUserId } = moderateSchema.parse(req.body)

    // Check if user is admin or channel creator
    const userMembership = await prisma.channelMember.findUnique({
      where: {
        userId_channelId: {
          userId: session.user.id,
          channelId: channelId as string
        }
      },
      include: {
        channel: {
          include: {
            creator: true
          }
        }
      }
    })

    if (!userMembership || (userMembership.role !== 'admin' && userMembership.channel.createdBy !== session.user.id)) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    const targetMembership = await prisma.channelMember.findUnique({
      where: {
        userId_channelId: {
          userId: targetUserId,
          channelId: channelId as string
        }
      }
    })

    switch (action) {
      case 'kick':
        if (!targetMembership) {
          return res.status(404).json({ error: 'User is not a member' })
        }
        if (targetMembership.role === 'admin' && userMembership.channel.createdBy !== session.user.id) {
          return res.status(403).json({ error: 'Cannot kick another admin' })
        }
        await prisma.channelMember.delete({
          where: {
            userId_channelId: {
              userId: targetUserId,
              channelId: channelId as string
            }
          }
        })
        break

      case 'promote':
        if (!targetMembership) {
          return res.status(404).json({ error: 'User is not a member' })
        }
        if (targetMembership.role === 'admin') {
          return res.status(400).json({ error: 'User is already an admin' })
        }
        await prisma.channelMember.update({
          where: {
            userId_channelId: {
              userId: targetUserId,
              channelId: channelId as string
            }
          },
          data: { role: 'admin' }
        })
        break

      case 'demote':
        if (!targetMembership) {
          return res.status(404).json({ error: 'User is not a member' })
        }
        if (targetMembership.role !== 'admin') {
          return res.status(400).json({ error: 'User is not an admin' })
        }
        if (userMembership.channel.createdBy !== session.user.id) {
          return res.status(403).json({ error: 'Only channel creator can demote admins' })
        }
        await prisma.channelMember.update({
          where: {
            userId_channelId: {
              userId: targetUserId,
              channelId: channelId as string
            }
          },
          data: { role: 'member' }
        })
        break

      case 'invite':
        if (targetMembership) {
          return res.status(400).json({ error: 'User is already a member' })
        }
        // Check if user exists
        const targetUser = await prisma.user.findUnique({
          where: { id: targetUserId }
        })
        if (!targetUser) {
          return res.status(404).json({ error: 'User not found' })
        }
        await prisma.channelMember.create({
          data: {
            userId: targetUserId,
            channelId: channelId as string,
            role: 'member'
          }
        })
        break

      default:
        return res.status(400).json({ error: 'Invalid action' })
    }

    res.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.issues })
    }
    console.error('Channel moderation error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
