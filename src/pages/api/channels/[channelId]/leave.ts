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
    // Check if user is a member
    const membership = await prisma.channelMember.findUnique({
      where: {
        userId_channelId: {
          userId: session.user.id,
          channelId: channelId as string
        }
      },
      include: {
        channel: {
          include: {
            members: true
          }
        }
      }
    })

    if (!membership) {
      return res.status(404).json({ error: 'Not a member of this channel' })
    }

    // Check if user is the only admin
    if (membership.role === 'admin') {
      const adminCount = membership.channel.members.filter(m => m.role === 'admin').length
      if (adminCount === 1 && membership.channel.members.length > 1) {
        return res.status(400).json({ error: 'Cannot leave: you are the only admin. Transfer admin rights first.' })
      }
    }

    // Remove user from channel
    await prisma.channelMember.delete({
      where: {
        userId_channelId: {
          userId: session.user.id,
          channelId: channelId as string
        }
      }
    })

    // If no members left, delete the channel
    const remainingMembers = await prisma.channelMember.count({
      where: { channelId: channelId as string }
    })

    if (remainingMembers === 0) {
      await prisma.channel.delete({
        where: { id: channelId as string }
      })
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Leave channel error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
