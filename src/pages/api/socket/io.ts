import { NextApiRequest } from 'next'
import { NextApiResponseServerIO, initializeSocketIO } from '@/lib/socket'

export default function handler(req: NextApiRequest, res: NextApiResponseServerIO) {
  console.log(`Socket.IO endpoint called: ${req.method} from ${req.headers['user-agent']?.substring(0, 50)}`)
  
  // Add cache-busting headers
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  
  if (req.method === 'POST' || req.method === 'GET') {
    try {
      // Check if Socket.IO is already initialized
      if (res.socket.server.io) {
        console.log('Socket.IO server already initialized')
        return res.status(200).json({ 
          message: 'Socket.IO server already initialized', 
          timestamp: Date.now(),
          initialized: true 
        })
      }
      
      initializeSocketIO(req, res)
      console.log('Socket.IO server initialized successfully')
      res.status(200).json({ 
        message: 'Socket.IO server initialized', 
        timestamp: Date.now(),
        initialized: true 
      })
    } catch (error) {
      console.error('Socket.IO initialization error:', error)
      // Return 500 for all initialization errors, 400 was causing client confusion
      res.status(500).json({ 
        error: 'Failed to initialize Socket.IO server', 
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
        initialized: false
      })
    }
  } else {
    console.log(`Method not allowed: ${req.method}`)
    res.status(405).json({ error: 'Method not allowed', timestamp: Date.now() })
  }
}

export { config } from '@/lib/socket'