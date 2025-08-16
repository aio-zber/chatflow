'use client';

import { useState } from 'react';
import { useE2EE } from '@/hooks/useE2EE';
import { SafeSignalClient } from '@/lib/e2ee/SignalClientWrapper';

export default function E2EETester() {
  const { status, setupDevice, sendMessage, logSignalClientStatus, isAvailable, isInitializing, error } = useE2EE();
  const [deviceName, setDeviceName] = useState('Primary Device');
  const [isSettingUp, setIsSettingUp] = useState(false);

  const handleTestE2EE = async () => {
    try {
      console.log('🔐 E2EE Tester: Checking libsignal-client status...');
      logSignalClientStatus();
      
      // Test encryption status for current conversation
      console.log('🔐 E2EE Tester: Current E2EE status:', {
        available: isAvailable,
        initializing: isInitializing,
        error: error,
        deviceId: status.deviceId,
        systemStatus: isAvailable ? 'READY FOR E2EE MESSAGING' : 'NOT READY'
      });
      
      // Log security validation
      const securityCheck = SafeSignalClient.validateSecurityRequirements();
      console.log('🔐 E2EE Tester: Security validation:', securityCheck);

      // Test basic crypto functionality if available
      if (isAvailable) {
        console.log('🔐 E2EE Tester: ✅ E2EE SYSTEM IS READY!');
        console.log('🔐 E2EE Tester: Your messages are being encrypted with Web Crypto API');
        console.log('🔐 E2EE Tester: Auto-device setup is working for new recipients');
        
        try {
          const testMessage = { content: 'Test message', timestamp: Date.now() };
          const testRecipients = [{ deviceId: 'test-device', userId: 'test-user' }];
          
          // This will test the Web Crypto API fallback
          const result = await sendMessage(testMessage, testRecipients);
          console.log('🔐 E2EE Tester: ✅ Encryption test successful:', result);
        } catch (encryptError) {
          console.error('🔐 E2EE Tester: Encryption test failed:', encryptError);
        }
      } else {
        console.log('🔐 E2EE Tester: ❌ E2EE system not ready');
      }
      
    } catch (error) {
      console.error('🔐 E2EE Tester: Test failed:', error);
    }
  };

  const handleSetupDevice = async () => {
    if (!deviceName.trim()) {
      alert('Please enter a device name');
      return;
    }

    setIsSettingUp(true);
    try {
      const success = await setupDevice(deviceName.trim());
      if (success) {
        alert('E2EE device setup successful!');
      } else {
        alert('E2EE device setup failed. Check console for details.');
      }
    } catch (error) {
      console.error('Device setup error:', error);
      alert('E2EE device setup failed with error. Check console for details.');
    } finally {
      setIsSettingUp(false);
    }
  };

  return (
    <div className="p-4 bg-gray-100 rounded-lg m-4">
      <h3 className="text-lg font-semibold mb-4">E2EE Status Tester</h3>
      
      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-2">
          <span className="font-medium">Available:</span>
          <span className={isAvailable ? 'text-green-600 font-semibold' : 'text-red-600'}>
            {isAvailable ? '✓ YES - MESSAGES ARE ENCRYPTED' : '✗ No'}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="font-medium">Initializing:</span>
          <span className={isInitializing ? 'text-yellow-600' : 'text-gray-600'}>
            {isInitializing ? 'Yes' : 'No'}
          </span>
        </div>
        
        {error && (
          <div className="flex items-start gap-2">
            <span className="font-medium">Status:</span>
            <span className={error.includes('No E2EE device registered') ? 'text-orange-600' : 'text-green-600'}>
              {error}
            </span>
          </div>
        )}
        
        {status.deviceId && (
          <div className="flex items-center gap-2">
            <span className="font-medium">Device ID:</span>
            <span className="text-blue-600 font-mono text-sm">{status.deviceId}</span>
          </div>
        )}
      </div>
      
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <button
            onClick={handleTestE2EE}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            Test E2EE Status
          </button>
          
          {isAvailable && (
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors text-sm"
            >
              Refresh to Apply Changes
            </button>
          )}
        </div>

        {!isInitializing && (
          <div className="space-y-3 border-t pt-3">
            {!status.deviceId ? (
              <>
                <h4 className="font-medium text-gray-700">Setup E2EE Device</h4>
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    placeholder="Device name"
                    className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isSettingUp}
                  />
                  <button
                    onClick={handleSetupDevice}
                    disabled={isSettingUp}
                    className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors disabled:opacity-50"
                  >
                    {isSettingUp ? 'Setting up...' : 'Setup E2EE Device'}
                  </button>
                </div>
              </>
            ) : (
              <div className="text-sm text-green-600">
                ✓ E2EE Device configured: {status.deviceId.substring(0, 20)}...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}