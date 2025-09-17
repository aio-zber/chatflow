interface ConnectionRecoveryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  jitterFactor: number;
}

interface ConnectionRecoveryState {
  participantId: string;
  retryCount: number;
  lastAttempt: number;
  backoffDelay: number;
  recoveryStrategy: 'ice_restart' | 'reconnect' | 'fallback';
}

class ConnectionRecoveryManager {
  private recoveryStates: Map<string, ConnectionRecoveryState> = new Map();
  private readonly config: ConnectionRecoveryConfig;

  constructor(config?: Partial<ConnectionRecoveryConfig>) {
    this.config = {
      maxRetries: 5,
      baseDelay: 1000,    // 1 second
      maxDelay: 30000,    // 30 seconds
      jitterFactor: 0.1,  // 10% jitter
      ...config
    };
  }

  async recoverConnection(
    participantId: string, 
    peerConnection: RTCPeerConnection,
    webrtcService: any
  ): Promise<boolean> {
    const state = this.getOrCreateRecoveryState(participantId);
    
    if (state.retryCount >= this.config.maxRetries) {
      console.error(`[RECOVERY] Max retries exceeded for ${participantId}`);
      return false;
    }

    const strategy = this.selectRecoveryStrategy(state, peerConnection);
    console.log(`[RECOVERY] Attempt ${state.retryCount + 1} for ${participantId} using ${strategy}`);

    try {
      const success = await this.executeRecoveryStrategy(
        strategy, 
        participantId, 
        peerConnection, 
        webrtcService
      );

      if (success) {
        this.resetRecoveryState(participantId);
        return true;
      } else {
        this.updateRecoveryState(participantId, false);
        await this.scheduleRetry(participantId, peerConnection, webrtcService);
        return false;
      }
    } catch (error) {
      console.error(`[RECOVERY] Strategy ${strategy} failed for ${participantId}:`, error);
      this.updateRecoveryState(participantId, false);
      return false;
    }
  }

  private getOrCreateRecoveryState(participantId: string): ConnectionRecoveryState {
    if (!this.recoveryStates.has(participantId)) {
      this.recoveryStates.set(participantId, {
        participantId,
        retryCount: 0,
        lastAttempt: 0,
        backoffDelay: this.config.baseDelay,
        recoveryStrategy: 'ice_restart'
      });
    }
    return this.recoveryStates.get(participantId)!;
  }

  private selectRecoveryStrategy(
    state: ConnectionRecoveryState, 
    peerConnection: RTCPeerConnection
  ): 'ice_restart' | 'reconnect' | 'fallback' {
    const connectionState = peerConnection.connectionState;
    const iceState = peerConnection.iceConnectionState;

    // First attempts: try ICE restart for connection issues
    if (state.retryCount < 2 && (iceState === 'failed' || iceState === 'disconnected')) {
      return 'ice_restart';
    }

    // Middle attempts: full reconnection
    if (state.retryCount < 4) {
      return 'reconnect';
    }

    // Last attempts: fallback strategies
    return 'fallback';
  }

  private async executeRecoveryStrategy(
    strategy: 'ice_restart' | 'reconnect' | 'fallback',
    participantId: string,
    peerConnection: RTCPeerConnection,
    webrtcService: any
  ): Promise<boolean> {
    switch (strategy) {
      case 'ice_restart':
        return this.performIceRestart(participantId, peerConnection);
      
      case 'reconnect':
        return this.performFullReconnect(participantId, webrtcService);
      
      case 'fallback':
        return this.performFallbackRecovery(participantId, peerConnection);
      
      default:
        return false;
    }
  }

  private async performIceRestart(
    participantId: string, 
    peerConnection: RTCPeerConnection
  ): Promise<boolean> {
    console.log(`[RECOVERY] Performing ICE restart for ${participantId}`);
    
    try {
      // Create offer with ICE restart
      const offer = await peerConnection.createOffer({ iceRestart: true });
      await peerConnection.setLocalDescription(offer);
      
      // TODO: Send offer via signaling server
      
      return true;
    } catch (error) {
      console.error(`[RECOVERY] ICE restart failed for ${participantId}:`, error);
      return false;
    }
  }

  private async performFullReconnect(
    participantId: string,
    webrtcService: any
  ): Promise<boolean> {
    console.log(`[RECOVERY] Performing full reconnect for ${participantId}`);
    
    try {
      // Close existing connection
      webrtcService.closePeerConnection?.(participantId);
      
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Recreate connection
      await webrtcService.createOffer?.(participantId);
      
      return true;
    } catch (error) {
      console.error(`[RECOVERY] Full reconnect failed for ${participantId}:`, error);
      return false;
    }
  }

  private async performFallbackRecovery(
    participantId: string,
    peerConnection: RTCPeerConnection
  ): Promise<boolean> {
    console.log(`[RECOVERY] Performing fallback recovery for ${participantId}`);
    
    try {
      // Try different STUN/TURN servers
      const fallbackConfig: RTCConfiguration = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          }
        ]
      };

      // Apply new configuration
      peerConnection.setConfiguration(fallbackConfig);
      
      // Restart ICE with new configuration
      const offer = await peerConnection.createOffer({ iceRestart: true });
      await peerConnection.setLocalDescription(offer);
      
      return true;
    } catch (error) {
      console.error(`[RECOVERY] Fallback recovery failed for ${participantId}:`, error);
      return false;
    }
  }

  private updateRecoveryState(participantId: string, success: boolean): void {
    const state = this.recoveryStates.get(participantId);
    if (!state) return;

    if (!success) {
      state.retryCount++;
      state.lastAttempt = Date.now();
      state.backoffDelay = this.calculateBackoffDelay(state.retryCount);
    }
  }

  private resetRecoveryState(participantId: string): void {
    this.recoveryStates.delete(participantId);
    console.log(`[RECOVERY] Recovery state reset for ${participantId}`);
  }

  private async scheduleRetry(
    participantId: string,
    peerConnection: RTCPeerConnection,
    webrtcService: any
  ): Promise<void> {
    const state = this.recoveryStates.get(participantId);
    if (!state) return;

    const delay = state.backoffDelay;
    console.log(`[RECOVERY] Scheduling retry for ${participantId} in ${delay}ms`);
    
    setTimeout(() => {
      this.recoverConnection(participantId, peerConnection, webrtcService);
    }, delay);
  }

  private calculateBackoffDelay(retryCount: number): number {
    const exponentialDelay = Math.min(
      this.config.baseDelay * Math.pow(2, retryCount),
      this.config.maxDelay
    );
    
    // Add jitter to prevent thundering herd
    const jitter = exponentialDelay * this.config.jitterFactor * (Math.random() - 0.5);
    
    return Math.floor(exponentialDelay + jitter);
  }

  // Get recovery status for monitoring
  getRecoveryStatus(participantId: string): ConnectionRecoveryState | null {
    return this.recoveryStates.get(participantId) || null;
  }

  // Get all active recovery states
  getAllRecoveryStates(): Map<string, ConnectionRecoveryState> {
    return new Map(this.recoveryStates);
  }

  // Clear recovery state for a participant
  clearRecoveryState(participantId: string): void {
    this.recoveryStates.delete(participantId);
  }

  // Cleanup old recovery states
  cleanup(olderThanMinutes: number = 10): void {
    const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);
    let cleanedCount = 0;

    for (const [participantId, state] of this.recoveryStates.entries()) {
      if (state.lastAttempt < cutoffTime) {
        this.recoveryStates.delete(participantId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[RECOVERY] Cleaned up ${cleanedCount} old recovery states`);
    }
  }
}

export { ConnectionRecoveryManager, type ConnectionRecoveryConfig, type ConnectionRecoveryState };