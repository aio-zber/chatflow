import { fileCleanupService } from './file-cleanup'

/**
 * Scheduled file cleanup job
 * This can be called by:
 * 1. A cron job
 * 2. A background worker
 * 3. A serverless function on a schedule
 * 4. GitHub Actions scheduled workflow
 */
export async function runScheduledCleanup(): Promise<void> {
  console.log('[ScheduledCleanup] Starting scheduled file cleanup job...')

  try {
    // Get cleanup stats first for logging
    const stats = await fileCleanupService.getCleanupStats()

    console.log('[ScheduledCleanup] Cleanup stats:', {
      expiredFiles: stats.expiredCount,
      totalSizeMB: Math.round(stats.totalSize / (1024 * 1024) * 100) / 100,
      oldestFile: stats.oldestFile,
      expiryDate: stats.expiryDate
    })

    // Skip cleanup if no expired files
    if (stats.expiredCount === 0) {
      console.log('[ScheduledCleanup] ✅ No expired files found, skipping cleanup')
      return
    }

    // Run the actual cleanup
    const result = await fileCleanupService.cleanupExpiredFiles()

    // Log results
    const summary = {
      processed: result.processed,
      deleted: result.deletedCount,
      errors: result.errors.length,
      estimatedSizeMB: Math.round(result.deletedCount * 0.5 * 100) / 100, // Rough estimate
      duration: new Date().toISOString()
    }

    console.log('[ScheduledCleanup] ✅ Cleanup completed successfully:', summary)

    // Log any errors that occurred
    if (result.errors.length > 0) {
      console.warn('[ScheduledCleanup] ⚠️ Cleanup completed with errors:')
      result.errors.forEach((error, index) => {
        console.warn(`[ScheduledCleanup] Error ${index + 1}:`, error)
      })
    }

  } catch (error) {
    console.error('[ScheduledCleanup] ❌ Scheduled cleanup failed:', error)
    throw error // Re-throw to allow monitoring systems to detect failures
  }
}

// Self-executing function for standalone script usage
if (require.main === module) {
  runScheduledCleanup()
    .then(() => {
      console.log('[ScheduledCleanup] Script completed successfully')
      process.exit(0)
    })
    .catch((error) => {
      console.error('[ScheduledCleanup] Script failed:', error)
      process.exit(1)
    })
}