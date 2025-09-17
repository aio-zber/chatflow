import { NextApiRequest, NextApiResponse } from 'next'
import { runScheduledCleanup } from '@/lib/scheduled-cleanup'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow POST requests (for security)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Verify cron secret if provided (for external cron services)
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const providedSecret = req.headers.authorization?.replace('Bearer ', '') || req.query.secret

    if (!providedSecret || providedSecret !== cronSecret) {
      console.warn('[Cron] Unauthorized cleanup attempt:', {
        ip: req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        hasSecret: !!providedSecret
      })
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  try {
    console.log('[Cron] File cleanup job triggered via API')

    // Run the scheduled cleanup
    await runScheduledCleanup()

    return res.status(200).json({
      success: true,
      message: 'File cleanup completed successfully',
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('[Cron] File cleanup job failed:', error)

    return res.status(500).json({
      success: false,
      error: 'File cleanup failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    })
  }
}

// Disable body parsing for this endpoint (not needed and saves resources)
export const config = {
  api: {
    bodyParser: false,
  },
}