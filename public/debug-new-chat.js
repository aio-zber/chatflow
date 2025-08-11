// Debug script for New Chat functionality
console.log('🔍 DEBUG SCRIPT: New Chat Button Investigation');

// Test 1: Check if the New Chat button exists
function findNewChatButton() {
    const buttons = document.querySelectorAll('button');
    console.log('📊 Total buttons found:', buttons.length);
    
    for (let button of buttons) {
        if (button.textContent.includes('New Chat')) {
            console.log('✅ Found New Chat button:', button);
            console.log('📍 Button classes:', button.className);
            console.log('👆 Button onclick:', button.onclick);
            console.log('📏 Button dimensions:', {
                width: button.offsetWidth,
                height: button.offsetHeight,
                visible: button.offsetParent !== null
            });
            return button;
        }
    }
    
    console.log('❌ New Chat button NOT found');
    return null;
}

// Test 2: Check for modal in DOM
function findModal() {
    const modals = document.querySelectorAll('[class*="fixed"][class*="inset-0"]');
    console.log('📊 Potential modals found:', modals.length);
    
    modals.forEach((modal, index) => {
        console.log(`🪟 Modal ${index + 1}:`, {
            element: modal,
            visible: modal.offsetParent !== null,
            zIndex: getComputedStyle(modal).zIndex,
            display: getComputedStyle(modal).display
        });
    });
    
    return modals;
}

// Test 3: Simulate button click
function testButtonClick() {
    const button = findNewChatButton();
    if (button) {
        console.log('🖱️ Simulating button click...');
        button.click();
        
        // Wait a moment and check for modal
        setTimeout(() => {
            console.log('⏳ Checking for modal after click...');
            findModal();
        }, 100);
    }
}

// Test 4: Check for React components
function checkReactComponents() {
    const chatSidebar = document.querySelector('[class*="sidebar"]') || 
                       document.querySelector('[class*="chat"]');
    
    if (chatSidebar) {
        console.log('⚛️ Found potential React component:', chatSidebar);
        const reactProps = Object.keys(chatSidebar).find(key => 
            key.startsWith('__reactInternalInstance') || 
            key.startsWith('_reactInternalInstance') ||
            key.startsWith('__reactFiber')
        );
        
        if (reactProps) {
            console.log('✅ React instance found');
        } else {
            console.log('❌ No React instance found - possible hydration issue');
        }
    }
}

// Test 5: Check for console errors
function checkConsoleErrors() {
    const originalError = console.error;
    const originalWarn = console.warn;
    
    let errorCount = 0;
    let warnCount = 0;
    
    console.error = function(...args) {
        errorCount++;
        console.log('🚨 Console Error #' + errorCount + ':', ...args);
        originalError.apply(console, args);
    };
    
    console.warn = function(...args) {
        warnCount++;
        console.log('⚠️ Console Warning #' + warnCount + ':', ...args);
        originalWarn.apply(console, args);
    };
    
    console.log('📡 Error monitoring enabled');
}

// Run all tests
function runFullDebug() {
    console.log('🚀 Starting comprehensive debug...');
    
    checkConsoleErrors();
    findNewChatButton();
    findModal();
    checkReactComponents();
    
    console.log('✨ Click the New Chat button now, or run testButtonClick() to simulate a click');
}

// Auto-run when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runFullDebug);
} else {
    runFullDebug();
}

// Export functions for manual testing
window.debugNewChat = {
    findButton: findNewChatButton,
    findModal: findModal,
    testClick: testButtonClick,
    checkComponents: checkReactComponents,
    runAll: runFullDebug
};

console.log('🛠️ Debug functions available at window.debugNewChat');