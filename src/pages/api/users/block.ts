import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]'
import { z } from 'zod'

const blockUserSchema = z.object({
  userId: z.string(),
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { userId } = blockUserSchema.parse(req.body)

    if (userId === session.user.id) {
      return res.status(400).json({ error: 'Cannot block yourself' })
    }

    // Verify the user exists
    const userToBlock = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, name: true }
    })

    if (!userToBlock) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (req.method === 'POST') {
      // Block user
      const block = await prisma.userBlock.create({
        data: {
          blockerId: session.user.id,
          blockedId: userId,
        },
        include: {
          blocked: {
            select: {
              id: true,
              username: true,
              name: true,
              avatar: true,
            }
          }
        }
      })

      return res.status(201).json({ 
        success: true,
        block,
        message: `${userToBlock.name || userToBlock.username} has been blocked`
      })

    } else if (req.method === 'DELETE') {
      // Unblock user
      const deleted = await prisma.userBlock.deleteMany({
        where: {
          blockerId: session.user.id,
          blockedId: userId,
        }
      })

      if (deleted.count === 0) {
        return res.status(404).json({ error: 'User is not blocked' })
      }

      return res.status(200).json({ 
        success: true,
        message: `${userToBlock.name || userToBlock.username} has been unblocked`
      })

    } else {
      return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.issues })
    }
    console.error('Block user error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}