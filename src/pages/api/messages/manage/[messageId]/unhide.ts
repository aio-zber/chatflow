import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]'
import { prisma } from '@/lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { messageId } = req.query
    if (!messageId || typeof messageId !== 'string') {
      return res.status(400).json({ error: 'Message ID is required' })
    }

    // Check if message is hidden for this user
    const hiddenMessage = await prisma.messageHidden.findUnique({
      where: {
        messageId_userId: {
          messageId,
          userId: session.user.id
        }
      }
    })

    if (!hiddenMessage) {
      return res.status(404).json({ error: 'Message is not hidden for you' })
    }

    // Unhide the message
    await prisma.messageHidden.delete({
      where: {
        messageId_userId: {
          messageId,
          userId: session.user.id
        }
      }
    })

    return res.status(200).json({ success: true, message: 'Message restored to your view' })
  } catch (error) {
    console.error('Error unhiding message:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}