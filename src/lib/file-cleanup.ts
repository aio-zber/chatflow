import { prisma } from './prisma'

export interface FileCleanupResult {
  deletedCount: number
  errors: string[]
  processed: number
}

export class FileCleanupService {
  private readonly EXPIRY_DAYS = 30
  private readonly BATCH_SIZE = 100

  async cleanupExpiredFiles(): Promise<FileCleanupResult> {
    console.log('[FileCleanup] Starting cleanup of expired files...')

    const result: FileCleanupResult = {
      deletedCount: 0,
      errors: [],
      processed: 0
    }

    try {
      // Calculate expiry date (30 days ago)
      const expiryDate = new Date()
      expiryDate.setDate(expiryDate.getDate() - this.EXPIRY_DAYS)

      console.log('[FileCleanup] Looking for files created before:', expiryDate.toISOString())

      // Find expired attachments in batches
      let hasMore = true
      let skip = 0

      while (hasMore) {
        const expiredAttachments = await prisma.messageAttachment.findMany({
          where: {
            createdAt: {
              lt: expiryDate
            }
          },
          take: this.BATCH_SIZE,
          skip,
          orderBy: {
            createdAt: 'asc'
          }
        })

        if (expiredAttachments.length === 0) {
          hasMore = false
          break
        }

        console.log(`[FileCleanup] Processing batch: ${expiredAttachments.length} files (offset: ${skip})`)

        // Process each attachment in the batch
        for (const attachment of expiredAttachments) {
          try {
            result.processed++

            // Extract file info for logging
            const fileInfo = {
              id: attachment.id,
              fileName: attachment.fileName,
              fileType: attachment.fileType,
              createdAt: attachment.createdAt,
              messageId: attachment.messageId
            }

            console.log('[FileCleanup] Processing file:', fileInfo)

            // Delete from cloud storage first (Cloudinary)
            await this.deleteFromCloudStorage(attachment.fileUrl, attachment.fileType)

            // Delete from database
            await prisma.messageAttachment.delete({
              where: { id: attachment.id }
            })

            result.deletedCount++
            console.log(`[FileCleanup] ✅ Successfully deleted file: ${attachment.fileName}`)

          } catch (error) {
            const errorMsg = `Failed to delete file ${attachment.fileName}: ${error}`
            console.error('[FileCleanup] ❌', errorMsg)
            result.errors.push(errorMsg)
          }
        }

        skip += this.BATCH_SIZE

        // Add small delay between batches to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      const summary = {
        processed: result.processed,
        deleted: result.deletedCount,
        errors: result.errors.length,
        expiryDate: expiryDate.toISOString()
      }

      console.log('[FileCleanup] ✅ Cleanup completed:', summary)
      return result

    } catch (error) {
      const errorMsg = `File cleanup failed: ${error}`
      console.error('[FileCleanup] ❌ Critical error:', errorMsg)
      result.errors.push(errorMsg)
      return result
    }
  }

  private async deleteFromCloudStorage(fileUrl: string, fileType?: string): Promise<void> {
    try {
      // Check if this is a Cloudinary URL
      if (fileUrl.includes('cloudinary.com')) {
        const { deleteFromCloudinary } = await import('./cloudinary')

        // Extract public_id from Cloudinary URL
        const publicId = this.extractCloudinaryPublicId(fileUrl)

        if (publicId) {
          // Determine resource type from file type
          const resourceType = this.getResourceType(fileType)
          await deleteFromCloudinary(publicId, resourceType)
          console.log('[FileCleanup] ✅ Deleted from Cloudinary:', { publicId, resourceType })
        } else {
          console.warn('[FileCleanup] ⚠️ Could not extract public_id from URL:', fileUrl)
        }
      } else {
        console.log('[FileCleanup] ℹ️ File not on Cloudinary, skipping cloud deletion:', fileUrl)
      }
    } catch (error) {
      // Don't fail the entire cleanup if cloud deletion fails
      console.warn('[FileCleanup] ⚠️ Cloud storage deletion failed (continuing with DB cleanup):', error)
    }
  }

  private getResourceType(fileType?: string): 'image' | 'video' | 'raw' {
    if (!fileType) return 'raw'

    if (fileType.startsWith('image/')) {
      return 'image'
    } else if (fileType.startsWith('video/') || fileType.startsWith('audio/')) {
      return 'video'
    } else {
      return 'raw'
    }
  }

  private extractCloudinaryPublicId(url: string): string | null {
    try {
      // Example Cloudinary URL: https://res.cloudinary.com/demo/image/upload/v1234567890/sample.jpg
      const matches = url.match(/\/v\d+\/(.+?)(?:\.|$)/)
      if (matches && matches[1]) {
        // Remove file extension if present
        return matches[1].replace(/\.[^.]+$/, '')
      }
      return null
    } catch (error) {
      console.warn('[FileCleanup] Error extracting public_id:', error)
      return null
    }
  }

  // Get statistics about files that would be cleaned up (dry run)
  async getCleanupStats(): Promise<{
    expiredCount: number
    totalSize: number
    oldestFile: Date | null
    expiryDate: Date
  }> {
    const expiryDate = new Date()
    expiryDate.setDate(expiryDate.getDate() - this.EXPIRY_DAYS)

    const stats = await prisma.messageAttachment.aggregate({
      where: {
        createdAt: {
          lt: expiryDate
        }
      },
      _count: {
        id: true
      },
      _sum: {
        fileSize: true
      }
    })

    const oldestFile = await prisma.messageAttachment.findFirst({
      where: {
        createdAt: {
          lt: expiryDate
        }
      },
      orderBy: {
        createdAt: 'asc'
      },
      select: {
        createdAt: true
      }
    })

    return {
      expiredCount: stats._count.id || 0,
      totalSize: stats._sum.fileSize || 0,
      oldestFile: oldestFile?.createdAt || null,
      expiryDate
    }
  }
}

// Convenience function for API usage
export const fileCleanupService = new FileCleanupService()