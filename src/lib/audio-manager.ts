// AudioManager - Type-safe Web Audio API management for call system

export class AudioManager {
  private audioContext?: AudioContext;
  private gainNode?: GainNode;
  private currentSource?: AudioBufferSourceNode;
  private audioBuffer?: AudioBuffer;
  private isPlaying: boolean = false;
  private ringingInterval?: NodeJS.Timeout;
  private ringingSource?: AudioBufferSourceNode;

  constructor() {
    this.initializeAudioContext();
  }

  private async initializeAudioContext(): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }
    
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 0.5;
      this.gainNode.connect(this.audioContext.destination);
    } catch (error) {
      console.warn('[AudioManager] Failed to initialize audio context:', error);
    }
  }

  async loadAudioBuffer(arrayBuffer: ArrayBuffer): Promise<void> {
    if (!this.audioContext) {
      await this.initializeAudioContext();
    }

    if (!this.audioContext) {
      throw new Error('AudioContext not available');
    }

    try {
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    } catch (error) {
      console.error('[AudioManager] Failed to decode audio data:', error);
      throw error;
    }
  }

  async play(): Promise<void> {
    if (!this.audioContext || !this.audioBuffer || !this.gainNode) {
      console.warn('[AudioManager] Audio not properly initialized');
      return;
    }

    try {
      // Resume audio context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Stop existing source if playing
      this.stop();

      // Create new source
      this.currentSource = this.audioContext.createBufferSource();
      this.currentSource.buffer = this.audioBuffer;
      this.currentSource.loop = true;
      this.currentSource.connect(this.gainNode);

      // Start playing
      this.currentSource.start();
      this.isPlaying = true;

      console.log('[AudioManager] ✅ Audio playback started');
    } catch (error) {
      console.error('[AudioManager] Error during playback:', error);
      throw error;
    }
  }

  stop(): void {
    if (this.currentSource && this.isPlaying) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
        this.currentSource = undefined;
        this.isPlaying = false;
        console.log('[AudioManager] ✅ Audio playback stopped');
      } catch (error) {
        console.warn('[AudioManager] Error stopping audio:', error);
      }
    }
  }

  setVolume(volume: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  // Generate a synthetic ringing tone
  private async generateRingingTone(): Promise<AudioBuffer> {
    if (!this.audioContext) {
      throw new Error('AudioContext not available');
    }

    const sampleRate = this.audioContext.sampleRate;
    const duration = 1.0; // 1 second tone
    const frameCount = sampleRate * duration;
    const buffer = this.audioContext.createBuffer(1, frameCount, sampleRate);
    const channelData = buffer.getChannelData(0);

    // Generate a pleasant ringing tone (dual tone: 350Hz + 440Hz)
    for (let i = 0; i < frameCount; i++) {
      const time = i / sampleRate;
      const tone1 = Math.sin(2 * Math.PI * 350 * time);
      const tone2 = Math.sin(2 * Math.PI * 440 * time);

      // Envelope to avoid clicks (fade in/out)
      let envelope = 1;
      const fadeTime = 0.05; // 50ms fade
      if (time < fadeTime) {
        envelope = time / fadeTime;
      } else if (time > duration - fadeTime) {
        envelope = (duration - time) / fadeTime;
      }

      channelData[i] = (tone1 + tone2) * 0.3 * envelope; // Mix and reduce volume
    }

    return buffer;
  }

  async playOutgoingRinging(): Promise<void> {
    try {
      if (!this.audioContext) {
        await this.initializeAudioContext();
      }

      if (!this.audioContext || !this.gainNode) {
        console.warn('[AudioManager] Audio context not available for ringing');
        return;
      }

      // Resume audio context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Stop any existing ringing
      this.stopOutgoingRinging();

      // Generate ringing tone
      const ringingBuffer = await this.generateRingingTone();

      // Play pattern: ring for 1s, pause for 2s, repeat
      const playRingTone = () => {
        if (!this.audioContext || !this.gainNode) return;

        try {
          this.ringingSource = this.audioContext.createBufferSource();
          this.ringingSource.buffer = ringingBuffer;
          this.ringingSource.connect(this.gainNode);
          this.ringingSource.start();

          // Auto-stop after tone duration
          this.ringingSource.addEventListener('ended', () => {
            this.ringingSource = undefined;
          });
        } catch (error) {
          console.warn('[AudioManager] Error playing ring tone:', error);
        }
      };

      // Start first ring immediately
      playRingTone();

      // Set up interval for subsequent rings (every 3 seconds)
      this.ringingInterval = setInterval(playRingTone, 3000);

      console.log('[AudioManager] ✅ Started outgoing ringing pattern');
    } catch (error) {
      console.error('[AudioManager] Failed to start outgoing ringing:', error);
      throw error;
    }
  }

  stopOutgoingRinging(): void {
    // Clear interval
    if (this.ringingInterval) {
      clearInterval(this.ringingInterval);
      this.ringingInterval = undefined;
    }

    // Stop current ringing source
    if (this.ringingSource) {
      try {
        this.ringingSource.stop();
        this.ringingSource.disconnect();
      } catch (error) {
        console.warn('[AudioManager] Error stopping ringing source:', error);
      }
      this.ringingSource = undefined;
    }

    console.log('[AudioManager] ✅ Stopped outgoing ringing');
  }

  isRinging(): boolean {
    return !!this.ringingInterval;
  }

  cleanup(): void {
    this.stop();
    this.stopOutgoingRinging();

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(error => {
        console.warn('[AudioManager] Error closing audio context:', error);
      });
    }

    this.audioContext = undefined;
    this.gainNode = undefined;
    this.audioBuffer = undefined;
  }
}

// Singleton instance for global use - lazy initialization
let _globalAudioManager: AudioManager | null = null;

export const getGlobalAudioManager = (): AudioManager | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  
  if (!_globalAudioManager) {
    _globalAudioManager = new AudioManager();
  }
  
  return _globalAudioManager;
};