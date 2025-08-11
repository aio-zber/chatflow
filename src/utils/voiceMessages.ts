/**
 * Voice message utilities for ChatFlow
 */

export interface VoiceUploadResponse {
  success: boolean
  fileUrl: string
  filename: string
  size: number
  duration: number
}

/**
 * Upload a voice message blob to the server
 */
export async function uploadVoiceMessage(
  audioBlob: Blob, 
  duration: number
): Promise<VoiceUploadResponse> {
  const formData = new FormData()
  formData.append('voice', audioBlob, 'voice-message.webm')
  formData.append('duration', duration.toString())

  const response = await fetch('/api/upload/voice', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to upload voice message')
  }

  return response.json()
}

/**
 * Convert audio blob to different format if needed
 */
export function convertAudioBlob(
  blob: Blob, 
  targetMimeType: string = 'audio/webm;codecs=opus'
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (blob.type === targetMimeType) {
      resolve(blob)
      return
    }

    // For now, just return the original blob
    // In a real implementation, you might use Web Audio API or external library
    // to convert between formats
    resolve(blob)
  })
}

/**
 * Get audio duration from blob
 */
export function getAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio()
    const url = URL.createObjectURL(blob)
    
    audio.addEventListener('loadedmetadata', () => {
      URL.revokeObjectURL(url)
      resolve(audio.duration)
    })
    
    audio.addEventListener('error', () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load audio metadata'))
    })
    
    audio.src = url
  })
}

/**
 * Check if browser supports audio recording
 */
export function checkAudioRecordingSupport(): {
  supported: boolean
  reason?: string
} {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return {
      supported: false,
      reason: 'MediaDevices API not supported'
    }
  }

  if (!window.MediaRecorder) {
    return {
      supported: false,
      reason: 'MediaRecorder API not supported'
    }
  }

  return { supported: true }
}

/**
 * Get supported audio formats for recording
 */
export function getSupportedAudioFormats(): string[] {
  const formats = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav'
  ]

  return formats.filter(format => {
    try {
      return MediaRecorder.isTypeSupported(format)
    } catch {
      return false
    }
  })
}

/**
 * Estimate file size for given duration and quality
 */
export function estimateFileSize(
  durationSeconds: number,
  quality: 'low' | 'medium' | 'high' = 'medium'
): number {
  // Rough estimates in bytes per second for different qualities
  const bytesPerSecond = {
    low: 4000,    // ~32 kbps
    medium: 8000, // ~64 kbps  
    high: 16000   // ~128 kbps
  }

  return durationSeconds * bytesPerSecond[quality]
}

/**
 * Format duration for display
 */
export function formatVoiceDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Validate voice message constraints
 */
export function validateVoiceMessage(blob: Blob, duration: number): {
  valid: boolean
  error?: string
} {
  const maxDuration = 300 // 5 minutes
  const maxSize = 50 * 1024 * 1024 // 50MB

  if (duration > maxDuration) {
    return {
      valid: false,
      error: `Voice message too long. Maximum duration is ${Math.floor(maxDuration / 60)} minutes.`
    }
  }

  if (blob.size > maxSize) {
    return {
      valid: false,
      error: `Voice message file too large. Maximum size is ${Math.floor(maxSize / 1024 / 1024)}MB.`
    }
  }

  if (duration < 1) {
    return {
      valid: false,
      error: 'Voice message too short. Minimum duration is 1 second.'
    }
  }

  return { valid: true }
}
