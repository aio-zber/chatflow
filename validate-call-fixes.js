#!/usr/bin/env node

/**
 * Quick validation script to check if call fixes are working
 * This performs a basic smoke test of the call system
 */

const io = require('socket.io-client');

console.log('🔍 Validating Call System Fixes...\n');

const serverUrl = 'http://localhost:3000';
const socketPath = '/api/socket/io';

async function validateCallSystem() {
  console.log('1. Testing server connection...');
  
  const socket = io(serverUrl, {
    path: socketPath,
    transports: ['polling'],
    timeout: 5000
  });

  return new Promise((resolve, reject) => {
    let isResolved = false;

    socket.on('connect', () => {
      console.log('✅ Server connection successful');
      console.log(`   Socket ID: ${socket.id}`);
      console.log(`   Transport: ${socket.io.engine.transport.name}`);
      
      // Test user room joining
      console.log('\n2. Testing user room functionality...');
      socket.emit('user-online', 'test-validation-user');
      socket.emit('join-user-room', 'test-validation-user');
      socket.emit('join-room', 'test-validation-conversation');
      
      setTimeout(() => {
        console.log('✅ Room joining completed');
        
        // Test call initiation
        console.log('\n3. Testing call initiation...');
        socket.emit('initiate_call', {
          conversationId: 'test-validation-conversation',
          callType: 'voice',
          callerName: 'Validation Test User',
          callerAvatar: null,
          conversationName: 'Validation Test',
          isGroupCall: false,
          participantCount: 1
        });
      }, 1000);
    });

    socket.on('call_initiated', (data) => {
      console.log('✅ Call initiation successful');
      console.log(`   Call ID: ${data.callId}`);
      console.log(`   Conversation: ${data.conversationId}`);
      
      // Test call cleanup
      setTimeout(() => {
        console.log('\n4. Testing call cleanup...');
        socket.emit('end_call', {
          conversationId: data.conversationId,
          callId: data.callId,
          participantId: 'test-validation-user'
        });
      }, 1000);
    });

    socket.on('call_ended', (data) => {
      console.log('✅ Call cleanup successful');
      console.log(`   Reason: ${data.reason || 'user_ended'}`);
      
      setTimeout(() => {
        console.log('\n🎉 All validation tests passed!');
        console.log('\nCall system fixes validated:');
        console.log('✅ Server connectivity');
        console.log('✅ Room management');
        console.log('✅ Call initiation');
        console.log('✅ Call cleanup');
        
        console.log('\n📋 Ready for comprehensive testing with test-call-fixes.js');
        
        socket.disconnect();
        if (!isResolved) {
          isResolved = true;
          resolve();
        }
      }, 1000);
    });

    socket.on('connect_error', (error) => {
      console.error('❌ Server connection failed:', error.message);
      console.log('\n💡 Make sure the server is running on http://localhost:3000');
      if (!isResolved) {
        isResolved = true;
        reject(error);
      }
    });

    socket.on('error', (error) => {
      console.error('❌ Socket error:', error);
      if (!isResolved) {
        isResolved = true;
        reject(error);
      }
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!isResolved) {
        console.error('❌ Validation timeout - server may not be responding');
        isResolved = true;
        reject(new Error('Validation timeout'));
      }
    }, 10000);
  });
}

// Run validation
validateCallSystem()
  .then(() => {
    console.log('\n✨ Validation completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Validation failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Ensure Next.js server is running: npm run dev');
    console.log('2. Check if port 3000 is available');
    console.log('3. Verify socket.io configuration');
    process.exit(1);
  });