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
    poor: { videoBitrate: 150_000, audioBitrate: 32_000, fps: 15, width: 320, height: 240 },
    fair: { videoBitrate: 300_000, audioBitrate: 48_000, fps: 24, width: 640, height: 480 },
    good: { videoBitrate: 500_000, audioBitrate: 64_000, fps: 30, width: 1280, height: 720 },
    excellent: { videoBitrate: 1_000_000, audioBitrate: 128_000, fps: 30, width: 1920, height: 1080 }
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
            
            // Enable simulcast for group calls to improve bandwidth efficiency
            if (participantCount > 2) {
              this.enableSimulcast(params, networkQuality.quality);
            }
          }

          // Apply track constraints for resolution
          try {
            await sender.track.applyConstraints({
              width: { ideal: preset.width },
              height: { ideal: preset.height },
              frameRate: { ideal: preset.fps }
            });
          } catch (error) {
            console.warn('[BANDWIDTH] Failed to apply track constraints:', error);
          }

        } else if (sender.track.kind === 'audio') {
          // Apply audio constraints
          if (params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = adjustedAudioBitrate;
          }

          // Optimize audio processing for better bandwidth usage
          try {
            await sender.track.applyConstraints({
              sampleRate: networkQuality.quality === 'poor' ? 24000 : 48000,
              channelCount: 1, // Mono for better bandwidth efficiency
              echoCancellation: networkQuality.quality !== 'poor', // Disable for poor connections
              noiseSuppression: networkQuality.quality === 'excellent',
              autoGainControl: networkQuality.quality === 'excellent'
            });
          } catch (error) {
            console.warn('[BANDWIDTH] Failed to apply audio constraints:', error);
          }
        }
        
        await sender.setParameters(params);
      }
    }
  }

  private static enableSimulcast(params: RTCRtpSendParameters, quality: 'poor' | 'fair' | 'good' | 'excellent'): void {
    // Configure simulcast layers for adaptive quality based on network conditions
    switch (quality) {
      case 'poor':
        params.encodings = [
          { rid: 'low', maxBitrate: 100_000, scaleResolutionDownBy: 4 }
        ];
        break;
      case 'fair':
        params.encodings = [
          { rid: 'medium', maxBitrate: 300_000, scaleResolutionDownBy: 2 },
          { rid: 'low', maxBitrate: 100_000, scaleResolutionDownBy: 4 }
        ];
        break;
      case 'good':
      case 'excellent':
        params.encodings = [
          { rid: 'high', maxBitrate: quality === 'excellent' ? 1000_000 : 500_000, scaleResolutionDownBy: 1 },
          { rid: 'medium', maxBitrate: 300_000, scaleResolutionDownBy: 2 },
          { rid: 'low', maxBitrate: 100_000, scaleResolutionDownBy: 4 }
        ];
        break;
    }
    
    console.log(`[BANDWIDTH] Simulcast enabled with ${params.encodings.length} layers for ${quality} quality`);
  }

  static async measureNetworkQuality(): Promise<NetworkQuality> {
    try {
      const startTime = performance.now();
      
      // Test connection latency with multiple endpoints
      const pingPromises = [
        fetch('/api/ping', { method: 'HEAD' }).catch(() => ({ ok: false })),
        fetch('https://www.google.com/favicon.ico', { method: 'HEAD', mode: 'no-cors' }).catch(() => ({ ok: false }))
      ];
      
      await Promise.race(pingPromises);
      const latency = performance.now() - startTime;
      
      // Estimate bandwidth using navigator connection API if available
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
    // Stricter thresholds for better user experience
    if (latency > 300 || packetLoss > 0.05 || bandwidth < 500_000) return 'poor';
    if (latency > 150 || packetLoss > 0.02 || bandwidth < 1_000_000) return 'fair';
    if (latency > 50 || packetLoss > 0.01 || bandwidth < 2_000_000) return 'good';
    return 'excellent';
  }

  private static estimateBandwidth(): number {
    // Use navigator.connection API if available
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    
    if (connection && connection.downlink) {
      // Convert Mbps to bps
      const estimatedBandwidth = connection.downlink * 1_000_000;
      console.log(`[BANDWIDTH] Navigator connection API bandwidth: ${connection.downlink} Mbps`);
      return estimatedBandwidth;
    }
    
    // Fallback estimation based on user agent and other factors
    const userAgent = navigator.userAgent;
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    
    if (isMobile) {
      return 1_500_000; // 1.5 Mbps for mobile
    } else {
      return 5_000_000; // 5 Mbps for desktop
    }
  }

  // Adaptive bitrate adjustment based on real-time feedback
  static async adaptBitrate(
    peerConnection: RTCPeerConnection,
    participantId: string,
    metrics: {
      packetLoss: number;
      roundTripTime: number;
      jitter: number;
    }
  ): Promise<void> {
    const senders = peerConnection.getSenders();
    
    for (const sender of senders) {
      if (sender.track && sender.track.kind === 'video') {
        const params = sender.getParameters();
        if (params.encodings && params.encodings[0]) {
          const currentBitrate = params.encodings[0].maxBitrate || 1000000;
          let newBitrate = currentBitrate;
          
          // Decrease bitrate if network conditions are poor
          if (metrics.packetLoss > 0.03 || metrics.roundTripTime > 200) {
            newBitrate = Math.max(currentBitrate * 0.8, 100_000);
            console.log(`[BANDWIDTH] Reducing bitrate for ${participantId}: ${currentBitrate} -> ${newBitrate}`);
          }
          // Increase bitrate if network conditions are good
          else if (metrics.packetLoss < 0.01 && metrics.roundTripTime < 100) {
            newBitrate = Math.min(currentBitrate * 1.1, 2_000_000);
            console.log(`[BANDWIDTH] Increasing bitrate for ${participantId}: ${currentBitrate} -> ${newBitrate}`);
          }
          
          if (newBitrate !== currentBitrate) {
            params.encodings[0].maxBitrate = newBitrate;
            await sender.setParameters(params);
          }
        }
      }
    }
  }

  // Optimize for screen sharing
  static async optimizeForScreenSharing(
    peerConnection: RTCPeerConnection,
    isScreenShare: boolean
  ): Promise<void> {
    const senders = peerConnection.getSenders();
    
    for (const sender of senders) {
      if (sender.track && sender.track.kind === 'video') {
        const params = sender.getParameters();
        if (params.encodings && params.encodings[0]) {
          if (isScreenShare) {
            // Optimize for screen sharing - higher bitrate, lower framerate
            params.encodings[0].maxBitrate = 2_000_000;
            params.encodings[0].maxFramerate = 5; // Lower framerate for screen content
            console.log('[BANDWIDTH] Optimized for screen sharing');
          } else {
            // Restore normal video settings
            params.encodings[0].maxBitrate = 1_000_000;
            params.encodings[0].maxFramerate = 30;
            console.log('[BANDWIDTH] Restored normal video settings');
          }
          await sender.setParameters(params);
        }
      }
    }
  }
}

export { BandwidthOptimizer, type NetworkQuality, type BandwidthConfig };