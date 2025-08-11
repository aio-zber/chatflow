import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]'
import { z } from 'zod'

const markReadSchema = z.object({
  notificationIds: z.array(z.string()),
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method === 'GET') {
    try {
      const { limit = '20', offset = '0', unreadOnly } = req.query

      const notifications = await prisma.notification.findMany({
        where: {
          userId: session.user.id,
          ...(unreadOnly === 'true' && { isRead: false }),
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: parseInt(limit as string),
        skip: parseInt(offset as string),
      })

      const totalUnread = await prisma.notification.count({
        where: {
          userId: session.user.id,
          isRead: false,
        }
      })

      res.status(200).json({
        notifications,
        totalUnread,
        hasMore: notifications.length === parseInt(limit as string),
      })
    } catch (error) {
      console.error('Get notifications error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else if (req.method === 'PUT') {
    try {
      const { notificationIds } = markReadSchema.parse(req.body)

      await prisma.notification.updateMany({
        where: {
          id: { in: notificationIds },
          userId: session.user.id,
        },
        data: {
          isRead: true,
        }
      })

      const totalUnread = await prisma.notification.count({
        where: {
          userId: session.user.id,
          isRead: false,
        }
      })

      res.status(200).json({
        success: true,
        totalUnread,
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.issues })
      }
      console.error('Mark notifications read error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else if (req.method === 'DELETE') {
    try {
      // Mark all notifications as read
      await prisma.notification.updateMany({
        where: {
          userId: session.user.id,
          isRead: false,
        },
        data: {
          isRead: true,
        }
      })

      res.status(200).json({
        success: true,
        totalUnread: 0,
      })
    } catch (error) {
      console.error('Mark all notifications read error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}