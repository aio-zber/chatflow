// Call system configuration - centralized settings for easy adjustment
export const CALL_CONFIG = {
  // Participant limits by tier
  LIMITS: {
    BASIC: {
      MAX_PARTICIPANTS: 2,
      ALLOW_GROUP_CALLS: false,
      MAX_CALL_DURATION_MINUTES: 60
    },
    BETA: {
      MAX_PARTICIPANTS: 4,
      ALLOW_GROUP_CALLS: true,
      MAX_CALL_DURATION_MINUTES: 120
    },
    PREMIUM: {
      MAX_PARTICIPANTS: 6, // Reduced from 8 to 6 for better stability
      ALLOW_GROUP_CALLS: true,
      MAX_CALL_DURATION_MINUTES: 240
    }
  },

  // Memory management settings
  MEMORY: {
    MAX_ACTIVE_CALLS: 100,
    MAX_CALL_TRACES: 1000,
    CLEANUP_INTERVAL_MS: 300000, // 5 minutes
    STALE_CALL_TIMEOUT_MS: 3600000, // 1 hour
    QUALITY_HISTORY_SIZE: 100
  },

  // Circuit breaker settings
  CIRCUIT_BREAKER: {
    FAILURE_THRESHOLD: 5,
    RECOVERY_TIMEOUT_MS: 30000, // 30 seconds
    MONITORING_WINDOW_MS: 60000 // 1 minute
  },

  // Connection recovery settings
  RECOVERY: {
    MAX_RETRIES: 5,
    BASE_DELAY_MS: 1000,
    MAX_DELAY_MS: 30000,
    JITTER_FACTOR: 0.1
  },

  // Quality thresholds
  QUALITY: {
    PACKET_LOSS_WARNING: 0.02,     // 2%
    PACKET_LOSS_CRITICAL: 0.05,    // 5%
    RTT_WARNING_MS: 150,
    RTT_CRITICAL_MS: 300,
    JITTER_WARNING_MS: 30,
    JITTER_CRITICAL_MS: 50
  },

  // Bandwidth optimization
  BANDWIDTH: {
    QUALITY_PRESETS: {
      POOR: { videoBitrate: 150_000, audioBitrate: 32_000, fps: 15 },
      FAIR: { videoBitrate: 300_000, audioBitrate: 48_000, fps: 24 },
      GOOD: { videoBitrate: 500_000, audioBitrate: 64_000, fps: 30 },
      EXCELLENT: { videoBitrate: 1_000_000, audioBitrate: 128_000, fps: 30 }
    },
    PARTICIPANT_MULTIPLIER: 0.15, // Reduce quality by 15% per additional participant
    MIN_QUALITY_MULTIPLIER: 0.3   // Never go below 30% of base quality
  },

  // UI optimization
  UI: {
    OPTIMIZED_GRID_THRESHOLD: 5,   // Use optimized grid for 5+ participants
    MAX_VISIBLE_PARTICIPANTS: 12,
    VIRTUALIZATION_ENABLED: true,
    VIRTUALIZATION_FALLBACK_ENABLED: true // Enable fallback when virtualization fails
  },

  // WebRTC settings
  WEBRTC: {
    ICE_GATHERING_TIMEOUT_MS: 10000,
    CONNECTION_TIMEOUT_MS: 15000,
    OFFER_ANSWER_TIMEOUT_MS: 10000,
    MAX_PEER_CONNECTIONS: 20
  },

  // Production monitoring
  MONITORING: {
    MEMORY_ALERT_THRESHOLD_MB: 500,
    CALL_FAILURE_RATE_THRESHOLD: 0.02, // 2%
    CONNECTION_TIME_THRESHOLD_MS: 10000,
    ENABLE_QUALITY_MONITORING: true,
    ENABLE_PERFORMANCE_LOGGING: process.env.NODE_ENV === 'development'
  },

  // Feature flags for gradual rollout
  FEATURES: {
    ENHANCED_WEBRTC_SERVICE: true,
    CIRCUIT_BREAKER_ENABLED: true,
    QUALITY_MONITORING_ENABLED: true,
    BANDWIDTH_OPTIMIZATION_ENABLED: true,
    CONNECTION_RECOVERY_ENABLED: true,
    CALL_LIMITS_ENFORCEMENT: true,
    SFU_ADAPTER_READY: false // Not implemented yet
  }
};

// Helper functions for configuration
export const getParticipantLimit = (tier: 'basic' | 'beta' | 'premium'): number => {
  return CALL_CONFIG.LIMITS[tier.toUpperCase() as keyof typeof CALL_CONFIG.LIMITS].MAX_PARTICIPANTS;
};

export const isGroupCallAllowed = (tier: 'basic' | 'beta' | 'premium'): boolean => {
  return CALL_CONFIG.LIMITS[tier.toUpperCase() as keyof typeof CALL_CONFIG.LIMITS].ALLOW_GROUP_CALLS;
};

export const shouldUseOptimizedGrid = (participantCount: number): boolean => {
  return CALL_CONFIG.FEATURES.ENHANCED_WEBRTC_SERVICE && 
         participantCount >= CALL_CONFIG.UI.OPTIMIZED_GRID_THRESHOLD;
};

export const isFeatureEnabled = (feature: keyof typeof CALL_CONFIG.FEATURES): boolean => {
  return CALL_CONFIG.FEATURES[feature];
};