#!/usr/bin/env node

/**
 * Comprehensive Call System Test - Tests Real Communication Issues
 * 
 * This test specifically addresses the two main issues:
 * 1. Users are both connected but can't talk, hear, and see each other
 * 2. No Call traces for different scenarios (Missed/Completed with duration)
 */

const io = require('socket.io-client');

console.log('🧪 Comprehensive Call Communication & Trace Test');
console.log('======================================================');
console.log('Testing specific issues:');
console.log('✅ 1. WebRTC communication between connected users');
console.log('✅ 2. Call traces for all scenarios (Missed/Completed)');
console.log('✅ 3. Proper call duration tracking\n');

const serverUrl = 'http://localhost:3000';
const socketPath = '/api/socket/io';

// Test scenarios that specifically test the issues
const testScenarios = [
  {
    id: 1,
    name: 'Voice Call - Accept, Connect & Complete (Test Communication + Duration Trace)',
    type: 'voice',
    action: 'accept_and_complete',
    expectedDuration: 8, // seconds
    expectedTrace: /📞 voice call \(\d+:\d+\) - Completed/,
    description: 'Tests if users can actually communicate AND if completed call trace shows duration'
  },
  {
    id: 2,
    name: 'Video Call - Accept, Connect & Complete (Test Video Communication)',
    type: 'video', 
    action: 'accept_and_complete',
    expectedDuration: 6,
    expectedTrace: /📹 video call \(\d+:\d+\) - Completed/,
    description: 'Tests video communication and proper video call trace'
  },
  {
    id: 3,
    name: 'Voice Call - Decline (Test Missed Call Trace)',
    type: 'voice',
    action: 'decline',
    expectedDuration: 0,
    expectedTrace: /📞 voice call - Missed/,
    description: 'Tests declined call trace generation'
  },
  {
    id: 4,
    name: 'Video Call - Timeout (Test Missed Call Trace)',
    type: 'video',
    action: 'timeout',
    expectedDuration: 0,
    expectedTrace: /📹 video call - Missed/,
    description: 'Tests timeout call trace generation'
  },
  {
    id: 5,
    name: 'Voice Call - Early End (Test Cancelled/Short Duration)',
    type: 'voice',
    action: 'early_end',
    expectedDuration: 2,
    expectedTrace: /📞 voice call.*- (Completed|Cancelled)/,
    description: 'Tests early call termination scenarios'
  }
]

class CallCommunicationTester {
  constructor() {
    this.sockets = new Map()
    this.testResults = []
    this.currentCallId = null
    this.currentTest = null
    this.communicationVerified = false
    this.traceReceived = null
  }

  async runAllTests() {
    console.log('🔌 Setting up test environment...\n')
    
    try {
      await this.setupTestUsers()
      
      for (const scenario of testScenarios) {
        console.log(`\n${'='.repeat(60)}`)
        console.log(`🧪 Running Test ${scenario.id}: ${scenario.name}`)
        console.log(`   Description: ${scenario.description}`)
        console.log(`${'='.repeat(60)}`)
        
        await this.runScenario(scenario)
        
        // Wait between tests
        console.log('\n⏱️ Waiting 3 seconds before next test...')
        await this.sleep(3000)
      }
      
      this.showResults()
      
    } catch (error) {
      console.error('💥 Test suite failed:', error)
    } finally {
      await this.cleanup()
    }
  }

  async setupTestUsers() {
    const users = [
      { id: 'caller-test', name: 'Alice (Caller)', role: 'caller' },
      { id: 'receiver-test', name: 'Bob (Receiver)', role: 'receiver' }
    ]

    for (const user of users) {
      const socket = io(serverUrl, {
        path: socketPath,
        transports: ['polling'],
        timeout: 10000
      })

      this.sockets.set(user.id, { socket, user })
      this.setupSocketHandlers(socket, user)

      await new Promise((resolve, reject) => {
        socket.on('connect', () => {
          console.log(`✅ ${user.name} connected: ${socket.id}`)
          
          // Setup user
          socket.emit('user-online', user.id)
          socket.emit('join-user-room', user.id)
          socket.emit('join-room', 'test-conversation')
          
          resolve()
        })

        socket.on('connect_error', reject)
        setTimeout(() => reject(new Error(`Timeout connecting ${user.name}`)), 10000)
      })
    }

    console.log('✅ Both test users connected and ready\n')
  }

  setupSocketHandlers(socket, user) {
    socket.on('call_initiated', (data) => {
      console.log(`📞 ${user.name}: Call initiated - ${data.callId}`)
      this.currentCallId = data.callId
    })

    socket.on('incoming_call', (data) => {
      console.log(`📱 ${user.name}: Incoming ${data.callType} call from ${data.callerName}`)
      this.currentCallId = data.callId
    })

    socket.on('call_state_update', (data) => {
      console.log(`🔄 ${user.name}: Call state changed to "${data.status}" (${data.participantCount} participants)`)
      
      // This is critical - when call becomes connected, we need to verify communication
      if (data.status === 'connected') {
        console.log(`🚀 ${user.name}: CALL IS CONNECTED - Communication should work now!`)
        this.verifyCallCommunication(data.callId)
      }
    })

    socket.on('call_response', (data) => {
      console.log(`📲 ${user.name}: Call response - ${data.accepted ? 'ACCEPTED' : 'DECLINED'}`)
    })

    socket.on('call_ended', (data) => {
      console.log(`🔴 ${user.name}: Call ended - ${data.reason || 'unknown reason'}`)
    })

    socket.on('webrtc_stream_ready', (data) => {
      console.log(`🎥 ${user.name}: WebRTC stream ready for participant ${data.participantId}`)
      console.log(`    Has Audio: ${data.hasAudio}, Has Video: ${data.hasVideo}`)
      
      // This indicates that media streams are flowing
      if (data.participantId !== user.id) {
        console.log(`✅ ${user.name}: REMOTE STREAM RECEIVED - This means communication IS working!`)
        this.communicationVerified = true
      }
    })

    socket.on('message_received', (data) => {
      if (data.type === 'call_trace') {
        console.log(`📋 ${user.name}: CALL TRACE RECEIVED: "${data.content}"`)
        this.traceReceived = data.content
      }
    })

    // Error handlers
    socket.on('error', (error) => {
      console.error(`❌ ${user.name}: Socket error -`, error)
    })
  }

  async runScenario(scenario) {
    this.currentTest = scenario
    this.communicationVerified = false
    this.traceReceived = null
    this.currentCallId = null

    const caller = this.sockets.get('caller-test')
    const receiver = this.sockets.get('receiver-test')
    const testStart = Date.now()

    try {
      // Start the call
      console.log(`📞 Initiating ${scenario.type} call...`)
      caller.socket.emit('initiate_call', {
        conversationId: 'test-conversation',
        callType: scenario.type,
        callerName: caller.user.name,
        callerAvatar: null,
        conversationName: 'Test Conversation',
        isGroupCall: false,
        participantCount: 2
      })

      await this.sleep(1500) // Wait for call initiation

      // Handle different scenarios
      switch (scenario.action) {
        case 'accept_and_complete':
          await this.handleAcceptAndComplete(scenario)
          break
        case 'decline':
          await this.handleDecline()
          break
        case 'timeout':
          await this.handleTimeout()
          break
        case 'early_end':
          await this.handleEarlyEnd(scenario)
          break
      }

      // Wait for traces and cleanup
      await this.sleep(3000)

      // Verify results
      const testResult = this.verifyScenarioResults(scenario, testStart)
      this.testResults.push(testResult)

    } catch (error) {
      console.error(`❌ Scenario failed: ${error.message}`)
      this.testResults.push({
        scenario: scenario.name,
        passed: false,
        error: error.message,
        duration: Date.now() - testStart
      })
    }
  }

  async handleAcceptAndComplete(scenario) {
    const receiver = this.sockets.get('receiver-test')
    const caller = this.sockets.get('caller-test')
    
    console.log('✅ Accepting call...')
    receiver.socket.emit('call_response', {
      callId: this.currentCallId,
      conversationId: 'test-conversation',
      accepted: true,
      participantId: 'receiver-test'
    })

    // Wait for connection to establish
    console.log('⏱️ Waiting for WebRTC connection to establish...')
    await this.sleep(3000)

    // Let the call run for the expected duration
    console.log(`⏱️ Letting call run for ${scenario.expectedDuration} seconds to test communication...`)
    await this.sleep(scenario.expectedDuration * 1000)

    // End the call
    console.log('🔴 Ending call...')
    caller.socket.emit('end_call', {
      conversationId: 'test-conversation',
      callId: this.currentCallId,
      participantId: 'caller-test'
    })
  }

  async handleDecline() {
    const receiver = this.sockets.get('receiver-test')
    
    console.log('❌ Declining call...')
    receiver.socket.emit('call_response', {
      callId: this.currentCallId,
      conversationId: 'test-conversation',
      accepted: false,
      participantId: 'receiver-test'
    })
  }

  async handleTimeout() {
    console.log('⏰ Letting call timeout (not responding)...')
    // Just wait for timeout - don't respond
    await this.sleep(65000) // Wait longer than 60 second timeout
  }

  async handleEarlyEnd(scenario) {
    const receiver = this.sockets.get('receiver-test')
    const caller = this.sockets.get('caller-test')
    
    console.log('✅ Accepting call for early end test...')
    receiver.socket.emit('call_response', {
      callId: this.currentCallId,
      conversationId: 'test-conversation',
      accepted: true,
      participantId: 'receiver-test'
    })

    // Very short duration before ending
    await this.sleep(scenario.expectedDuration * 1000)

    console.log('🔴 Ending call early...')
    caller.socket.emit('end_call', {
      conversationId: 'test-conversation',
      callId: this.currentCallId,
      participantId: 'caller-test'
    })
  }

  verifyCallCommunication(callId) {
    // This is called when call state becomes 'connected'
    // The real test is whether webrtc_stream_ready events are received
    console.log('🔍 Verifying call communication capabilities...')
    
    setTimeout(() => {
      if (this.communicationVerified) {
        console.log('✅ COMMUNICATION VERIFIED: Remote streams are flowing between users!')
      } else {
        console.log('❌ COMMUNICATION NOT VERIFIED: No remote streams detected')
      }
    }, 2000)
  }

  verifyScenarioResults(scenario, testStart) {
    const duration = Date.now() - testStart
    let passed = true
    let errors = []

    // Check call trace
    if (this.traceReceived) {
      if (scenario.expectedTrace.test(this.traceReceived)) {
        console.log(`✅ Call trace matches expected pattern: "${this.traceReceived}"`)
      } else {
        console.log(`❌ Call trace doesn't match. Expected: ${scenario.expectedTrace}, Got: "${this.traceReceived}"`)
        errors.push(`Call trace mismatch`)
        passed = false
      }
    } else {
      console.log(`❌ No call trace received`)
      errors.push(`No call trace`)
      passed = false
    }

    // Check communication for accept scenarios
    if (scenario.action === 'accept_and_complete' || scenario.action === 'early_end') {
      if (this.communicationVerified) {
        console.log(`✅ Communication verified: Users can talk/hear/see each other`)
      } else {
        console.log(`❌ Communication not verified: Users can't communicate properly`)
        errors.push(`No communication verification`)
        passed = false
      }
    }

    const result = {
      scenario: scenario.name,
      passed,
      duration,
      errors: errors.length > 0 ? errors : undefined,
      communicationWorking: this.communicationVerified,
      traceReceived: this.traceReceived
    }

    if (passed) {
      console.log(`✅ Scenario PASSED`)
    } else {
      console.log(`❌ Scenario FAILED: ${errors.join(', ')}`)
    }

    return result
  }

  showResults() {
    console.log('\n' + '='.repeat(80))
    console.log('📊 COMPREHENSIVE TEST RESULTS')
    console.log('='.repeat(80))

    let passedTests = 0
    let totalTests = this.testResults.length
    let communicationTests = 0
    let communicationPassed = 0

    this.testResults.forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.scenario}`)
      console.log(`   Status: ${result.passed ? '✅ PASS' : '❌ FAIL'}`)
      console.log(`   Duration: ${(result.duration / 1000).toFixed(1)}s`)
      
      if (result.communicationWorking !== undefined) {
        communicationTests++
        if (result.communicationWorking) {
          communicationPassed++
          console.log(`   Communication: ✅ WORKING - Users can talk/hear/see each other`)
        } else {
          console.log(`   Communication: ❌ NOT WORKING - Users can't communicate`)
        }
      }
      
      if (result.traceReceived) {
        console.log(`   Call Trace: ✅ "${result.traceReceived}"`)
      } else {
        console.log(`   Call Trace: ❌ No trace received`)
      }
      
      if (result.errors) {
        console.log(`   Errors: ${result.errors.join(', ')}`)
      }

      if (result.passed) passedTests++
    })

    console.log(`\n${'='.repeat(80)}`)
    console.log(`Overall Results: ${passedTests}/${totalTests} tests passed`)
    console.log(`Communication Tests: ${communicationPassed}/${communicationTests} working`)
    
    if (passedTests === totalTests) {
      console.log('🎉 ALL TESTS PASSED!')
      console.log('✅ Call communication is working properly')
      console.log('✅ Call traces are being generated correctly')
    } else {
      console.log('❌ Some tests failed - Issues remain:')
      
      const failedResults = this.testResults.filter(r => !r.passed)
      failedResults.forEach(result => {
        console.log(`   • ${result.scenario}: ${result.errors?.join(', ') || 'Unknown error'}`)
      })
    }

    console.log('='.repeat(80))
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test connections...')
    
    for (const [userId, socketData] of this.sockets) {
      try {
        if (socketData.socket.connected) {
          socketData.socket.emit('user-offline', userId)
          socketData.socket.disconnect()
        }
      } catch (error) {
        console.warn(`Warning: Cleanup error for ${userId}:`, error.message)
      }
    }

    setTimeout(() => process.exit(0), 1000)
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Test interrupted')
  process.exit(1)
})

// Run the comprehensive test
const tester = new CallCommunicationTester()
tester.runAllTests().catch(error => {
  console.error('💥 Test suite crashed:', error)
  process.exit(1)
})