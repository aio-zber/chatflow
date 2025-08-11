import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../../auth/[...nextauth]'

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
    // Check if channel exists and is public or user has permission
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

    if (channel.isPrivate) {
      return res.status(403).json({ error: 'Cannot join private channel without invitation' })
    }

    // Check if user is already a member
    if (channel.members.length > 0) {
      return res.status(400).json({ error: 'Already a member of this channel' })
    }

    // Add user to channel
    await prisma.channelMember.create({
      data: {
        userId: session.user.id,
        channelId: channelId as string,
        role: 'member'
      }
    })

    res.json({ success: true })
  } catch (error) {
    console.error('Join channel error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}