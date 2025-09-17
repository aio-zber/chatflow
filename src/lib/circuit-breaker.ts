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

  getFailureCount(): number {
    return this.failures;
  }

  getNextAttemptTime(): number {
    return this.nextAttempt;
  }

  // Reset circuit breaker manually
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.lastFailureTime = 0;
    this.nextAttempt = 0;
    console.log('[CIRCUIT_BREAKER] Manually reset to CLOSED state');
  }

  // Force open for maintenance
  forceOpen(duration: number): void {
    this.state = CircuitState.OPEN;
    this.nextAttempt = Date.now() + duration;
    console.log(`[CIRCUIT_BREAKER] Forced OPEN for ${duration}ms`);
  }
}

// Usage in call initiation
export const callCircuitBreaker = new CallCircuitBreaker({
  failureThreshold: 5,
  recoveryTimeout: 30000, // 30 seconds
  monitoringWindow: 60000  // 1 minute
});

export { CallCircuitBreaker, CircuitState, type CircuitBreakerConfig };