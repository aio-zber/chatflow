interface SFUConfig {
  serverUrl: string;
  apiKey: string;
  maxParticipants: number;
  preferredCodecs: string[];
}

interface SFUParticipant {
  id: string;
  userId: string;
  displayName: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenShareEnabled: boolean;
}

interface SFURoom {
  id: string;
  name: string;
  participants: SFUParticipant[];
  maxParticipants: number;
  created: Date;
}

// Abstract SFU adapter to support multiple providers
abstract class SFUAdapter {
  protected config: SFUConfig;

  constructor(config: SFUConfig) {
    this.config = config;
  }

  abstract connect(): Promise<void>;
  abstract createRoom(roomId: string, maxParticipants: number): Promise<SFURoom>;
  abstract joinRoom(roomId: string, participant: SFUParticipant): Promise<void>;
  abstract leaveRoom(roomId: string, participantId: string): Promise<void>;
  abstract publishStream(roomId: string, stream: MediaStream): Promise<void>;
  abstract subscribeToStream(roomId: string, participantId: string): Promise<MediaStream>;
  abstract disconnect(): Promise<void>;

  // Quality monitoring hooks
  abstract onQualityUpdate(callback: (quality: any) => void): void;
  abstract onParticipantUpdate(callback: (participant: SFUParticipant) => void): void;
}

// LiveKit implementation (preferred SFU solution)
class LiveKitSFUAdapter extends SFUAdapter {
  private room: any; // LiveKit Room instance
  private connected = false;
  
  async connect(): Promise<void> {
    // Implementation will use LiveKit SDK
    console.log('[SFU] Connecting to LiveKit server...');
    try {
      // TODO: Implement LiveKit connection
      // this.room = new Room(this.config);
      this.connected = true;
      console.log('[SFU] ✅ Connected to LiveKit server');
    } catch (error) {
      console.error('[SFU] ❌ Failed to connect to LiveKit:', error);
      throw error;
    }
  }

  async createRoom(roomId: string, maxParticipants: number): Promise<SFURoom> {
    if (!this.connected) {
      throw new Error('Not connected to SFU server');
    }
    
    console.log(`[SFU] Creating room: ${roomId}, max participants: ${maxParticipants}`);
    // TODO: Implement room creation with LiveKit API
    
    return {
      id: roomId,
      name: roomId,
      participants: [],
      maxParticipants,
      created: new Date()
    };
  }

  async joinRoom(roomId: string, participant: SFUParticipant): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected to SFU server');
    }
    
    console.log(`[SFU] Joining room ${roomId} as ${participant.displayName}`);
    // TODO: Implement LiveKit room joining
  }

  async leaveRoom(roomId: string, participantId: string): Promise<void> {
    console.log(`[SFU] Leaving room ${roomId}: ${participantId}`);
    // TODO: Implement LiveKit room leaving
  }

  async publishStream(roomId: string, stream: MediaStream): Promise<void> {
    console.log(`[SFU] Publishing stream to room ${roomId}`);
    // TODO: Implement LiveKit stream publishing
  }

  async subscribeToStream(roomId: string, participantId: string): Promise<MediaStream> {
    console.log(`[SFU] Subscribing to stream from ${participantId} in room ${roomId}`);
    // TODO: Implement LiveKit stream subscription
    throw new Error('Not implemented');
  }

  async disconnect(): Promise<void> {
    if (this.room) {
      // TODO: Disconnect from LiveKit room
      this.connected = false;
      console.log('[SFU] ✅ Disconnected from LiveKit server');
    }
  }

  onQualityUpdate(callback: (quality: any) => void): void {
    // TODO: Implement quality monitoring with LiveKit
    console.log('[SFU] Quality monitoring callback registered');
  }

  onParticipantUpdate(callback: (participant: SFUParticipant) => void): void {
    // TODO: Implement participant updates with LiveKit
    console.log('[SFU] Participant update callback registered');
  }
}

// Mediasoup implementation (alternative)
class MediasoupSFUAdapter extends SFUAdapter {
  private device: any;
  private transport: any;
  
  async connect(): Promise<void> {
    console.log('[SFU] Connecting to Mediasoup server...');
    // TODO: Implement Mediasoup connection
    throw new Error('Mediasoup adapter not implemented yet');
  }

  async createRoom(roomId: string, maxParticipants: number): Promise<SFURoom> {
    throw new Error('Mediasoup adapter not implemented yet');
  }

  async joinRoom(roomId: string, participant: SFUParticipant): Promise<void> {
    throw new Error('Mediasoup adapter not implemented yet');
  }

  async leaveRoom(roomId: string, participantId: string): Promise<void> {
    throw new Error('Mediasoup adapter not implemented yet');
  }

  async publishStream(roomId: string, stream: MediaStream): Promise<void> {
    throw new Error('Mediasoup adapter not implemented yet');
  }

  async subscribeToStream(roomId: string, participantId: string): Promise<MediaStream> {
    throw new Error('Mediasoup adapter not implemented yet');
  }

  async disconnect(): Promise<void> {
    throw new Error('Mediasoup adapter not implemented yet');
  }

  onQualityUpdate(callback: (quality: any) => void): void {
    throw new Error('Mediasoup adapter not implemented yet');
  }

  onParticipantUpdate(callback: (participant: SFUParticipant) => void): void {
    throw new Error('Mediasoup adapter not implemented yet');
  }
}

// Factory for creating SFU adapters
class SFUAdapterFactory {
  static create(provider: 'livekit' | 'mediasoup', config: SFUConfig): SFUAdapter {
    switch (provider) {
      case 'livekit':
        return new LiveKitSFUAdapter(config);
      case 'mediasoup':
        return new MediasoupSFUAdapter(config);
      default:
        throw new Error(`Unknown SFU provider: ${provider}`);
    }
  }
}

// Migration helper for transitioning from P2P to SFU
class P2PToSFUMigration {
  static shouldUseSFU(participantCount: number, networkQuality: 'poor' | 'good' | 'excellent'): boolean {
    // Use SFU for group calls or poor network conditions
    if (participantCount > 2) return true;
    if (networkQuality === 'poor') return true;
    return false;
  }

  static getRecommendedSFUProvider(participantCount: number): 'livekit' | 'mediasoup' {
    // LiveKit for smaller groups, Mediasoup for larger
    return participantCount <= 8 ? 'livekit' : 'mediasoup';
  }
}

export {
  SFUAdapter,
  LiveKitSFUAdapter,
  MediasoupSFUAdapter,
  SFUAdapterFactory,
  P2PToSFUMigration,
  type SFUConfig,
  type SFUParticipant,
  type SFURoom
};