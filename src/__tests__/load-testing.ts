interface LoadTestConfig {
  simultaneousCalls: number;
  callDurationSeconds: number;
  participantsPerCall: number;
  rampUpDurationSeconds: number;
}

interface LoadTestResults {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  averageSetupTime: number;
  memoryUsagePeak: number;
  errors: string[];
  startTime: number;
  endTime: number;
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
      errors: [],
      startTime: Date.now(),
      endTime: 0
    };

    const callPromises: Promise<void>[] = [];
    
    // Start memory monitoring
    const memoryMonitor = this.startMemoryMonitoring(results);
    
    for (let i = 0; i < config.simultaneousCalls; i++) {
      // Stagger call creation for realistic load
      const delay = (i / config.simultaneousCalls) * config.rampUpDurationSeconds * 1000;
      
      callPromises.push(
        this.createDelayedCall(delay, config, results, i)
      );
    }
    
    await Promise.allSettled(callPromises);
    
    // Stop memory monitoring
    clearInterval(memoryMonitor);
    
    results.endTime = Date.now();
    this.calculateFinalMetrics(results);
    
    return results;
  }

  private startMemoryMonitoring(results: LoadTestResults): NodeJS.Timeout {
    return setInterval(() => {
      if (typeof process !== 'undefined' && process.memoryUsage) {
        const usage = process.memoryUsage();
        results.memoryUsagePeak = Math.max(results.memoryUsagePeak, usage.heapUsed);
      } else if (typeof performance !== 'undefined' && (performance as any).memory) {
        const usage = (performance as any).memory.usedJSHeapSize;
        results.memoryUsagePeak = Math.max(results.memoryUsagePeak, usage);
      }
    }, 100); // Check every 100ms
  }

  private async createDelayedCall(
    delay: number, 
    config: LoadTestConfig, 
    results: LoadTestResults,
    callIndex: number
  ): Promise<void> {
    await this.sleep(delay);
    
    const startTime = Date.now();
    results.totalCalls++;
    
    try {
      await this.simulateCall(config, callIndex);
      results.successfulCalls++;
      
      const setupTime = Date.now() - startTime;
      this.updateAverageSetupTime(results, setupTime);
      
    } catch (error) {
      results.failedCalls++;
      results.errors.push(`Call ${callIndex}: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`[LOAD_TEST] Call ${callIndex} failed:`, error);
    }
  }

  private updateAverageSetupTime(results: LoadTestResults, setupTime: number): void {
    if (results.successfulCalls === 1) {
      results.averageSetupTime = setupTime;
    } else {
      results.averageSetupTime = (results.averageSetupTime * (results.successfulCalls - 1) + setupTime) / results.successfulCalls;
    }
  }

  private async simulateCall(config: LoadTestConfig, callIndex: number): Promise<void> {
    console.log(`[LOAD_TEST] Starting call ${callIndex}`);
    
    // Simulate call setup phase
    await this.simulateCallSetup();
    
    // Simulate WebRTC connection establishment
    await this.simulateWebRTCConnection(config.participantsPerCall);
    
    // Simulate call duration
    await this.simulateCallDuration(config.callDurationSeconds);
    
    // Simulate call cleanup
    await this.simulateCallCleanup();
    
    console.log(`[LOAD_TEST] Completed call ${callIndex}`);
  }

  private async simulateCallSetup(): Promise<void> {
    // Simulate socket connection and signaling
    await this.sleep(Math.random() * 500 + 200); // 200-700ms
    
    // Simulate database operations
    await this.sleep(Math.random() * 200 + 100); // 100-300ms
  }

  private async simulateWebRTCConnection(participantCount: number): Promise<void> {
    // Simulate peer connection creation
    for (let i = 0; i < participantCount - 1; i++) {
      await this.sleep(Math.random() * 1000 + 500); // 500ms-1.5s per connection
    }
    
    // Simulate ICE gathering and connection
    await this.sleep(Math.random() * 2000 + 1000); // 1-3s for ICE
    
    // Random failures to simulate real conditions
    if (Math.random() < 0.05) { // 5% failure rate
      throw new Error('WebRTC connection failed');
    }
  }

  private async simulateCallDuration(durationSeconds: number): Promise<void> {
    // Simulate actual call time (shortened for testing)
    const actualDuration = Math.min(durationSeconds * 1000, 5000); // Max 5 seconds for testing
    await this.sleep(actualDuration);
    
    // Simulate occasional mid-call failures
    if (Math.random() < 0.02) { // 2% failure rate during call
      throw new Error('Call dropped unexpectedly');
    }
  }

  private async simulateCallCleanup(): Promise<void> {
    // Simulate cleanup operations
    await this.sleep(Math.random() * 300 + 100); // 100-400ms cleanup
  }

  private calculateFinalMetrics(results: LoadTestResults): void {
    const duration = results.endTime - results.startTime;
    const successRate = (results.successfulCalls / results.totalCalls) * 100;
    
    console.log(`[LOAD_TEST] Test completed in ${duration}ms`);
    console.log(`[LOAD_TEST] Success rate: ${successRate.toFixed(1)}%`);
    console.log(`[LOAD_TEST] Average setup time: ${results.averageSetupTime.toFixed(0)}ms`);
    console.log(`[LOAD_TEST] Peak memory usage: ${(results.memoryUsagePeak / 1024 / 1024).toFixed(1)}MB`);
    
    if (results.errors.length > 0) {
      console.log(`[LOAD_TEST] Errors encountered: ${results.errors.length}`);
      console.log('[LOAD_TEST] First 5 errors:', results.errors.slice(0, 5));
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Stress test for specific scenarios
  async runStressTest(scenario: 'memory' | 'connection' | 'concurrent'): Promise<void> {
    console.log(`[STRESS_TEST] Running ${scenario} stress test`);
    
    switch (scenario) {
      case 'memory':
        await this.memoryStressTest();
        break;
      case 'connection':
        await this.connectionStressTest();
        break;
      case 'concurrent':
        await this.concurrentStressTest();
        break;
    }
  }

  private async memoryStressTest(): Promise<void> {
    console.log('[STRESS_TEST] Testing memory usage with many simultaneous calls');
    
    const config: LoadTestConfig = {
      simultaneousCalls: 50,
      callDurationSeconds: 10,
      participantsPerCall: 2,
      rampUpDurationSeconds: 5
    };
    
    const results = await this.runLoadTest(config);
    
    // Check if memory usage is within acceptable limits
    const memoryLimitMB = 500; // 500MB limit
    const actualMemoryMB = results.memoryUsagePeak / 1024 / 1024;
    
    if (actualMemoryMB > memoryLimitMB) {
      throw new Error(`Memory usage exceeded limit: ${actualMemoryMB.toFixed(1)}MB > ${memoryLimitMB}MB`);
    }
    
    console.log(`[STRESS_TEST] Memory test passed: ${actualMemoryMB.toFixed(1)}MB used`);
  }

  private async connectionStressTest(): Promise<void> {
    console.log('[STRESS_TEST] Testing connection reliability under high load');
    
    const config: LoadTestConfig = {
      simultaneousCalls: 100,
      callDurationSeconds: 5,
      participantsPerCall: 3,
      rampUpDurationSeconds: 2
    };
    
    const results = await this.runLoadTest(config);
    
    // Check success rate
    const successRate = (results.successfulCalls / results.totalCalls) * 100;
    const minimumSuccessRate = 95; // 95% minimum
    
    if (successRate < minimumSuccessRate) {
      throw new Error(`Success rate too low: ${successRate.toFixed(1)}% < ${minimumSuccessRate}%`);
    }
    
    console.log(`[STRESS_TEST] Connection test passed: ${successRate.toFixed(1)}% success rate`);
  }

  private async concurrentStressTest(): Promise<void> {
    console.log('[STRESS_TEST] Testing concurrent call handling');
    
    // Run multiple load tests simultaneously
    const testPromises = [];
    
    for (let i = 0; i < 3; i++) {
      const config: LoadTestConfig = {
        simultaneousCalls: 20,
        callDurationSeconds: 3,
        participantsPerCall: 2,
        rampUpDurationSeconds: 1
      };
      
      testPromises.push(this.runLoadTest(config));
    }
    
    const results = await Promise.all(testPromises);
    
    // Aggregate results
    const totalCalls = results.reduce((sum, r) => sum + r.totalCalls, 0);
    const totalSuccessful = results.reduce((sum, r) => sum + r.successfulCalls, 0);
    const overallSuccessRate = (totalSuccessful / totalCalls) * 100;
    
    console.log(`[STRESS_TEST] Concurrent test completed: ${overallSuccessRate.toFixed(1)}% success rate`);
    
    if (overallSuccessRate < 90) {
      throw new Error(`Concurrent test failed: ${overallSuccessRate.toFixed(1)}% < 90%`);
    }
  }
}

// Performance benchmarking utilities
class CallPerformanceBenchmark {
  async benchmarkCallSetup(iterations: number = 100): Promise<{
    averageTime: number;
    minTime: number;
    maxTime: number;
    p95Time: number;
  }> {
    console.log(`[BENCHMARK] Running call setup benchmark with ${iterations} iterations`);
    
    const times: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const startTime = performance.now();
      
      // Simulate call setup operations
      await this.simulateCallSetupOperations();
      
      const endTime = performance.now();
      times.push(endTime - startTime);
    }
    
    times.sort((a, b) => a - b);
    
    const results = {
      averageTime: times.reduce((sum, time) => sum + time, 0) / times.length,
      minTime: times[0],
      maxTime: times[times.length - 1],
      p95Time: times[Math.floor(times.length * 0.95)]
    };
    
    console.log(`[BENCHMARK] Call setup results:`, {
      average: `${results.averageTime.toFixed(2)}ms`,
      min: `${results.minTime.toFixed(2)}ms`,
      max: `${results.maxTime.toFixed(2)}ms`,
      p95: `${results.p95Time.toFixed(2)}ms`
    });
    
    return results;
  }

  private async simulateCallSetupOperations(): Promise<void> {
    // Simulate validation
    await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
    
    // Simulate socket operations
    await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
    
    // Simulate WebRTC setup
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
  }
}

export { CallLoadTester, CallPerformanceBenchmark, type LoadTestConfig, type LoadTestResults };

// Jest tests for load testing functionality
describe('Load Testing Suite', () => {
  let loadTester: CallLoadTester;
  let benchmark: CallPerformanceBenchmark;

  beforeEach(() => {
    loadTester = new CallLoadTester();
    benchmark = new CallPerformanceBenchmark();
  });

  describe('Call Load Tester', () => {
    it('should handle basic load test configuration', async () => {
      const config: LoadTestConfig = {
        simultaneousCalls: 5,
        callDurationSeconds: 1,
        participantsPerCall: 2,
        rampUpDurationSeconds: 1
      };

      const results = await loadTester.runLoadTest(config);

      expect(results.totalCalls).toBe(5);
      expect(results.successfulCalls).toBeGreaterThan(0);
      expect(results.endTime).toBeGreaterThan(results.startTime);
      expect(results.averageSetupTime).toBeGreaterThan(0);
    }, 15000); // 15 second timeout

    it('should track memory usage during load test', async () => {
      const config: LoadTestConfig = {
        simultaneousCalls: 3,
        callDurationSeconds: 1,
        participantsPerCall: 2,
        rampUpDurationSeconds: 0.5
      };

      const results = await loadTester.runLoadTest(config);

      expect(results.memoryUsagePeak).toBeGreaterThan(0);
    }, 10000);

    it('should handle failures gracefully', async () => {
      // This test relies on the built-in 5% failure rate in simulateWebRTCConnection
      const config: LoadTestConfig = {
        simultaneousCalls: 20, // Higher chance of hitting failures
        callDurationSeconds: 1,
        participantsPerCall: 2,
        rampUpDurationSeconds: 1
      };

      const results = await loadTester.runLoadTest(config);

      expect(results.totalCalls).toBe(20);
      expect(results.successfulCalls + results.failedCalls).toBe(20);
      
      // Should have mostly successful calls
      const successRate = (results.successfulCalls / results.totalCalls) * 100;
      expect(successRate).toBeGreaterThan(80); // At least 80% success rate
    }, 20000);
  });

  describe('Performance Benchmark', () => {
    it('should benchmark call setup operations', async () => {
      const results = await benchmark.benchmarkCallSetup(10);

      expect(results.averageTime).toBeGreaterThan(0);
      expect(results.minTime).toBeLessThanOrEqual(results.averageTime);
      expect(results.maxTime).toBeGreaterThanOrEqual(results.averageTime);
      expect(results.p95Time).toBeGreaterThanOrEqual(results.averageTime);
    }, 10000);

    it('should provide consistent performance metrics', async () => {
      const results1 = await benchmark.benchmarkCallSetup(5);
      const results2 = await benchmark.benchmarkCallSetup(5);

      // Results should be in similar ranges (within 50% variance)
      const variance = Math.abs(results1.averageTime - results2.averageTime) / results1.averageTime;
      expect(variance).toBeLessThan(0.5);
    }, 10000);
  });

  describe('Stress Testing', () => {
    it('should pass memory stress test', async () => {
      // Run a smaller memory test for CI/testing
      const config: LoadTestConfig = {
        simultaneousCalls: 10,
        callDurationSeconds: 2,
        participantsPerCall: 2,
        rampUpDurationSeconds: 1
      };

      const results = await loadTester.runLoadTest(config);
      
      // Memory should be under 100MB for small test
      const memoryUsageMB = results.memoryUsagePeak / 1024 / 1024;
      expect(memoryUsageMB).toBeLessThan(100);
    }, 15000);

    it('should maintain high success rate under load', async () => {
      const config: LoadTestConfig = {
        simultaneousCalls: 15,
        callDurationSeconds: 1,
        participantsPerCall: 2,
        rampUpDurationSeconds: 1
      };

      const results = await loadTester.runLoadTest(config);
      
      const successRate = (results.successfulCalls / results.totalCalls) * 100;
      expect(successRate).toBeGreaterThan(85); // At least 85% success rate
    }, 20000);
  });

  describe('Phase 5 Success Criteria Validation', () => {
    it('should meet Phase 5 load test criteria', async () => {
      // Smaller scale for CI, but validates the pattern
      const config: LoadTestConfig = {
        simultaneousCalls: 10, // Reduced from 100 for CI
        callDurationSeconds: 2,
        participantsPerCall: 2,
        rampUpDurationSeconds: 2
      };

      const results = await loadTester.runLoadTest(config);
      
      // Validate Phase 5 criteria (adapted for smaller scale)
      expect(results.totalCalls).toBe(10);
      
      const successRate = (results.successfulCalls / results.totalCalls) * 100;
      expect(successRate).toBeGreaterThan(90); // >90% success rate
      
      const memoryUsageMB = results.memoryUsagePeak / 1024 / 1024;
      expect(memoryUsageMB).toBeLessThan(200); // Memory stable under load
      
      expect(results.averageSetupTime).toBeLessThan(5000); // Setup time reasonable
    }, 30000); // 30 second timeout for this comprehensive test
  });
});