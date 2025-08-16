export interface EncryptedAttachment {
  encryptedData: Uint8Array;
  key: Uint8Array;
  digest: string;
  originalSize: number;
}

export interface AttachmentDecryptionKey {
  key: Uint8Array;
  digest: string;
  originalSize: number;
}

export class AttachmentCrypto {
  
  async encryptFile(file: File): Promise<EncryptedAttachment> {
    // Generate random AES-256-GCM key
    const key = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    // Import key for WebCrypto
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      'AES-GCM',
      false,
      ['encrypt']
    );
    
    // Read file data
    const fileData = new Uint8Array(await file.arrayBuffer());
    const originalSize = fileData.length;
    
    // Encrypt
    const encryptedData = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      fileData
    );
    
    // Prepend IV to encrypted data
    const result = new Uint8Array(iv.length + encryptedData.byteLength);
    result.set(iv);
    result.set(new Uint8Array(encryptedData), iv.length);
    
    // Calculate digest of encrypted data
    const digest = await crypto.subtle.digest('SHA-256', result);
    const digestHex = Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return {
      encryptedData: result,
      key,
      digest: digestHex,
      originalSize
    };
  }

  async decryptFile(
    encryptedData: Uint8Array,
    decryptionKey: AttachmentDecryptionKey,
    originalMimeType: string
  ): Promise<Blob> {
    // Verify digest
    const computedDigest = await crypto.subtle.digest('SHA-256', encryptedData);
    const computedDigestHex = Array.from(new Uint8Array(computedDigest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    if (computedDigestHex !== decryptionKey.digest) {
      throw new Error('Attachment integrity check failed - file may be corrupted');
    }
    
    // Extract IV and ciphertext
    const iv = encryptedData.slice(0, 12);
    const ciphertext = encryptedData.slice(12);
    
    // Import key for WebCrypto
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      decryptionKey.key,
      'AES-GCM',
      false,
      ['decrypt']
    );
    
    // Decrypt
    const decryptedData = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext
    );
    
    // Verify size matches expected
    if (decryptedData.byteLength !== decryptionKey.originalSize) {
      throw new Error('Decrypted file size mismatch');
    }
    
    return new Blob([decryptedData], { type: originalMimeType });
  }

  async uploadEncryptedFile(
    encryptedData: Uint8Array, 
    digest: string, 
    mimeType: string,
    originalFilename: string
  ): Promise<string> {
    const formData = new FormData();
    formData.append('file', new Blob([encryptedData]), 'encrypted_file');
    formData.append('digest', digest);
    formData.append('mimeType', mimeType);
    formData.append('originalFilename', originalFilename);
    
    const authToken = localStorage.getItem('auth_token') || await this.getAuthToken();
    
    const response = await fetch('/api/e2ee/attachments/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      body: formData
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    return result.attachmentId;
  }

  async downloadEncryptedFile(attachmentId: string): Promise<{
    data: Uint8Array;
    mimeType: string;
    originalFilename: string;
  }> {
    const authToken = localStorage.getItem('auth_token') || await this.getAuthToken();
    
    const response = await fetch(`/api/e2ee/attachments/${attachmentId}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }
    
    // Get metadata from headers
    const mimeType = response.headers.get('X-Original-Mime-Type') || 'application/octet-stream';
    const originalFilename = response.headers.get('X-Original-Filename') || 'unknown';
    
    const data = new Uint8Array(await response.arrayBuffer());
    
    return {
      data,
      mimeType,
      originalFilename
    };
  }

  // Streaming encryption for large files
  async encryptFileStream(
    file: File,
    onProgress?: (bytesProcessed: number, totalBytes: number) => void
  ): Promise<EncryptedAttachment> {
    const chunkSize = 64 * 1024; // 64KB chunks
    const totalBytes = file.size;
    let bytesProcessed = 0;
    
    // Generate key and IV
    const key = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      'AES-GCM',
      false,
      ['encrypt']
    );
    
    const encryptedChunks: Uint8Array[] = [];
    let offset = 0;
    
    // Add IV as first chunk
    encryptedChunks.push(iv);
    
    while (offset < file.size) {
      const chunkEnd = Math.min(offset + chunkSize, file.size);
      const chunk = file.slice(offset, chunkEnd);
      const chunkData = new Uint8Array(await chunk.arrayBuffer());
      
      // Encrypt chunk
      const encryptedChunk = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: crypto.getRandomValues(new Uint8Array(12)) },
        cryptoKey,
        chunkData
      );
      
      encryptedChunks.push(new Uint8Array(encryptedChunk));
      
      offset = chunkEnd;
      bytesProcessed += chunkData.length;
      
      if (onProgress) {
        onProgress(bytesProcessed, totalBytes);
      }
    }
    
    // Combine all chunks
    const totalSize = encryptedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalSize);
    let resultOffset = 0;
    
    for (const chunk of encryptedChunks) {
      result.set(chunk, resultOffset);
      resultOffset += chunk.length;
    }
    
    // Calculate digest
    const digest = await crypto.subtle.digest('SHA-256', result);
    const digestHex = Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return {
      encryptedData: result,
      key,
      digest: digestHex,
      originalSize: file.size
    };
  }

  // Create decryption key that can be shared via encrypted message
  createDecryptionKey(encryptedAttachment: EncryptedAttachment): string {
    const keyData = {
      key: Array.from(encryptedAttachment.key),
      digest: encryptedAttachment.digest,
      originalSize: encryptedAttachment.originalSize
    };
    
    return JSON.stringify(keyData);
  }

  // Parse decryption key from string
  parseDecryptionKey(keyString: string): AttachmentDecryptionKey {
    try {
      const keyData = JSON.parse(keyString);
      
      if (!keyData.key || !keyData.digest || typeof keyData.originalSize !== 'number') {
        throw new Error('Invalid key format');
      }
      
      return {
        key: new Uint8Array(keyData.key),
        digest: keyData.digest,
        originalSize: keyData.originalSize
      };
    } catch (error) {
      throw new Error('Failed to parse decryption key: ' + error.message);
    }
  }

  // Generate thumbnail for images (encrypted)
  async generateEncryptedThumbnail(
    file: File,
    maxSize: number = 200
  ): Promise<EncryptedAttachment | null> {
    if (!file.type.startsWith('image/')) {
      return null;
    }
    
    try {
      // Create thumbnail
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      return new Promise((resolve, reject) => {
        img.onload = async () => {
          try {
            // Calculate thumbnail dimensions
            const ratio = Math.min(maxSize / img.width, maxSize / img.height);
            canvas.width = img.width * ratio;
            canvas.height = img.height * ratio;
            
            // Draw scaled image
            ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // Convert to blob
            canvas.toBlob(async (blob) => {
              if (!blob) {
                resolve(null);
                return;
              }
              
              // Encrypt thumbnail
              const thumbnailFile = new File([blob], 'thumbnail.jpg', { type: 'image/jpeg' });
              const encrypted = await this.encryptFile(thumbnailFile);
              resolve(encrypted);
            }, 'image/jpeg', 0.8);
            
          } catch (error) {
            reject(error);
          }
        };
        
        img.onerror = () => resolve(null);
        img.src = URL.createObjectURL(file);
      });
      
    } catch (error) {
      console.warn('Failed to generate thumbnail:', error);
      return null;
    }
  }

  private async getAuthToken(): Promise<string> {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      throw new Error('No authentication token available');
    }
    return token;
  }
}