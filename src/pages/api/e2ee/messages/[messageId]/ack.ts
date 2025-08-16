import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '../../../auth/[...nextauth]';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { messageId } = req.query;

    if (!messageId || typeof messageId !== 'string') {
      return res.status(400).json({ error: 'Message ID is required' });
    }

    // Get user's devices
    const userDevices = await prisma.device.findMany({
      where: { userId: session.user.id },
      select: { id: true }
    });

    const deviceIds = userDevices.map(d => d.id);

    if (deviceIds.length === 0) {
      return res.status(400).json({ error: 'No devices registered' });
    }

    // Find and mark message as delivered
    const message = await prisma.encryptedMessage.findFirst({
      where: {
        id: messageId,
        recipientDeviceId: { in: deviceIds },
        deliveredAt: null
      }
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found or already acknowledged' });
    }

    // Mark as delivered
    await prisma.encryptedMessage.update({
      where: { id: message.id },
      data: { deliveredAt: new Date() }
    });

    res.status(204).end();

  } catch (error) {
    console.error('Acknowledge message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}