// Test script to verify call flow
const io = require('socket.io-client');

console.log('🚀 Starting call flow test...');

// Simulate two users
const user1Id = 'test-user-1';
const user2Id = 'test-user-2';
const conversationId = 'test-conversation';

// Create two socket connections
const socket1 = io('http://localhost:3000', {
  path: '/api/socket/io',
  transports: ['polling']
});

const socket2 = io('http://localhost:3000', {
  path: '/api/socket/io',
  transports: ['polling']
});

let callId = null;

// User 1 (Caller) setup
socket1.on('connect', () => {
  console.log('📞 User 1 (Caller) connected:', socket1.id);
  
  // Join user room
  socket1.emit('user-online', user1Id);
  socket1.emit('join-user-room', user1Id);
  socket1.emit('join-room', conversationId);
  
  // Listen for events
  socket1.on('call_initiated', (data) => {
    console.log('✅ User 1: Call initiated:', data);
    callId = data.callId;
  });
  
  socket1.on('call_state_update', (data) => {
    console.log('🔄 User 1: State update:', data);
  });
  
  socket1.on('call_response', (data) => {
    console.log('📲 User 1: Call response:', data);
  });
  
  // Start call after 2 seconds
  setTimeout(() => {
    console.log('📞 User 1: Initiating call...');
    socket1.emit('initiate_call', {
      conversationId,
      callType: 'voice',
      callerName: 'Test User 1',
      callerAvatar: null,
      conversationName: 'Test Conversation',
      isGroupCall: false,
      participantCount: 2
    });
  }, 2000);
});

// User 2 (Recipient) setup
socket2.on('connect', () => {
  console.log('📱 User 2 (Recipient) connected:', socket2.id);
  
  // Join user room
  socket2.emit('user-online', user2Id);
  socket2.emit('join-user-room', user2Id);
  socket2.emit('join-room', conversationId);
  
  // Listen for events
  socket2.on('incoming_call', (data) => {
    console.log('📞 User 2: Incoming call:', data);
    callId = data.callId;
    
    // Accept call after 1 second (faster response)
    setTimeout(() => {
      console.log('✅ User 2: Accepting call...');
      socket2.emit('call_response', {
        callId: data.callId,
        conversationId,
        accepted: true,
        participantId: user2Id
      });
    }, 1000);
  });
  
  socket2.on('call_state_update', (data) => {
    console.log('🔄 User 2: State update:', data);
  });
  
  socket2.on('call_response', (data) => {
    console.log('📲 User 2: Call response:', data);
  });
});

// Cleanup after 8 seconds, but wait for call acceptance to complete
setTimeout(() => {
  console.log('🛑 Test completed. Cleaning up...');
  socket1.disconnect();
  socket2.disconnect();
  process.exit(0);
}, 8000);