import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const blockedUsers = await prisma.userBlock.findMany({
      where: {
        blockerId: session.user.id,
      },
      include: {
        blocked: {
          select: {
            id: true,
            username: true,
            name: true,
            avatar: true,
            status: true,
            isOnline: true,
            lastSeen: true,
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    res.status(200).json({
      blockedUsers: blockedUsers.map(block => ({
        id: block.id,
        blockedAt: block.createdAt,
        user: block.blocked,
      }))
    })
  } catch (error) {
    console.error('Get blocked users error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}