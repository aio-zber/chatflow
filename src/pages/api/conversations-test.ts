import { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log(`🧪 NEW ENDPOINT TEST: ${req.method} ${req.url} AT ${new Date().toISOString()}`)
  
  if (req.method === 'POST') {
    console.log(`🧪 POST REQUEST REACHED NEW CONVERSATIONS TEST ENDPOINT!`)
    return res.status(200).json({ 
      success: true,
      message: 'POST request to new conversations test endpoint successful',
      timestamp: new Date().toISOString(),
      method: req.method,
      body: req.body
    })
  }

  if (req.method === 'GET') {
    console.log(`🧪 GET REQUEST REACHED NEW CONVERSATIONS TEST ENDPOINT!`)
    return res.status(200).json({ 
      success: true,
      message: 'GET request to new conversations test endpoint successful',
      timestamp: new Date().toISOString(),
      method: req.method
    })
  }

  res.status(405).json({ error: 'Method not allowed' })
}