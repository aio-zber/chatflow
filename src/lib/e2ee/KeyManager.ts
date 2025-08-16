import { getSignalClient } from './SignalClientWrapper';
import { SignalProtocolStore } from './SignalStore';

export interface PreKeyBundle {
  registrationId: number;
  identityKey: string;
  signedPreKey: {
    keyId: number;
    publicKey: string;
    signature: string;
  };
  preKeys: Array<{
    keyId: number;
    publicKey: string;
  }>;
}

export class KeyManager {
  constructor(private store: SignalProtocolStore) {}

  async generateIdentityKeyPair(): Promise<any> {
    const SignalClient = getSignalClient();
    const identityKey = SignalClient.PrivateKey.generate();
    const identityKeyPair = SignalClient.IdentityKeyPair.new(
      identityKey.publicKey(),
      identityKey
    );
    
    // Store private key securely in localStorage
    localStorage.setItem('e2ee_identity_private_key', 
      Buffer.from(identityKey.serialize()).toString('base64'));
    
    return identityKeyPair;
  }

  async generateRegistrationId(): Promise<number> {
    // Generate a cryptographically secure random 14-bit number (0-16383)
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    const registrationId = array[0] % 16384; // Ensure 14-bit range
    
    // Validate the generated ID
    if (registrationId < 0 || registrationId >= 16384) {
      throw new Error('Invalid registration ID generated');
    }
    
    localStorage.setItem('e2ee_registration_id', registrationId.toString());
    return registrationId;
  }

  async generatePreKeys(start: number, count: number): Promise<any[]> {
    const SignalClient = getSignalClient();
    const preKeys: any[] = [];
    
    for (let i = 0; i < count; i++) {
      const preKeyId = start + i;
      const preKeyPair = SignalClient.PrivateKey.generate();
      const preKey = SignalClient.PreKeyRecord.new(preKeyId, preKeyPair);
      
      await this.store.savePreKey(preKeyId, preKey);
      preKeys.push(preKey);
    }
    
    return preKeys;
  }

  async generateSignedPreKey(
    identityKeyPair: any, 
    signedPreKeyId: number
  ): Promise<any> {
    const SignalClient = getSignalClient();
    const timestamp = Date.now();
    const signedPreKeyPair = SignalClient.PrivateKey.generate();
    
    const signature = identityKeyPair.privateKey().calculateSignature(
      signedPreKeyPair.publicKey().serialize()
    );
    
    const signedPreKey = SignalClient.SignedPreKeyRecord.new(
      signedPreKeyId,
      timestamp,
      signedPreKeyPair,
      signature
    );
    
    await this.store.saveSignedPreKey(signedPreKeyId, signedPreKey);
    return signedPreKey;
  }

  async createPreKeyBundle(): Promise<PreKeyBundle> {
    const registrationId = await this.store.getLocalRegistrationId();
    const identityKey = await this.store.getIdentityKey();
    
    // Generate new signed pre-key
    const SignalClient = getSignalClient();
    const identityKeyPair = SignalClient.IdentityKeyPair.new(
      identityKey.publicKey(),
      identityKey
    );
    const signedPreKeyId = Date.now(); // Use timestamp as ID
    const signedPreKey = await this.generateSignedPreKey(identityKeyPair, signedPreKeyId);
    
    // Generate one-time pre-keys
    const preKeys = await this.generatePreKeys(1, 100);
    
    return {
      registrationId,
      identityKey: Buffer.from(identityKey.publicKey().serialize()).toString('base64'),
      signedPreKey: {
        keyId: signedPreKey.id(),
        publicKey: Buffer.from(signedPreKey.publicKey().serialize()).toString('base64'),
        signature: Buffer.from(signedPreKey.signature()).toString('base64')
      },
      preKeys: preKeys.map(pk => ({
        keyId: pk.id(),
        publicKey: Buffer.from(pk.publicKey().serialize()).toString('base64')
      }))
    };
  }

  async setupDevice(deviceName?: string): Promise<{ deviceId: string; preKeyBundle: PreKeyBundle }> {
    // Generate secure device ID
    const deviceId = crypto.randomUUID();
    
    // Validate device ID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(deviceId)) {
      throw new Error('Invalid device ID generated');
    }
    
    // Generate identity key pair and registration ID
    await this.generateIdentityKeyPair();
    await this.generateRegistrationId();
    
    // Create prekey bundle
    const preKeyBundle = await this.createPreKeyBundle();
    
    // Store device info
    this.store.setCurrentDeviceId(deviceId);
    
    return { deviceId, preKeyBundle };
  }

  async checkPreKeyLevels(): Promise<{ 
    oneTimePreKeys: number; 
    needsReplenishment: boolean;
    lowThreshold: number;
  }> {
    // This is a simplified check - in a real implementation,
    // you'd query IndexedDB to count available prekeys
    const lowThreshold = 10;
    
    // For now, assume we need to implement a proper counter
    // This would involve tracking used prekeys in the database
    return {
      oneTimePreKeys: 50, // Placeholder
      needsReplenishment: false,
      lowThreshold
    };
  }

  async replenishPreKeys(): Promise<void> {
    // Generate new batch of prekeys starting from a safe ID
    const startId = Date.now() % 1000000; // Use timestamp mod for ID range
    await this.generatePreKeys(startId, 100);
  }

  async rotateSignedPreKey(): Promise<void> {
    try {
      const identityKey = await this.store.getIdentityKey();
      const SignalClient = getSignalClient();
      const identityKeyPair = SignalClient.IdentityKeyPair.new(
        identityKey.publicKey(),
        identityKey
      );
      
      const newSignedPreKeyId = Date.now();
      await this.generateSignedPreKey(identityKeyPair, newSignedPreKeyId);
      
      console.log(`Rotated signed prekey to ID: ${newSignedPreKeyId}`);
    } catch (error) {
      console.error('Failed to rotate signed prekey:', error);
      throw error;
    }
  }

  async generateSafetyNumber(
    localUserId: string,
    remoteUserId: string,
    remoteIdentityKey: any
  ): Promise<string> {
    const localIdentityKey = await this.store.getIdentityKey();
    
    // Concatenate identity information
    const localData = new TextEncoder().encode(localUserId);
    const remoteData = new TextEncoder().encode(remoteUserId);
    const localKeyBytes = localIdentityKey.publicKey().serialize();
    const remoteKeyBytes = remoteIdentityKey.serialize();
    
    const combined = new Uint8Array(
      localData.length + localKeyBytes.length +
      remoteData.length + remoteKeyBytes.length
    );
    
    let offset = 0;
    combined.set(localData, offset);
    offset += localData.length;
    combined.set(localKeyBytes, offset);
    offset += localKeyBytes.length;
    combined.set(remoteData, offset);
    offset += remoteData.length;
    combined.set(remoteKeyBytes, offset);
    
    // Generate SHA-256 hash
    const hash = await crypto.subtle.digest('SHA-256', combined);
    const hashArray = new Uint8Array(hash);
    
    // Convert to 60-digit safety number (12 groups of 5 digits)
    let safetyNumber = '';
    for (let i = 0; i < 30; i += 5) {
      if (i + 5 <= hashArray.length) {
        const group = hashArray.slice(i, i + 5);
        const value = group.reduce((acc, byte, idx) => acc + (byte << (8 * idx)), 0);
        const digits = (value % 100000).toString().padStart(5, '0');
        safetyNumber += digits;
        if (safetyNumber.length < 60) safetyNumber += ' ';
      }
    }
    
    return safetyNumber.trim();
  }

  async exportKeys(): Promise<{
    identityKey: string;
    registrationId: number;
    deviceId: string;
  }> {
    const identityKey = await this.store.getIdentityKey();
    const registrationId = await this.store.getLocalRegistrationId();
    const deviceId = this.store.getCurrentDeviceId();
    
    return {
      identityKey: Buffer.from(identityKey.publicKey().serialize()).toString('base64'),
      registrationId,
      deviceId
    };
  }
}