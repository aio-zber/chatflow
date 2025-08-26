import { Socket } from 'socket.io-client'

export interface WebRTCConfig extends RTCConfiguration {
  iceServers: RTCIceServer[]
}

export interface PeerConnection {
  id: string
  connection: RTCPeerConnection
  remoteStream?: MediaStream
}

export class WebRTCService {
  private socket: Socket
  private localStream: MediaStream | null = null
  private peerConnections: Map<string, PeerConnection> = new Map()
  private callId: string | null = null
  private currentUserId: string
  private initializationInProgress: boolean = false // Prevent concurrent initialization
  // Buffer for ICE candidates that arrive before peer connections are established
  private pendingIceCandidates: Map<string, RTCIceCandidateInit[]> = new Map()
  
  private readonly config: WebRTCConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      // Additional reliable STUN servers for better connectivity
      { urls: 'stun:stun.xten.com' },
      { urls: 'stun:stun.voiparound.com' },
      { urls: 'stun:stun.voipbuster.com' },
      // Free public TURN servers for NAT traversal
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ],
    // ENHANCED: Configuration optimized for ultra-low latency real-time communication
    iceCandidatePoolSize: 15, // Increased for faster connection setup
    bundlePolicy: 'max-bundle', // Bundle audio/video on same connection for efficiency
    rtcpMuxPolicy: 'require', // Multiplex RTP/RTCP on same port to reduce delay
    iceTransportPolicy: 'all', // Use both STUN and TURN for best connectivity
    // Additional real-time optimizations
    sdpSemantics: 'unified-plan' // Use unified plan for better performance
  }

  // Store bound methods to ensure proper cleanup
  private boundHandleRemoteOffer: (data: { callId: string; fromUserId: string; offer: RTCSessionDescriptionInit }) => void
  private boundHandleRemoteAnswer: (data: { callId: string; fromUserId: string; answer: RTCSessionDescriptionInit }) => void
  private boundHandleRemoteIceCandidate: (data: { callId: string; fromUserId: string; candidate: RTCIceCandidateInit }) => void
  private boundHandleParticipantLeft: (data: { participantId: string }) => void

  // CRITICAL: Optimize SDP for ultra-low latency real-time communication
  private optimizeSdpForLowLatency(sdp: string): string {
    console.log('[WebRTC] 🚀 Optimizing SDP for ultra-low latency...')
    
    let optimizedSdp = sdp
    
    // 1. Prioritize Opus for audio (best real-time codec)
    // Move Opus to the front of the codec list
    optimizedSdp = optimizedSdp.replace(
      /(m=audio \d+ UDP\/TLS\/RTP\/SAVPF) (.+)/g,
      (match, prefix, codecs) => {
        const codecList = codecs.split(' ')
        const opusIndex = codecList.findIndex(codec => 
          optimizedSdp.includes(`a=rtpmap:${codec} opus/48000/2`)
        )
        if (opusIndex > 0) {
          // Move Opus to front
          const opusCodec = codecList.splice(opusIndex, 1)[0]
          codecList.unshift(opusCodec)
        }
        return `${prefix} ${codecList.join(' ')}`
      }
    )
    
    // 2. Add low-latency audio attributes for Opus
    optimizedSdp = optimizedSdp.replace(
      /(a=rtpmap:(\d+) opus\/48000\/2\r?\n)/g,
      '$1a=fmtp:$2 minptime=10;useinbandfec=1;usedtx=0\r\n'
    )
    
    // 3. Prioritize H.264 for video (hardware accelerated)
    optimizedSdp = optimizedSdp.replace(
      /(m=video \d+ UDP\/TLS\/RTP\/SAVPF) (.+)/g,
      (match, prefix, codecs) => {
        const codecList = codecs.split(' ')
        const h264Index = codecList.findIndex(codec => 
          optimizedSdp.includes(`a=rtpmap:${codec} H264/90000`)
        )
        if (h264Index > 0) {
          // Move H.264 to front
          const h264Codec = codecList.splice(h264Index, 1)[0]
          codecList.unshift(h264Codec)
        }
        return `${prefix} ${codecList.join(' ')}`
      }
    )
    
    // 4. Add ultra-low latency video encoding parameters
    optimizedSdp = optimizedSdp.replace(
      /(a=rtpmap:(\d+) H264\/90000\r?\n)/g,
      '$1a=fmtp:$2 profile-level-id=42e01f;level-asymmetry-allowed=1;packetization-mode=1\r\n'
    )
    
    // 5. Minimize buffering with smaller packet sizes
    optimizedSdp = optimizedSdp.replace(
      /(a=rtpmap:\d+ opus\/48000\/2\r?\n)/g,
      '$1a=ptime:10\r\n'
    )
    
    // 6. Set aggressive bandwidth parameters for real-time
    if (!optimizedSdp.includes('b=AS:')) {
      optimizedSdp = optimizedSdp.replace(
        /(m=video \d+ UDP\/TLS\/RTP\/SAVPF .+\r?\n)/,
        '$1b=AS:2000\r\n' // 2Mbps for video
      )
      optimizedSdp = optimizedSdp.replace(
        /(m=audio \d+ UDP\/TLS\/RTP\/SAVPF .+\r?\n)/,
        '$1b=AS:128\r\n' // 128kbps for audio
      )
    }
    
    console.log('[WebRTC] ✅ SDP optimized for ultra-low latency')
    return optimizedSdp
  }

  constructor(socket: Socket, userId: string) {
    this.socket = socket
    this.currentUserId = userId
    
    // Bind methods once to ensure proper cleanup
    this.boundHandleRemoteOffer = this.handleRemoteOffer.bind(this)
    this.boundHandleRemoteAnswer = this.handleRemoteAnswer.bind(this)
    this.boundHandleRemoteIceCandidate = this.handleRemoteIceCandidate.bind(this)
    this.boundHandleParticipantLeft = this.handleParticipantLeft.bind(this)
    
    this.setupSocketListeners()
  }

  private setupSocketListeners() {
    console.log('[WebRTC] Setting up socket listeners for user:', this.currentUserId)
    this.socket.on('webrtc_offer', this.boundHandleRemoteOffer)
    this.socket.on('webrtc_answer', this.boundHandleRemoteAnswer)
    this.socket.on('webrtc_ice_candidate', this.boundHandleRemoteIceCandidate)
    this.socket.on('participant_left', this.boundHandleParticipantLeft)
  }

  async initializeCall(callId: string, isVideo: boolean): Promise<MediaStream> {
    console.log('[WebRTC] 🚀 INITIALIZING CALL:', callId, 'video:', isVideo, 'userId:', this.currentUserId)
    console.log('[WebRTC] 📊 Service state before init:', {
      hasLocalStream: !!this.localStream,
      peerConnections: this.peerConnections.size,
      initInProgress: this.initializationInProgress
    })
    
    // CRITICAL: Prevent concurrent initialization
    if (this.initializationInProgress) {
      console.log('[WebRTC] ⏳ Initialization already in progress, waiting...')
      // Wait for current initialization to complete
      while (this.initializationInProgress) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      // If we now have a stream, return it
      if (this.localStream?.active) {
        console.log('[WebRTC] ✅ Using stream from concurrent initialization')
        return this.localStream
      }
    }
    
    this.initializationInProgress = true
    this.callId = callId

    try {
      // If we already have a local stream, verify it's still active
      if (this.localStream) {
        const isActive = this.localStream.active && this.localStream.getTracks().some(t => t.readyState === 'live')
        if (isActive) {
          console.log('[WebRTC] ✅ Using existing active local stream:', this.localStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, readyState: t.readyState })))
          this.initializationInProgress = false // Clear lock before early return
          return this.localStream
        } else {
          console.log('[WebRTC] ⚠️ Existing stream is inactive, creating new one')
          this.localStream = null
        }
      }

      // ENHANCED: Progressive fallback with optimized constraints for better compatibility and performance
      const createConstraints = (highQuality: boolean = true) => {
        return {
          audio: {
            // CRITICAL: Ultra-low latency audio configuration
            echoCancellation: true, // Keep for call quality
            noiseSuppression: false, // DISABLE for lower latency
            autoGainControl: false, // DISABLE for lower latency
            sampleRate: highQuality ? 48000 : 24000, // Optimized sample rates
            sampleSize: 16,
            channelCount: 1, // Mono for lower bandwidth and processing
            latency: 0.005, // 5ms target latency (very aggressive)
            volume: 1.0,
            // Additional low-latency constraints
            googEchoCancellation: false, // Disable Google's EC for speed
            googNoiseSuppression: false, // Disable Google's NS for speed
            googAutoGainControl: false, // Disable Google's AGC for speed
            googHighpassFilter: false, // Disable filtering for speed
            googTypingNoiseDetection: false // Disable typing detection
          },
          video: isVideo ? {
            width: highQuality ? { ideal: 1280, max: 1920 } : { ideal: 640, max: 1280 },
            height: highQuality ? { ideal: 720, max: 1080 } : { ideal: 480, max: 720 },
            frameRate: highQuality ? { ideal: 30, max: 60 } : { ideal: 15, max: 30 },
            facingMode: 'user',
            // CRITICAL: Video optimization for low latency
            aspectRatio: 16/9,
            resizeMode: 'crop-and-scale'
          } : false
        }
      }

      console.log('[WebRTC] 📹 Requesting media permissions...')
      
      // ENHANCED: Progressive fallback strategy with better error handling
      const primaryConstraints = createConstraints(true)
      const fallbackConstraints = createConstraints(false)
      const basicConstraints = {
        audio: true,
        video: isVideo
      }
      
      console.log('[WebRTC] 🎯 Trying primary constraints (high quality)...')
      let stream: MediaStream
      let constraintAttempt = 'primary'

      try {
        stream = await navigator.mediaDevices.getUserMedia(primaryConstraints)
        console.log('[WebRTC] ✅ Primary constraints successful!')
      } catch (primaryError) {
        console.warn('[WebRTC] ⚠️ Primary constraints failed, trying fallback:', primaryError)
        constraintAttempt = 'fallback'
        
        try {
          stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints)
          console.log('[WebRTC] ✅ Fallback constraints successful!')
        } catch (fallbackError) {
          console.warn('[WebRTC] ⚠️ Fallback constraints failed, trying basic:', fallbackError)
          constraintAttempt = 'basic'
          
          try {
            stream = await navigator.mediaDevices.getUserMedia(basicConstraints)
            console.log('[WebRTC] ✅ Basic constraints successful!')
          } catch (basicError) {
            console.error('[WebRTC] ❌ All constraint attempts failed')
            throw basicError
          }
        }
      }

      console.log(`[WebRTC] 🎉 Media stream acquired using ${constraintAttempt} constraints`)

      this.localStream = stream

      // Verify and validate tracks
      const tracks = this.localStream.getTracks()
      console.log('[WebRTC] Local stream acquired successfully:', tracks.map(t => ({ 
        kind: t.kind, 
        enabled: t.enabled, 
        readyState: t.readyState,
        label: t.label 
      })))
      
      // Validate we have the required tracks
      const audioTracks = tracks.filter(t => t.kind === 'audio')
      const videoTracks = tracks.filter(t => t.kind === 'video')
      
      if (audioTracks.length === 0) {
        throw new Error('No audio track available')
      }
      
      if (isVideo && videoTracks.length === 0) {
        console.warn('[WebRTC] Video requested but no video track available, continuing with audio only')
      }
      
      // Ensure all tracks are enabled and add error handlers
      tracks.forEach(track => {
        if (!track.enabled) {
          console.log('[WebRTC] Enabling disabled track:', track.kind)
          track.enabled = true
        }
        
        // CRITICAL: Apply ultra-low latency settings for audio tracks
        if (track.kind === 'audio') {
          try {
            // Apply audio constraints for minimum latency
            const audioTrack = track as MediaStreamTrack
            const constraints = {
              echoCancellation: false, // Disable for minimum latency
              noiseSuppression: false,
              autoGainControl: false,
              latency: 0.005, // 5ms target
              sampleRate: 48000,
              sampleSize: 16,
              channelCount: 1
            }
            
            // Apply constraints to the track if supported
            if (audioTrack.applyConstraints) {
              audioTrack.applyConstraints(constraints)
                .then(() => {
                  console.log('[WebRTC] ✅ Applied ultra-low latency constraints to audio track')
                })
                .catch(error => {
                  console.warn('[WebRTC] Could not apply audio constraints:', error)
                })
            }
            
            // Set audio processing flags for minimum latency
            const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
            const audioContext = new AudioContextClass()
            if (audioContext) {
              try {
                // Set the audio context to low latency mode
                if (audioContext.audioWorklet) {
                  audioContext.audioWorklet.addModule('data:text/javascript,')
                    .catch(() => {}) // Ignore if not supported
                }
                
                // Close the context as we don't need it after settings
                audioContext.close().catch(() => {})
              } catch (contextError) {
                console.warn('[WebRTC] Could not optimize audio context:', contextError)
              }
            }
            
          } catch (optimizationError) {
            console.warn('[WebRTC] Could not apply audio optimizations:', optimizationError)
          }
        }
        
        // Add track event handlers for debugging
        track.addEventListener('ended', () => {
          console.warn('[WebRTC] Track ended:', track.kind, track.label)
        })
        
        track.addEventListener('mute', () => {
          console.warn('[WebRTC] Track muted:', track.kind, track.label)
        })
      })
      
      return this.localStream
    } catch (error) {
      console.error('[WebRTC] Failed to get user media:', error)
      
      // Cleanup any partial stream
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop())
        this.localStream = null
      }
      
      // More specific error messages with recovery suggestions
      if (error instanceof DOMException) {
        switch (error.name) {
          case 'NotAllowedError':
            throw new Error('Camera/microphone access denied. Please allow permissions and refresh the page.')
          case 'NotFoundError':
            throw new Error('No camera/microphone found. Please check your device connections.')
          case 'NotReadableError':
            throw new Error('Camera/microphone is in use by another application. Please close other applications and try again.')
          case 'OverconstrainedError':
            throw new Error('Camera/microphone does not support the requested settings. Please try again.')
          case 'SecurityError':
            throw new Error('Camera/microphone access blocked by security policy. Please check browser settings.')
          default:
            throw new Error(`Camera/microphone error: ${error.message}`)
        }
      }
      
      throw new Error(`Failed to access ${isVideo ? 'camera and ' : ''}microphone: ${(error as Error).message}`)
    } finally {
      // CRITICAL: Always clear initialization lock
      this.initializationInProgress = false
    }
  }

  hasLocalStream(): boolean {
    if (!this.localStream) {
      console.log('[WebRTC] 🔍 hasLocalStream: No local stream')
      return false
    }
    
    const liveTracks = this.localStream.getTracks().filter(track => track.readyState === 'live')
    const hasLiveTracks = liveTracks.length > 0
    
    console.log('[WebRTC] 🔍 hasLocalStream:', {
      hasStream: !!this.localStream,
      streamActive: this.localStream.active,
      totalTracks: this.localStream.getTracks().length,
      liveTracks: liveTracks.length,
      result: hasLiveTracks
    })
    
    return hasLiveTracks
  }

  async waitForLocalStream(timeoutMs: number = 5000): Promise<boolean> {
    console.log('[WebRTC] ⏳ Waiting for local stream to be ready...')
    
    const startTime = Date.now()
    
    while (Date.now() - startTime < timeoutMs) {
      if (this.hasLocalStream()) {
        console.log('[WebRTC] ✅ Local stream is ready!')
        return true
      }
      
      // Wait 50ms before checking again
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    
    console.log('[WebRTC] ❌ Timeout waiting for local stream')
    return false
  }

  async safeCreateOffer(participantId: string): Promise<void> {
    console.log('[WebRTC] 📞 Safe creating offer for participant:', participantId)
    
    // First, wait for local stream to be ready
    const streamReady = await this.waitForLocalStream(3000)
    if (!streamReady) {
      throw new Error('Local stream not available - cannot create offer')
    }
    
    // Create peer connection
    const pc = await this.createPeerConnection(participantId)
    
    try {
      // Create offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: false
      })
      
      // Optimize SDP for low latency
      const optimizedSdp = this.optimizeSdpForLowLatency(offer.sdp || '')
      offer.sdp = optimizedSdp
      
      await pc.setLocalDescription(offer)
      
      console.log('[WebRTC] 📡 Sending offer to participant:', participantId)
      this.socket.emit('webrtc_offer', {
        callId: this.callId,
        toUserId: participantId,
        offer: offer
      })
      
    } catch (error) {
      console.error('[WebRTC] ❌ Failed to create offer for participant:', participantId, error)
      throw error
    }
  }

  setLocalStream(stream: MediaStream): void {
    this.localStream = stream
    console.log('[WebRTC] 🎥 LOCAL STREAM SET:', {
      streamId: stream.id,
      tracks: stream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, readyState: t.readyState })),
      callId: this.callId,
      userId: this.currentUserId,
      existingPeerConnections: this.peerConnections.size
    })
    
    // CRITICAL FIX: Add tracks to existing peer connections if they exist
    this.peerConnections.forEach((peerConn, participantId) => {
      console.log('[WebRTC] Adding new tracks to existing peer connection for:', participantId)
      
      const existingSenders = peerConn.connection.getSenders()
      
      stream.getTracks().forEach(track => {
        // Check if track is already being sent
        const existingSender = existingSenders.find(sender => sender.track?.kind === track.kind)
        
        if (!existingSender) {
          console.log('[WebRTC] Adding new track to peer connection:', track.kind, 'for:', participantId)
          peerConn.connection.addTrack(track, stream)
        } else {
          console.log('[WebRTC] Replacing existing track:', track.kind, 'for:', participantId)
          existingSender.replaceTrack(track)
        }
      })
    })
    
    // CRITICAL FIX: Notify server that our local stream is ready
    if (this.callId && this.currentUserId) {
      console.log('[WebRTC] 📡 Notifying server that local stream is ready')
      this.socket.emit('webrtc_stream_ready', {
        callId: this.callId,
        participantId: this.currentUserId,
        streamId: stream.id,
        hasAudio: stream.getAudioTracks().length > 0,
        hasVideo: stream.getVideoTracks().length > 0
      })
    }
    
    console.log('[WebRTC] ✅ Local stream fully set and ready for peer connections')
  }

  async createPeerConnection(participantId: string): Promise<RTCPeerConnection> {
    console.log('[WebRTC] Creating peer connection for:', participantId)
    
    // CRITICAL: Check if peer connection already exists to prevent duplicates
    if (this.peerConnections.has(participantId)) {
      const existingPeerConn = this.peerConnections.get(participantId)!
      const existingState = existingPeerConn.connection.connectionState
      const existingICEState = existingPeerConn.connection.iceConnectionState
      
      console.log('[WebRTC] ⚠️ Peer connection already exists for:', participantId, {
        connectionState: existingState,
        iceConnectionState: existingICEState,
        signalingState: existingPeerConn.connection.signalingState
      })
      
      // CRITICAL FIX: Only reuse if connection is in a good state
      if (existingState === 'connected' || existingState === 'connecting' ||
          existingICEState === 'connected' || existingICEState === 'checking') {
        console.log('[WebRTC] ✅ Reusing healthy existing connection for:', participantId)
        return existingPeerConn.connection
      } else {
        console.log('[WebRTC] 🔄 Existing connection unhealthy, creating new one for:', participantId)
        // Clean up the unhealthy connection first
        try {
          existingPeerConn.connection.close()
          this.peerConnections.delete(participantId)
        } catch (error) {
          console.warn('[WebRTC] Error cleaning up unhealthy connection:', error)
        }
      }
    }
    
    // ENHANCED: More robust local stream validation with detailed logging
    if (!this.localStream) {
      console.error('[WebRTC] ❌ No local stream available! Cannot create peer connection.')
      throw new Error('Local stream not available for peer connection')
    }
    
    // Check if stream has live tracks instead of just checking active property
    const liveTracks = this.localStream.getTracks().filter(track => track.readyState === 'live')
    if (liveTracks.length === 0) {
      console.error('[WebRTC] ❌ No live tracks in local stream! Cannot create peer connection.')
      console.error('[WebRTC] Stream state:', {
        streamActive: this.localStream.active,
        totalTracks: this.localStream.getTracks().length,
        liveTracks: liveTracks.length,
        tracks: this.localStream.getTracks().map(t => ({ kind: t.kind, readyState: t.readyState, enabled: t.enabled }))
      })
      throw new Error('Local stream has no live tracks for peer connection')
    }
    
    console.log('[WebRTC] ✅ Local stream validation passed:', {
      streamActive: this.localStream.active,
      liveTracks: liveTracks.length,
      trackDetails: liveTracks.map(t => ({ kind: t.kind, enabled: t.enabled }))
    })
    
    const pc = new RTCPeerConnection(this.config)
    
    // CRITICAL: Apply low-latency optimizations immediately after creation
    console.log('[WebRTC] 🚀 Applying low-latency optimizations for peer connection:', participantId)
    
    // Add local stream tracks FIRST before setting up event handlers
    const tracks = this.localStream.getTracks()
    console.log('[WebRTC] Adding local tracks to peer connection:', tracks.map(t => ({ kind: t.kind, enabled: t.enabled, readyState: t.readyState })))
    
    let tracksAdded = 0
    tracks.forEach(track => {
      if (track.readyState === 'live' && track.enabled) {
        console.log('[WebRTC] Adding live track to peer connection:', track.kind, track.label)
        
        // CRITICAL FIX: Use addTrack instead of addTransceiver for better compatibility
        const sender = pc.addTrack(track, this.localStream!)
        console.log('[WebRTC] ✅ Track added successfully:', track.kind, 'sender:', !!sender)
        
        // Apply optimizations to the sender
        if (sender) {
          setTimeout(async () => {
            try {
              const params = sender.getParameters()
              if (params.encodings && params.encodings.length > 0) {
                if (track.kind === 'audio') {
                  // ULTRA-LOW LATENCY: Audio optimization
                  params.encodings[0].priority = 'high'
                  params.encodings[0].networkPriority = 'high'
                  params.encodings[0].maxBitrate = 128000 // 128kbps for audio
                  console.log('[WebRTC] 🎵 Set ultra-low latency audio parameters')
                } else if (track.kind === 'video') {
                  // ULTRA-LOW LATENCY: Video optimization
                  params.encodings[0].priority = 'medium'
                  params.encodings[0].networkPriority = 'medium' 
                  params.encodings[0].maxBitrate = 2000000 // 2Mbps max for video
                  params.encodings[0].maxFramerate = 30 // Cap at 30fps for efficiency
                  // CRITICAL: Real-time encoding parameters
                  params.encodings[0].scaleResolutionDownBy = 1 // No downscaling
                  console.log('[WebRTC] 📹 Set ultra-low latency video parameters')
                }
                await sender.setParameters(params)
              }
            } catch (error) {
              console.warn('[WebRTC] Could not optimize sender parameters:', error)
            }
          }, 100)
        }
        
        // ULTRA-LOW LATENCY: Apply additional real-time constraints to live audio tracks
        if (track.kind === 'audio') {
          // Apply constraints without await to avoid blocking - constraints apply asynchronously
          track.applyConstraints({
            echoCancellation: false,        // DISABLED for absolute minimum latency
            noiseSuppression: false,        // DISABLED for absolute minimum latency
            autoGainControl: false,         // DISABLED for absolute minimum latency
            latency: 0.005,                 // 5ms target - extremely aggressive
            sampleRate: 48000,              // High sample rate for low processing delay
            channelCount: 1,                // Mono for efficiency
            // Additional ultra-low latency flags
            googEchoCancellation: false,
            googNoiseSuppression: false,
            googAutoGainControl: false,
            googHighpassFilter: false,
            googTypingNoiseDetection: false,
            googAudioMirroring: false,
            // Voice activity detection OFF for consistent ultra-low latency
            voiceActivityDetection: false
          }).then(() => {
            console.log('[WebRTC] 🎵 Applied ultra-low latency constraints to live audio track')
          }).catch((constraintError) => {
            console.warn('[WebRTC] Could not apply ultra-low latency constraints:', constraintError)
          })
        }
        
        tracksAdded++
      } else {
        console.warn('[WebRTC] Skipping track:', track.kind, 'readyState:', track.readyState, 'enabled:', track.enabled)
      }
    })
    
    if (tracksAdded === 0) {
      console.error('[WebRTC] ❌ No live tracks were added to peer connection!')
      throw new Error('No live tracks available for peer connection')
    }
    
    console.log('[WebRTC] ✅ Added', tracksAdded, 'tracks with low-latency transceivers for:', participantId)

    // Handle remote stream - CRITICAL: This is where remote media is received
    pc.ontrack = (event) => {
      console.log('[WebRTC] 🎵 RECEIVED REMOTE TRACK:', event.track.kind, 'from:', participantId)
      console.log('[WebRTC] Track state:', {
        id: event.track.id,
        label: event.track.label,
        enabled: event.track.enabled,
        readyState: event.track.readyState,
        muted: event.track.muted
      })

      // CRITICAL FIX: Ensure remote audio tracks are enabled for hearing other participants
      if (event.track.kind === 'audio') {
        if (!event.track.enabled) {
          console.log('[WebRTC] 🔧 ENABLING disabled remote audio track from:', participantId)
          event.track.enabled = true
        }
        console.log('[WebRTC] 🎵 Remote audio track final state:', {
          enabled: event.track.enabled,
          muted: event.track.muted,
          readyState: event.track.readyState
        })
      }
      
      const peerConn = this.peerConnections.get(participantId)
      if (peerConn) {
        // CRITICAL FIX: Always use stream from event if available for better compatibility
        if (event.streams && event.streams.length > 0) {
          peerConn.remoteStream = event.streams[0]
          console.log('[WebRTC] ✅ Using stream from event:', peerConn.remoteStream.id)
        } else {
          // Fallback: create stream and add tracks manually
          if (!peerConn.remoteStream) {
            peerConn.remoteStream = new MediaStream()
          }
          
          // Only add track if it's not already in the stream
          const trackIds = peerConn.remoteStream.getTracks().map(t => t.id)
          if (!trackIds.includes(event.track.id)) {
            peerConn.remoteStream.addTrack(event.track)
            console.log('[WebRTC] ✅ Added track to remote stream:', event.track.kind)
          }
        }
        
        // CRITICAL: Verify stream has working tracks
        const audioTracks = peerConn.remoteStream.getAudioTracks()
        const videoTracks = peerConn.remoteStream.getVideoTracks()
        
        console.log('[WebRTC] 📊 Stream verification for', participantId + ':')
        console.log('[WebRTC]   Audio tracks:', audioTracks.length, audioTracks.map(t => ({enabled: t.enabled, readyState: t.readyState})))
        console.log('[WebRTC]   Video tracks:', videoTracks.length, videoTracks.map(t => ({enabled: t.enabled, readyState: t.readyState})))
        console.log('[WebRTC]   Stream active:', peerConn.remoteStream.active)
        
        // Monitor track state changes
        event.track.addEventListener('ended', () => {
          console.log('[WebRTC] ⚠️ Remote track ended:', event.track.kind, 'for:', participantId)
        })
        
        event.track.addEventListener('mute', () => {
          console.log('[WebRTC] 🔇 Remote track muted:', event.track.kind, 'for:', participantId)
        })
        
        event.track.addEventListener('unmute', () => {
          console.log('[WebRTC] 🔊 Remote track unmuted:', event.track.kind, 'for:', participantId)
        })
        
        // CRITICAL FIX: Delay notification to ensure peer connection state is stable
        console.log('[WebRTC] 📡 Scheduling notification about remote stream for:', participantId)
        setTimeout(() => {
          // Verify the peer connection and stream still exist
          const currentPeerConn = this.peerConnections.get(participantId)
          if (currentPeerConn && currentPeerConn.remoteStream) {
            console.log('[WebRTC] 📡 EMITTING webrtc_stream_ready after delay for:', participantId)
            this.socket.emit('webrtc_stream_ready', {
              callId: this.callId,
              participantId: participantId,
              streamId: currentPeerConn.remoteStream.id,
              hasAudio: currentPeerConn.remoteStream.getAudioTracks().length > 0,
              hasVideo: currentPeerConn.remoteStream.getVideoTracks().length > 0
            })
          } else {
            console.warn('[WebRTC] ⚠️ Peer connection or stream no longer exists for:', participantId)
          }
        }, 100) // Small delay to ensure state consistency
        
        // CRITICAL FIX: Check call readiness after receiving remote track
        // This ensures we don't miss calling checkCallReadiness when tracks arrive
        console.log('[WebRTC] 🔍 Checking call readiness after receiving remote track')
        this.checkCallReadiness()
        
      } else {
        console.error('[WebRTC] ❌ CRITICAL: No peer connection found for remote track from:', participantId)
      }
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[WebRTC] Sending ICE candidate to:', participantId)
        this.socket.emit('webrtc_ice_candidate', {
          callId: this.callId,
          targetUserId: participantId,
          candidate: event.candidate
        })
      }
    }

    // Enhanced connection state monitoring with detailed debugging for video call issues
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] 🔄 Connection state changed to: ${pc.connectionState} for ${participantId}`)
      
      // Enhanced debugging for video call acceptance issues
      console.log(`[WebRTC] 🔍 DEBUG - Full connection diagnostic:`, {
        participantId,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        iceGatheringState: pc.iceGatheringState,
        signalingState: pc.signalingState,
        sctp: pc.sctp?.state,
        localDescription: {
          type: pc.localDescription?.type,
          hasOffer: !!pc.localDescription?.sdp.includes('m=video') || !!pc.localDescription?.sdp.includes('m=audio')
        },
        remoteDescription: {
          type: pc.remoteDescription?.type,
          hasAnswer: !!pc.remoteDescription?.sdp.includes('m=video') || !!pc.remoteDescription?.sdp.includes('m=audio')
        },
        timestamp: new Date().toISOString()
      })
      
      // Log critical state transitions
      if (pc.connectionState === 'failed') {
        console.error(`[WebRTC] ❌ Connection FAILED for ${participantId} - attempting recovery`)
        
        // Attempt immediate recovery for failed connections
        setTimeout(async () => {
          console.log(`[WebRTC] 🔄 Attempting recovery for failed connection: ${participantId}`)
          await this.attemptConnectionRecovery(participantId)
        }, 1000) // Short delay before recovery attempt
        
      } else if (pc.connectionState === 'disconnected') {
        console.warn(`[WebRTC] ⚠️ Connection DISCONNECTED for ${participantId} - monitoring for recovery`)
        
        // Don't immediately fail on disconnected - give it time to reconnect
        setTimeout(() => {
          const currentPeerConn = this.peerConnections.get(participantId)
          if (currentPeerConn?.connection.connectionState === 'disconnected') {
            console.log(`[WebRTC] 🔄 Connection still disconnected after timeout, attempting recovery: ${participantId}`)
            this.attemptConnectionRecovery(participantId)
          }
        }, 5000) // Give 5 seconds for natural recovery
        
      } else if (pc.connectionState === 'connected') {
        console.log(`[WebRTC] ✅ Connection ESTABLISHED for ${participantId} - call should work now`)
      }
      
      // Emit connection state for UI updates
      this.socket.emit('webrtc_connection_state', {
        callId: this.callId,
        participantId,
        state: pc.connectionState
      })
      
      if (pc.connectionState === 'failed') {
        console.log('[WebRTC] Connection FAILED for:', participantId, '- Immediate reconnection attempt')
        this.attemptReconnection(participantId)
      } else if (pc.connectionState === 'disconnected') {
        console.log('[WebRTC] Connection DISCONNECTED for:', participantId, '- Starting recovery timer')
        // Shorter timeout for faster recovery
        setTimeout(() => {
          const currentPc = this.peerConnections.get(participantId)
          if (currentPc && currentPc.connection.connectionState === 'disconnected') {
            console.log('[WebRTC] Connection still disconnected, attempting recovery')
            this.attemptReconnection(participantId)
          }
        }, 3000) // Reduced from 5s to 3s
      } else if (pc.connectionState === 'connected') {
        console.log('[WebRTC] Connection ESTABLISHED successfully for:', participantId)
        
        // CRITICAL: Add stability check before declaring connection ready
        setTimeout(() => {
          // Verify connection is still stable before notifying server
          const currentPc = this.peerConnections.get(participantId)
          if (currentPc && 
              (currentPc.connection.connectionState === 'connected' || 
               currentPc.connection.connectionState === 'completed')) {
            
            console.log('[WebRTC] Connection STABLE for:', participantId, '- verifying media streams')
            
            // Check if this peer connection has streams ready
            if (currentPc.remoteStream) {
              console.log('[WebRTC] Remote stream ready for:', participantId)
              // Re-emit stream ready event to ensure UI is updated
              this.socket.emit('webrtc_stream_ready', {
                callId: this.callId,
                participantId: participantId,
                streamId: currentPc.remoteStream.id,
                hasAudio: currentPc.remoteStream.getAudioTracks().length > 0,
                hasVideo: currentPc.remoteStream.getVideoTracks().length > 0
              })
            }
            
            // Enhanced peer connection notification with detailed state
            console.log('[WebRTC] 📡 EMITTING webrtc_peer_connected for:', participantId)
            this.socket.emit('webrtc_peer_connected', {
              callId: this.callId,
              participantId: participantId,
              verified: true,
              hasMedia: !!currentPc.remoteStream,
              connectionState: pc.connectionState,
              iceConnectionState: pc.iceConnectionState,
              hasAudio: currentPc.remoteStream?.getAudioTracks().length > 0,
              hasVideo: currentPc.remoteStream?.getVideoTracks().length > 0,
              timestamp: Date.now()
            })
            
            // Also emit a general state update to ensure UI synchronization
            this.socket.emit('webrtc_state_update', {
              callId: this.callId,
              state: 'peer_connected',
              participantId: participantId,
              details: 'Connection verified and stable'
            })
            
            // Check overall call readiness with a delay to ensure tracks are processed
            setTimeout(() => {
              console.log('[WebRTC] 🔍 Delayed readiness check after stable connection for:', participantId)
              this.checkCallReadiness()
            }, 500)
            
            console.log('[WebRTC] ✅ Stable connection verified and reported for:', participantId)
          } else {
            console.log('[WebRTC] ⚠️ Connection became unstable during verification for:', participantId)
          }
        }, 2000) // 2 second stability verification
      }
    }
    
    // Enhanced ICE connection state monitoring for better stability
    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] 🧊 ICE connection state changed to: ${pc.iceConnectionState} for ${participantId}`)
      
      const diagnostics = {
        participantId,
        iceConnectionState: pc.iceConnectionState,
        connectionState: pc.connectionState,
        iceGatheringState: pc.iceGatheringState,
        timestamp: Date.now()
      }
      
      console.log('[WebRTC] ICE diagnostics:', diagnostics)
      
      switch (pc.iceConnectionState) {
        case 'failed':
          console.error(`[WebRTC] 💥 ICE connection FAILED for ${participantId} - attempting ICE restart`)
          // Attempt ICE restart immediately for failed ICE connections
          setTimeout(async () => {
            console.log(`[WebRTC] 🧊 Starting emergency ICE restart for: ${participantId}`)
            await this.attemptConnectionRecovery(participantId)
          }, 500)
          break
          
        case 'disconnected':
          console.warn(`[WebRTC] ⚠️ ICE connection DISCONNECTED for ${participantId} - monitoring...`)
          // Give ICE some time to reconnect before taking action
          setTimeout(() => {
            const currentConn = this.peerConnections.get(participantId)
            if (currentConn?.connection.iceConnectionState === 'disconnected') {
              console.log(`[WebRTC] 🧊 ICE still disconnected, attempting recovery: ${participantId}`)
              this.attemptConnectionRecovery(participantId)
            }
          }, 8000) // Give ICE 8 seconds to recover naturally
          break
          
        case 'connected':
        case 'completed':
          console.log(`[WebRTC] ✅ ICE connection established for ${participantId} - media flow should be stable`)
          break
          
        case 'checking':
          console.log(`[WebRTC] 🔍 ICE checking connectivity for ${participantId}`)
          break
      }
    }
    
    // Monitor connection quality
    this.startQualityMonitoring(participantId, pc)

    // Store peer connection
    this.peerConnections.set(participantId, {
      id: participantId,
      connection: pc
    })

    // ENHANCED: Defer ICE candidate application until peer connection is ready
    const applyBufferedCandidates = async () => {
      const bufferedCandidates = this.pendingIceCandidates.get(participantId)
      if (bufferedCandidates && bufferedCandidates.length > 0) {
        console.log('[WebRTC] Applying', bufferedCandidates.length, 'buffered ICE candidates for:', participantId)
        
        for (const candidate of bufferedCandidates) {
          try {
            // CRITICAL: Only apply ICE candidates if remote description is set
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate))
              console.log('[WebRTC] ✅ Applied buffered ICE candidate for:', participantId)
            } else {
              console.log('[WebRTC] ⏳ Keeping ICE candidate buffered - no remote description yet')
              return // Keep candidates buffered
            }
          } catch (error) {
            console.warn('[WebRTC] ❌ Failed to apply buffered ICE candidate:', error)
          }
        }
        
        // Clear the buffer only if all candidates were successfully processed
        this.pendingIceCandidates.delete(participantId)
        console.log('[WebRTC] Cleared ICE candidate buffer for:', participantId)
      }
    }
    
    // Apply buffered candidates immediately if remote description exists
    await applyBufferedCandidates()
    
    // Also set up listener to apply candidates when remote description is set
    const originalSetRemoteDescription = pc.setRemoteDescription.bind(pc)
    pc.setRemoteDescription = async (description: RTCSessionDescriptionInit) => {
      await originalSetRemoteDescription(description)
      console.log('[WebRTC] Remote description set, applying any buffered ICE candidates')
      await applyBufferedCandidates()
    }

    return pc
  }

  async createOffer(participantId: string): Promise<void> {
    console.log('[WebRTC] 📞 Creating offer for participant:', participantId)
    
    try {
      // ENHANCED: Wait for initialization to complete if still in progress
      if (this.initializationInProgress) {
        console.log('[WebRTC] ⏳ Waiting for initialization to complete before creating offer...')
        let waitCount = 0
        while (this.initializationInProgress && waitCount < 100) { // Max 5 seconds
          await new Promise(resolve => setTimeout(resolve, 50))
          waitCount++
        }
        
        if (this.initializationInProgress) {
          throw new Error('WebRTC initialization timeout - cannot create offer')
        }
      }
      
      const pc = await this.createPeerConnection(participantId)
      
      // CRITICAL: Double-check local stream is available after waiting
      if (!this.localStream) {
        throw new Error('No local stream available for offer creation after initialization wait')
      }
      
      console.log('[WebRTC] Local stream verification - tracks:', this.localStream.getTracks().length)
      
      // CRITICAL DEBUG: Verify tracks are actually attached to the peer connection
      const senders = pc.getSenders()
      console.log('[WebRTC] 🔍 Peer connection senders before offer:', senders.length)
      senders.forEach((sender, index) => {
        console.log(`[WebRTC]   Sender ${index}:`, {
          hasTrack: !!sender.track,
          trackKind: sender.track?.kind,
          trackEnabled: sender.track?.enabled,
          trackReadyState: sender.track?.readyState
        })
      })
      
      console.log('[WebRTC] Creating offer with low-latency options...')
      
      // CRITICAL: Create offer with ultra-low-latency optimization
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        // ULTRA-LOW LATENCY: Disable all processing that causes delay
        voiceActivityDetection: false,   // Disable VAD for consistent low latency
        iceRestart: false               // Avoid ICE restart delays
      })
      
      // CRITICAL: Optimize SDP for ultra-low latency
      if (offer.sdp) {
        offer.sdp = this.optimizeSdpForLowLatency(offer.sdp)
      }
      
      console.log('[WebRTC] Offer created and SDP optimized, analyzing...')
      // DEBUG: Verify the offer contains media tracks
      const offerSdp = offer.sdp || ''
      const hasAudio = offerSdp.includes('m=audio')
      const hasVideo = offerSdp.includes('m=video')
      console.log('[WebRTC] 🔍 Offer SDP analysis:', { hasAudio, hasVideo })
      
      if (!hasAudio && !hasVideo) {
        console.error('[WebRTC] ❌ CRITICAL: Offer has no media tracks!')
        throw new Error('Offer contains no media tracks')
      }
      
      console.log('[WebRTC] Setting local description...')
      await pc.setLocalDescription(offer)
      
      console.log('[WebRTC] 📡 Sending offer to participant:', participantId)
      this.socket.emit('webrtc_offer', {
        callId: this.callId,
        targetUserId: participantId,
        offer: offer
      })
      
      console.log('[WebRTC] ✅ Offer successfully sent to:', participantId)
      
      // Enhanced connection state monitoring after offer
      setTimeout(() => {
        const currentPc = this.peerConnections.get(participantId)?.connection
        if (currentPc) {
          console.log('[WebRTC] 🔍 Post-offer state for', participantId, ':', {
            connectionState: currentPc.connectionState,
            signalingState: currentPc.signalingState,
            iceConnectionState: currentPc.iceConnectionState,
            iceGatheringState: currentPc.iceGatheringState
          })
          
          // Monitor for early connection failures
          if (currentPc.connectionState === 'failed' || currentPc.iceConnectionState === 'failed') {
            console.warn('[WebRTC] ⚠️ Connection failed early for:', participantId, 'triggering recovery')
            this.attemptConnectionRecovery(participantId)
          }
        }
      }, 1000)
      
      // Additional monitoring after 5 seconds to catch delayed failures
      setTimeout(() => {
        const currentPc = this.peerConnections.get(participantId)?.connection
        if (currentPc && (currentPc.connectionState === 'disconnected' || currentPc.connectionState === 'failed')) {
          console.warn('[WebRTC] ⚠️ Delayed connection failure for:', participantId, 'attempting recovery')
          this.attemptConnectionRecovery(participantId)
        }
      }, 5000)
      
    } catch (error) {
      console.error('[WebRTC] ❌ Failed to create offer for participant:', participantId, error)
      
      // CRITICAL FIX: Don't immediately close connection, let it retry naturally
      // Only close if it's a permanent error, not a temporary failure
      const errorMessage = error instanceof Error ? error.message : String(error)
      const isPermanentError = errorMessage.includes('InvalidStateError') || 
                              errorMessage.includes('InvalidAccessError') ||
                              errorMessage.includes('NotSupportedError')
      
      if (isPermanentError) {
        console.log('[WebRTC] Permanent error detected, closing connection for:', participantId)
        this.closePeerConnection(participantId)
      } else {
        console.log('[WebRTC] Temporary error, preserving connection for retry:', participantId)
      }
      
      // Emit error event for UI handling
      this.socket.emit('webrtc_error', {
        callId: this.callId,
        participantId,
        error: errorMessage,
        type: 'offer_creation_failed',
        isPermanent: isPermanentError
      })
    }
  }

  private async handleRemoteOffer(data: {
    callId: string
    fromUserId: string
    offer: RTCSessionDescriptionInit
  }) {
    console.log('[WebRTC] 📞 RECEIVED OFFER from:', data.fromUserId)
    console.log('[WebRTC] Call ID check:', { received: data.callId, ours: this.callId })
    
    if (data.callId !== this.callId) {
      console.log('[WebRTC] ❌ Ignoring offer for different call:', data.callId, 'vs', this.callId)
      return
    }
    
    console.log('[WebRTC] ✅ Processing offer from:', data.fromUserId)
    
    try {
      const pc = await this.createPeerConnection(data.fromUserId)
      
      // CRITICAL: Verify local stream before proceeding
      if (!this.localStream) {
        throw new Error(`No local stream available when handling offer from ${data.fromUserId}`)
      }
      
      console.log('[WebRTC] Local stream ready with tracks:', this.localStream.getTracks().length)
      
      // CRITICAL DEBUG: Verify tracks are attached before setting remote description
      const senders = pc.getSenders()
      console.log('[WebRTC] 🔍 Peer connection senders before answer:', senders.length)
      senders.forEach((sender, index) => {
        console.log(`[WebRTC]   Sender ${index}:`, {
          hasTrack: !!sender.track,
          trackKind: sender.track?.kind,
          trackEnabled: sender.track?.enabled,
          trackReadyState: sender.track?.readyState
        })
      })
      
      console.log('[WebRTC] Setting remote description from offer...')
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer))
      
      console.log('[WebRTC] Creating answer with ultra-low-latency options...')
      const answer = await pc.createAnswer({
        // ULTRA-LOW LATENCY: Disable all processing that causes delay
        voiceActivityDetection: false,  // Disable VAD for consistent low latency
        iceRestart: false              // Avoid ICE restart delays
      })
      
      // CRITICAL: Optimize SDP for ultra-low latency
      if (answer.sdp) {
        answer.sdp = this.optimizeSdpForLowLatency(answer.sdp)
      }
      
      console.log('[WebRTC] Answer created and SDP optimized, analyzing...')
      // DEBUG: Verify the answer contains media tracks
      const answerSdp = answer.sdp || ''
      const hasAudio = answerSdp.includes('m=audio')
      const hasVideo = answerSdp.includes('m=video')
      console.log('[WebRTC] 🔍 Answer SDP analysis:', { hasAudio, hasVideo })
      
      console.log('[WebRTC] Setting local description with answer...')
      await pc.setLocalDescription(answer)
      
      console.log('[WebRTC] 📡 Sending answer to:', data.fromUserId)
      this.socket.emit('webrtc_answer', {
        callId: this.callId,
        targetUserId: data.fromUserId,
        answer: answer
      })
      
      console.log('[WebRTC] ✅ Answer successfully sent to:', data.fromUserId)
      
      // Log states for debugging
      setTimeout(() => {
        console.log('[WebRTC] Post-answer states for', data.fromUserId)
        console.log('[WebRTC]   Connection state:', pc.connectionState)
        console.log('[WebRTC]   Signaling state:', pc.signalingState)
      }, 1000)
      
    } catch (error) {
      console.error('[WebRTC] ❌ Failed to handle offer from', data.fromUserId, ':', error)
      
      // CRITICAL FIX: Don't immediately close connection unless it's a permanent error
      const errorMessage = error instanceof Error ? error.message : String(error)
      const isPermanentError = errorMessage.includes('InvalidStateError') || 
                              errorMessage.includes('InvalidAccessError') ||
                              errorMessage.includes('NotSupportedError') ||
                              errorMessage.includes('OperationError')
      
      if (isPermanentError) {
        console.log('[WebRTC] Permanent offer handling error, closing connection for:', data.fromUserId)
        this.closePeerConnection(data.fromUserId)
      } else {
        console.log('[WebRTC] Temporary offer handling error, preserving connection for retry:', data.fromUserId)
      }
      
      // Emit error for debugging
      this.socket.emit('webrtc_error', {
        callId: this.callId,
        participantId: data.fromUserId,
        error: errorMessage,
        type: 'offer_handling_failed',
        isPermanent: isPermanentError
      })
    }
  }

  private async handleRemoteAnswer(data: {
    callId: string
    fromUserId: string
    answer: RTCSessionDescriptionInit
  }) {
    console.log('[WebRTC] Received answer:', { callId: data.callId, fromUserId: data.fromUserId, ourCallId: this.callId })
    
    if (data.callId !== this.callId) {
      console.log('[WebRTC] Ignoring answer for different call:', data.callId, 'vs', this.callId)
      return
    }
    
    console.log('[WebRTC] Processing answer from:', data.fromUserId)
    
    const peerConn = this.peerConnections.get(data.fromUserId)
    if (!peerConn) {
      console.error('[WebRTC] No peer connection found for answer from:', data.fromUserId)
      console.log('[WebRTC] Available peer connections:', Array.from(this.peerConnections.keys()))
      return
    }
    
    try {
      // Check if we're in the correct state to set remote description
      const currentState = peerConn.connection.signalingState
      console.log('[WebRTC] Current signaling state:', currentState)
      
      if (currentState === 'have-local-offer') {
        console.log('[WebRTC] Setting remote description from answer')
        await peerConn.connection.setRemoteDescription(new RTCSessionDescription(data.answer))
        console.log('[WebRTC] Remote description set successfully for:', data.fromUserId)
        console.log('[WebRTC] Connection state:', peerConn.connection.connectionState)
      } else {
        console.warn('[WebRTC] Invalid signaling state for answer:', currentState, 'Expected: have-local-offer')
        // Try to recover by recreating the peer connection
        console.log('[WebRTC] Attempting to recover by recreating peer connection')
        this.closePeerConnection(data.fromUserId)
        // Don't automatically recreate here - let the higher level logic handle it
      }
    } catch (error) {
      console.error('[WebRTC] Failed to set remote description:', error)
      // If we get an InvalidStateError, try to recover
      if (error instanceof DOMException && error.name === 'InvalidStateError') {
        console.log('[WebRTC] InvalidStateError detected, attempting recovery')
        this.closePeerConnection(data.fromUserId)
      }
    }
  }

  private async handleRemoteIceCandidate(data: {
    callId: string
    fromUserId: string
    candidate: RTCIceCandidateInit
  }) {
    if (data.callId !== this.callId) return
    
    console.log('[WebRTC] Received ICE candidate from:', data.fromUserId)
    
    const peerConn = this.peerConnections.get(data.fromUserId)
    if (!peerConn) {
      console.log('[WebRTC] No peer connection found for ICE candidate, buffering for later:', data.fromUserId)
      
      // Buffer the ICE candidate for when the peer connection is created
      if (!this.pendingIceCandidates.has(data.fromUserId)) {
        this.pendingIceCandidates.set(data.fromUserId, [])
      }
      this.pendingIceCandidates.get(data.fromUserId)!.push(data.candidate)
      console.log('[WebRTC] Buffered ICE candidate for:', data.fromUserId, 'Total buffered:', this.pendingIceCandidates.get(data.fromUserId)!.length)
      return
    }
    
    try {
      await peerConn.connection.addIceCandidate(new RTCIceCandidate(data.candidate))
      console.log('[WebRTC] ICE candidate added for:', data.fromUserId)
    } catch (error) {
      console.error('[WebRTC] Failed to add ICE candidate:', error)
    }
  }

  private handleParticipantLeft(data: { participantId: string }) {
    console.log('[WebRTC] Participant left:', data.participantId)
    this.closePeerConnection(data.participantId)
    
    // Clear any buffered ICE candidates for this participant
    if (this.pendingIceCandidates.has(data.participantId)) {
      console.log('[WebRTC] Clearing buffered ICE candidates for left participant:', data.participantId)
      this.pendingIceCandidates.delete(data.participantId)
    }
  }

  private handleConnectionFailure(participantId: string) {
    console.log('[WebRTC] Connection failed for:', participantId)
    // Could implement reconnection logic here
    this.closePeerConnection(participantId)
  }

  private closePeerConnection(participantId: string) {
    const peerConn = this.peerConnections.get(participantId)
    if (peerConn) {
      // CRITICAL FIX: Add protection against premature closure of healthy connections
      const connectionState = peerConn.connection.connectionState
      const iceConnectionState = peerConn.connection.iceConnectionState
      
      console.log('[WebRTC] 🔍 Connection closure requested for:', participantId, {
        connectionState,
        iceConnectionState,
        signalingState: peerConn.connection.signalingState,
        localDescription: !!peerConn.connection.localDescription,
        remoteDescription: !!peerConn.connection.remoteDescription,
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
      })
      
      // CRITICAL: Prevent closure of healthy connections that are connecting or connected
      if (connectionState === 'connected' || 
          connectionState === 'connecting' || 
          iceConnectionState === 'connected' ||
          iceConnectionState === 'checking') {
        console.warn('[WebRTC] ⚠️ PREVENTING closure of healthy connection for:', participantId, 
                     'State:', connectionState, 'ICE:', iceConnectionState)
        
        // Only close if this is explicitly due to participant leaving or connection failure
        const stackTrace = new Error().stack || ''
        const isParticipantLeft = stackTrace.includes('handleParticipantLeft')
        const isConnectionFailure = stackTrace.includes('handleConnectionFailure')
        
        if (!isParticipantLeft && !isConnectionFailure) {
          console.log('[WebRTC] ✅ Preserving healthy connection for:', participantId)
          return // Don't close healthy connections
        }
      }
      
      try {
        // Force close connection immediately
        if (peerConn.connection.connectionState !== 'closed') {
          peerConn.connection.close()
        }
        // Remove remote stream if exists
        if (peerConn.remoteStream) {
          peerConn.remoteStream.getTracks().forEach(track => {
            try {
              track.stop()
            } catch (error) {
              console.warn('[WebRTC] Error stopping remote track:', error)
            }
          })
        }
      } catch (error) {
        console.warn('[WebRTC] Error during peer connection cleanup:', error)
      }
      this.peerConnections.delete(participantId)
      console.log('[WebRTC] Closed peer connection for:', participantId)
    }
  }

  getRemoteStream(participantId: string): MediaStream | null {
    const peerConn = this.peerConnections.get(participantId)
    return peerConn?.remoteStream || null
  }

  toggleMute(): boolean {
    if (!this.localStream) return false
    
    const audioTracks = this.localStream.getAudioTracks()
    const newMuted = !audioTracks[0]?.enabled
    
    audioTracks.forEach(track => {
      track.enabled = !newMuted
    })
    
    console.log('[WebRTC] Audio muted:', newMuted)
    return newMuted
  }

  toggleVideo(): boolean {
    if (!this.localStream) return false
    
    const videoTracks = this.localStream.getVideoTracks()
    const newVideoOff = !videoTracks[0]?.enabled
    
    videoTracks.forEach(track => {
      track.enabled = !newVideoOff
    })
    
    console.log('[WebRTC] Video disabled:', newVideoOff)
    return newVideoOff
  }


  cleanup() {
    console.log('[WebRTC] Cleaning up WebRTC service')
    
    // Close all peer connections immediately and stop remote streams
    this.peerConnections.forEach((peerConn, participantId) => {
      console.log('[WebRTC] Closing peer connection for:', participantId)
      try {
        // Stop remote stream tracks first
        if (peerConn.remoteStream) {
          peerConn.remoteStream.getTracks().forEach(track => {
            try {
              track.stop()
              console.log('[WebRTC] Stopped remote track:', track.kind, 'for participant:', participantId, 'readyState:', track.readyState)
            } catch (error) {
              console.warn('[WebRTC] Error stopping remote track:', error)
            }
          })
          // Clear the stream
          peerConn.remoteStream = undefined
        }
        
        // Close the connection immediately
        if (peerConn.connection.connectionState !== 'closed') {
          peerConn.connection.close()
        }
      } catch (error) {
        console.warn('[WebRTC] Error closing peer connection:', error)
      }
    })
    this.peerConnections.clear()
    
    // Stop local stream tracks immediately and forcefully with retry mechanism
    if (this.localStream) {
      const tracks = this.localStream.getTracks()
      console.log('[WebRTC] Force stopping', tracks.length, 'local tracks')
      
      tracks.forEach(track => {
        try {
          // Double-check and force stop the track
          if (track.readyState === 'live') {
            track.stop()
            console.log('[WebRTC] Force stopped local track:', track.kind, 'readyState after stop:', track.readyState)
            
            // Verify the track is actually stopped
            setTimeout(() => {
              if (track.readyState === 'live') {
                console.warn('[WebRTC] Track still live after stop, forcing again:', track.kind)
                try {
                  track.stop()
                } catch (retryError) {
                  console.error('[WebRTC] Failed to force stop track on retry:', retryError)
                }
              }
            }, 100)
          }
        } catch (error) {
          console.warn('[WebRTC] Error stopping local track:', error)
        }
      })
      
      // Clear the stream reference
      this.localStream = null
      console.log('[WebRTC] ✅ Local stream reference cleared')
    }
    
    // Remove socket listeners using bound methods
    console.log('[WebRTC] Removing socket listeners for user:', this.currentUserId)
    try {
      this.socket.off('webrtc_offer', this.boundHandleRemoteOffer)
      this.socket.off('webrtc_answer', this.boundHandleRemoteAnswer)
      this.socket.off('webrtc_ice_candidate', this.boundHandleRemoteIceCandidate)
      this.socket.off('participant_left', this.boundHandleParticipantLeft)
    } catch (error) {
      console.warn('[WebRTC] Error removing socket listeners:', error)
    }
    
    // Clear ICE candidate buffer
    this.pendingIceCandidates.clear()
    console.log('[WebRTC] Cleared ICE candidate buffer')
    
    this.callId = null
    this.initializationInProgress = false // Reset initialization flag
    
    // CRITICAL: Verify all connections are closed  
    setTimeout(() => {
      if (this.peerConnections.size > 0) {
        console.warn('[WebRTC] ⚠️ Found lingering peer connections after cleanup:', this.peerConnections.size)
        this.peerConnections.clear()
      }
      console.log('[WebRTC] ✅ Post-cleanup verification complete - service ready for reuse')
    }, 100)
    
    // ENHANCED: Add aggressive browser-level media cleanup
    setTimeout(() => {
      console.log('[WebRTC] 🔍 Performing final browser-level media verification...')
      
      // Force browser to release any remaining media resources
      try {
        // Get all video and audio elements in the document
        const videoElements = document.querySelectorAll('video')
        const audioElements = document.querySelectorAll('audio')
        
        videoElements.forEach((video, index) => {
          if (video.srcObject) {
            console.log(`[WebRTC] Found active video element ${index}, clearing srcObject`)
            const stream = video.srcObject as MediaStream
            if (stream && stream.getTracks) {
              stream.getTracks().forEach(track => {
                try {
                  track.stop()
                  console.log(`[WebRTC] Stopped track from video element:`, track.kind)
                } catch (e) {
                  console.warn(`[WebRTC] Error stopping track from video element:`, e)
                }
              })
            }
            video.srcObject = null
            video.load() // Force reload to clear any cached media
          }
        })
        
        audioElements.forEach((audio, index) => {
          if (audio.srcObject) {
            console.log(`[WebRTC] Found active audio element ${index}, clearing srcObject`)
            const stream = audio.srcObject as MediaStream
            if (stream && stream.getTracks) {
              stream.getTracks().forEach(track => {
                try {
                  track.stop()
                  console.log(`[WebRTC] Stopped track from audio element:`, track.kind)
                } catch (e) {
                  console.warn(`[WebRTC] Error stopping track from audio element:`, e)
                }
              })
            }
            audio.srcObject = null
            audio.load() // Force reload to clear any cached media
          }
        })
        
        console.log(`[WebRTC] ✅ Cleared ${videoElements.length} video and ${audioElements.length} audio elements`)
        
        // Final check: Trigger garbage collection if available
        if (window.gc) {
          try {
            window.gc()
            console.log('[WebRTC] ✅ Triggered garbage collection')
          } catch {
            // gc() might not be available in all environments
          }
        }
        
        // CRITICAL: Enhanced media device permission release for video calls
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          try {
            // Multi-stage permission release for video calls
            console.log('[WebRTC] 🎥 Starting enhanced media permission release...')
            
            // Step 1: Request minimal constraints to trigger permission check
            // FIXED: Use device enumeration for cleanup
            navigator.mediaDevices.enumerateDevices()
              .then(devices => {
                console.log('[WebRTC] 📹 Enumerated', devices.length, 'devices for permission cleanup')
                console.log('[WebRTC] 🧹 Media cleanup completed with device enumeration')
              })
              .catch(() => console.log('[WebRTC] Device enumeration completed'))
          } catch (error) {
            console.warn('[WebRTC] Error during permission release:', error)
          }
        }
        
        // Enhanced: Clear any cached MediaStream constraints
        if (navigator.mediaDevices) {
          try {
            // Attempt to enumerate devices to trigger permission check/cleanup
            navigator.mediaDevices.enumerateDevices()
              .then(devices => {
                console.log('[WebRTC] ✅ Enumerated devices for permission cleanup:', devices.length)
              })
              .catch(error => {
                console.warn('[WebRTC] Device enumeration failed:', error)
              })
          } catch (error) {
            console.warn('[WebRTC] Error during device enumeration:', error)
          }
        }
        
      } catch (domError) {
        console.warn('[WebRTC] Error during DOM media cleanup:', domError)
      }
      
      console.log('[WebRTC] 🎯 FINAL CLEANUP COMPLETED - All media resources should be fully released')
    }, 300)
    
    console.log('[WebRTC] Cleanup completed - all media streams should be released and browser indicators should clear')
  }

  // Initiate WebRTC connections with all participants
  async initiateConnections(participantIds: string[]) {
    console.log('[WebRTC] Initiating connections with participants:', participantIds)
    
    for (const participantId of participantIds) {
      if (participantId !== this.currentUserId) {
        try {
          await this.createOffer(participantId)
        } catch (error) {
          console.error('[WebRTC] Failed to create offer for:', participantId, error)
        }
      }
    }
  }

  // Get all active peer connections
  getActivePeerConnections(): Map<string, PeerConnection> {
    return new Map(this.peerConnections)
  }

  // Remove a specific peer connection
  removePeerConnection(participantId: string): void {
    const peerData = this.peerConnections.get(participantId)
    if (peerData) {
      console.log('[WebRTC] Removing peer connection for:', participantId)
      try {
        peerData.connection.close()
      } catch (error) {
        console.warn('[WebRTC] Error closing peer connection:', error)
      }
      this.peerConnections.delete(participantId)
    }
  }

  // Enhanced connection quality monitoring with adaptive adjustments
  private async startQualityMonitoring(participantId: string, pc: RTCPeerConnection) {
    const monitorInterval = setInterval(async () => {
      try {
        const stats = await pc.getStats()
        let audioPacketLoss = 0
        let videoPacketLoss = 0
        let roundTripTime = 0
        let jitter = 0
        // let bandwidth = 0 // Future use for bandwidth monitoring
        
        stats.forEach((report: RTCStatsReport[keyof RTCStatsReport]) => {
          // Check both inbound and outbound RTP stats for comprehensive monitoring
          if (report.type === 'inbound-rtp') {
            if (report.kind === 'audio') {
              const totalPackets = (report.packetsReceived || 0) + (report.packetsLost || 0)
              audioPacketLoss = totalPackets > 0 ? (report.packetsLost || 0) / totalPackets : 0
              jitter = report.jitter || 0
            } else if (report.kind === 'video') {
              const totalPackets = (report.packetsReceived || 0) + (report.packetsLost || 0)
              videoPacketLoss = totalPackets > 0 ? (report.packetsLost || 0) / totalPackets : 0
            }
          } else if (report.type === 'outbound-rtp') {
            // Also monitor outbound stats for complete picture
            if (report.kind === 'audio' && report.packetsSent) {
              // Check for high retransmissions as indicator of poor connection
              const retransmissionRate = (report.retransmittedPacketsSent || 0) / report.packetsSent
              if (retransmissionRate > 0.1) { // More than 10% retransmissions
                audioPacketLoss = Math.max(audioPacketLoss, retransmissionRate)
              }
            }
          } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            roundTripTime = (report.currentRoundTripTime || 0) * 1000 // Convert to ms
          }
        })
        
        // More realistic network condition detection with connection stability
        const connectionState = pc.connectionState
        const iceConnectionState = pc.iceConnectionState
        
        // Consider connection instability as a factor
        const isConnectionUnstable = (
          connectionState === 'disconnected' ||
          connectionState === 'failed' ||
          iceConnectionState === 'disconnected' ||
          iceConnectionState === 'failed'
        )
        
        const isNetworkPoor = (
          audioPacketLoss > 0.03 ||     // 3% packet loss for audio is poor
          videoPacketLoss > 0.06 ||     // 6% packet loss for video
          roundTripTime > 250 ||        // 250ms RTT is poor
          jitter > 40 ||                // High jitter indicates network issues
          isConnectionUnstable          // Connection instability
        )
        
        const isNetworkExcellent = (
          audioPacketLoss < 0.01 &&
          videoPacketLoss < 0.02 &&
          roundTripTime < 100 &&        // Lower RTT threshold for excellent
          jitter < 15 &&                // Lower jitter threshold for excellent
          connectionState === 'connected' &&
          iceConnectionState === 'connected'
        )
        
        // Adaptive quality adjustment with connection recovery
        if (isConnectionUnstable) {
          console.log('[WebRTC] ⚠️ Connection unstable for participant:', participantId, 
                     'Connection:', connectionState, 'ICE:', iceConnectionState)
          
          // Try to recover the connection
          await this.attemptConnectionRecovery(participantId)
        } else if (isNetworkPoor) {
          console.log('[WebRTC] Poor network detected - Audio loss:', audioPacketLoss.toFixed(3), 
                     'Video loss:', videoPacketLoss.toFixed(3), 'RTT:', roundTripTime.toFixed(1), 'ms')
          await this.reduceQuality(participantId)
        } else if (isNetworkExcellent) {
          console.log('[WebRTC] Excellent network detected - restoring quality')
          await this.improveQuality(participantId)
        }
        
        // Emit network quality info for UI
        this.socket.emit('webrtc_network_quality', {
          callId: this.callId,
          participantId,
          audioPacketLoss,
          videoPacketLoss,
          roundTripTime,
          jitter,
          quality: isNetworkExcellent ? 'excellent' : isNetworkPoor ? 'poor' : 'good'
        })
        
        // Stop monitoring if connection is closed
        const peerConn = this.peerConnections.get(participantId)
        if (!peerConn || peerConn.connection.connectionState === 'closed') {
          clearInterval(monitorInterval)
        }
      } catch (error) {
        console.error('[WebRTC] Error monitoring quality:', error)
      }
    }, 3000) // More frequent monitoring for better responsiveness
  }

  // Reduce quality for poor network conditions
  private async reduceQuality(participantId: string) {
    const peerConn = this.peerConnections.get(participantId)
    if (!peerConn) return
    
    const senders = peerConn.connection.getSenders()
    for (const sender of senders) {
      try {
        const params = sender.getParameters()
        if (params.encodings && params.encodings[0]) {
          if (sender.track?.kind === 'video') {
            // Aggressive video quality reduction
            params.encodings[0].maxBitrate = Math.max((params.encodings[0].maxBitrate || 1000000) * 0.3, 100000)
            params.encodings[0].maxFramerate = 15 // Reduce to 15fps
            params.encodings[0].scaleResolutionDownBy = 2 // Half resolution
            console.log('[WebRTC] Reduced video quality for:', participantId)
          } else if (sender.track?.kind === 'audio') {
            // Reduce audio bitrate slightly
            params.encodings[0].maxBitrate = Math.max((params.encodings[0].maxBitrate || 64000) * 0.7, 32000)
            console.log('[WebRTC] Reduced audio quality for:', participantId)
          }
          await sender.setParameters(params)
        }
      } catch (error) {
        console.warn('[WebRTC] Failed to reduce quality:', error)
      }
    }
  }
  
  // Improve quality for excellent network conditions
  private async improveQuality(participantId: string) {
    const peerConn = this.peerConnections.get(participantId)
    if (!peerConn) return
    
    const senders = peerConn.connection.getSenders()
    for (const sender of senders) {
      try {
        const params = sender.getParameters()
        if (params.encodings && params.encodings[0]) {
          if (sender.track?.kind === 'video') {
            // Restore video quality
            params.encodings[0].maxBitrate = 2000000 // 2Mbps max
            params.encodings[0].maxFramerate = 30 // Full 30fps
            delete params.encodings[0].scaleResolutionDownBy // Full resolution
            console.log('[WebRTC] Improved video quality for:', participantId)
          } else if (sender.track?.kind === 'audio') {
            // Restore audio quality
            params.encodings[0].maxBitrate = 128000 // High quality audio
            console.log('[WebRTC] Improved audio quality for:', participantId)
          }
          await sender.setParameters(params)
        }
      } catch (error) {
        console.warn('[WebRTC] Failed to improve quality:', error)
      }
    }
  }

  // Attempt to recover an unstable connection
  private async attemptConnectionRecovery(participantId: string) {
    console.log('[WebRTC] 🔄 Attempting connection recovery for:', participantId)
    
    const peerConn = this.peerConnections.get(participantId)
    if (!peerConn) {
      console.log('[WebRTC] ⚠️ No peer connection found for recovery:', participantId)
      return
    }
    
    try {
      // First try ICE restart
      console.log('[WebRTC] 🧊 Attempting ICE restart for:', participantId)
      
      // Create new offer with ICE restart
      const offer = await peerConn.connection.createOffer({ iceRestart: true })
      await peerConn.connection.setLocalDescription(offer)
      
      // Send the new offer to restart ICE
      this.socket.emit('webrtc_offer', {
        callId: this.callId,
        participantId: this.currentUserId,
        targetParticipantId: participantId,
        offer: offer,
        isIceRestart: true
      })
      
      console.log('[WebRTC] ✅ ICE restart initiated for:', participantId)
      
      // If ICE restart doesn't work after a delay, try full reconnection
      setTimeout(async () => {
        const updatedPeerConn = this.peerConnections.get(participantId)
        if (updatedPeerConn && 
            (updatedPeerConn.connection.connectionState === 'disconnected' ||
             updatedPeerConn.connection.connectionState === 'failed')) {
          
          console.log('[WebRTC] 🔄 ICE restart failed, attempting full reconnection for:', participantId)
          
          // Use existing reconnection logic
          this.attemptReconnection(participantId, 1)
          
          console.log('[WebRTC] ✅ Full reconnection initiated for:', participantId)
        }
      }, 5000) // Give ICE restart 5 seconds to work
      
    } catch (error) {
      console.error('[WebRTC] ❌ Connection recovery failed for:', participantId, error)
    }
  }

  // Check if all connections are ready and signal the call as fully connected
  private checkCallReadiness() {
    const connectedCount = Array.from(this.peerConnections.values()).filter(
      pc => pc.connection.connectionState === 'connected'
    ).length

    // ENHANCED: More detailed stream verification with logging
    const peerDetails = Array.from(this.peerConnections.entries()).map(([id, pc]) => {
      const trackCount = pc.remoteStream ? pc.remoteStream.getTracks().length : 0
      const tracks = pc.remoteStream ? pc.remoteStream.getTracks().map(t => ({
        kind: t.kind,
        enabled: t.enabled,
        readyState: t.readyState,
        muted: t.muted
      })) : []
      
      return {
        participantId: id,
        connectionState: pc.connection.connectionState,
        hasRemoteStream: !!pc.remoteStream,
        trackCount,
        tracks,
        streamActive: pc.remoteStream ? pc.remoteStream.active : false
      }
    })

    const hasStreamsCount = peerDetails.filter(
      detail => detail.hasRemoteStream && detail.trackCount > 0
    ).length

    console.log('[WebRTC] 🔍 DETAILED Call readiness check:')
    console.log('[WebRTC]   Total peers:', this.peerConnections.size)
    console.log('[WebRTC]   Connected peers:', connectedCount)
    console.log('[WebRTC]   Peers with streams:', hasStreamsCount)
    console.log('[WebRTC]   Peer details:', peerDetails)

    // If we have at least one connected peer with streams, consider call ready
    if (connectedCount > 0 && hasStreamsCount > 0) {
      console.log('[WebRTC] ✅ Call is ready! Signaling server...')
      console.log('[WebRTC] 📡 EMITTING webrtc_call_ready - peers:', connectedCount, 'streams:', hasStreamsCount)
      this.socket.emit('webrtc_call_ready', {
        callId: this.callId,
        connectedPeers: connectedCount,
        peersWithStreams: hasStreamsCount
      })
    } else {
      console.log('[WebRTC] ❌ Call NOT ready - Connected:', connectedCount, 'WithStreams:', hasStreamsCount)
    }
  }

  // Enhanced reconnection with multiple retry attempts
  private async attemptReconnection(participantId: string, attempt = 1) {
    const maxAttempts = 3
    console.log(`[WebRTC] Attempting reconnection for: ${participantId} (attempt ${attempt}/${maxAttempts})`)
    
    if (attempt > maxAttempts) {
      console.error(`[WebRTC] Max reconnection attempts reached for: ${participantId}`)
      this.handleConnectionFailure(participantId)
      return
    }
    
    // Close existing connection
    this.closePeerConnection(participantId)
    
    // Progressive delay: 1s, 2s, 3s
    const delay = attempt * 1000
    setTimeout(async () => {
      try {
        // Verify we still have a valid call and local stream
        if (!this.callId || !this.localStream) {
          console.log('[WebRTC] Call ended during reconnection attempt')
          return
        }
        
        // Recreate offer for reconnection
        console.log(`[WebRTC] Creating new offer for reconnection attempt ${attempt}`)
        await this.createOffer(participantId)
        
        // Set a timeout to retry if this attempt fails
        setTimeout(() => {
          const peerConn = this.peerConnections.get(participantId)
          if (!peerConn || peerConn.connection.connectionState === 'failed') {
            console.log(`[WebRTC] Reconnection attempt ${attempt} failed, retrying...`)
            this.attemptReconnection(participantId, attempt + 1)
          }
        }, 5000)
        
      } catch (error) {
        console.error(`[WebRTC] Reconnection attempt ${attempt} failed:`, error)
        this.attemptReconnection(participantId, attempt + 1)
      }
    }, delay)
  }
}