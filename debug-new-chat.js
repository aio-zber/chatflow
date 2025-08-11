// New Chat Button Debug Testing Script
// Run this in the browser console while on the chat page

console.log('=== NEW CHAT BUTTON DEBUGGING SCRIPT ===');

// Test 1: Check if the New Chat button exists
function testButtonExists() {
  const buttons = document.querySelectorAll('button');
  const newChatButton = Array.from(buttons).find(btn => 
    btn.textContent?.includes('New Chat')
  );
  
  console.log('1. New Chat Button Found:', !!newChatButton);
  if (newChatButton) {
    console.log('   - Button element:', newChatButton);
    console.log('   - Button classes:', newChatButton.className);
    console.log('   - Button disabled:', newChatButton.disabled);
  }
  
  return newChatButton;
}

// Test 2: Check if UserSelectionModal exists in DOM
function testModalExists() {
  // Look for modal elements
  const modalBackdrops = document.querySelectorAll('.fixed.inset-0');
  const modalContent = document.querySelector('[class*="bg-white"][class*="dark:bg-gray-800"]');
  
  console.log('2. Modal Backdrop Found:', modalBackdrops.length > 0);
  console.log('3. Modal Content Found:', !!modalContent);
  
  if (modalBackdrops.length > 0) {
    modalBackdrops.forEach((backdrop, index) => {
      console.log(`   - Modal ${index + 1}:`, backdrop);
      console.log(`   - Z-index:`, window.getComputedStyle(backdrop).zIndex);
      console.log(`   - Display:`, window.getComputedStyle(backdrop).display);
      console.log(`   - Visibility:`, window.getComputedStyle(backdrop).visibility);
    });
  }
  
  return modalBackdrops.length > 0;
}

// Test 3: Check React state (if React DevTools available)
function testReactState() {
  console.log('4. Checking React State...');
  
  // Try to access React fiber
  const rootElement = document.querySelector('#__next') || document.querySelector('[data-reactroot]');
  if (rootElement && rootElement._reactInternalFiber) {
    console.log('   - React fiber found');
  } else if (rootElement && rootElement._reactInternals) {
    console.log('   - React internals found');
  } else {
    console.log('   - React debug info not accessible');
  }
}

// Test 4: Simulate button click
function testButtonClick() {
  const newChatButton = testButtonExists();
  if (newChatButton) {
    console.log('5. Simulating button click...');
    
    // Add event listener to monitor click
    newChatButton.addEventListener('click', (e) => {
      console.log('   - Button click event fired!', e);
    }, { once: true });
    
    // Simulate click
    newChatButton.click();
    
    // Check modal after short delay
    setTimeout(() => {
      const modalExists = testModalExists();
      console.log('   - Modal appeared after click:', modalExists);
    }, 100);
  }
}

// Test 5: Check for JavaScript errors
function testConsoleErrors() {
  console.log('6. Check browser console for any errors above this message');
  console.log('   - Look for React errors, network failures, or other issues');
}

// Test 6: Check session and authentication
function testAuthentication() {
  console.log('7. Testing Authentication...');
  
  // Check if fetch works (basic connectivity test)
  fetch('/api/auth/session')
    .then(response => response.json())
    .then(data => {
      console.log('   - Session data:', data);
      console.log('   - User authenticated:', !!data.user);
      
      if (!data.user) {
        console.log('   - ❌ USER NOT AUTHENTICATED - This could be the issue!');
      }
    })
    .catch(error => {
      console.log('   - ❌ Session check failed:', error);
    });
}

// Test 7: Check network connectivity to user search
function testNetworkConnectivity() {
  console.log('8. Testing Network Connectivity...');
  
  fetch('/api/users/search?q=test&limit=1')
    .then(response => {
      console.log('   - User search API status:', response.status);
      return response.json();
    })
    .then(data => {
      console.log('   - User search response:', data);
    })
    .catch(error => {
      console.log('   - ❌ User search failed:', error);
    });
}

// Run all tests
function runAllTests() {
  console.log('\n🚀 Running All Tests...\n');
  
  testButtonExists();
  testModalExists();
  testReactState();
  testAuthentication();
  testNetworkConnectivity();
  testConsoleErrors();
  
  console.log('\n⚠️  Now click the New Chat button manually and watch the console...\n');
  
  // Set up monitoring for the next 10 seconds
  let clickCount = 0;
  const originalConsoleLog = console.log;
  console.log = function(...args) {
    if (args[0]?.includes?.('New Chat button clicked!')) {
      clickCount++;
      originalConsoleLog(`🎯 BUTTON CLICK DETECTED (#${clickCount}):`, ...args);
    } else {
      originalConsoleLog(...args);
    }
  };
  
  setTimeout(() => {
    console.log = originalConsoleLog;
    console.log(`\n📊 MONITORING COMPLETE - Button clicks detected: ${clickCount}\n`);
  }, 10000);
}

// Auto-run tests
runAllTests();

// Expose individual test functions for manual use
window.debugNewChat = {
  testButtonExists,
  testModalExists,
  testReactState,
  testButtonClick,
  testConsoleErrors,
  testAuthentication,
  testNetworkConnectivity,
  runAllTests
};

console.log('\n💡 Individual tests available as: window.debugNewChat.testButtonExists(), etc.\n');