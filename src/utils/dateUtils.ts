/**
 * Utility functions for consistent date and time formatting across the application
 * Uses the device's local timezone and 12-hour format with AM/PM
 */

/**
 * Formats a date as a time string in 12-hour format with AM/PM
 * Uses the device's local timezone
 * 
 * @param date - The date to format
 * @returns Formatted time string (e.g., "2:30 PM")
 */
export const formatTime12Hour = (date: Date): string => {
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

/**
 * Formats a date for message display with contextual information
 * - Today: Shows only time (e.g., "2:30 PM")
 * - Yesterday: Shows "Yesterday 2:30 PM" 
 * - This week: Shows day and time (e.g., "Mon 2:30 PM")
 * - Older: Shows date and time (e.g., "Dec 15 2:30 PM" or "Dec 15, 2023 2:30 PM")
 * 
 * @param date - The date to format
 * @returns Formatted date/time string with context
 */
export const formatMessageTime = (date: Date): string => {
  const now = new Date()
  const messageDate = new Date(date)
  
  // Check if message is from today
  const isToday = messageDate.toDateString() === now.toDateString()
  
  // Check if message is from yesterday
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday = messageDate.toDateString() === yesterday.toDateString()
  
  // Check if message is from this week (within last 7 days)
  const daysDiff = Math.floor((now.getTime() - messageDate.getTime()) / (1000 * 60 * 60 * 24))
  const isThisWeek = daysDiff < 7
  
  const timeString = formatTime12Hour(messageDate)
  
  if (isToday) {
    return timeString
  } else if (isYesterday) {
    return `Yesterday ${timeString}`
  } else if (isThisWeek) {
    return `${messageDate.toLocaleDateString(undefined, { weekday: 'short' })} ${timeString}`
  } else {
    return `${messageDate.toLocaleDateString(undefined, { 
      month: 'short', 
      day: 'numeric',
      ...(messageDate.getFullYear() !== now.getFullYear() && { year: 'numeric' })
    })} ${timeString}`
  }
}

/**
 * Formats a date for conversation list display
 * - Recent (< 1 minute): "now"
 * - Same day: Time in 12-hour format (e.g., "2:30 PM")
 * - Different day: Relative or absolute date
 * 
 * @param date - The date to format
 * @returns Formatted time string for conversation list
 */
export const formatConversationTime = (date: Date): string => {
  const now = new Date()
  const messageDate = new Date(date)
  const diffInMinutes = Math.floor((now.getTime() - messageDate.getTime()) / (1000 * 60))
  
  if (diffInMinutes < 1) {
    return 'now'
  } else if (diffInMinutes < 60) {
    return `${diffInMinutes}m`
  } else {
    return formatTime12Hour(messageDate)
  }
}