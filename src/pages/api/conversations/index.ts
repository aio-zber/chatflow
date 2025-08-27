import { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CRITICAL: Minimal test to see if POST requests reach this handler AT ALL
  console.log(`🧪 SIMPLE TEST: ${req.method} ${req.url} AT ${new Date().toISOString()}`)
  
  if (req.method === 'POST') {
    console.log(`🧪 POST REQUEST REACHED CONVERSATIONS HANDLER!`)
    return res.status(200).json({ 
      success: true,
      message: 'POST request to conversations endpoint successful',
      timestamp: new Date().toISOString(),
      method: req.method
    })
  }

  if (req.method === 'GET') {
    console.log(`🧪 GET REQUEST REACHED CONVERSATIONS HANDLER!`)
    return res.status(200).json({ 
      success: true,
      message: 'GET request to conversations endpoint successful',
      timestamp: new Date().toISOString(),
      method: req.method
    })
  }

  res.status(405).json({ error: 'Method not allowed' })
}