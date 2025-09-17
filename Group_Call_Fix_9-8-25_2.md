# Group Call Fix Implementation Plan 9-8-25_2

## 🎯 Executive Summary
This comprehensive plan addresses all critical issues identified in the call system analysis, implementing a phased approach that prioritizes immediate production stability while preparing for long-term scalability. The plan follows best practices for WebRTC architecture, memory management, and system design.

## 📋 Implementation Phases

### Phase 1: IMMEDIATE CRITICAL FIXES (Week 1) 🚨
**Goal**: Make current system production-safe with strict limitations
**Timeline**: 5-7 days
**Risk Level**: Low (safety improvements only)

#### 1.1 Memory Leak Prevention - CRITICAL
**Priority**: P0 - Deploy blocker

```typescript
// src/lib/socket-cleanup.ts - NEW FILE
interface CallCleanupService {
  cleanupStaleActiveCalls(): void;
  cleanupCallTraces(): void;
  monitorMemoryUsage(): void;
}

class CallCleanupManager implements CallCleanupService {
  private readonly MAX_ACTIVE_CALLS = 100;
  private readonly MAX_CALL_TRACES = 1000;
  private readonly CLEANUP_INTERVAL = 300000; // 5 minutes
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    this.startCleanupCycle();
  }

  private startCleanupCycle(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleActiveCalls();
      this.cleanupCallTraces();
      this.monitorMemoryUsage();
    }, this.CLEANUP_INTERVAL);
  }

  cleanupStaleActiveCalls(): void {
    const now = Date.now();
    const STALE_CALL_TIMEOUT = 3600000; // 1 hour
    
    for (const [callId, call] of activeCalls.entries()) {
      const callAge = now - call.startTime;
      if (callAge > STALE_CALL_TIMEOUT || call.participants.size === 0) {
        console.log(`[CLEANUP] Removing stale call: ${callId}, age: ${callAge}ms`);
        activeCalls.delete(callId);
      }
    }
  }

  cleanupCallTraces(): void {
    if (createdCallTraces.size > this.MAX_CALL_TRACES) {
      console.log(`[CLEANUP] Clearing call traces cache, size: ${createdCallTraces.size}`);
      createdCallTraces.clear();
    }
  }

  monitorMemoryUsage(): void {
    const activeCallsCount = activeCalls.size;
    const callTracesCount = createdCallTraces.size;
    
    console.log(`[MEMORY] Active calls: ${activeCallsCount}, Call traces: ${callTracesCount}`);
    
    if (activeCallsCount > this.MAX_ACTIVE_CALLS) {
      console.error(`CRITICAL: Active calls exceeding safe limits: ${activeCallsCount}`);
      // Emit alert to monitoring system
      this.emitMemoryAlert('active_calls_limit', activeCallsCount);
    }
  }

  private emitMemoryAlert(type: string, value: number): void {
    // Integration with monitoring system (Sentry, DataDog, etc.)
    console.error(`MEMORY_ALERT: ${type} = ${value}`);
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}
```

#### 1.2 Participant Limits with Graceful Degradation
**Priority**: P0 - Safety measure

```typescript
// src/lib/call-limits.ts - NEW FILE
export class CallLimitsManager {
  private static readonly MAX_PARTICIPANTS_BASIC = 2;  // 1-on-1 only initially
  private static readonly MAX_PARTICIPANTS_BETA = 4;   // Future beta testing
  private static readonly MAX_PARTICIPANTS_PREMIUM = 8; // Future premium feature

  static validateCallParticipants(
    participants: string[], 
    isGroupCall: boolean,
    userTier: 'basic' | 'beta' | 'premium' = 'basic'
  ): { allowed: boolean; reason?: string; maxAllowed: number } {
    const limits = {
      basic: this.MAX_PARTICIPANTS_BASIC,
      beta: this.MAX_PARTICIPANTS_BETA,
      premium: this.MAX_PARTICIPANTS_PREMIUM
    };

    const maxAllowed = limits[userTier];
    const actualCount = participants.length;

    if (actualCount > maxAllowed) {
      return {
        allowed: false,
        reason: `Group calls limited to ${maxAllowed} participants for ${userTier} users`,
        maxAllowed
      };
    }

    // Special handling for group calls in basic tier
    if (userTier === 'basic' && isGroupCall && actualCount > 2) {
      return {
        allowed: false,
        reason: 'Group calls not supported in current version. Please upgrade for multi-participant calls.',
        maxAllowed
      };
    }

    return { allowed: true, maxAllowed };
  }

  static getRecommendedAction(participantCount: number): string {
    if (participantCount <= 2) return 'direct_call';
    if (participantCount <= 4) return 'small_group_beta';
    if (participantCount <= 8) return 'medium_group_premium';
    return 'enterprise_solution_required';
  }
}
```

#### 1.3 Enhanced Resource Cleanup
**Priority**: P1 - Performance and stability

```typescript
// src/lib/webrtc-enhanced.ts - Enhancement to existing WebRTC service
class EnhancedWebRTCService extends WebRTCService {
  private cleanupTimers: Set<NodeJS.Timeout> = new Set();
  private activeIntervals: Set<NodeJS.Timeout> = new Set();

  // Override cleanup to ensure all resources are properly released
  cleanup(): void {
    console.log('[WebRTC] 🧹 Enhanced cleanup starting...');
    
    // Clear all timers first
    this.cleanupTimers.forEach(timer => clearTimeout(timer));
    this.activeIntervals.forEach(interval => clearInterval(interval));
    this.cleanupTimers.clear();
    this.activeIntervals.clear();
    
    // Call parent cleanup
    super.cleanup();
    
    // Force garbage collection hint (if available)
    if (typeof window !== 'undefined' && window.gc) {
      try {
        window.gc();
        console.log('[WebRTC] ✅ Forced garbage collection');
      } catch (e) {
        console.log('[WebRTC] GC not available (normal in production)');
      }
    }
    
    console.log('[WebRTC] 🎯 Enhanced cleanup completed');
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
}
```

### Phase 2: SHORT-TERM PRODUCTION STABILIZATION (Weeks 2-3) ⚡
**Goal**: Implement robust monitoring and improve reliability
**Timeline**: 10-14 days
**Risk Level**: Medium (significant improvements)

#### 2.1 Circuit Breaker Implementation
**Priority**: P1 - Prevent cascade failures

```typescript
// src/lib/circuit-breaker.ts - NEW FILE
interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringWindow: number;
}

enum CircuitState {
  CLOSED = 'closed',     // Normal operation
  OPEN = 'open',         // Failing, reject requests
  HALF_OPEN = 'half_open' // Testing recovery
}

class CallCircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private lastFailureTime = 0;
  private nextAttempt = 0;

  constructor(private config: CircuitBreakerConfig) {}

  async executeCall<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker OPEN - calls temporarily disabled');
      }
      this.state = CircuitState.HALF_OPEN;
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = CircuitState.CLOSED;
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.config.recoveryTimeout;
      console.error(`[CIRCUIT_BREAKER] OPENED - too many failures: ${this.failures}`);
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

// Usage in call initiation
export const callCircuitBreaker = new CallCircuitBreaker({
  failureThreshold: 5,
  recoveryTimeout: 30000, // 30 seconds
  monitoringWindow: 60000  // 1 minute
});
```

#### 2.2 Call Quality Monitoring System
**Priority**: P1 - Essential for production monitoring

```typescript
// src/lib/call-quality-monitor.ts - NEW FILE
interface CallQualityMetrics {
  callId: string;
  participantId: string;
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  packetLoss: number;
  roundTripTime: number;
  jitter: number;
  bandwidth: { upload: number; download: number };
  timestamp: number;
}

interface CallQualityThresholds {
  packetLossWarning: number;
  packetLossCritical: number;
  rttWarning: number;
  rttCritical: number;
  jitterWarning: number;
  jitterCritical: number;
}

class CallQualityMonitor {
  private static readonly DEFAULT_THRESHOLDS: CallQualityThresholds = {
    packetLossWarning: 0.02,   // 2%
    packetLossCritical: 0.05,  // 5%
    rttWarning: 150,           // 150ms
    rttCritical: 300,          // 300ms
    jitterWarning: 30,         // 30ms
    jitterCritical: 50         // 50ms
  };

  private metricsHistory: Map<string, CallQualityMetrics[]> = new Map();
  private readonly maxHistorySize = 100;

  async collectMetrics(
    callId: string, 
    peerConnections: Map<string, RTCPeerConnection>
  ): Promise<CallQualityMetrics[]> {
    const metrics: CallQualityMetrics[] = [];

    for (const [participantId, pc] of peerConnections.entries()) {
      try {
        const stats = await pc.getStats();
        const metric = await this.parseRTCStats(callId, participantId, pc, stats);
        metrics.push(metric);
        this.storeMetric(participantId, metric);
        this.evaluateQuality(metric);
      } catch (error) {
        console.error(`[QUALITY] Failed to collect metrics for ${participantId}:`, error);
      }
    }

    return metrics;
  }

  private async parseRTCStats(
    callId: string,
    participantId: string,
    pc: RTCPeerConnection,
    stats: RTCStatsReport
  ): Promise<CallQualityMetrics> {
    let packetLoss = 0;
    let roundTripTime = 0;
    let jitter = 0;
    let bandwidth = { upload: 0, download: 0 };

    stats.forEach((report) => {
      if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
        packetLoss = Math.max(packetLoss, report.packetsLost / (report.packetsReceived + report.packetsLost) || 0);
        jitter = Math.max(jitter, report.jitter || 0);
      }
      
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        roundTripTime = Math.max(roundTripTime, report.currentRoundTripTime * 1000 || 0);
      }
      
      if (report.type === 'outbound-rtp') {
        bandwidth.upload += report.bytesSent || 0;
      }
      
      if (report.type === 'inbound-rtp') {
        bandwidth.download += report.bytesReceived || 0;
      }
    });

    return {
      callId,
      participantId,
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      packetLoss,
      roundTripTime,
      jitter,
      bandwidth,
      timestamp: Date.now()
    };
  }

  private evaluateQuality(metric: CallQualityMetrics): void {
    const issues: string[] = [];
    const thresholds = CallQualityMonitor.DEFAULT_THRESHOLDS;

    if (metric.packetLoss > thresholds.packetLossCritical) {
      issues.push(`CRITICAL packet loss: ${(metric.packetLoss * 100).toFixed(1)}%`);
    } else if (metric.packetLoss > thresholds.packetLossWarning) {
      issues.push(`HIGH packet loss: ${(metric.packetLoss * 100).toFixed(1)}%`);
    }

    if (metric.roundTripTime > thresholds.rttCritical) {
      issues.push(`CRITICAL latency: ${metric.roundTripTime.toFixed(0)}ms`);
    } else if (metric.roundTripTime > thresholds.rttWarning) {
      issues.push(`HIGH latency: ${metric.roundTripTime.toFixed(0)}ms`);
    }

    if (issues.length > 0) {
      console.warn(`[QUALITY] ${metric.callId}/${metric.participantId}: ${issues.join(', ')}`);
      this.reportQualityIssues(metric, issues);
    }
  }

  private reportQualityIssues(metric: CallQualityMetrics, issues: string[]): void {
    // Integration with monitoring service
    // This would typically send to DataDog, Sentry, CloudWatch, etc.
    console.log(`[QUALITY_ALERT] Call: ${metric.callId}, Issues: ${issues.join(', ')}`);
  }
}
```

#### 2.3 SFU Architecture Planning and Preparation
**Priority**: P1 - Foundation for scalability

```typescript
// src/lib/sfu-adapter.ts - NEW FILE (Interface for future SFU integration)
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
  
  async connect(): Promise<void> {
    // Implementation will use LiveKit SDK
    console.log('[SFU] Connecting to LiveKit server...');
    // TODO: Implement LiveKit connection
  }

  async createRoom(roomId: string, maxParticipants: number): Promise<SFURoom> {
    // Implementation for room creation
    console.log(`[SFU] Creating room: ${roomId}, max participants: ${maxParticipants}`);
    // TODO: Implement room creation
    return {
      id: roomId,
      name: roomId,
      participants: [],
      maxParticipants,
      created: new Date()
    };
  }

  // ... other methods implementation
}
```

### Phase 3: ADVANCED RELIABILITY IMPROVEMENTS (Week 4) 🛡️
**Goal**: Production-grade error handling and recovery
**Timeline**: 7 days
**Risk Level**: Medium-Low (stability improvements)

#### 3.1 Advanced Connection Recovery
**Priority**: P2 - Improved reliability

```typescript
// src/lib/connection-recovery-manager.ts - NEW FILE
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

  private calculateBackoffDelay(retryCount: number): number {
    const exponentialDelay = Math.min(
      this.config.baseDelay * Math.pow(2, retryCount),
      this.config.maxDelay
    );
    
    // Add jitter to prevent thundering herd
    const jitter = exponentialDelay * this.config.jitterFactor * (Math.random() - 0.5);
    
    return Math.floor(exponentialDelay + jitter);
  }
}
```

### Phase 4: PERFORMANCE OPTIMIZATIONS (Week 5-6) 🚀
**Goal**: Optimize for production scale and user experience
**Timeline**: 10-14 days
**Risk Level**: Low (performance improvements)

#### 4.1 React Component Optimizations
**Priority**: P2 - User experience improvements

```typescript
// src/components/video/OptimizedVideoGrid.tsx - NEW FILE
import React, { memo, useMemo, useCallback, useRef, useEffect } from 'react';
import { FixedSizeGrid as Grid } from 'react-window';

interface OptimizedVideoGridProps {
  participants: VideoParticipant[];
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  maxVisibleParticipants?: number;
}

// Memoized individual video component
const VideoParticipantCard = memo(({ 
  participant, 
  stream, 
  isLocal = false 
}: {
  participant: VideoParticipant;
  stream: MediaStream | null;
  isLocal?: boolean;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Memoize expensive operations
  const streamId = useMemo(() => stream?.id || 'no-stream', [stream]);
  
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="video-participant-card" data-stream-id={streamId}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className="w-full h-full object-cover"
      />
      <div className="participant-info">
        {participant.name}
      </div>
    </div>
  );
});

// Virtualized grid for large participant counts
export const OptimizedVideoGrid = memo(({
  participants,
  localStream,
  remoteStreams,
  maxVisibleParticipants = 9
}: OptimizedVideoGridProps) => {
  // Memoize grid calculations
  const gridConfig = useMemo(() => {
    const totalParticipants = participants.length + 1; // +1 for local
    const cols = Math.min(Math.ceil(Math.sqrt(totalParticipants)), 4);
    const rows = Math.ceil(totalParticipants / cols);
    
    return { cols, rows, totalParticipants };
  }, [participants.length]);

  // Memoize participant data
  const allParticipants = useMemo(() => {
    const local = {
      id: 'local',
      name: 'You',
      stream: localStream,
      isLocal: true
    };
    
    const remote = participants.map(p => ({
      ...p,
      stream: remoteStreams.get(p.id) || null,
      isLocal: false
    }));
    
    return [local, ...remote];
  }, [participants, localStream, remoteStreams]);

  // Use virtualization for large groups
  if (gridConfig.totalParticipants > maxVisibleParticipants) {
    return (
      <VirtualizedVideoGrid 
        participants={allParticipants}
        gridConfig={gridConfig}
      />
    );
  }

  // Regular grid for small groups
  return (
    <div className={`video-grid grid-cols-${gridConfig.cols}`}>
      {allParticipants.map((participant) => (
        <VideoParticipantCard
          key={participant.id}
          participant={participant}
          stream={participant.stream}
          isLocal={participant.isLocal}
        />
      ))}
    </div>
  );
});

// Virtualized grid component for large participant counts
const VirtualizedVideoGrid = memo(({ participants, gridConfig }: any) => {
  const cellRenderer = useCallback(({ columnIndex, rowIndex, style }: any) => {
    const participantIndex = rowIndex * gridConfig.cols + columnIndex;
    const participant = participants[participantIndex];
    
    if (!participant) return null;
    
    return (
      <div style={style}>
        <VideoParticipantCard
          participant={participant}
          stream={participant.stream}
          isLocal={participant.isLocal}
        />
      </div>
    );
  }, [participants, gridConfig.cols]);

  return (
    <Grid
      columnCount={gridConfig.cols}
      rowCount={gridConfig.rows}
      columnWidth={300}
      rowHeight={200}
      height={600}
      width={1200}
    >
      {cellRenderer}
    </Grid>
  );
});
```

#### 4.2 Bandwidth Optimization
**Priority**: P2 - Network efficiency

```typescript
// src/lib/bandwidth-optimizer.ts - NEW FILE
interface BandwidthConfig {
  maxVideoBitrate: number;
  maxAudioBitrate: number;
  adaptiveQuality: boolean;
  simulcast: boolean;
}

interface NetworkQuality {
  bandwidth: number;
  latency: number;
  packetLoss: number;
  quality: 'poor' | 'fair' | 'good' | 'excellent';
}

class BandwidthOptimizer {
  private static readonly QUALITY_PRESETS = {
    poor: { videoBitrate: 150_000, audioBitrate: 32_000, fps: 15 },
    fair: { videoBitrate: 300_000, audioBitrate: 48_000, fps: 24 },
    good: { videoBitrate: 500_000, audioBitrate: 64_000, fps: 30 },
    excellent: { videoBitrate: 1_000_000, audioBitrate: 128_000, fps: 30 }
  };

  static async optimizeForNetworkConditions(
    peerConnection: RTCPeerConnection,
    networkQuality: NetworkQuality,
    participantCount: number
  ): Promise<void> {
    const preset = this.QUALITY_PRESETS[networkQuality.quality];
    
    // Adjust for participant count - reduce quality as more participants join
    const participantMultiplier = Math.max(0.3, 1 - (participantCount - 2) * 0.15);
    const adjustedVideoBitrate = Math.floor(preset.videoBitrate * participantMultiplier);
    const adjustedAudioBitrate = Math.floor(preset.audioBitrate * participantMultiplier);

    console.log(`[BANDWIDTH] Optimizing for ${networkQuality.quality} quality, ${participantCount} participants`);
    console.log(`[BANDWIDTH] Video: ${adjustedVideoBitrate} bps, Audio: ${adjustedAudioBitrate} bps`);

    // Apply constraints to senders
    const senders = peerConnection.getSenders();
    
    for (const sender of senders) {
      if (sender.track) {
        const params = sender.getParameters();
        
        if (sender.track.kind === 'video') {
          // Apply video constraints
          if (params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = adjustedVideoBitrate;
            params.encodings[0].maxFramerate = preset.fps;
            
            // Enable simulcast for group calls
            if (participantCount > 2) {
              this.enableSimulcast(params);
            }
          }
        } else if (sender.track.kind === 'audio') {
          // Apply audio constraints
          if (params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = adjustedAudioBitrate;
          }
        }
        
        await sender.setParameters(params);
      }
    }
  }

  private static enableSimulcast(params: RTCRtpSendParameters): void {
    // Configure simulcast layers for adaptive quality
    params.encodings = [
      { rid: 'high', maxBitrate: 1000_000, scaleResolutionDownBy: 1 },
      { rid: 'medium', maxBitrate: 300_000, scaleResolutionDownBy: 2 },
      { rid: 'low', maxBitrate: 100_000, scaleResolutionDownBy: 4 }
    ];
  }

  static async measureNetworkQuality(): Promise<NetworkQuality> {
    // Simplified network quality assessment
    try {
      const startTime = performance.now();
      await fetch('/api/ping', { method: 'HEAD' });
      const latency = performance.now() - startTime;
      
      // Estimate bandwidth (this would be more sophisticated in production)
      const bandwidth = this.estimateBandwidth();
      const packetLoss = 0; // Would use WebRTC stats in practice
      
      const quality = this.calculateQualityScore(bandwidth, latency, packetLoss);
      
      return { bandwidth, latency, packetLoss, quality };
    } catch (error) {
      console.error('[BANDWIDTH] Failed to measure network quality:', error);
      return { bandwidth: 0, latency: 999, packetLoss: 0.1, quality: 'poor' };
    }
  }

  private static calculateQualityScore(
    bandwidth: number, 
    latency: number, 
    packetLoss: number
  ): 'poor' | 'fair' | 'good' | 'excellent' {
    if (latency > 300 || packetLoss > 0.05 || bandwidth < 500_000) return 'poor';
    if (latency > 150 || packetLoss > 0.02 || bandwidth < 1_000_000) return 'fair';
    if (latency > 50 || packetLoss > 0.01 || bandwidth < 2_000_000) return 'good';
    return 'excellent';
  }

  private static estimateBandwidth(): number {
    // Simplified bandwidth estimation
    // In production, this would use more sophisticated methods
    return 1_500_000; // 1.5 Mbps default estimate
  }
}
```

### Phase 5: TESTING AND VALIDATION (Week 7) 🧪
**Goal**: Ensure all fixes work correctly before production
**Timeline**: 7 days
**Risk Level**: Low (testing phase)

#### 5.1 Comprehensive Test Suite
**Priority**: P1 - Critical for validation

```typescript
// src/__tests__/call-system.integration.test.ts - NEW FILE
import { describe, it, expect, beforeEach, afterEach } from 'jest';
import { CallLimitsManager } from '../lib/call-limits';
import { CallCircuitBreaker } from '../lib/circuit-breaker';
import { CallQualityMonitor } from '../lib/call-quality-monitor';

describe('Call System Integration Tests', () => {
  describe('Call Limits', () => {
    it('should enforce participant limits correctly', () => {
      const result = CallLimitsManager.validateCallParticipants(
        ['user1', 'user2', 'user3'], // 3 participants
        true, // is group call
        'basic' // user tier
      );
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Group calls not supported');
    });

    it('should allow 1-on-1 calls for basic users', () => {
      const result = CallLimitsManager.validateCallParticipants(
        ['user1', 'user2'], // 2 participants
        false, // not group call
        'basic'
      );
      
      expect(result.allowed).toBe(true);
    });
  });

  describe('Circuit Breaker', () => {
    it('should open circuit after failure threshold', async () => {
      const circuitBreaker = new CallCircuitBreaker({
        failureThreshold: 3,
        recoveryTimeout: 1000,
        monitoringWindow: 5000
      });

      const failingOperation = () => Promise.reject(new Error('Connection failed'));
      
      // First 3 failures should be allowed
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.executeCall(failingOperation);
        } catch (e) {
          // Expected failures
        }
      }
      
      // 4th attempt should be blocked by circuit breaker
      await expect(
        circuitBreaker.executeCall(failingOperation)
      ).rejects.toThrow('Circuit breaker OPEN');
    });
  });

  describe('Memory Management', () => {
    it('should clean up stale calls', () => {
      // Mock test for cleanup functionality
      const cleanup = new CallCleanupManager();
      
      // Add mock stale calls
      const staleCall = {
        startTime: Date.now() - 7200000, // 2 hours old
        participants: new Set()
      };
      
      activeCalls.set('stale-call-1', staleCall);
      
      cleanup.cleanupStaleActiveCalls();
      
      expect(activeCalls.has('stale-call-1')).toBe(false);
    });
  });
});
```

#### 5.2 Load Testing Plan
**Priority**: P1 - Performance validation

```typescript
// src/__tests__/load-testing.ts - NEW FILE
interface LoadTestConfig {
  simultaneousCalls: number;
  callDurationSeconds: number;
  participantsPerCall: number;
  rampUpDurationSeconds: number;
}

class CallLoadTester {
  async runLoadTest(config: LoadTestConfig): Promise<LoadTestResults> {
    console.log(`[LOAD_TEST] Starting test with ${config.simultaneousCalls} calls`);
    
    const results: LoadTestResults = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      averageSetupTime: 0,
      memoryUsagePeak: 0,
      errors: []
    };

    const callPromises: Promise<void>[] = [];
    
    for (let i = 0; i < config.simultaneousCalls; i++) {
      // Stagger call creation for realistic load
      const delay = (i / config.simultaneousCalls) * config.rampUpDurationSeconds * 1000;
      
      callPromises.push(
        this.createDelayedCall(delay, config, results)
      );
    }
    
    await Promise.allSettled(callPromises);
    
    return results;
  }

  private async createDelayedCall(
    delay: number, 
    config: LoadTestConfig, 
    results: LoadTestResults
  ): Promise<void> {
    await this.sleep(delay);
    
    const startTime = Date.now();
    results.totalCalls++;
    
    try {
      await this.simulateCall(config);
      results.successfulCalls++;
      
      const setupTime = Date.now() - startTime;
      results.averageSetupTime = (results.averageSetupTime + setupTime) / results.successfulCalls;
      
    } catch (error) {
      results.failedCalls++;
      results.errors.push(error.message);
    }
  }

  private async simulateCall(config: LoadTestConfig): Promise<void> {
    // Simulate WebRTC connection setup
    await this.sleep(Math.random() * 2000 + 1000); // 1-3 seconds setup
    
    // Simulate call duration
    await this.sleep(config.callDurationSeconds * 1000);
    
    // Simulate cleanup
    await this.sleep(Math.random() * 500 + 200); // 200-700ms cleanup
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

## 🎯 SUCCESS CRITERIA & METRICS

### Phase 1 Success Criteria (Week 1)
- [ ] Zero memory leaks in 24-hour test run
- [ ] Participant limits enforced (max 2 for basic tier)
- [ ] 99.9% resource cleanup success rate
- [ ] No calls exceed 1-hour duration without cleanup

### Phase 2 Success Criteria (Weeks 2-3)
- [ ] Circuit breaker activates within 30 seconds of failures
- [ ] Quality monitoring reports <2% packet loss
- [ ] SFU adapter interfaces defined and tested
- [ ] Call failure rate <1% for 1-on-1 calls

### Phase 3 Success Criteria (Week 4)
- [ ] Connection recovery success rate >85%
- [ ] Average recovery time <10 seconds
- [ ] Zero infinite retry loops
- [ ] Graceful degradation under network stress

### Phase 4 Success Criteria (Weeks 5-6)
- [ ] Video grid renders 50+ participants without lag
- [ ] Bandwidth usage 40% reduction vs. current
- [ ] React component re-renders reduced by 60%
- [ ] UI remains responsive during call operations

### Phase 5 Success Criteria (Week 7)
- [ ] All tests pass with 95% code coverage
- [ ] Load test: 100 concurrent 1-on-1 calls successful
- [ ] Memory usage stable under sustained load
- [ ] Zero critical production issues identified

## 📊 MONITORING & ROLLBACK PLAN

### Production Monitoring
```typescript
// Key metrics to monitor post-deployment
const PRODUCTION_ALERTS = {
  memory_usage: { threshold: '500MB', action: 'scale_up' },
  call_failure_rate: { threshold: '2%', action: 'rollback' },
  connection_time: { threshold: '10s', action: 'investigate' },
  active_calls: { threshold: 100, action: 'circuit_break' }
};
```

### Rollback Triggers
- Call failure rate >5% for 10 minutes
- Memory usage >1GB sustained for 5 minutes  
- Circuit breaker open >50% of time for 15 minutes
- Customer complaints >10 per hour

## 🔄 LONG-TERM VISION (Post Phase 5)

### Future Architecture (Month 2-3)
1. **Full SFU Implementation**: LiveKit or Mediasoup deployment
2. **Cloud Infrastructure**: Auto-scaling WebRTC media servers
3. **Advanced Features**: Recording, transcription, breakout rooms
4. **Mobile Native**: React Native WebRTC integration
5. **Enterprise Scale**: Support for 50+ participant calls

### Technology Stack Evolution
- **Current**: Mesh P2P WebRTC (2 participants max)
- **Phase 5**: Optimized mesh + SFU preparation (3-4 participants)
- **Future**: Full SFU architecture (unlimited participants)

## ⚠️ RISK MITIGATION

### Technical Risks
- **WebRTC compatibility**: Comprehensive browser testing
- **Performance degradation**: Staged rollout with monitoring
- **Memory leaks**: Automated leak detection in CI/CD

### Business Risks  
- **User experience**: Feature flags for gradual rollout
- **Downtime**: Blue-green deployment strategy
- **Scalability**: Auto-scaling infrastructure ready

## 🚀 DEPLOYMENT STRATEGY

### Week 1: Internal Testing
- Deploy to staging environment
- Internal QA and testing
- Performance benchmarking

### Week 2: Beta Release
- Deploy to 10% of users
- Monitor key metrics
- Collect feedback

### Week 3: Gradual Rollout
- 25% → 50% → 75% → 100%
- Monitor at each stage
- Ready rollback at any point

### Week 4+: Full Production
- All users on new system
- Advanced monitoring active
- Optimization based on real usage

This comprehensive plan ensures that all critical issues identified in the analysis are addressed systematically, with proper testing and monitoring at each phase. The approach prioritizes safety and stability while preparing for future scalability needs.