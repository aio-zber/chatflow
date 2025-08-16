import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '../../auth/[...nextauth]';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

export const config = {
  api: {
    bodyParser: false,
  },
};

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get uploader device
    const uploaderDevice = await prisma.device.findFirst({
      where: { userId: session.user.id },
      orderBy: [
        { isPrimary: 'desc' },
        { lastSeen: 'desc' }
      ]
    });

    if (!uploaderDevice) {
      return res.status(400).json({ error: 'No device registered for uploader' });
    }

    // Parse multipart form data
    const form = formidable({
      maxFileSize: 50 * 1024 * 1024, // 50MB limit
      keepExtensions: true,
    });

    const [fields, files] = await form.parse(req);
    
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    const digest = Array.isArray(fields.digest) ? fields.digest[0] : fields.digest;
    const mimeType = Array.isArray(fields.mimeType) ? fields.mimeType[0] : fields.mimeType;
    const originalFilename = Array.isArray(fields.originalFilename) ? fields.originalFilename[0] : fields.originalFilename;

    if (!file || !digest || !mimeType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify file exists and read it
    const fileData = await readFile(file.filepath);
    
    // Verify digest
    const computedDigest = await crypto.subtle.digest('SHA-256', fileData);
    const computedDigestHex = Array.from(new Uint8Array(computedDigest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (computedDigestHex !== digest) {
      return res.status(400).json({ error: 'File integrity check failed' });
    }

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(process.cwd(), 'public', 'encrypted-uploads');
    try {
      await mkdir(uploadsDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    // Generate unique filename
    const attachmentId = crypto.randomUUID();
    const fileExtension = path.extname(file.originalFilename || '');
    const storedFilename = `${attachmentId}${fileExtension}`;
    const filePath = path.join(uploadsDir, storedFilename);

    // Save encrypted file
    await writeFile(filePath, fileData);

    // Store metadata in database
    const attachment = await prisma.encryptedAttachment.create({
      data: {
        id: attachmentId,
        uploaderDeviceId: uploaderDevice.id,
        filename: originalFilename || file.originalFilename || 'unknown',
        mimeType,
        sizeBytes: BigInt(fileData.length),
        digestSha256: digest,
        ciphertextUrl: `/encrypted-uploads/${storedFilename}`
      }
    });

    res.status(201).json({
      attachmentId: attachment.id,
      url: `/api/e2ee/attachments/${attachment.id}`,
      digest,
      size: fileData.length
    });

  } catch (error) {
    console.error('Upload encrypted attachment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}