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

  constructor(private activeCalls: Map<string, any>, private createdCallTraces: Set<string>) {
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
    let cleanedCount = 0;
    
    for (const [callId, call] of this.activeCalls.entries()) {
      const callAge = now - call.startTime;
      if (callAge > STALE_CALL_TIMEOUT || call.participants?.size === 0) {
        console.log(`[CLEANUP] Removing stale call: ${callId}, age: ${callAge}ms`);
        
        // Clear any active timeouts
        if (call.timeoutId) {
          clearTimeout(call.timeoutId);
        }
        if (call.connectingTimeoutId) {
          clearTimeout(call.connectingTimeoutId);
        }
        
        this.activeCalls.delete(callId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`[CLEANUP] ✅ Cleaned up ${cleanedCount} stale calls. Active calls: ${this.activeCalls.size}`);
    }
  }

  cleanupCallTraces(): void {
    if (this.createdCallTraces.size > this.MAX_CALL_TRACES) {
      console.log(`[CLEANUP] Clearing call traces cache, size: ${this.createdCallTraces.size}`);
      this.createdCallTraces.clear();
    }
  }

  monitorMemoryUsage(): void {
    const activeCallsCount = this.activeCalls.size;
    const callTracesCount = this.createdCallTraces.size;
    
    console.log(`[MEMORY] Active calls: ${activeCallsCount}, Call traces: ${callTracesCount}`);
    
    if (activeCallsCount > this.MAX_ACTIVE_CALLS) {
      console.error(`CRITICAL: Active calls exceeding safe limits: ${activeCallsCount}`);
      this.emitMemoryAlert('active_calls_limit', activeCallsCount);
    }
  }

  private emitMemoryAlert(type: string, value: number): void {
    // Integration with monitoring system (Sentry, DataDog, etc.)
    console.error(`MEMORY_ALERT: ${type} = ${value}`);
    
    // In production, this would integrate with monitoring services
    if (process.env.NODE_ENV === 'production') {
      // TODO: Send alert to monitoring service
      // Example: Sentry.captureException(new Error(`Memory alert: ${type} = ${value}`))
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}

export { CallCleanupManager, type CallCleanupService };