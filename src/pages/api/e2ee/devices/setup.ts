import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import { prisma } from '@/lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { deviceName = 'Primary Device' } = req.body;

    // Generate a simple device setup for demo purposes
    const deviceId = `${session.user.id}-primary`;
    const registrationId = Math.floor(Math.random() * 16383) + 1; // 1-16383
    
    // Create a mock identity key (in real implementation, this would be a proper public key)
    const identityKey = Buffer.from(`identity-${session.user.id}-${Date.now()}`).toString('base64');

    await prisma.$transaction(async (tx) => {
      // Upsert device
      await tx.device.upsert({
        where: { id: deviceId },
        create: {
          id: deviceId,
          userId: session.user.id,
          registrationId,
          identityKey,
          name: deviceName,
          isPrimary: true,
          lastSeen: new Date()
        },
        update: {
          registrationId,
          identityKey,
          name: deviceName,
          lastSeen: new Date()
        }
      });

      // Create a simple signed prekey
      await tx.signedPreKey.deleteMany({
        where: { deviceId }
      });

      await tx.signedPreKey.create({
        data: {
          deviceId,
          keyId: 1,
          publicKey: Buffer.from(`signed-prekey-${Date.now()}`).toString('base64'),
          signature: Buffer.from(`signature-${Date.now()}`).toString('base64')
        }
      });

      // Create some one-time prekeys
      await tx.oneTimePreKey.deleteMany({
        where: { deviceId }
      });

      const preKeys = [];
      for (let i = 1; i <= 10; i++) {
        preKeys.push({
          deviceId,
          keyId: i,
          publicKey: Buffer.from(`prekey-${i}-${Date.now()}`).toString('base64')
        });
      }

      await tx.oneTimePreKey.createMany({
        data: preKeys
      });
    });

    res.status(200).json({
      success: true,
      deviceId,
      message: 'E2EE device setup complete',
      registrationId
    });

  } catch (error) {
    console.error('E2EE device setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}