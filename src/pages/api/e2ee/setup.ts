import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/pages/api/auth/[...nextauth]'
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

    const { registrationId, identityKey, signedPreKey, preKeys } = req.body

    if (!registrationId || !identityKey || !signedPreKey || !preKeys) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Create or update the primary device
    const deviceId = `${session.user.id}-primary`
    
    await prisma.$transaction(async (tx) => {
      // Upsert device
      await tx.device.upsert({
        where: { id: deviceId },
        create: {
          id: deviceId,
          userId: session.user.id,
          registrationId,
          identityKey,
          name: 'Primary Device',
          isPrimary: true,
          lastSeen: new Date()
        },
        update: {
          registrationId,
          identityKey,
          lastSeen: new Date()
        }
      })

      // Delete existing keys for this device
      await tx.signedPreKey.deleteMany({
        where: { deviceId }
      })
      await tx.oneTimePreKey.deleteMany({
        where: { deviceId }
      })

      // Create signed prekey
      await tx.signedPreKey.create({
        data: {
          id: `${deviceId}-${signedPreKey.keyId}`,
          deviceId,
          keyId: signedPreKey.keyId,
          publicKey: signedPreKey.publicKey,
          signature: signedPreKey.signature,
          createdAt: new Date()
        }
      })

      // Create prekeys
      await tx.oneTimePreKey.createMany({
        data: preKeys.map((preKey: any) => ({
          id: `${deviceId}-${preKey.keyId}`,
          deviceId,
          keyId: preKey.keyId,
          publicKey: preKey.publicKey,
          createdAt: new Date()
        }))
      })
    })

    res.status(200).json({ 
      success: true, 
      deviceId,
      message: 'E2EE device setup complete' 
    })

  } catch (error) {
    console.error('E2EE setup error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}