import { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { id } = req.query

  if (req.method === 'GET') {
    try {
      const user = await prisma.user.findUnique({
        where: { id: id as string },
        select: {
          id: true,
          username: true,
          name: true,
          avatar: true,
          bio: true,
          status: true,
          lastSeen: true,
          isOnline: true,
          createdAt: true,
        }
      })

      if (!user) {
        return res.status(404).json({ error: 'User not found' })
      }

      res.json({ user })
    } catch (error) {
      console.error('Get user error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else if (req.method === 'PUT') {
    if (session.user?.id !== id) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    try {
      const { name, bio, status } = req.body

      const user = await prisma.user.update({
        where: { id: id as string },
        data: {
          ...(name && { name }),
          ...(bio !== undefined && { bio }),
          ...(status && { status }),
        },
        select: {
          id: true,
          username: true,
          name: true,
          avatar: true,
          bio: true,
          status: true,
          lastSeen: true,
          isOnline: true,
        }
      })

      res.json({ user })
    } catch (error) {
      console.error('Update user error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}