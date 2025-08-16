'use client'

import React, { useState } from 'react'
import { useE2EE } from '@/hooks/useE2EE'

interface E2EETesterProps {
  conversationId: string
}

export function E2EETester({ conversationId }: E2EETesterProps) {
  const { 
    isAvailable, 
    status,
    logSignalClientStatus,
    getEncryptionStatus 
  } = useE2EE()

  const handleStatusCheck = async () => {
    console.log('🔐 E2EE Tester: Checking libsignal-client status...')
    logSignalClientStatus()
    const encStatus = await getEncryptionStatus(conversationId)
    console.log('🔐 E2EE Tester: Conversation encryption status:', encStatus)
  }

  const statusColor = isAvailable ? 'green' : status.initializing ? 'yellow' : 'red'
  const statusBg = isAvailable ? 'bg-green-50 border-green-200' : status.initializing ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'
  const statusText = isAvailable ? 'text-green-800' : status.initializing ? 'text-yellow-800' : 'text-red-800'

  return (
    <div className={`p-4 ${statusBg} border rounded-lg`}>
      <h3 className={`text-lg font-semibold ${statusText} mb-4`}>🔐 E2EE Status Panel</h3>
      
      <div className="space-y-3">
        <div className={`p-3 rounded-md ${statusText}`}>
          <div className="font-medium">
            Status: {isAvailable ? '✅ Available' : status.initializing ? '⏳ Initializing' : '❌ Not Available'}
          </div>
          {status.error && (
            <div className="text-sm mt-1">Error: {status.error}</div>
          )}
          {status.deviceId && (
            <div className="text-sm mt-1">Device: {status.deviceId}</div>
          )}
        </div>

        <button
          onClick={handleStatusCheck}
          className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
        >
          Check LibSignal Status
        </button>
      </div>
      
      <div className="mt-4 text-sm text-gray-600">
        <p>• Check browser console for detailed libsignal-client logs</p>
        <p>• This shows the status of the real E2EE implementation</p>
      </div>
    </div>
  )
}