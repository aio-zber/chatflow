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
    const { userId, deviceId } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Verify the user exists and can be contacted
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if users have blocked each other
    const blockExists = await prisma.userBlock.findFirst({
      where: {
        OR: [
          {
            blockerId: session.user.id,
            blockedId: userId,
          },
          {
            blockerId: userId,
            blockedId: session.user.id,
          }
        ]
      }
    });

    if (blockExists) {
      return res.status(403).json({ error: 'User relationship blocked' });
    }

    // Find target device
    let device;
    if (deviceId) {
      device = await prisma.device.findFirst({
        where: {
          userId,
          id: deviceId as string
        },
        include: {
          signedPreKeys: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      });
    } else {
      // Get primary device or most recent device
      device = await prisma.device.findFirst({
        where: { userId },
        orderBy: [
          { isPrimary: 'desc' },
          { lastSeen: 'desc' }
        ],
        include: {
          signedPreKeys: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      });
    }

    if (!device) {
      return res.status(404).json({ error: 'No devices found for user' });
    }

    if (!device.signedPreKeys.length) {
      return res.status(410).json({ error: 'No signed prekeys available' });
    }

    // Get an unused one-time prekey
    const oneTimePreKey = await prisma.oneTimePreKey.findFirst({
      where: {
        deviceId: device.id,
        usedAt: null
      },
      orderBy: { createdAt: 'asc' }
    });

    // If no one-time prekeys available, that's okay for Signal Protocol
    // The session can still be established with just the signed prekey
    if (!oneTimePreKey) {
      console.warn(`No one-time prekeys available for device ${device.id}`);
    }

    const signedPreKey = device.signedPreKeys[0];

    const response = {
      userId: device.userId,
      deviceId: device.id,
      registrationId: device.registrationId,
      identityKey: device.identityKey,
      signedPreKey: {
        keyId: signedPreKey.keyId,
        publicKey: signedPreKey.publicKey,
        signature: signedPreKey.signature
      },
      ...(oneTimePreKey && {
        preKey: {
          keyId: oneTimePreKey.keyId,
          publicKey: oneTimePreKey.publicKey
        }
      })
    };

    // If we're returning a one-time prekey, mark it as used
    if (oneTimePreKey) {
      await prisma.oneTimePreKey.update({
        where: { id: oneTimePreKey.id },
        data: { usedAt: new Date() }
      });
    }

    res.status(200).json(response);

  } catch (error) {
    console.error('Fetch prekey bundle error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}