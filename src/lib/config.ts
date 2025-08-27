// Environment variable validation and configuration
export const config = {
  database: {
    url: process.env.DATABASE_URL,
  },
  auth: {
    secret: process.env.NEXTAUTH_SECRET,
    url: process.env.NEXTAUTH_URL,
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  environment: process.env.NODE_ENV || 'development',
}

// Validate critical environment variables
export function validateConfig() {
  const issues: string[] = []
  
  if (!config.database.url) {
    issues.push('DATABASE_URL is not set')
  }
  
  if (!config.auth.secret) {
    issues.push('NEXTAUTH_SECRET is not set')
  }
  
  if (!config.auth.url && config.environment === 'production') {
    issues.push('NEXTAUTH_URL is not set (required in production)')
  }
  
  if (issues.length > 0) {
    console.error('❌ Configuration validation failed:')
    issues.forEach(issue => console.error(`  - ${issue}`))
    
    if (config.environment === 'production') {
      throw new Error('Critical configuration missing in production')
    } else {
      console.warn('⚠️ Configuration issues detected (continuing in development)')
    }
  } else {
    console.log('✅ Configuration validation passed')
  }
}

// Log configuration status (without sensitive values)
export function logConfigStatus() {
  console.log('🔧 Environment Configuration:')
  console.log(`  - Environment: ${config.environment}`)
  console.log(`  - Database URL: ${config.database.url ? '✓ Set' : '✗ Missing'}`)
  console.log(`  - NextAuth Secret: ${config.auth.secret ? '✓ Set' : '✗ Missing'}`)
  console.log(`  - NextAuth URL: ${config.auth.url ? '✓ Set' : '✗ Missing'}`)
  console.log(`  - Cloudinary: ${config.cloudinary.cloudName ? '✓ Configured' : '✗ Not configured'}`)
}