import { getSignalClient } from './SignalClientWrapper';
import { SignalProtocolStore } from './SignalStore';
import { MessageCrypto } from './MessageCrypto';

export class GroupCrypto {
  constructor(private store: SignalProtocolStore) {}

  async createSenderKey(groupId: string): Promise<void> {
    const SignalClient = getSignalClient();
    const currentUserId = await this.getCurrentUserId();
    const distributionId = crypto.randomUUID();
    
    const senderKeyName = new SignalClient.SenderKeyName(
      groupId,
      new SignalClient.ProtocolAddress(currentUserId, 1)
    );
    
    // Create and store a new sender key by encrypting an empty message
    // This initializes the sender key state
    await SignalClient.groupEncrypt(
      senderKeyName,
      Buffer.from(''), // Empty message to initialize
      this.store
    );
  }

  async encryptGroupMessage(groupId: string, message: string): Promise<string> {
    const SignalClient = getSignalClient();
    const currentUserId = await this.getCurrentUserId();
    const senderKeyName = new SignalClient.SenderKeyName(
      groupId,
      new SignalClient.ProtocolAddress(currentUserId, 1)
    );
    
    const ciphertext = await SignalClient.groupEncrypt(
      senderKeyName,
      Buffer.from(message, 'utf-8'),
      this.store
    );
    
    return Buffer.from(ciphertext).toString('base64');
  }

  async decryptGroupMessage(
    groupId: string, 
    senderUserId: string,
    ciphertext: string
  ): Promise<string> {
    const SignalClient = getSignalClient();
    const senderKeyName = new SignalClient.SenderKeyName(
      groupId,
      new SignalClient.ProtocolAddress(senderUserId, 1)
    );
    
    const encryptedMessage = Buffer.from(ciphertext, 'base64');
    const plaintext = await SignalClient.groupDecrypt(
      encryptedMessage,
      senderKeyName,
      this.store
    );
    
    return Buffer.from(plaintext).toString('utf-8');
  }

  async rotateSenderKey(groupId: string, memberUserIds: string[]): Promise<void> {
    console.log(`Rotating sender key for group ${groupId} with ${memberUserIds.length} members`);
    
    // Generate new sender key
    await this.createSenderKey(groupId);
    
    // Get the new sender key record to distribute
    const SignalClient = getSignalClient();
    const currentUserId = await this.getCurrentUserId();
    const senderKeyName = new SignalClient.SenderKeyName(
      groupId,
      new SignalClient.ProtocolAddress(currentUserId, 1)
    );
    
    const senderKeyRecord = await this.store.loadSenderKey(senderKeyName);
    if (!senderKeyRecord) {
      throw new Error('Failed to load newly created sender key');
    }
    
    // Distribute to all members via pairwise sessions
    const distributionPromises = memberUserIds.map(userId => 
      this.distributeSenderKey(userId, groupId, senderKeyRecord)
    );
    
    await Promise.allSettled(distributionPromises);
  }

  private async distributeSenderKey(
    recipientUserId: string,
    groupId: string, 
    senderKeyRecord: any
  ): Promise<void> {
    try {
      // Encrypt sender key using pairwise session
      const messageCrypto = new MessageCrypto(this.store);
      const senderKeyData = {
        type: 'SENDER_KEY_DISTRIBUTION',
        groupId,
        distributionId: crypto.randomUUID(),
        senderKeyRecord: Buffer.from(senderKeyRecord.serialize()).toString('base64')
      };
      
      const encrypted = await messageCrypto.encryptMessage(
        recipientUserId,
        '1', // Assuming device ID 1 for simplicity
        JSON.stringify(senderKeyData)
      );
      
      // Send via API
      const authToken = localStorage.getItem('auth_token') || await this.getAuthToken();
      
      await fetch('/api/e2ee/groups/sender-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          groupId,
          recipientUserId,
          distributionId: senderKeyData.distributionId,
          encryptedSenderKey: encrypted.ciphertext
        })
      });
      
    } catch (error) {
      console.error(`Failed to distribute sender key to ${recipientUserId}:`, error);
      throw error;
    }
  }

  async processSenderKeyDistribution(
    groupId: string,
    senderUserId: string,
    encryptedSenderKey: string
  ): Promise<void> {
    try {
      // Decrypt the sender key using pairwise session
      const messageCrypto = new MessageCrypto(this.store);
      const decryptedData = await messageCrypto.decryptMessage(
        senderUserId,
        '1', // Assuming device ID 1
        {
          type: 'MESSAGE',
          ciphertext: encryptedSenderKey
        }
      );
      
      const senderKeyData = JSON.parse(decryptedData);
      
      if (senderKeyData.type !== 'SENDER_KEY_DISTRIBUTION') {
        throw new Error('Invalid sender key distribution message');
      }
      
      // Store the sender key
      const SignalClient = getSignalClient();
      const senderKeyName = new SignalClient.SenderKeyName(
        groupId,
        new SignalClient.ProtocolAddress(senderUserId, 1)
      );
      
      const senderKeyRecord = SignalClient.SenderKeyRecord.deserialize(
        Buffer.from(senderKeyData.senderKeyRecord, 'base64')
      );
      
      await this.store.storeSenderKey(senderKeyName, senderKeyRecord);
      
      console.log(`Successfully processed sender key distribution for group ${groupId} from ${senderUserId}`);
      
    } catch (error) {
      console.error('Failed to process sender key distribution:', error);
      throw error;
    }
  }

  async handleMembershipChange(
    groupId: string,
    addedMembers: string[] = [],
    removedMembers: string[] = []
  ): Promise<void> {
    if (removedMembers.length > 0) {
      console.log(`Members removed from group ${groupId}, rotating sender key`);
      
      // Get remaining members
      const remainingMembers = await this.getGroupMembers(groupId);
      const filteredMembers = remainingMembers.filter(id => !removedMembers.includes(id));
      
      // Rotate sender key for security
      await this.rotateSenderKey(groupId, filteredMembers);
    }
    
    if (addedMembers.length > 0) {
      console.log(`New members added to group ${groupId}, distributing current sender key`);
      
      // Get current sender key
      const SignalClient = getSignalClient();
      const currentUserId = await this.getCurrentUserId();
      const senderKeyName = new SignalClient.SenderKeyName(
        groupId,
        new SignalClient.ProtocolAddress(currentUserId, 1)
      );
      
      const senderKeyRecord = await this.store.loadSenderKey(senderKeyName);
      if (senderKeyRecord) {
        // Distribute to new members only
        const distributionPromises = addedMembers.map(userId => 
          this.distributeSenderKey(userId, groupId, senderKeyRecord)
        );
        
        await Promise.allSettled(distributionPromises);
      }
    }
  }

  private async getGroupMembers(groupId: string): Promise<string[]> {
    try {
      const authToken = localStorage.getItem('auth_token') || await this.getAuthToken();
      
      const response = await fetch(`/api/conversations/${groupId}/members`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch group members: ${response.status}`);
      }
      
      const data = await response.json();
      return data.members?.map((m: any) => m.userId) || [];
      
    } catch (error) {
      console.error('Failed to get group members:', error);
      return [];
    }
  }

  private async getCurrentUserId(): Promise<string> {
    // Get from auth context or localStorage
    const userId = localStorage.getItem('current_user_id');
    if (!userId) {
      throw new Error('Current user ID not available');
    }
    return userId;
  }

  private async getAuthToken(): Promise<string> {
    // This would integrate with your existing auth system
    const token = localStorage.getItem('auth_token');
    if (!token) {
      throw new Error('No authentication token available');
    }
    return token;
  }

  // Group sender key diagnostics
  async getGroupKeyInfo(groupId: string): Promise<{
    hasSenderKey: boolean;
    canEncrypt: boolean;
    participantCount?: number;
  }> {
    try {
      const SignalClient = getSignalClient();
      const currentUserId = await this.getCurrentUserId();
      const senderKeyName = new SignalClient.SenderKeyName(
        groupId,
        new SignalClient.ProtocolAddress(currentUserId, 1)
      );
      
      const senderKeyRecord = await this.store.loadSenderKey(senderKeyName);
      const hasSenderKey = senderKeyRecord !== null;
      
      let participantCount;
      if (hasSenderKey) {
        const members = await this.getGroupMembers(groupId);
        participantCount = members.length;
      }
      
      return {
        hasSenderKey,
        canEncrypt: hasSenderKey,
        participantCount
      };
      
    } catch (error) {
      console.error('Failed to get group key info:', error);
      return {
        hasSenderKey: false,
        canEncrypt: false
      };
    }
  }
}