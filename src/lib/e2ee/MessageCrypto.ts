import { SafeSignalClient, isSignalClientAvailable, getSignalClient } from './SignalClientWrapper';
import { SignalProtocolStore } from './SignalStore';

export interface EncryptedMessage {
  type: 'PREKEY_MESSAGE' | 'MESSAGE';
  ciphertext: string;
  registrationId?: number;
  preKeyId?: number;
}

export interface RecipientInfo {
  userId: string;
  deviceId: string;
  registrationId: number;
}

export class MessageCrypto {
  constructor(private store: SignalProtocolStore) {
    if (!isSignalClientAvailable()) {
      throw new Error('libsignal-client not available. Call initializeSignalClient() first.');
    }
  }

  async encryptMessage(
    recipientUserId: string,
    recipientDeviceId: string,
    plaintextMessage: string
  ): Promise<EncryptedMessage> {
    const deviceIdNumber = parseInt(recipientDeviceId);
    const address = SafeSignalClient.createProtocolAddress(recipientUserId, deviceIdNumber);
    
    // Check if we have an existing session
    const existingSession = await this.store.getSession(address);
    
    if (!existingSession) {
      // Need to fetch prekey bundle and establish session
      const preKeyBundle = await this.fetchPreKeyBundle(recipientUserId, recipientDeviceId);
      await this.processPreKeyBundle(address, preKeyBundle);
    }
    
    // Encrypt the message
    const plaintext = Buffer.from(plaintextMessage, 'utf-8');
    const ciphertext = await SafeSignalClient.signalEncrypt(plaintext, address, this.store);
    
    const messageTypes = SafeSignalClient.getCiphertextMessageType();
    const isPreKeyMessage = ciphertext.type() === messageTypes.PreKey;
    
    return {
      type: isPreKeyMessage ? 'PREKEY_MESSAGE' : 'MESSAGE',
      ciphertext: Buffer.from(ciphertext.serialize()).toString('base64'),
      registrationId: isPreKeyMessage ? (await this.store.getLocalRegistrationId()) : undefined
    };
  }

  async decryptMessage(
    senderUserId: string,
    senderDeviceId: string,
    encryptedMessage: EncryptedMessage
  ): Promise<string> {
    const deviceIdNumber = parseInt(senderDeviceId);
    const address = SafeSignalClient.createProtocolAddress(senderUserId, deviceIdNumber);
    const ciphertext = Buffer.from(encryptedMessage.ciphertext, 'base64');
    
    let message: any;
    
    if (encryptedMessage.type === 'PREKEY_MESSAGE') {
      message = SafeSignalClient.deserializePreKeySignalMessage(ciphertext);
    } else {
      message = SafeSignalClient.deserializeSignalMessage(ciphertext);
    }
    
    const plaintext = await SafeSignalClient.signalDecrypt(message, address, this.store);
    return Buffer.from(plaintext).toString('utf-8');
  }

  async encryptForMultipleDevices(
    recipients: RecipientInfo[],
    message: string
  ): Promise<Array<{
    userId: string;
    deviceId: string;
    registrationId: number;
    encryptedMessage: EncryptedMessage;
  }>> {
    const results = [];
    
    for (const recipient of recipients) {
      try {
        const encrypted = await this.encryptMessage(
          recipient.userId,
          recipient.deviceId,
          message
        );
        
        results.push({
          userId: recipient.userId,
          deviceId: recipient.deviceId,
          registrationId: recipient.registrationId,
          encryptedMessage: encrypted
        });
      } catch (error) {
        console.warn(`Failed to encrypt for device ${recipient.deviceId}:`, error);
        // Continue with other devices - some might be offline or have issues
      }
    }
    
    return results;
  }

  private async fetchPreKeyBundle(userId: string, deviceId: string): Promise<any> {
    const authToken = localStorage.getItem('auth_token') || 
                     this.getSessionToken() || 
                     await this.getAuthToken();

    const response = await fetch(`/api/e2ee/keys/${userId}?deviceId=${deviceId}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      if (response.status === 410) {
        throw new Error('No prekeys available for this device');
      }
      throw new Error(`Failed to fetch prekey bundle: ${response.status}`);
    }
    
    return response.json();
  }

  private async processPreKeyBundle(address: any, bundle: any): Promise<void> {
    try {
      const SignalClient = getSignalClient();
      const identityKey = SignalClient.PublicKey.deserialize(
        Buffer.from(bundle.identityKey, 'base64')
      );
      
      const signedPreKey = SignalClient.PublicKey.deserialize(
        Buffer.from(bundle.signedPreKey.publicKey, 'base64')
      );
      
      const preKey = bundle.preKey ? 
        SignalClient.PublicKey.deserialize(Buffer.from(bundle.preKey.publicKey, 'base64')) : 
        null;
      
      const preKeyBundle = SignalClient.PreKeyBundle.new(
        bundle.registrationId,
        address.deviceId(),
        bundle.preKey?.keyId || null,
        preKey,
        bundle.signedPreKey.keyId,
        signedPreKey,
        Buffer.from(bundle.signedPreKey.signature, 'base64'),
        identityKey
      );
      
      await SignalClient.processPreKeyBundle(preKeyBundle, address, this.store);
      
      // Mark the one-time prekey as used
      if (bundle.preKey?.keyId) {
        await this.markPreKeyAsUsed(bundle.preKey.keyId);
      }
      
    } catch (error) {
      console.error('Failed to process prekey bundle:', error);
      throw new Error('Invalid prekey bundle');
    }
  }

  private async markPreKeyAsUsed(preKeyId: number): Promise<void> {
    try {
      const authToken = localStorage.getItem('auth_token') || 
                       this.getSessionToken() || 
                       await this.getAuthToken();
      
      await fetch(`/api/e2ee/keys/prekey/${preKeyId}/used`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      console.warn('Failed to mark prekey as used:', error);
      // Non-critical error, continue
    }
  }

  async hasSession(userId: string, deviceId: string): Promise<boolean> {
    const SignalClient = getSignalClient();
    const deviceIdNumber = parseInt(deviceId);
    const address = new SignalClient.ProtocolAddress(userId, deviceIdNumber);
    const session = await this.store.getSession(address);
    return session !== null;
  }

  async deleteSession(userId: string, deviceId: string): Promise<void> {
    const SignalClient = getSignalClient();
    const deviceIdNumber = parseInt(deviceId);
    const address = new SignalClient.ProtocolAddress(userId, deviceIdNumber);
    
    // Create empty session record to effectively delete the session
    const emptySession = SignalClient.SessionRecord.newFresh();
    await this.store.saveSession(address, emptySession);
  }

  private getSessionToken(): string | null {
    // Try to get token from various possible locations
    if (typeof window !== 'undefined') {
      // Check for NextAuth session
      const nextAuthSession = document.cookie
        .split('; ')
        .find(row => row.startsWith('next-auth.session-token='));
      
      if (nextAuthSession) {
        return nextAuthSession.split('=')[1];
      }
    }
    
    return null;
  }

  private async getAuthToken(): Promise<string> {
    // This would integrate with your existing auth system
    // For now, throw an error to indicate auth is required
    throw new Error('No authentication token available');
  }

  // Session diagnostics
  async getSessionInfo(userId: string, deviceId: string): Promise<{
    hasSession: boolean;
    sessionVersion?: number;
    lastActivity?: Date;
  }> {
    const hasSession = await this.hasSession(userId, deviceId);
    
    if (!hasSession) {
      return { hasSession: false };
    }
    
    // In a real implementation, you might store additional metadata
    return {
      hasSession: true,
      sessionVersion: 1, // Placeholder
      lastActivity: new Date() // Placeholder
    };
  }
}