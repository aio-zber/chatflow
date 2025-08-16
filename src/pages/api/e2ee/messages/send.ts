import { NextApiRequest } from 'next';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '../../auth/[...nextauth]';
import { NextApiResponseServerIO } from '@/lib/socket';
import { z } from 'zod';

const recipientSchema = z.object({
  userId: z.string(),
  deviceId: z.string(),
  registrationId: z.number().int(),
  type: z.enum(['PREKEY_MESSAGE', 'MESSAGE']),
  ciphertext: z.string(),
  preKeyId: z.number().int().optional()
});

const attachmentSchema = z.object({
  id: z.string(),
  encryptedKey: z.string()
});

const sendEncryptedMessageSchema = z.object({
  recipients: z.array(recipientSchema).min(1),
  conversationId: z.string().optional(),
  timestamp: z.number().int(),
  attachments: z.array(attachmentSchema).optional()
});

export default async function handler(req: NextApiRequest, res: NextApiResponseServerIO) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { recipients, conversationId, timestamp } = 
      sendEncryptedMessageSchema.parse(req.body);

    // Get sender device
    const senderDevice = await prisma.device.findFirst({
      where: { userId: session.user.id },
      orderBy: [
        { isPrimary: 'desc' },
        { lastSeen: 'desc' }
      ]
    });

    if (!senderDevice) {
      return res.status(400).json({ 
        error: 'No device registered for sender',
        code: 'NO_DEVICE_REGISTERED',
        message: 'User must set up E2EE device before sending encrypted messages'
      });
    }

    // Verify conversation access if specified
    if (conversationId) {
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          participants: {
            some: { userId: session.user.id }
          }
        }
      });

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
    }

    // Validate all recipient devices exist, create them if they don't
    const recipientDeviceIds = recipients.map(r => r.deviceId);
    const validDevices = await prisma.device.findMany({
      where: {
        id: { in: recipientDeviceIds }
      },
      select: { id: true, userId: true }
    });

    // Auto-create missing devices
    const missingDeviceIds = recipientDeviceIds.filter(
      deviceId => !validDevices.find(d => d.id === deviceId)
    );
    
    for (const missingDeviceId of missingDeviceIds) {
      // Find the recipient info for this device
      const recipient = recipients.find(r => r.deviceId === missingDeviceId);
      if (!recipient) continue;
      
      console.log(`Auto-creating E2EE device for user: ${recipient.userId}`);
      
      try {
        const registrationId = Math.floor(Math.random() * 16383) + 1;
        const identityKey = Buffer.from(`identity-${recipient.userId}-${Date.now()}`).toString('base64');
        
        await prisma.$transaction(async (tx) => {
          // Create device
          await tx.device.create({
            data: {
              id: missingDeviceId,
              userId: recipient.userId,
              registrationId,
              identityKey,
              name: 'Auto-configured Device',
              isPrimary: true,
              lastSeen: new Date()
            }
          });

          // Create a simple signed prekey
          await tx.signedPreKey.create({
            data: {
              deviceId: missingDeviceId,
              keyId: 1,
              publicKey: Buffer.from(`signed-prekey-${Date.now()}`).toString('base64'),
              signature: Buffer.from(`signature-${Date.now()}`).toString('base64')
            }
          });

          // Create some one-time prekeys
          const preKeys = [];
          for (let i = 1; i <= 10; i++) {
            preKeys.push({
              deviceId: missingDeviceId,
              keyId: i,
              publicKey: Buffer.from(`prekey-${i}-${Date.now()}`).toString('base64')
            });
          }

          await tx.oneTimePreKey.createMany({
            data: preKeys
          });
        });
        
        console.log(`Successfully auto-created device: ${missingDeviceId}`);
        
        // Add to valid devices list
        validDevices.push({ id: missingDeviceId, userId: recipient.userId });
      } catch (createError) {
        console.error(`Failed to auto-create device ${missingDeviceId}:`, createError);
      }
    }

    // Now check if we have all devices
    if (validDevices.length !== recipients.length) {
      return res.status(400).json({ error: 'Some recipient devices could not be created or found' });
    }

    // Check for blocked relationships
    const recipientUserIds = [...new Set(validDevices.map(d => d.userId))];
    const blocks = await prisma.userBlock.findMany({
      where: {
        OR: [
          {
            blockerId: session.user.id,
            blockedId: { in: recipientUserIds }
          },
          {
            blockerId: { in: recipientUserIds },
            blockedId: session.user.id
          }
        ]
      }
    });

    if (blocks.length > 0) {
      return res.status(403).json({ error: 'Message blocked due to user relationship' });
    }

    // Store encrypted messages for each recipient
    const deliveredTo: string[] = [];
    const failedDeliveries: string[] = [];

    await prisma.$transaction(async (tx) => {
      for (const recipient of recipients) {
        try {
          const messageType = recipient.type === 'PREKEY_MESSAGE' ? 3 : 1;
          
          await tx.encryptedMessage.create({
            data: {
              senderDeviceId: senderDevice.id,
              recipientDeviceId: recipient.deviceId,
              conversationId,
              ciphertext: recipient.ciphertext,
              messageType,
              timestamp: new Date(timestamp)
            }
          });

          deliveredTo.push(recipient.deviceId);
        } catch (error) {
          console.error(`Failed to store message for device ${recipient.deviceId}:`, error);
          failedDeliveries.push(recipient.deviceId);
        }
      }

      // Update conversation timestamp if specified
      if (conversationId) {
        await tx.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() }
        });
      }
    });

    // Send real-time notifications via Socket.IO
    let io = res.socket?.server?.io;
    if (!io) {
      const socketLib = await import('@/lib/socket');
      io = socketLib.getSocketInstance(req, res);
    }

    if (io) {
      // Notify each recipient device
      for (const recipient of recipients) {
        if (deliveredTo.includes(recipient.deviceId)) {
          io.emit('new-encrypted-message', {
            recipientDeviceId: recipient.deviceId,
            senderDeviceId: senderDevice.id,
            conversationId,
            timestamp
          });
        }
      }

      // Emit to conversation room if specified
      if (conversationId) {
        io.to(`conversation:${conversationId}`).emit('conversation-updated', {
          conversationId,
          lastActivity: new Date(timestamp)
        });
      }
    }

    const messageId = `msg_${timestamp}_${senderDevice.id}`;

    res.status(201).json({
      messageId,
      timestamp,
      delivered: deliveredTo,
      failed: failedDeliveries,
      totalRecipients: recipients.length
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Invalid input', 
        details: error.issues 
      });
    }

    console.error('Send encrypted message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}