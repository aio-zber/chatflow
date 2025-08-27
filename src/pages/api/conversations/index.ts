import { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log(`🚨🚨🚨 MINIMAL HANDLER ENTRY: ${req.method} ${req.url} AT ${new Date().toISOString()}`)
  
  try {
    console.log(`🚨 IMPORTING DEPENDENCIES...`)
    
    // Import dependencies inside handler to catch import errors
    const { getServerSession } = await import('next-auth')
    const { corsMiddleware } = await import('@/middleware/cors')
    const { authOptions } = await import('../auth/[...nextauth]')
    const { prisma } = await import('@/lib/prisma')
    const { z } = await import('zod')
    
    console.log(`🚨 ALL DEPENDENCIES IMPORTED SUCCESSFULLY`)
    
    // Schema definition
    const createConversationSchema = z.object({
      userId: z.string(),
      isGroup: z.boolean().default(false),
      name: z.string().optional(),
      description: z.string().optional(),
    })
    
    console.log(`🚨 SCHEMA CREATED, PROCESSING REQUEST...`)
    console.log(`🚨 REQUEST BODY:`, req.body)
    console.log(`🚨 REQUEST HEADERS:`, {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']?.substring(0, 50),
      'origin': req.headers.origin,
      'cookie': req.headers.cookie ? 'Present' : 'Missing'
    })
    
    // Handle CORS
    if (corsMiddleware(req, res)) {
      console.log(`🚨 CORS PREFLIGHT HANDLED`)
      return
    }
    
    console.log(`🚨 CORS PASSED, CHECKING SESSION...`)
    
    // Get session
    const session = await getServerSession(req, res, authOptions)
    
    console.log(`🚨 SESSION CHECK:`, {
      hasSession: !!session,
      hasUser: !!session?.user,
      userId: session?.user?.id || 'undefined',
      method: req.method
    })
    
    if (!session?.user?.id) {
      console.log(`🚨 AUTHENTICATION FAILED`)
      return res.status(401).json({ 
        error: 'Unauthorized', 
        details: 'No valid session found'
      })
    }
    
    const user = session.user
    console.log(`🚨 AUTHENTICATED USER:`, user.id)
    
    if (req.method === 'GET') {
      console.log(`🚨 PROCESSING GET REQUEST`)
      
      const conversations = await prisma.conversation.findMany({
        where: {
          participants: {
            some: { userId: user.id }
          }
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  name: true,
                  avatar: true,
                  isOnline: true,
                  lastSeen: true,
                }
              }
            }
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              sender: {
                select: {
                  username: true,
                  name: true,
                }
              }
            }
          }
        },
        orderBy: { updatedAt: 'desc' }
      })
      
      console.log(`🚨 GET CONVERSATIONS SUCCESS: ${conversations.length} found`)
      return res.json({ conversations })
      
    } else if (req.method === 'POST') {
      console.log(`🚨 PROCESSING POST REQUEST`)
      
      const validationResult = createConversationSchema.safeParse(req.body)
      
      if (!validationResult.success) {
        console.log(`🚨 VALIDATION FAILED:`, validationResult.error.issues)
        return res.status(400).json({ 
          error: 'Invalid input', 
          details: validationResult.error.issues 
        })
      }
      
      const { userId, isGroup, name, description } = validationResult.data
      console.log(`🚨 VALIDATED DATA:`, { userId, isGroup, name, description })
      
      // Check if target user exists
      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, name: true }
      })
      
      if (!targetUser) {
        console.log(`🚨 TARGET USER NOT FOUND:`, userId)
        return res.status(404).json({ error: 'User not found' })
      }
      
      console.log(`🚨 TARGET USER FOUND:`, targetUser.id)
      
      // Create conversation
      const conversation = await prisma.conversation.create({
        data: {
          name,
          description,
          isGroup,
          participants: {
            create: [
              { 
                userId: user.id, 
                role: isGroup ? 'admin' : 'member',
                lastReadAt: new Date()
              },
              { 
                userId, 
                role: 'member',
                lastReadAt: new Date()
              }
            ]
          }
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  name: true,
                  avatar: true,
                  isOnline: true,
                  lastSeen: true,
                }
              }
            }
          }
        }
      })
      
      console.log(`🚨 CONVERSATION CREATED SUCCESS:`, conversation.id)
      return res.status(201).json({ conversation })
      
    } else {
      console.log(`🚨 METHOD NOT ALLOWED: ${req.method}`)
      return res.status(405).json({ error: 'Method not allowed' })
    }
    
  } catch (error: any) {
    console.error(`🚨 CRITICAL ERROR IN HANDLER:`, {
      name: error?.name,
      message: error?.message,
      stack: error?.stack?.substring(0, 500),
      timestamp: new Date().toISOString()
    })
    
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error?.message,
      timestamp: new Date().toISOString()
    })
  }
}