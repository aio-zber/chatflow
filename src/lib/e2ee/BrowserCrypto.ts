/**
 * Browser-compatible E2EE implementation using Web Crypto API
 * This serves as a fallback when libsignal-client is not available
 */

export interface SimplifiedEncryptedMessage {
  type: 'BROWSER_ENCRYPTED';
  ciphertext: string;
  iv: string;
  keyId: string;
}

export interface BrowserCryptoStatus {
  available: boolean;
  keyGenerated: boolean;
  activeConversations: Set<string>;
}

export class BrowserCrypto {
  private cryptoKey: CryptoKey | null = null;
  private keyId: string | null = null;
  private status: BrowserCryptoStatus = {
    available: false,
    keyGenerated: false,
    activeConversations: new Set()
  };

  constructor() {
    this.checkAvailability();
  }

  private checkAvailability(): void {
    this.status.available = !!(
      typeof window !== 'undefined' &&
      window.crypto &&
      window.crypto.subtle &&
      window.crypto.getRandomValues
    );
    
    if (this.status.available) {
      console.log('🔐 BrowserCrypto: Web Crypto API available, initializing...');
    } else {
      console.warn('🔐 BrowserCrypto: Web Crypto API not available');
    }
  }

  async initialize(): Promise<boolean> {
    if (!this.status.available) {
      console.warn('🔐 BrowserCrypto: Cannot initialize - Web Crypto API not available');
      return false;
    }

    try {
      await this.generateOrLoadKey();
      console.log('🔐 BrowserCrypto: Successfully initialized with encryption key');
      return true;
    } catch (error) {
      console.error('🔐 BrowserCrypto: Failed to initialize:', error);
      return false;
    }
  }

  private async generateOrLoadKey(): Promise<void> {
    // Try to load existing key from localStorage
    const storedKeyData = localStorage.getItem('browser_crypto_key');
    const storedKeyId = localStorage.getItem('browser_crypto_key_id');

    if (storedKeyData && storedKeyId) {
      try {
        const keyData = JSON.parse(storedKeyData);
        this.cryptoKey = await window.crypto.subtle.importKey(
          'jwk',
          keyData,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
        this.keyId = storedKeyId;
        this.status.keyGenerated = true;
        console.log('🔐 BrowserCrypto: Loaded existing encryption key');
        return;
      } catch (error) {
        console.warn('🔐 BrowserCrypto: Failed to load stored key, generating new one:', error);
      }
    }

    // Generate new key
    this.cryptoKey = await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    // Export and store the key
    const exportedKey = await window.crypto.subtle.exportKey('jwk', this.cryptoKey);
    this.keyId = this.generateKeyId();
    
    localStorage.setItem('browser_crypto_key', JSON.stringify(exportedKey));
    localStorage.setItem('browser_crypto_key_id', this.keyId);
    
    this.status.keyGenerated = true;
    console.log('🔐 BrowserCrypto: Generated new encryption key');
  }

  private generateKeyId(): string {
    const array = new Uint8Array(8);
    window.crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async encryptMessage(
    message: string,
    conversationId: string
  ): Promise<SimplifiedEncryptedMessage> {
    if (!this.cryptoKey || !this.keyId) {
      throw new Error('BrowserCrypto not initialized');
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    
    // Generate random IV
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    // Encrypt the message
    const encryptedData = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.cryptoKey,
      data
    );

    // Track active conversation
    this.status.activeConversations.add(conversationId);

    const result = {
      type: 'BROWSER_ENCRYPTED' as const,
      ciphertext: this.arrayBufferToBase64(encryptedData),
      iv: this.arrayBufferToBase64(iv),
      keyId: this.keyId
    };

    console.log(`🔐 BrowserCrypto: Encrypted message for conversation ${conversationId}`, {
      originalLength: message.length,
      encryptedLength: result.ciphertext.length,
      keyId: this.keyId
    });

    return result;
  }

  async decryptMessage(
    encryptedMessage: SimplifiedEncryptedMessage,
    conversationId: string
  ): Promise<string> {
    if (!this.cryptoKey) {
      throw new Error('BrowserCrypto not initialized');
    }

    if (encryptedMessage.keyId !== this.keyId) {
      throw new Error('Message encrypted with different key');
    }

    const ciphertext = this.base64ToArrayBuffer(encryptedMessage.ciphertext);
    const iv = this.base64ToArrayBuffer(encryptedMessage.iv);

    // Decrypt the message
    const decryptedData = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this.cryptoKey,
      ciphertext
    );

    const decoder = new TextDecoder();
    const message = decoder.decode(decryptedData);

    console.log(`🔐 BrowserCrypto: Decrypted message for conversation ${conversationId}`, {
      encryptedLength: encryptedMessage.ciphertext.length,
      decryptedLength: message.length,
      keyId: this.keyId
    });

    return message;
  }

  getStatus(): BrowserCryptoStatus {
    return { ...this.status };
  }

  isAvailable(): boolean {
    return this.status.available && this.status.keyGenerated;
  }

  getActiveConversations(): string[] {
    return Array.from(this.status.activeConversations);
  }

  // Utility methods
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Diagnostics
  logStatus(): void {
    console.log('🔐 BrowserCrypto Status:', {
      available: this.status.available,
      keyGenerated: this.status.keyGenerated,
      keyId: this.keyId,
      activeConversations: this.getActiveConversations(),
      timestamp: new Date().toISOString()
    });
  }

  // Clear all crypto data
  async clearAllData(): Promise<void> {
    localStorage.removeItem('browser_crypto_key');
    localStorage.removeItem('browser_crypto_key_id');
    this.cryptoKey = null;
    this.keyId = null;
    this.status.keyGenerated = false;
    this.status.activeConversations.clear();
    console.log('🔐 BrowserCrypto: Cleared all encryption data');
  }
}