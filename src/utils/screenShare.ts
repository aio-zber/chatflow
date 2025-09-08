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

      const constraints: any = {
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
      // Stop all tracks with proper cleanup
      this.screenStream.getTracks().forEach(track => {
        try {
          if (track.readyState !== 'ended') {
            track.stop()
          }
          console.log('Stopped screen share track:', track.kind, 'readyState:', track.readyState)
        } catch (error) {
          console.warn('Error stopping screen share track:', error)
        }
      })
      
      // Clear the stream reference
      this.screenStream = null
      
      // Notify listeners about the change
      this.onStreamChange?.(null)
      
      // Force garbage collection hint for the browser
      setTimeout(() => {
        console.log('Screen share cleanup completed')
      }, 100)
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
      if (videoTrack && videoTrack.readyState === 'live') {
        await sender.replaceTrack(videoTrack)
        console.log('Replaced video track with screen share')
      } else {
        throw new Error('Screen share video track is not available or not live')
      }
    } else {
      // When switching back to camera, ensure we have a live camera stream
      if (!this.originalStream) {
        throw new Error('No original stream available')
      }
      
      let videoTrack = this.originalStream.getVideoTracks()[0]
      
      // Check if the original video track is still live
      if (!videoTrack || videoTrack.readyState !== 'live') {
        console.log('Original camera track not live, requesting new camera stream...')
        
        try {
          // Get a fresh camera stream
          const freshCameraStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 },
              facingMode: 'user'
            },
            audio: false  // Only video for track replacement
          })
          
          videoTrack = freshCameraStream.getVideoTracks()[0]
          
          // Update the original stream with the fresh camera track
          if (videoTrack) {
            // Remove old video tracks from original stream
            this.originalStream.getVideoTracks().forEach(track => {
              this.originalStream!.removeTrack(track)
              track.stop()
            })
            
            // Add fresh camera track to original stream
            this.originalStream.addTrack(videoTrack)
            console.log('Updated original stream with fresh camera track')
          }
        } catch (error) {
          console.error('Failed to get fresh camera stream:', error)
          throw new Error('Failed to restore camera: ' + (error as Error).message)
        }
      }
      
      if (videoTrack && videoTrack.readyState === 'live') {
        await sender.replaceTrack(videoTrack)
        console.log('Replaced video track with camera (live track confirmed)')
        
        // Force a brief pause and resume to ensure the track change is processed
        setTimeout(() => {
          if (videoTrack.enabled) {
            videoTrack.enabled = false
            setTimeout(() => {
              videoTrack.enabled = true
              console.log('Camera track re-enabled to ensure proper display')
            }, 100)
          }
        }, 200)
      } else {
        throw new Error('Camera video track is not available or not live')
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
  const systemAudioSupported = 'getDisplayMedia' in navigator.mediaDevices

  return {
    supported: true,
    systemAudioSupported,
    reason: undefined
  }
}
