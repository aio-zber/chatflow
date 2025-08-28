/**
 * Utility functions for handling file URLs with CORS/COEP compatibility
 */

/**
 * Converts a Cloudinary URL to use our proxy API route
 * This helps bypass COEP issues by serving files through our own domain
 */
export function getProxiedFileUrl(originalUrl: string): string {
  try {
    const url = new URL(originalUrl)
    
    // Only proxy Cloudinary URLs
    if (url.hostname !== 'res.cloudinary.com') {
      return originalUrl
    }
    
    // Extract the path after the hostname
    const pathWithoutHost = `${url.hostname}${url.pathname}`
    
    // Return proxied URL
    return `/api/files/${pathWithoutHost}`
  } catch (error) {
    console.warn('Failed to parse URL for proxying:', originalUrl, error)
    return originalUrl
  }
}

/**
 * Determines if a URL should be proxied based on current environment
 * In development, we might not need proxying due to different COEP settings
 */
export function shouldProxyFile(url: string): boolean {
  // Always proxy in production to handle COEP issues
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return true
  }
  
  // In development, proxy if we detect COEP issues
  return url.includes('res.cloudinary.com')
}

/**
 * Smart file URL handler that automatically proxies when needed
 */
export function getCompatibleFileUrl(originalUrl: string): string {
  if (shouldProxyFile(originalUrl)) {
    return getProxiedFileUrl(originalUrl)
  }
  return originalUrl
}

/**
 * Checks if a URL is a Cloudinary URL
 */
export function isCloudinaryUrl(url: string): boolean {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname === 'res.cloudinary.com' || urlObj.hostname.endsWith('.cloudinary.com')
  } catch {
    return false
  }
}