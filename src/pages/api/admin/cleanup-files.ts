import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]'
import { fileCleanupService } from '@/lib/file-cleanup'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Check if user is authenticated and is admin
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // For now, allow any authenticated user to run cleanup
    // In production, you might want to add admin role checks
    console.log('[API] File cleanup requested by user:', session.user.id)

    // Check if this is a dry run (just get stats)
    const isDryRun = req.query.dryRun === 'true'

    if (isDryRun) {
      // Return statistics without actually deleting files
      const stats = await fileCleanupService.getCleanupStats()

      return res.status(200).json({
        dryRun: true,
        stats: {
          expiredCount: stats.expiredCount,
          totalSize: stats.totalSize,
          totalSizeMB: Math.round(stats.totalSize / (1024 * 1024) * 100) / 100,
          oldestFile: stats.oldestFile,
          expiryDate: stats.expiryDate,
          expiryDays: 30
        },
        message: `Found ${stats.expiredCount} expired files (${Math.round(stats.totalSize / (1024 * 1024) * 100) / 100} MB)`
      })
    }

    // Run actual cleanup
    const result = await fileCleanupService.cleanupExpiredFiles()

    // Calculate total size of deleted files (approximate)
    const avgFileSizeMB = 0.5 // Rough estimate
    const deletedSizeMB = Math.round(result.deletedCount * avgFileSizeMB * 100) / 100

    const response = {
      success: true,
      processed: result.processed,
      deleted: result.deletedCount,
      errors: result.errors,
      errorCount: result.errors.length,
      estimatedSizeMB: deletedSizeMB,
      message: `Successfully processed ${result.processed} files, deleted ${result.deletedCount} expired files`
    }

    console.log('[API] File cleanup completed:', response)
    return res.status(200).json(response)

  } catch (error) {
    console.error('[API] File cleanup error:', error)
    return res.status(500).json({
      error: 'File cleanup failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}