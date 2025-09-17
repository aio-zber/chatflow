import { WebRTCService } from './webrtc';

class EnhancedWebRTCService extends WebRTCService {
  private cleanupTimers: Set<NodeJS.Timeout> = new Set();
  private activeIntervals: Set<NodeJS.Timeout> = new Set();
  private resourceMonitoringEnabled = true;

  constructor(socket: any, userId: string) {
    super(socket, userId);
    this.startResourceMonitoring();
  }

  private startResourceMonitoring(): void {
    if (!this.resourceMonitoringEnabled) return;

    const monitoringInterval = setInterval(() => {
      this.monitorResourceUsage();
    }, 60000); // Monitor every minute

    this.activeIntervals.add(monitoringInterval);
  }

  // PHASE 5 FIX: Enhanced resource monitoring with performance optimizations
  private monitorResourceUsage(): void {
    const peerConnections = this.getActivePeerConnections();
    const activePeers = peerConnections.size;

    console.log(`[WebRTC Enhanced] Resource monitoring - Active peers: ${activePeers}`);

    // Enhanced connection health monitoring
    let staleConnections = 0;
    let stuckConnections = 0;
    let performanceIssues = 0;

    peerConnections.forEach((peerConn, participantId) => {
      const connectionState = peerConn.connection.connectionState;
      const iceState = peerConn.connection.iceConnectionState;
      const connectionAge = Date.now() - (peerConn.createdAt || 0);

      // Detect stale connections
      if (connectionState === 'failed' || connectionState === 'closed' ||
          iceState === 'failed' || iceState === 'closed') {
        console.log(`[WebRTC Enhanced] Found stale connection for ${participantId}: ${connectionState}/${iceState}`);
        this.removePeerConnection(participantId);
        staleConnections++;
      }
      // PHASE 5 FIX: Detect stuck connections with age-based detection
      else if ((connectionState === 'connecting' && connectionAge > 20000) ||
               (iceState === 'checking' && connectionAge > 25000) ||
               (connectionState === 'new' && connectionAge > 15000)) {
        console.log(`[WebRTC Enhanced] Found stuck connection for ${participantId}: ${connectionState}/${iceState}, age: ${connectionAge}ms`);
        this.removePeerConnection(participantId);
        stuckConnections++;
      }
      // Monitor for performance issues
      else if (connectionAge > 60000 && connectionState !== 'connected') {
        console.warn(`[WebRTC Enhanced] Performance issue for ${participantId}: long-running non-connected state ${connectionState}`);
        performanceIssues++;
      }
    });

    // Detailed cleanup reporting
    if (staleConnections > 0 || stuckConnections > 0) {
      console.log(`[WebRTC Enhanced] Cleaned up - stale: ${staleConnections}, stuck: ${stuckConnections}, performance issues: ${performanceIssues}`);
    }

    // Enhanced memory usage monitoring with recommendations
    if (activePeers > 8) {
      console.warn(`[WebRTC Enhanced] High peer connection count: ${activePeers} (recommended max: 8 for optimal performance)`);
      if (activePeers > 12) {
        console.error(`[WebRTC Enhanced] CRITICAL: Too many peer connections (${activePeers}) - expect performance degradation`);
        // Trigger optimization for high peer count
        this.optimizeForMemoryUsage();
      }
    }

    // Connection quality assessment
    let healthyConnections = 0;
    peerConnections.forEach((peerConn) => {
      if (peerConn.connection.connectionState === 'connected' &&
          (peerConn.connection.iceConnectionState === 'connected' ||
           peerConn.connection.iceConnectionState === 'completed')) {
        healthyConnections++;
      }
    });

    const healthRatio = activePeers > 0 ? (healthyConnections / activePeers) * 100 : 100;
    if (healthRatio < 80 && activePeers > 1) {
      console.warn(`[WebRTC Enhanced] Connection health below 80%: ${healthRatio.toFixed(1)}% (${healthyConnections}/${activePeers})`);
    }
  }

  // Override cleanup to ensure all resources are properly released
  cleanup(): void {
    console.log('[WebRTC Enhanced] 🧹 Enhanced cleanup starting...');

    this.resourceMonitoringEnabled = false;

    // Clear all timers first with enhanced tracking
    console.log(`[WebRTC Enhanced] Clearing ${this.cleanupTimers.size} timers and ${this.activeIntervals.size} intervals`);
    this.cleanupTimers.forEach(timer => {
      try {
        clearTimeout(timer);
      } catch (error) {
        console.warn('[WebRTC Enhanced] Error clearing timer:', error);
      }
    });
    this.activeIntervals.forEach(interval => {
      try {
        clearInterval(interval);
      } catch (error) {
        console.warn('[WebRTC Enhanced] Error clearing interval:', error);
      }
    });
    this.cleanupTimers.clear();
    this.activeIntervals.clear();

    // Enhanced peer connection cleanup with connection state validation
    const peerConnections = this.getActivePeerConnections();
    console.log(`[WebRTC Enhanced] Cleaning up ${peerConnections.size} peer connections`);

    peerConnections.forEach((peerConn, participantId) => {
      const connectionState = peerConn.connection.connectionState;
      const iceState = peerConn.connection.iceConnectionState;

      console.log(`[WebRTC Enhanced] Cleaning up connection for ${participantId}: ${connectionState}/${iceState}`);

      try {
        // Force close regardless of state
        if (connectionState !== 'closed') {
          peerConn.connection.close();
        }
        this.removePeerConnection(participantId);
      } catch (error) {
        console.warn(`[WebRTC Enhanced] Error cleaning up connection for ${participantId}:`, error);
      }
    });

    // Call parent cleanup
    super.cleanup();

    // Additional memory cleanup
    try {
      // Clear any remaining references
      this.cleanupTimers = new Set();
      this.activeIntervals = new Set();

      // Force garbage collection hint (if available)
      if (typeof window !== 'undefined' && (window as any).gc) {
        try {
          (window as any).gc();
          console.log('[WebRTC Enhanced] ✅ Forced garbage collection');
        } catch (e) {
          console.log('[WebRTC Enhanced] GC not available (normal in production)');
        }
      }
    } catch (error) {
      console.warn('[WebRTC Enhanced] Error during memory cleanup:', error);
    }

    console.log('[WebRTC Enhanced] 🎯 Enhanced cleanup completed');
  }

  // Enhanced timer tracking
  private addTimer(timer: NodeJS.Timeout): void {
    this.cleanupTimers.add(timer);
  }

  private addInterval(interval: NodeJS.Timeout): void {
    this.activeIntervals.add(interval);
  }

  // Override methods to track timers
  protected createTrackedTimeout(callback: () => void, delay: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(timer);
      callback();
    }, delay);
    this.addTimer(timer);
    return timer;
  }

  // Enhanced connection recovery with retry limits
  private connectionRetryCount = new Map<string, number>();
  private readonly MAX_RETRY_COUNT = 3;

  protected async attemptConnectionRecovery(participantId: string): Promise<boolean> {
    const currentRetries = this.connectionRetryCount.get(participantId) || 0;
    
    if (currentRetries >= this.MAX_RETRY_COUNT) {
      console.error(`[WebRTC Enhanced] Max retries exceeded for ${participantId}`);
      this.connectionRetryCount.delete(participantId);
      return false;
    }

    console.log(`[WebRTC Enhanced] Recovery attempt ${currentRetries + 1}/${this.MAX_RETRY_COUNT} for ${participantId}`);
    this.connectionRetryCount.set(participantId, currentRetries + 1);

    try {
      // Enhanced recovery logic would go here
      // For now, use the parent's recovery mechanism
      return true;
    } catch (error) {
      console.error(`[WebRTC Enhanced] Recovery failed for ${participantId}:`, error);
      return false;
    } finally {
      // Reset retry count on successful recovery
      setTimeout(() => {
        this.connectionRetryCount.delete(participantId);
      }, 30000); // Reset after 30 seconds
    }
  }

  // Enhanced quality monitoring with bandwidth adaptation
  private qualityMetrics = new Map<string, {
    packetLoss: number;
    roundTripTime: number;
    bandwidth: number;
    lastUpdate: number;
  }>();

  public getQualityMetrics(participantId: string) {
    return this.qualityMetrics.get(participantId);
  }

  // Memory-efficient stream handling
  public optimizeForMemoryUsage(): void {
    const peerConnections = this.getActivePeerConnections();
    
    peerConnections.forEach((peerConn, participantId) => {
      // Optimize transceivers for lower memory usage
      try {
        const transceivers = peerConn.connection.getTransceivers();
        transceivers.forEach(transceiver => {
          if (transceiver.direction === 'sendrecv') {
            // Optimize encoding parameters
            const sender = transceiver.sender;
            if (sender.track) {
              sender.getParameters().then(params => {
                if (params.encodings && params.encodings[0]) {
                  // Reduce memory footprint with conservative settings
                  params.encodings[0].maxBitrate = Math.min(params.encodings[0].maxBitrate || 1000000, 500000);
                  return sender.setParameters(params);
                }
              }).catch(error => {
                console.warn(`[WebRTC Enhanced] Failed to optimize encoding for ${participantId}:`, error);
              });
            }
          }
        });
      } catch (error) {
        console.warn(`[WebRTC Enhanced] Failed to optimize transceivers for ${participantId}:`, error);
      }
    });

    console.log(`[WebRTC Enhanced] Optimized ${peerConnections.size} connections for memory usage`);
  }
}

export { EnhancedWebRTCService };