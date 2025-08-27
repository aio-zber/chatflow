import { PrismaClient } from '@prisma/client'
import { validateConfig, logConfigStatus } from './config'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  errorFormat: 'pretty',
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Validate configuration on startup
try {
  logConfigStatus()
  validateConfig()
} catch (error) {
  console.error('Configuration validation failed:', error)
}

// Test database connection on startup
prisma.$connect()
  .then(() => {
    console.log('✅ Database connected successfully')
  })
  .catch((error) => {
    console.error('❌ Database connection failed:', error)
    console.error('Database URL length:', process.env.DATABASE_URL?.length || 0)
    console.error('Database URL starts with:', process.env.DATABASE_URL?.substring(0, 30) || 'undefined')
  })