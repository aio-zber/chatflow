import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]'
import { prisma } from '@/lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { q, limit = '10' } = req.query
  const searchQuery = q as string
  const searchLimit = Math.min(parseInt(limit as string), 50) // Max 50 results

  if (!searchQuery || searchQuery.trim().length < 1) {
    return res.status(400).json({ error: 'Search query is required' })
  }

  try {
    // Get blocked user IDs to exclude from search
    const blockedUsers = await prisma.userBlock.findMany({
      where: {
        OR: [
          { blockerId: session.user.id },
          { blockedId: session.user.id }
        ]
      },
      select: {
        blockerId: true,
        blockedId: true
      }
    })

    const blockedUserIds = new Set<string>()
    blockedUsers.forEach(block => {
      blockedUserIds.add(block.blockerId)
      blockedUserIds.add(block.blockedId)
    })
    
    // Add current user to excluded list
    blockedUserIds.add(session.user.id)

    // Search for users
    const users = await prisma.user.findMany({
      where: {
        AND: [
          {
            id: {
              notIn: Array.from(blockedUserIds)
            }
          },
          {
            OR: [
              {
                username: {
                  contains: searchQuery,
                  mode: 'insensitive'
                }
              },
              {
                name: {
                  contains: searchQuery,
                  mode: 'insensitive'
                }
              },
              {
                email: {
                  contains: searchQuery,
                  mode: 'insensitive'
                }
              }
            ]
          }
        ]
      },
      select: {
        id: true,
        username: true,
        name: true,
        avatar: true,
        isOnline: true,
        lastSeen: true
      },
      orderBy: [
        { isOnline: 'desc' },
        { lastSeen: 'desc' },
        { name: 'asc' }
      ],
      take: searchLimit
    })

    return res.status(200).json({ users })
  } catch (error) {
    console.error('Error searching users:', error)
    return res.status(500).json({ error: 'Failed to search users' })
  }
}