import { NextApiRequest, NextApiResponse } from 'next'
import { getIO, getSocketInstance } from '@/lib/socket'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  let io = getIO()
  console.log('getIO() result:', !!io)
  
  if (!io) {
    console.log('Attempting to get socket instance...')
    io = getSocketInstance(req, res)
    console.log('getSocketInstance() result:', !!io)
  }
  
  const status = {
    socketAvailable: !!io,
    connectedSockets: io ? io.sockets.sockets.size : 0,
    rooms: io ? Array.from(io.sockets.adapter.rooms.keys()).slice(0, 20) : [],
    timestamp: new Date().toISOString()
  }
  
  console.log('Socket status check:', status)
  
  return res.status(200).json(status)
}