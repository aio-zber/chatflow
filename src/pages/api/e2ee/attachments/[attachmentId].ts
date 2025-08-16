import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '../../auth/[...nextauth]';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { attachmentId } = req.query;

    if (!attachmentId || typeof attachmentId !== 'string') {
      return res.status(400).json({ error: 'Attachment ID is required' });
    }

    // Get attachment metadata
    const attachment = await prisma.encryptedAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        uploaderDevice: {
          select: { userId: true }
        }
      }
    });

    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    // TODO: In a real implementation, you'd verify the user has access to this attachment
    // This could be done by checking if they're in the same conversation as the uploader
    // For now, we'll allow access to any authenticated user

    // Read encrypted file
    const filePath = path.join(process.cwd(), 'public', attachment.ciphertextUrl);
    
    let fileData: Buffer;
    try {
      fileData = await readFile(filePath);
    } catch (error) {
      console.error('File not found:', filePath);
      return res.status(404).json({ error: 'File not found on server' });
    }

    // Set headers for download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', fileData.length);
    res.setHeader('X-Original-Mime-Type', attachment.mimeType);
    res.setHeader('X-Original-Filename', attachment.filename);
    res.setHeader('X-Digest-SHA256', attachment.digestSha256);
    
    // Handle range requests for streaming
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileData.length - 1;
      
      if (start >= fileData.length || end >= fileData.length || start > end) {
        res.status(416).json({ error: 'Range not satisfiable' });
        return;
      }
      
      const chunkSize = (end - start) + 1;
      const chunk = fileData.slice(start, end + 1);
      
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileData.length}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunkSize);
      res.end(chunk);
    } else {
      // Send entire file
      res.status(200);
      res.end(fileData);
    }

  } catch (error) {
    console.error('Download encrypted attachment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}