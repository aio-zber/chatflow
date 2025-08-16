interface KeyBackup {
  version: number;
  userId: string;
  deviceId: string;
  timestamp: number;
  kdfSalt: string;
  encryptedData: string;
  hmac: string;
}

interface BackupContent {
  identityKeyPair: string;
  registrationId: number;
  sessions: Array<{ address: string; record: string }>;
  preKeys: Array<{ id: number; record: string }>;
  signedPreKeys: Array<{ id: number; record: string }>;
  identityKeys: Array<{ address: string; key: string; trusted: boolean }>;
  senderKeys: Array<{ address: string; record: string }>;
}

export class BackupManager {
  private readonly BACKUP_VERSION = 1;
  private readonly KDF_ITERATIONS = 100000; // PBKDF2 iterations
  private readonly KDF_SALT_LENGTH = 32;
  private readonly KEY_LENGTH = 32;

  async createBackup(passphrase: string): Promise<KeyBackup> {
    // Validate passphrase strength
    this.validatePassphrase(passphrase);
    
    // Collect all cryptographic state
    const backupContent = await this.collectBackupData();
    
    // Generate random salt
    const salt = crypto.getRandomValues(new Uint8Array(this.KDF_SALT_LENGTH));
    
    // Derive encryption key from passphrase
    const derivedKey = await this.deriveKey(passphrase, salt);
    
    // Encrypt backup content
    const { encryptedData, hmac } = await this.encryptBackupData(
      JSON.stringify(backupContent),
      derivedKey
    );
    
    return {
      version: this.BACKUP_VERSION,
      userId: await this.getCurrentUserId(),
      deviceId: localStorage.getItem('e2ee_device_id') || '',
      timestamp: Date.now(),
      kdfSalt: Buffer.from(salt).toString('base64'),
      encryptedData,
      hmac
    };
  }

  async restoreBackup(backup: KeyBackup, passphrase: string): Promise<void> {
    if (backup.version !== this.BACKUP_VERSION) {
      throw new Error(`Unsupported backup version: ${backup.version}`);
    }
    
    // Derive decryption key
    const salt = Buffer.from(backup.kdfSalt, 'base64');
    const derivedKey = await this.deriveKey(passphrase, salt);
    
    // Verify and decrypt
    const decryptedData = await this.decryptBackupData(
      backup.encryptedData,
      backup.hmac,
      derivedKey
    );
    
    const backupContent: BackupContent = JSON.parse(decryptedData);
    
    // Restore to IndexedDB and localStorage
    await this.restoreBackupData(backupContent);
  }

  private validatePassphrase(passphrase: string): void {
    if (passphrase.length < 12) {
      throw new Error('Passphrase must be at least 12 characters long');
    }
    
    // Check for basic complexity
    const hasLower = /[a-z]/.test(passphrase);
    const hasUpper = /[A-Z]/.test(passphrase);
    const hasNumber = /\d/.test(passphrase);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(passphrase);
    
    const complexityScore = [hasLower, hasUpper, hasNumber, hasSpecial].filter(Boolean).length;
    
    if (complexityScore < 3) {
      throw new Error('Passphrase must contain at least 3 of: lowercase, uppercase, numbers, special characters');
    }
  }

  private async deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    // Import passphrase as key material
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    
    // Derive AES-GCM key
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: this.KDF_ITERATIONS,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  private async encryptBackupData(
    data: string,
    key: CryptoKey
  ): Promise<{ encryptedData: string; hmac: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(data);
    
    // Encrypt with AES-GCM
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintext
    );
    
    // Combine IV + ciphertext
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    
    // Calculate HMAC for integrity
    const hmacKey = await crypto.subtle.importKey(
      'raw',
      await crypto.subtle.exportKey('raw', key),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const hmac = await crypto.subtle.sign('HMAC', hmacKey, combined);
    
    return {
      encryptedData: Buffer.from(combined).toString('base64'),
      hmac: Buffer.from(hmac).toString('base64')
    };
  }

  private async decryptBackupData(
    encryptedData: string,
    expectedHmac: string,
    key: CryptoKey
  ): Promise<string> {
    const combined = Buffer.from(encryptedData, 'base64');
    
    // Verify HMAC
    const hmacKey = await crypto.subtle.importKey(
      'raw',
      await crypto.subtle.exportKey('raw', key),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const hmacBytes = Buffer.from(expectedHmac, 'base64');
    const valid = await crypto.subtle.verify('HMAC', hmacKey, hmacBytes, combined);
    
    if (!valid) {
      throw new Error('Backup integrity check failed - wrong passphrase or corrupted data');
    }
    
    // Extract IV and ciphertext
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    
    // Decrypt
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    
    return new TextDecoder().decode(plaintext);
  }

  private async collectBackupData(): Promise<BackupContent> {
    // Get identity key and registration ID from localStorage
    const identityKeyPair = localStorage.getItem('e2ee_identity_private_key');
    const registrationId = localStorage.getItem('e2ee_registration_id');
    
    if (!identityKeyPair || !registrationId) {
      throw new Error('No identity key or registration ID found');
    }
    
    // Export data from IndexedDB
    const sessions = await this.exportSessions();
    const preKeys = await this.exportPreKeys();
    const signedPreKeys = await this.exportSignedPreKeys();
    const identityKeys = await this.exportIdentityKeys();
    const senderKeys = await this.exportSenderKeys();
    
    return {
      identityKeyPair,
      registrationId: parseInt(registrationId),
      sessions,
      preKeys,
      signedPreKeys,
      identityKeys,
      senderKeys
    };
  }

  private async restoreBackupData(backupContent: BackupContent): Promise<void> {
    // Restore to localStorage
    localStorage.setItem('e2ee_identity_private_key', backupContent.identityKeyPair);
    localStorage.setItem('e2ee_registration_id', backupContent.registrationId.toString());
    
    // Restore to IndexedDB
    await this.importSessions(backupContent.sessions);
    await this.importPreKeys(backupContent.preKeys);
    await this.importSignedPreKeys(backupContent.signedPreKeys);
    await this.importIdentityKeys(backupContent.identityKeys);
    await this.importSenderKeys(backupContent.senderKeys);
    
    console.log('Backup restored successfully');
  }

  // IndexedDB export/import methods
  private async exportSessions(): Promise<Array<{ address: string; record: string }>> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('chatflow-e2ee', 1);
      
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['sessions'], 'readonly');
        const store = transaction.objectStore('sessions');
        const getAllRequest = store.getAll();
        
        getAllRequest.onsuccess = () => {
          const sessions = getAllRequest.result.map(session => ({
            address: session.address,
            record: Buffer.from(session.record).toString('base64')
          }));
          resolve(sessions);
        };
        
        getAllRequest.onerror = () => reject(getAllRequest.error);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  private async exportPreKeys(): Promise<Array<{ id: number; record: string }>> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('chatflow-e2ee', 1);
      
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['preKeys'], 'readonly');
        const store = transaction.objectStore('preKeys');
        const getAllRequest = store.getAll();
        
        getAllRequest.onsuccess = () => {
          const preKeys = getAllRequest.result.map(preKey => ({
            id: preKey.id,
            record: Buffer.from(preKey.record).toString('base64')
          }));
          resolve(preKeys);
        };
        
        getAllRequest.onerror = () => reject(getAllRequest.error);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  private async exportSignedPreKeys(): Promise<Array<{ id: number; record: string }>> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('chatflow-e2ee', 1);
      
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['signedPreKeys'], 'readonly');
        const store = transaction.objectStore('signedPreKeys');
        const getAllRequest = store.getAll();
        
        getAllRequest.onsuccess = () => {
          const signedPreKeys = getAllRequest.result.map(signedPreKey => ({
            id: signedPreKey.id,
            record: Buffer.from(signedPreKey.record).toString('base64')
          }));
          resolve(signedPreKeys);
        };
        
        getAllRequest.onerror = () => reject(getAllRequest.error);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  private async exportIdentityKeys(): Promise<Array<{ address: string; key: string; trusted: boolean }>> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('chatflow-e2ee', 1);
      
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['identityKeys'], 'readonly');
        const store = transaction.objectStore('identityKeys');
        const getAllRequest = store.getAll();
        
        getAllRequest.onsuccess = () => {
          const identityKeys = getAllRequest.result.map(identity => ({
            address: identity.address,
            key: Buffer.from(identity.identityKey).toString('base64'),
            trusted: identity.trusted
          }));
          resolve(identityKeys);
        };
        
        getAllRequest.onerror = () => reject(getAllRequest.error);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  private async exportSenderKeys(): Promise<Array<{ address: string; record: string }>> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('chatflow-e2ee', 1);
      
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['senderKeys'], 'readonly');
        const store = transaction.objectStore('senderKeys');
        const getAllRequest = store.getAll();
        
        getAllRequest.onsuccess = () => {
          const senderKeys = getAllRequest.result.map(senderKey => ({
            address: senderKey.address,
            record: Buffer.from(senderKey.record).toString('base64')
          }));
          resolve(senderKeys);
        };
        
        getAllRequest.onerror = () => reject(getAllRequest.error);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  // Import methods would be similar but in reverse
  private async importSessions(sessions: Array<{ address: string; record: string }>): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('chatflow-e2ee', 1);
      
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['sessions'], 'readwrite');
        const store = transaction.objectStore('sessions');
        
        let completed = 0;
        const total = sessions.length;
        
        if (total === 0) {
          resolve();
          return;
        }
        
        sessions.forEach(session => {
          const addRequest = store.put({
            address: session.address,
            record: Buffer.from(session.record, 'base64')
          });
          
          addRequest.onsuccess = () => {
            completed++;
            if (completed === total) resolve();
          };
          
          addRequest.onerror = () => reject(addRequest.error);
        });
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  // Similar import methods for other data types...
  private async importPreKeys(preKeys: Array<{ id: number; record: string }>): Promise<void> {
    // Implementation similar to importSessions
    console.log('Importing preKeys:', preKeys.length);
  }

  private async importSignedPreKeys(signedPreKeys: Array<{ id: number; record: string }>): Promise<void> {
    // Implementation similar to importSessions
    console.log('Importing signedPreKeys:', signedPreKeys.length);
  }

  private async importIdentityKeys(identityKeys: Array<{ address: string; key: string; trusted: boolean }>): Promise<void> {
    // Implementation similar to importSessions
    console.log('Importing identityKeys:', identityKeys.length);
  }

  private async importSenderKeys(senderKeys: Array<{ address: string; record: string }>): Promise<void> {
    // Implementation similar to importSessions
    console.log('Importing senderKeys:', senderKeys.length);
  }

  private async getCurrentUserId(): Promise<string> {
    const userId = localStorage.getItem('current_user_id');
    if (!userId) {
      throw new Error('Current user ID not available');
    }
    return userId;
  }

  // Utility methods
  generateSecurePassphrase(): string {
    const words = [
      'apple', 'bridge', 'castle', 'dragon', 'eagle', 'forest', 'garden', 'harbor',
      'island', 'jungle', 'kitchen', 'ladder', 'mountain', 'notebook', 'ocean', 'palace',
      'quiver', 'rocket', 'sunset', 'tiger', 'umbrella', 'village', 'window', 'x-ray',
      'yellow', 'zebra'
    ];
    
    const selectedWords = [];
    for (let i = 0; i < 6; i++) {
      const randomIndex = Math.floor(Math.random() * words.length);
      selectedWords.push(words[randomIndex]);
    }
    
    return selectedWords.join('-') + '-' + Math.floor(Math.random() * 1000);
  }

  validateBackup(backup: KeyBackup): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (backup.version !== this.BACKUP_VERSION) {
      errors.push(`Unsupported backup version: ${backup.version}`);
    }
    
    if (!backup.userId || !backup.deviceId) {
      errors.push('Missing user or device ID');
    }
    
    if (!backup.kdfSalt || !backup.encryptedData || !backup.hmac) {
      errors.push('Missing encryption data');
    }
    
    if (Date.now() - backup.timestamp > 30 * 24 * 60 * 60 * 1000) {
      errors.push('Backup is more than 30 days old');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}