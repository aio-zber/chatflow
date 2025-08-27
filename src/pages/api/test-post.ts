import { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CRITICAL: Immediate logging to test if POST requests reach ANY handler
  console.log(`🧪 TEST POST HANDLER: ${req.method} ${req.url} AT ${new Date().toISOString()}`)
  console.log(`🧪 REQUEST BODY:`, req.body)
  console.log(`🧪 REQUEST HEADERS:`, {
    'content-type': req.headers['content-type'],
    'user-agent': req.headers['user-agent']?.substring(0, 50),
    'origin': req.headers.origin,
    'cookie': req.headers.cookie ? 'Present' : 'Missing'
  })

  if (req.method === 'POST') {
    console.log(`🧪 POST REQUEST SUCCESSFULLY REACHED HANDLER!`)
    return res.status(200).json({ 
      success: true, 
      message: 'POST request received successfully',
      timestamp: new Date().toISOString(),
      method: req.method,
      body: req.body
    })
  }

  if (req.method === 'GET') {
    console.log(`🧪 GET REQUEST SUCCESSFULLY REACHED HANDLER!`)
    return res.status(200).json({ 
      success: true, 
      message: 'GET request received successfully',
      timestamp: new Date().toISOString(),
      method: req.method
    })
  }

  console.log(`🧪 METHOD NOT ALLOWED: ${req.method}`)
  res.status(405).json({ error: 'Method not allowed' })
}