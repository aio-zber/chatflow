import { SignalProtocolStore } from './SignalStore';
import { KeyManager, PreKeyBundle } from './KeyManager';
import { MessageCrypto, RecipientInfo } from './MessageCrypto';
import { GroupCrypto } from './GroupCrypto';
import { AttachmentCrypto } from './AttachmentCrypto';
import { getSignalClient } from './SignalClientWrapper';

export interface E2EEMessage {
  content: string;
  attachments?: Array<{
    file: File;
    encryptedKey?: string;
  }>;
  conversationId?: string;
  replyToId?: string;
}

export interface DecryptedMessage {
  content: string;
  senderId: string;
  timestamp: number;
  attachments?: Array<{
    id: string;
    filename: string;
    mimeType: string;
    decryptionKey: string;
  }>;
}

export class E2EEManager {
  private store: SignalProtocolStore;
  private keyManager: KeyManager;
  private messageCrypto: MessageCrypto;
  private groupCrypto: GroupCrypto;
  private attachmentCrypto: AttachmentCrypto;
  private initialized = false;

  constructor() {
    this.store = new SignalProtocolStore();
    this.keyManager = new KeyManager(this.store);
    this.messageCrypto = new MessageCrypto(this.store);
    this.groupCrypto = new GroupCrypto(this.store);
    this.attachmentCrypto = new AttachmentCrypto();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    await this.store.initialize();
    this.initialized = true;
  }

  async setupDevice(deviceName?: string): Promise<{ deviceId: string; success: boolean }> {
    if (!this.initialized) await this.initialize();
    
    try {
      const { deviceId, preKeyBundle } = await this.keyManager.setupDevice(deviceName);
      
      // Upload keys to server
      await this.uploadDeviceKeys(deviceId, preKeyBundle, deviceName);
      
      return { deviceId, success: true };
    } catch (error) {
      console.error('Device setup failed:', error);
      return { deviceId: '', success: false };
    }
  }

  private async uploadDeviceKeys(
    deviceId: string, 
    preKeyBundle: PreKeyBundle, 
    deviceName?: string
  ): Promise<void> {
    const response = await fetch('/api/e2ee/keys/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include', // Include NextAuth cookies
      body: JSON.stringify({
        deviceId,
        deviceName,
        ...preKeyBundle
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Key upload failed: ${error.error}`);
    }
  }

  async sendMessage(message: E2EEMessage, recipients: RecipientInfo[]): Promise<{
    success: boolean;
    delivered: string[];
    failed: string[];
  }> {
    if (!this.initialized) await this.initialize();

    try {
      let messageContent = message.content;
      const attachmentKeys: string[] = [];

      // Handle file attachments
      if (message.attachments && message.attachments.length > 0) {
        for (const attachment of message.attachments) {
          const encrypted = await this.attachmentCrypto.encryptFile(attachment.file);
          const attachmentId = await this.attachmentCrypto.uploadEncryptedFile(
            encrypted.encryptedData,
            encrypted.digest,
            attachment.file.type,
            attachment.file.name
          );
          
          const decryptionKey = this.attachmentCrypto.createDecryptionKey(encrypted);
          attachmentKeys.push(`${attachmentId}:${decryptionKey}`);
        }

        // Append attachment info to message content
        if (attachmentKeys.length > 0) {
          messageContent += '\n\n__ATTACHMENTS__\n' + attachmentKeys.join('\n');
        }
      }

      // Encrypt for all recipients
      const encryptedMessages = await this.messageCrypto.encryptForMultipleDevices(
        recipients,
        messageContent
      );

      // Send to server
      const response = await fetch('/api/e2ee/messages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Include NextAuth cookies
        body: JSON.stringify({
          recipients: encryptedMessages.map(em => ({
            userId: em.userId,
            deviceId: em.deviceId,
            registrationId: em.registrationId,
            type: em.encryptedMessage.type,
            ciphertext: em.encryptedMessage.ciphertext,
            preKeyId: em.encryptedMessage.preKeyId
          })),
          conversationId: message.conversationId,
          timestamp: Date.now()
        })
      });

      if (!response.ok) {
        throw new Error(`Message send failed: ${response.status}`);
      }

      const result = await response.json();
      return {
        success: true,
        delivered: result.delivered || [],
        failed: result.failed || []
      };

    } catch (error) {
      console.error('Send message failed:', error);
      return {
        success: false,
        delivered: [],
        failed: recipients.map(r => r.deviceId)
      };
    }
  }

  async sendGroupMessage(groupId: string, message: E2EEMessage): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (!this.initialized) await this.initialize();

    try {
      // Ensure we have a sender key for this group
      const groupKeyInfo = await this.groupCrypto.getGroupKeyInfo(groupId);
      if (!groupKeyInfo.hasSenderKey) {
        await this.groupCrypto.createSenderKey(groupId);
      }

      let messageContent = message.content;

      // Handle attachments (same as 1:1 messages)
      if (message.attachments && message.attachments.length > 0) {
        const attachmentKeys: string[] = [];
        
        for (const attachment of message.attachments) {
          const encrypted = await this.attachmentCrypto.encryptFile(attachment.file);
          const attachmentId = await this.attachmentCrypto.uploadEncryptedFile(
            encrypted.encryptedData,
            encrypted.digest,
            attachment.file.type,
            attachment.file.name
          );
          
          const decryptionKey = this.attachmentCrypto.createDecryptionKey(encrypted);
          attachmentKeys.push(`${attachmentId}:${decryptionKey}`);
        }

        if (attachmentKeys.length > 0) {
          messageContent += '\n\n__ATTACHMENTS__\n' + attachmentKeys.join('\n');
        }
      }

      // Encrypt with group sender key
      const encryptedMessage = await this.groupCrypto.encryptGroupMessage(groupId, messageContent);

      // Send to server (this would need a group message endpoint)
      const response = await fetch('/api/e2ee/messages/group/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Include NextAuth cookies
        body: JSON.stringify({
          groupId,
          ciphertext: encryptedMessage,
          timestamp: Date.now()
        })
      });

      if (!response.ok) {
        throw new Error(`Group message send failed: ${response.status}`);
      }

      return { success: true };

    } catch (error) {
      console.error('Send group message failed:', error);
      return { 
        success: false,
        error: error.message
      };
    }
  }

  async pollMessages(): Promise<DecryptedMessage[]> {
    if (!this.initialized) await this.initialize();

    try {
      const response = await fetch('/api/e2ee/messages/poll', {
        credentials: 'include' // Include NextAuth cookies
      });

      if (!response.ok) {
        throw new Error(`Poll messages failed: ${response.status}`);
      }

      const data = await response.json();
      const decryptedMessages: DecryptedMessage[] = [];

      for (const msg of data.messages) {
        try {
          let decryptedContent: string;

          if (msg.groupId) {
            // Group message
            decryptedContent = await this.groupCrypto.decryptGroupMessage(
              msg.groupId,
              msg.senderId,
              msg.ciphertext
            );
          } else {
            // 1:1 message
            decryptedContent = await this.messageCrypto.decryptMessage(
              msg.senderId,
              msg.senderDeviceId,
              {
                type: msg.type,
                ciphertext: msg.ciphertext
              }
            );
          }

          // Parse attachments if present
          const attachments = this.parseAttachments(decryptedContent);
          const content = this.stripAttachments(decryptedContent);

          decryptedMessages.push({
            content,
            senderId: msg.senderId,
            timestamp: msg.timestamp,
            attachments
          });

          // Acknowledge message
          await this.acknowledgeMessage(msg.id);

        } catch (error) {
          console.error(`Failed to decrypt message ${msg.id}:`, error);
          // Continue with other messages
        }
      }

      return decryptedMessages;

    } catch (error) {
      console.error('Poll messages failed:', error);
      return [];
    }
  }

  private parseAttachments(content: string): Array<{
    id: string;
    filename: string;
    mimeType: string;
    decryptionKey: string;
  }> | undefined {
    const attachmentSection = content.split('\n\n__ATTACHMENTS__\n')[1];
    if (!attachmentSection) return undefined;

    const attachments = [];
    const lines = attachmentSection.split('\n');

    for (const line of lines) {
      if (line.includes(':')) {
        const [attachmentId, decryptionKey] = line.split(':', 2);
        // In a real implementation, you'd fetch metadata from the server
        attachments.push({
          id: attachmentId,
          filename: 'attachment', // Placeholder
          mimeType: 'application/octet-stream', // Placeholder
          decryptionKey
        });
      }
    }

    return attachments.length > 0 ? attachments : undefined;
  }

  private stripAttachments(content: string): string {
    return content.split('\n\n__ATTACHMENTS__\n')[0];
  }

  private async acknowledgeMessage(messageId: string): Promise<void> {
    try {
      await fetch(`/api/e2ee/messages/${messageId}/ack`, {
        method: 'DELETE',
        credentials: 'include' // Include NextAuth cookies
      });
    } catch (error) {
      console.warn('Failed to acknowledge message:', error);
    }
  }

  async downloadAttachment(attachmentId: string, decryptionKey: string): Promise<Blob> {
    const { data, mimeType } = await this.attachmentCrypto.downloadEncryptedFile(attachmentId);
    const key = this.attachmentCrypto.parseDecryptionKey(decryptionKey);
    return this.attachmentCrypto.decryptFile(data, key, mimeType);
  }

  async generateSafetyNumber(userId: string): Promise<string> {
    if (!this.initialized) await this.initialize();

    // Get their identity key
    const response = await fetch(`/api/e2ee/keys/${userId}`, {
      credentials: 'include' // Include NextAuth cookies
    });

    if (!response.ok) {
      throw new Error('Failed to fetch user identity key');
    }

    const keyBundle = await response.json();
    const SignalClient = getSignalClient();
    const remoteIdentityKey = SignalClient.PublicKey.deserialize(Buffer.from(keyBundle.identityKey, 'base64'));

    const currentUserId = await this.getCurrentUserId();
    return this.keyManager.generateSafetyNumber(currentUserId, userId, remoteIdentityKey);
  }

  async getDevices(): Promise<Array<{
    id: string;
    name: string;
    isPrimary: boolean;
    lastSeen: Date;
    availablePreKeys: number;
  }>> {
    const response = await fetch('/api/e2ee/devices', {
      credentials: 'include' // Include NextAuth cookies
    });

    if (!response.ok) {
      throw new Error('Failed to fetch devices');
    }

    const data = await response.json();
    return data.devices;
  }

  private async getCurrentUserId(): Promise<string> {
    // Get current user ID from NextAuth session
    const response = await fetch('/api/auth/session', {
      credentials: 'include'
    });
    
    if (!response.ok) {
      throw new Error('Failed to get user session');
    }
    
    const session = await response.json();
    if (!session?.user?.id) {
      throw new Error('User not authenticated');
    }
    
    return session.user.id;
  }

  // Utility methods for UI integration
  async isE2EEAvailable(): Promise<boolean> {
    try {
      if (!this.initialized) await this.initialize();
      const devices = await this.getDevices();
      return devices.length > 0;
    } catch {
      return false;
    }
  }

  async getEncryptionStatus(conversationId: string): Promise<{
    encrypted: boolean;
    reason?: string;
  }> {
    if (!await this.isE2EEAvailable()) {
      return { encrypted: false, reason: 'No E2EE device registered' };
    }

    // Additional checks could be added here
    return { encrypted: true };
  }
}