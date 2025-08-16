import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '../../auth/[...nextauth]';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { since, limit = '50' } = req.query;
    const limitNum = Math.min(parseInt(limit as string) || 50, 100);

    // Get user's devices
    const userDevices = await prisma.device.findMany({
      where: { userId: session.user.id },
      select: { id: true }
    });

    const deviceIds = userDevices.map(d => d.id);

    if (deviceIds.length === 0) {
      // Return empty response instead of error - user hasn't set up E2EE yet
      return res.status(200).json({
        messages: [],
        hasMore: false,
        nextCursor: undefined,
        count: 0,
        status: 'no_devices'
      });
    }

    // Build query filters
    const whereClause: {
      recipientDeviceId: { in: string[] };
      deliveredAt: null;
      timestamp?: { gt: Date };
    } = {
      recipientDeviceId: { in: deviceIds },
      deliveredAt: null // Only undelivered messages
    };

    if (since) {
      const sinceDate = new Date(parseInt(since as string));
      whereClause.timestamp = { gt: sinceDate };
    }

    // Fetch encrypted messages
    const messages = await prisma.encryptedMessage.findMany({
      where: whereClause,
      orderBy: { timestamp: 'asc' },
      take: limitNum,
      include: {
        senderDevice: {
          select: {
            id: true,
            userId: true,
            user: {
              select: {
                id: true,
                username: true,
                name: true,
                avatar: true
              }
            }
          }
        },
        conversation: {
          select: {
            id: true,
            name: true,
            isGroup: true
          }
        }
      }
    });

    // Check if there are more messages
    const hasMore = messages.length === limitNum;
    const nextCursor = hasMore ? messages[messages.length - 1].timestamp.getTime() : undefined;

    // Format response
    const formattedMessages = messages.map(msg => ({
      id: msg.id,
      senderId: msg.senderDevice.userId,
      senderDeviceId: msg.senderDeviceId,
      senderInfo: {
        username: msg.senderDevice.user.username,
        name: msg.senderDevice.user.name,
        avatar: msg.senderDevice.user.avatar
      },
      conversationId: msg.conversationId,
      conversationInfo: msg.conversation ? {
        name: msg.conversation.name,
        isGroup: msg.conversation.isGroup
      } : null,
      type: msg.messageType === 3 ? 'PREKEY_MESSAGE' : 'MESSAGE',
      ciphertext: msg.ciphertext,
      timestamp: msg.timestamp.getTime(),
      recipientDeviceId: msg.recipientDeviceId
    }));

    res.status(200).json({
      messages: formattedMessages,
      hasMore,
      nextCursor,
      count: messages.length
    });

  } catch (error) {
    console.error('Poll messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}