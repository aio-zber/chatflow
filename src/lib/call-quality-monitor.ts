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

  private storeMetric(participantId: string, metric: CallQualityMetrics): void {
    if (!this.metricsHistory.has(participantId)) {
      this.metricsHistory.set(participantId, []);
    }

    const history = this.metricsHistory.get(participantId)!;
    history.push(metric);

    // Keep only recent metrics
    if (history.length > this.maxHistorySize) {
      history.splice(0, history.length - this.maxHistorySize);
    }
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

  // Get quality metrics for a participant
  getMetricsHistory(participantId: string): CallQualityMetrics[] {
    return this.metricsHistory.get(participantId) || [];
  }

  // Get latest metrics for all participants
  getLatestMetrics(): Map<string, CallQualityMetrics> {
    const latest = new Map<string, CallQualityMetrics>();
    
    this.metricsHistory.forEach((history, participantId) => {
      if (history.length > 0) {
        latest.set(participantId, history[history.length - 1]);
      }
    });
    
    return latest;
  }

  // Calculate average quality over time
  getAverageQuality(participantId: string, windowMinutes: number = 5): {
    avgPacketLoss: number;
    avgRoundTripTime: number;
    avgJitter: number;
  } | null {
    const history = this.metricsHistory.get(participantId);
    if (!history || history.length === 0) return null;

    const cutoffTime = Date.now() - (windowMinutes * 60 * 1000);
    const recentMetrics = history.filter(m => m.timestamp >= cutoffTime);
    
    if (recentMetrics.length === 0) return null;

    const totalPacketLoss = recentMetrics.reduce((sum, m) => sum + m.packetLoss, 0);
    const totalRTT = recentMetrics.reduce((sum, m) => sum + m.roundTripTime, 0);
    const totalJitter = recentMetrics.reduce((sum, m) => sum + m.jitter, 0);

    return {
      avgPacketLoss: totalPacketLoss / recentMetrics.length,
      avgRoundTripTime: totalRTT / recentMetrics.length,
      avgJitter: totalJitter / recentMetrics.length
    };
  }

  // Clear old metrics
  cleanup(olderThanMinutes: number = 30): void {
    const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);
    let cleanedCount = 0;

    this.metricsHistory.forEach((history, participantId) => {
      const originalLength = history.length;
      const filtered = history.filter(m => m.timestamp >= cutoffTime);
      
      if (filtered.length < originalLength) {
        this.metricsHistory.set(participantId, filtered);
        cleanedCount += originalLength - filtered.length;
      }
    });

    if (cleanedCount > 0) {
      console.log(`[QUALITY] Cleaned up ${cleanedCount} old metrics entries`);
    }
  }
}

export { CallQualityMonitor, type CallQualityMetrics, type CallQualityThresholds };