import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '../../../auth/[...nextauth]';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { messageId } = req.query;

    if (!messageId || typeof messageId !== 'string') {
      return res.status(400).json({ error: 'Invalid message ID' });
    }

    // Mark the encrypted message as delivered
    await prisma.encryptedMessage.update({
      where: { id: messageId },
      data: { deliveredAt: new Date() }
    });

    res.status(200).json({ success: true });

  } catch (error) {
    console.error('Mark E2EE message delivered error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}