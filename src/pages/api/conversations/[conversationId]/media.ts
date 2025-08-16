import { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { conversationId } = req.query

  try {
    // First, verify that the user is a participant in this conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId as string,
        participants: {
          some: {
            userId: session.user.id
          }
        }
      }
    })

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found or access denied' })
    }

    // Fetch all messages with attachments in this conversation
    const messages = await prisma.message.findMany({
      where: {
        conversationId: conversationId as string,
        attachments: {
          some: {}
        }
      },
      include: {
        attachments: true,
        sender: {
          select: {
            id: true,
            name: true,
            username: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    // Extract all attachments with metadata
    const mediaItems = messages.flatMap(message => 
      message.attachments.map(attachment => ({
        id: attachment.id,
        fileName: attachment.fileName,
        fileUrl: attachment.fileUrl,
        fileType: attachment.fileType,
        fileSize: attachment.fileSize,
        createdAt: attachment.createdAt.toISOString(),
        messageId: message.id,
        sender: message.sender
      }))
    )

    res.json({ mediaItems })
  } catch (error) {
    console.error('Get media history error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}