### 1. **VoIP (Voice over Internet Protocol)**

- Viber uses **VoIP** to transmit voice and video data over the internet instead of traditional phone lines.
- When you make a call, your voice and video are converted into digital data packets, transmitted over the internet, and then reassembled at the recipient's device.

### 2. **Real-Time Communication Protocols**

- **RTP (Real-time Transport Protocol):** Carries the actual audio and video data during the call.
- **SIP (Session Initiation Protocol) or Proprietary Signaling:** Viber uses a proprietary signaling protocol (not standard SIP) to initiate, manage, and terminate calls. This handles call setup, ringing, and connection.

### 3. **Peer-to-Peer (P2P) and Server-Relayed Communication**

- **Early versions of Viber** used a **P2P architecture**, where calls were directly routed between users when possible, reducing server load and improving call quality.
- **Now, Viber uses a hybrid model:** Calls may go directly between users (P2P) if firewalls and networks allow, but more often they are **relayed through Viber’s secure servers**, especially when NAT traversal or firewalls block direct connections.

### 4. **Network Optimization**

- Viber dynamically adjusts call quality based on network conditions (bandwidth, latency, packet loss).
- It uses adaptive bitrate streaming and error correction techniques to maintain call clarity even on unstable connections.

### 5. **Global Infrastructure**

- Viber operates a **distributed network of data centers** around the world to minimize latency and ensure reliable connections.
- Calls are routed through the nearest or most efficient server to reduce lag.

### 6. **Device Integration**

- Viber leverages device hardware (microphones, cameras, speakers) and operating system APIs to capture and render audio/video.
- It supports background calling, push notifications, and integration with contact lists.

### 7. **Support for Multiple Platforms**

- The call feature works consistently across iOS, Android, desktop (Windows, macOS), and web, thanks to cross-platform development and synchronization via user accounts.

### Summary

Viber enables calling by:

- Using **VoIP** to send voice/video over the internet.
- Routing calls via **P2P or server relays** based on network conditions.
- Optimizing performance with **adaptive streaming and global servers**.

This allows Viber to offer high-quality, secure, and reliable voice and video calls across devices and networks.