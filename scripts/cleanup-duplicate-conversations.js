#!/usr/bin/env node

/**
 * Script to clean up duplicate conversations in the database
 * This script will:
 * 1. Find all conversations with duplicate participants (same two users)
 * 2. Keep the conversation with the most recent activity (messages or creation date)
 * 3. Merge messages from duplicate conversations into the kept conversation
 * 4. Delete the duplicate conversations
 */

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function cleanupDuplicateConversations() {
  console.log('🔍 Starting cleanup of duplicate conversations...')
  
  try {
    // Get all non-group conversations with their participants
    const conversations = await prisma.conversation.findMany({
      where: {
        isGroup: false
      },
      include: {
        participants: {
          select: {
            userId: true
          }
        },
        messages: {
          select: {
            id: true,
            createdAt: true
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 1
        },
        _count: {
          select: {
            messages: true
          }
        }
      }
    })

    console.log(`📊 Found ${conversations.length} non-group conversations`)

    // Group conversations by participant pairs
    const conversationGroups = new Map()

    for (const conversation of conversations) {
      if (conversation.participants.length !== 2) {
        console.log(`⚠️ Skipping conversation ${conversation.id} - unexpected participant count: ${conversation.participants.length}`)
        continue
      }

      // Create a sorted key from the two participant IDs
      const participantIds = conversation.participants.map(p => p.userId).sort()
      const key = participantIds.join('|')

      if (!conversationGroups.has(key)) {
        conversationGroups.set(key, [])
      }
      conversationGroups.get(key).push(conversation)
    }

    console.log(`👥 Found ${conversationGroups.size} unique participant pairs`)

    let duplicatesFound = 0
    let conversationsDeleted = 0
    let messagesMovedCount = 0

    // Process each group of conversations
    for (const [participantKey, conversationGroup] of conversationGroups) {
      if (conversationGroup.length <= 1) {
        continue // No duplicates for this pair
      }

      duplicatesFound++
      console.log(`\n🔄 Processing duplicate conversations for participants: ${participantKey}`)
      console.log(`   Found ${conversationGroup.length} conversations:`)

      // Sort conversations to determine which one to keep
      // Priority: 1) Most messages, 2) Most recent message, 3) Most recent creation
      conversationGroup.sort((a, b) => {
        // First, prefer conversation with more messages
        if (a._count.messages !== b._count.messages) {
          return b._count.messages - a._count.messages
        }
        
        // If same message count, prefer conversation with more recent message
        const aLastMessage = a.messages[0]?.createdAt || a.createdAt
        const bLastMessage = b.messages[0]?.createdAt || b.createdAt
        
        return new Date(bLastMessage) - new Date(aLastMessage)
      })

      const keepConversation = conversationGroup[0]
      const duplicateConversations = conversationGroup.slice(1)

      console.log(`   ✅ Keeping conversation: ${keepConversation.id} (${keepConversation._count.messages} messages)`)
      
      for (const duplicate of duplicateConversations) {
        console.log(`   🗑️ Will delete conversation: ${duplicate.id} (${duplicate._count.messages} messages)`)
      }

      // Move all messages from duplicate conversations to the kept conversation
      for (const duplicate of duplicateConversations) {
        if (duplicate._count.messages > 0) {
          console.log(`   📝 Moving ${duplicate._count.messages} messages from ${duplicate.id} to ${keepConversation.id}`)
          
          const updateResult = await prisma.message.updateMany({
            where: {
              conversationId: duplicate.id
            },
            data: {
              conversationId: keepConversation.id
            }
          })
          
          messagesMovedCount += updateResult.count
          console.log(`   ✅ Moved ${updateResult.count} messages`)
        }

        // Delete the duplicate conversation (cascade will handle participants)
        await prisma.conversation.delete({
          where: {
            id: duplicate.id
          }
        })
        
        conversationsDeleted++
        console.log(`   ✅ Deleted duplicate conversation: ${duplicate.id}`)
      }

      // Update the kept conversation's updatedAt timestamp
      await prisma.conversation.update({
        where: {
          id: keepConversation.id
        },
        data: {
          updatedAt: new Date()
        }
      })
    }

    console.log('\n🎉 Cleanup completed!')
    console.log(`📊 Summary:`)
    console.log(`   - Duplicate participant pairs found: ${duplicatesFound}`)
    console.log(`   - Conversations deleted: ${conversationsDeleted}`)
    console.log(`   - Messages moved: ${messagesMovedCount}`)
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run the cleanup
cleanupDuplicateConversations()
  .then(() => {
    console.log('✅ Script completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 Script failed:', error)
    process.exit(1)
  })