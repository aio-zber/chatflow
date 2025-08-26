'use client'

import { useState, useEffect } from 'react'
import { CallRecord, CallRecordData } from './CallRecord'
import { Phone } from 'lucide-react'

interface CallRecordsListProps {
  conversationId: string
  onInitiateCall?: (callType: 'voice' | 'video') => void
}

export function CallRecordsList({ conversationId, onInitiateCall }: CallRecordsListProps) {
  const [callRecords, setCallRecords] = useState<CallRecordData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchCallRecords()
  }, [conversationId])

  const fetchCallRecords = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch(`/api/conversations/${conversationId}/call-records`)
      if (!response.ok) {
        throw new Error('Failed to fetch call records')
      }
      
      const data = await response.json()
      const records = data.callRecords.map((record: any) => ({
        ...record,
        startedAt: new Date(record.startedAt),
        endedAt: record.endedAt ? new Date(record.endedAt) : undefined
      }))
      
      setCallRecords(records)
    } catch (error) {
      console.error('Error fetching call records:', error)
      setError('Failed to load call records')
    } finally {
      setLoading(false)
    }
  }

  const handleCallBack = (callType: 'voice' | 'video') => {
    onInitiateCall?.(callType)
  }

  if (loading) {
    return (
      <div className="p-4 text-center">
        <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading call history...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <button
          onClick={fetchCallRecords}
          className="mt-2 px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Try Again
        </button>
      </div>
    )
  }

  if (callRecords.length === 0) {
    return (
      <div className="p-4 text-center">
        <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-2">
          <Phone className="w-6 h-6 text-gray-400" />
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">No call history yet</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Start a voice or video call to see records here</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1 mb-3">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Call History</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">{callRecords.length} calls</span>
      </div>
      
      {callRecords.map((record) => (
        <CallRecord
          key={record.id}
          callRecord={record}
          onCallBack={handleCallBack}
        />
      ))}
    </div>
  )
}