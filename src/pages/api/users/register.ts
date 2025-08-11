import { NextApiRequest, NextApiResponse } from 'next'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { authLimiter } from '@/lib/rateLimit'

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(20),
  password: z.string().min(8),
  name: z.string().min(1).max(50).optional(),
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limiting
  const rateLimitResult = authLimiter.check(req, 5) // 5 attempts per hour
  if (!rateLimitResult.success) {
    return res.status(429).json({ 
      error: 'Too many registration attempts. Please try again later.',
      retryAfter: rateLimitResult.reset 
    })
  }

  try {
    const { email, username, password, name } = registerSchema.parse(req.body)

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }]
      }
    })

    if (existingUser) {
      return res.status(400).json({ 
        error: existingUser.email === email ? 'Email already exists' : 'Username already exists' 
      })
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    const user = await prisma.user.create({
      data: {
        email,
        username,
        password: hashedPassword,
        name: name || username,
      },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        createdAt: true,
      }
    })

    res.status(201).json({ user })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.issues })
    }
    console.error('Registration error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}