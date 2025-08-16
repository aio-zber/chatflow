import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '../../auth/[...nextauth]';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    try {
      const devices = await prisma.device.findMany({
        where: { userId: session.user.id },
        orderBy: [
          { isPrimary: 'desc' },
          { lastSeen: 'desc' }
        ],
        select: {
          id: true,
          name: true,
          registrationId: true,
          isPrimary: true,
          createdAt: true,
          lastSeen: true,
          _count: {
            select: {
              oneTimePreKeys: {
                where: { usedAt: null }
              }
            }
          }
        }
      });

      const formattedDevices = devices.map(device => ({
        id: device.id,
        name: device.name,
        registrationId: device.registrationId,
        isPrimary: device.isPrimary,
        createdAt: device.createdAt,
        lastSeen: device.lastSeen,
        availablePreKeys: device._count.oneTimePreKeys
      }));

      res.status(200).json({ devices: formattedDevices });

    } catch (error) {
      console.error('List devices error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }

  } else if (req.method === 'POST') {
    // Register new device - this would typically be called during device setup
    try {
      const { deviceName } = req.body;

      // Count existing devices
      const deviceCount = await prisma.device.count({
        where: { userId: session.user.id }
      });

      if (deviceCount >= 10) {
        return res.status(429).json({ error: 'Device limit exceeded (max 10 devices)' });
      }

      // This endpoint just reserves a device slot
      // The actual key upload happens via /api/e2ee/keys/upload
      const deviceId = crypto.randomUUID();

      res.status(201).json({
        deviceId,
        message: 'Device slot reserved. Upload keys to complete registration.'
      });

    } catch (error) {
      console.error('Reserve device error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }

  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}