import { getSignalClient } from './SignalClientWrapper';

interface StoredSession {
  address: string;
  record: Uint8Array;
}

interface StoredPreKey {
  id: number;
  record: Uint8Array;
}

interface StoredIdentity {
  address: string;
  identityKey: Uint8Array;
  trusted: boolean;
}

interface StoredSenderKey {
  address: string;
  record: Uint8Array;
}

export class SignalProtocolStore {
  private dbName = 'chatflow-e2ee';
  private version = 1;
  private db?: IDBDatabase;

  async initialize(): Promise<void> {
    this.db = await this.openDatabase();
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Sessions store
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'address' });
        }
        
        // Pre-keys store
        if (!db.objectStoreNames.contains('preKeys')) {
          db.createObjectStore('preKeys', { keyPath: 'id' });
        }
        
        // Signed pre-keys store
        if (!db.objectStoreNames.contains('signedPreKeys')) {
          db.createObjectStore('signedPreKeys', { keyPath: 'id' });
        }
        
        // Identity keys store
        if (!db.objectStoreNames.contains('identityKeys')) {
          db.createObjectStore('identityKeys', { keyPath: 'address' });
        }
        
        // Sender keys store (for groups)
        if (!db.objectStoreNames.contains('senderKeys')) {
          db.createObjectStore('senderKeys', { keyPath: 'address' });
        }
      };
    });
  }

  // Session Store Implementation
  async saveSession(address: any, record: any): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');
    
    return new Promise((resolve, reject) => {
      const request = store.put({
        address: address.toString(),
        record: record.serialize()
      });
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getSession(address: any): Promise<any | null> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');
    
    return new Promise((resolve, reject) => {
      const request = store.get(address.toString());
      
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          const SignalClient = getSignalClient();
          resolve(SignalClient.SessionRecord.deserialize(result.record));
        } else {
          resolve(null);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  async getExistingSessions(addresses: any[]): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');
    const existing: any[] = [];
    
    for (const address of addresses) {
      const result = await new Promise<any>((resolve, reject) => {
        const request = store.get(address.toString());
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      if (result) {
        existing.push(address);
      }
    }
    
    return existing;
  }

  // Pre-Key Store Implementation
  async savePreKey(id: number, record: any): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['preKeys'], 'readwrite');
    const store = transaction.objectStore('preKeys');
    
    return new Promise((resolve, reject) => {
      const request = store.put({
        id,
        record: record.serialize()
      });
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getPreKey(id: number): Promise<any> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['preKeys'], 'readonly');
    const store = transaction.objectStore('preKeys');
    
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          const SignalClient = getSignalClient();
          resolve(SignalClient.PreKeyRecord.deserialize(result.record));
        } else {
          reject(new Error(`No pre-key found with id ${id}`));
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  async removePreKey(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['preKeys'], 'readwrite');
    const store = transaction.objectStore('preKeys');
    
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Signed Pre-Key Store Implementation  
  async saveSignedPreKey(id: number, record: any): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['signedPreKeys'], 'readwrite');
    const store = transaction.objectStore('signedPreKeys');
    
    return new Promise((resolve, reject) => {
      const request = store.put({
        id,
        record: record.serialize()
      });
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getSignedPreKey(id: number): Promise<any> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['signedPreKeys'], 'readonly');
    const store = transaction.objectStore('signedPreKeys');
    
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          const SignalClient = getSignalClient();
          resolve(SignalClient.SignedPreKeyRecord.deserialize(result.record));
        } else {
          reject(new Error(`No signed pre-key found with id ${id}`));
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  // Identity Key Store Implementation
  async getIdentityKey(): Promise<any> {
    const stored = localStorage.getItem('e2ee_identity_private_key');
    if (stored) {
      const SignalClient = getSignalClient();
      return SignalClient.PrivateKey.deserialize(Buffer.from(stored, 'base64'));
    }
    throw new Error('No identity key found');
  }

  async getLocalRegistrationId(): Promise<number> {
    const stored = localStorage.getItem('e2ee_registration_id');
    if (stored) {
      return parseInt(stored, 10);
    }
    throw new Error('No registration ID found');
  }

  async saveIdentity(address: any, identityKey: any): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['identityKeys'], 'readwrite');
    const store = transaction.objectStore('identityKeys');
    
    return new Promise((resolve, reject) => {
      // First check if identity key already exists
      const getRequest = store.get(address.toString());
      
      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        const newKeyBytes = identityKey.serialize();
        
        if (existing && !this.arraysEqual(existing.identityKey, newKeyBytes)) {
          // Identity key changed - this should trigger a security warning
          console.warn(`Identity key changed for ${address.toString()}`);
          // For now, we'll reject the change - in production, prompt user
          resolve(false);
          return;
        }
        
        // Save or update identity key
        const putRequest = store.put({
          address: address.toString(),
          identityKey: newKeyBytes,
          trusted: !existing // New keys require verification
        });
        
        putRequest.onsuccess = () => resolve(true);
        putRequest.onerror = () => reject(putRequest.error);
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async isTrustedIdentity(address: any, identityKey: any): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['identityKeys'], 'readonly');
    const store = transaction.objectStore('identityKeys');
    
    return new Promise((resolve, reject) => {
      const request = store.get(address.toString());
      
      request.onsuccess = () => {
        const result = request.result;
        if (!result) {
          resolve(true); // First contact is trusted
          return;
        }
        
        const keyMatches = this.arraysEqual(result.identityKey, identityKey.serialize());
        resolve(keyMatches && result.trusted);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  async getIdentity(address: any): Promise<any | null> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['identityKeys'], 'readonly');
    const store = transaction.objectStore('identityKeys');
    
    return new Promise((resolve, reject) => {
      const request = store.get(address.toString());
      
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          const SignalClient = getSignalClient();
          resolve(SignalClient.PublicKey.deserialize(result.identityKey));
        } else {
          resolve(null);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  // Sender Key Store Implementation (for groups)
  async storeSenderKey(
    senderKeyName: any,
    record: any
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['senderKeys'], 'readwrite');
    const store = transaction.objectStore('senderKeys');
    
    return new Promise((resolve, reject) => {
      const request = store.put({
        address: senderKeyName.toString(),
        record: record.serialize()
      });
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async loadSenderKey(senderKeyName: any): Promise<any | null> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['senderKeys'], 'readonly');
    const store = transaction.objectStore('senderKeys');
    
    return new Promise((resolve, reject) => {
      const request = store.get(senderKeyName.toString());
      
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          const SignalClient = getSignalClient();
          resolve(SignalClient.SenderKeyRecord.deserialize(result.record));
        } else {
          resolve(null);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  // Helper methods
  private arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // Get current device ID
  getCurrentDeviceId(): string {
    return localStorage.getItem('e2ee_device_id') || '';
  }

  // Set current device ID
  setCurrentDeviceId(deviceId: string): void {
    localStorage.setItem('e2ee_device_id', deviceId);
  }

  // Check if current device is primary
  isPrimaryDevice(): boolean {
    return localStorage.getItem('e2ee_is_primary') === 'true';
  }
}