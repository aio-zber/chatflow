import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]'
import { z } from 'zod'

const settingsSchema = z.object({
  messages: z.boolean(),
  mentions: z.boolean(),
  reactions: z.boolean(),
  groupUpdates: z.boolean(),
  sounds: z.boolean(),
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method === 'GET') {
    try {
      // Get user notification settings
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          // Add notification preferences to user model if needed
          id: true,
        }
      })

      if (!user) {
        return res.status(404).json({ error: 'User not found' })
      }

      // For now, return default settings
      // In production, these would be stored in the database
      const defaultSettings = {
        messages: true,
        mentions: true,
        reactions: true,
        groupUpdates: true,
        sounds: true,
      }

      res.json({ settings: defaultSettings })
    } catch (error) {
      console.error('Get notification settings error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else if (req.method === 'PUT') {
    try {
      const settings = settingsSchema.parse(req.body)

      // Store notification settings
      // For now, we'll just validate and return success
      // In production, these would be stored in the database
      
      res.json({ success: true, settings })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.issues })
      }
      console.error('Update notification settings error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}
