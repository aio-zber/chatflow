import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '../auth/[...nextauth]'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    // Delete all notifications for the user
    await prisma.notification.deleteMany({
      where: {
        userId: session.user.id,
      }
    })

    res.json({ success: true })
  } catch (error) {
    console.error('Clear notifications error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
