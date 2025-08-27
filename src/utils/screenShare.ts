export interface ScreenShareOptions {
  video: boolean
  audio: boolean
  systemAudio?: boolean
}

export class ScreenShareManager {
  private screenStream: MediaStream | null = null
  private originalStream: MediaStream | null = null
  private onStreamChange?: (stream: MediaStream | null) => void

  constructor(onStreamChange?: (stream: MediaStream | null) => void) {
    this.onStreamChange = onStreamChange
  }

  async startScreenShare(options: ScreenShareOptions = { video: true, audio: false }): Promise<MediaStream> {
    try {
      // Check if screen sharing is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error('Screen sharing is not supported in this browser')
      }

      const constraints: DisplayMediaStreamConstraints = {
        video: options.video ? {
          cursor: 'always',
          displaySurface: 'monitor'
        } : false,
        audio: options.audio ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false
        } : false
      }

      // Add system audio if supported and requested
      if (options.systemAudio && 'getDisplayMedia' in navigator.mediaDevices) {
        // @ts-expect-error - systemAudio is experimental
        constraints.audio = {
          ...constraints.audio,
          systemAudio: 'include'
        }
      }

      this.screenStream = await navigator.mediaDevices.getDisplayMedia(constraints)

      // Listen for the user stopping screen share via browser controls
      this.screenStream.getVideoTracks()[0]?.addEventListener('ended', () => {
        console.log('Screen share ended by user')
        this.stopScreenShare()
      })

      this.onStreamChange?.(this.screenStream)
      return this.screenStream

    } catch (error) {
      console.error('Failed to start screen sharing:', error)
      
      // Provide user-friendly error messages
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          throw new Error('Screen sharing permission was denied. Please allow screen sharing and try again.')
        } else if (error.name === 'NotSupportedError') {
          throw new Error('Screen sharing is not supported in this browser or device.')
        } else if (error.name === 'NotFoundError') {
          throw new Error('No screen or window available for sharing.')
        } else if (error.name === 'AbortError') {
          throw new Error('Screen sharing was cancelled.')
        }
      }
      
      throw new Error('Failed to start screen sharing. Please try again.')
    }
  }

  stopScreenShare(): void {
    if (this.screenStream) {
      // Stop all tracks
      this.screenStream.getTracks().forEach(track => {
        track.stop()
        console.log('Stopped screen share track:', track.kind)
      })
      
      this.screenStream = null
      this.onStreamChange?.(null)
    }
  }

  isScreenSharing(): boolean {
    return this.screenStream !== null && this.screenStream.active
  }

  getScreenStream(): MediaStream | null {
    return this.screenStream
  }

  // Replace video track in an existing peer connection
  async replaceVideoTrack(peerConnection: RTCPeerConnection, useScreenShare: boolean): Promise<void> {
    const sender = peerConnection.getSenders().find(s => 
      s.track && s.track.kind === 'video'
    )

    if (!sender) {
      throw new Error('No video sender found in peer connection')
    }

    if (useScreenShare) {
      if (!this.screenStream) {
        throw new Error('No screen share stream available')
      }
      
      const videoTrack = this.screenStream.getVideoTracks()[0]
      if (videoTrack) {
        await sender.replaceTrack(videoTrack)
        console.log('Replaced video track with screen share')
      }
    } else {
      if (!this.originalStream) {
        throw new Error('No original stream available')
      }
      
      const videoTrack = this.originalStream.getVideoTracks()[0]
      if (videoTrack) {
        await sender.replaceTrack(videoTrack)
        console.log('Replaced video track with camera')
      }
    }
  }

  setOriginalStream(stream: MediaStream): void {
    this.originalStream = stream
  }

  cleanup(): void {
    this.stopScreenShare()
    this.originalStream = null
    this.onStreamChange = undefined
  }
}

// Utility function to detect screen share capabilities
export function getScreenShareCapabilities(): {
  supported: boolean
  systemAudioSupported: boolean
  reason?: string
} {
  if (!navigator.mediaDevices) {
    return {
      supported: false,
      systemAudioSupported: false,
      reason: 'MediaDevices API not available'
    }
  }

  if (!navigator.mediaDevices.getDisplayMedia) {
    return {
      supported: false,
      systemAudioSupported: false,
      reason: 'Screen sharing not supported in this browser'
    }
  }

  // Check for system audio support (experimental)
  const systemAudioSupported = 'getDisplayMedia' in navigator.mediaDevices && 
    typeof MediaTrackSupportedConstraints !== 'undefined'

  return {
    supported: true,
    systemAudioSupported,
    reason: undefined
  }
}
