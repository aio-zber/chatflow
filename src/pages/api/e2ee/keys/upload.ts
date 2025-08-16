import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '../../auth/[...nextauth]';
import { z } from 'zod';

const preKeySchema = z.object({
  keyId: z.number().int().min(0),
  publicKey: z.string().min(1)
});

const signedPreKeySchema = z.object({
  keyId: z.number().int().min(0),
  publicKey: z.string().min(1),
  signature: z.string().min(1)
});

const uploadKeysSchema = z.object({
  deviceId: z.string().uuid(),
  registrationId: z.number().int().min(0).max(16383),
  identityKey: z.string().min(1),
  signedPreKey: signedPreKeySchema,
  preKeys: z.array(preKeySchema).min(1).max(100),
  deviceName: z.string().optional(),
  isPrimary: z.boolean().optional().default(false)
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const {
      deviceId,
      registrationId,
      identityKey,
      signedPreKey,
      preKeys,
      deviceName,
      isPrimary
    } = uploadKeysSchema.parse(req.body);

    // Check if device already exists
    const existingDevice = await prisma.device.findUnique({
      where: { id: deviceId }
    });

    if (existingDevice) {
      return res.status(409).json({ error: 'Device already exists' });
    }

    // Check registration ID uniqueness for this user
    const existingRegistration = await prisma.device.findFirst({
      where: {
        userId: session.user.id,
        registrationId
      }
    });

    if (existingRegistration) {
      return res.status(409).json({ error: 'Registration ID already in use' });
    }

    // Check device limit (max 10 devices per user)
    const deviceCount = await prisma.device.count({
      where: { userId: session.user.id }
    });

    if (deviceCount >= 10) {
      return res.status(429).json({ error: 'Device limit exceeded' });
    }

    // If this is the first device, make it primary
    const shouldBePrimary = isPrimary || deviceCount === 0;

    // Use transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Create device
      const device = await tx.device.create({
        data: {
          id: deviceId,
          userId: session.user.id,
          registrationId,
          identityKey,
          name: deviceName || `Device ${deviceCount + 1}`,
          isPrimary: shouldBePrimary,
          lastSeen: new Date()
        }
      });

      // Create signed prekey
      await tx.signedPreKey.create({
        data: {
          deviceId: device.id,
          keyId: signedPreKey.keyId,
          publicKey: signedPreKey.publicKey,
          signature: signedPreKey.signature
        }
      });

      // Create one-time prekeys
      const preKeyData = preKeys.map(pk => ({
        deviceId: device.id,
        keyId: pk.keyId,
        publicKey: pk.publicKey
      }));

      await tx.oneTimePreKey.createMany({
        data: preKeyData
      });

      return device;
    });

    res.status(201).json({
      success: true,
      deviceId: result.id,
      preKeysUploaded: preKeys.length,
      signedPreKeyId: signedPreKey.keyId
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Invalid input', 
        details: error.issues 
      });
    }

    console.error('Keys upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}