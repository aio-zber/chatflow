'use client'

import React from 'react'
// Temporarily disable react-markdown due to VFile process.cwd() errors
// import ReactMarkdown from 'react-markdown'
// import rehypeHighlight from 'rehype-highlight' 
// import rehypeRaw from 'rehype-raw'
// import 'highlight.js/styles/github-dark.css'

interface MessageFormatterProps {
  content: string
  className?: string
}

export function MessageFormatter({ content, className = '' }: MessageFormatterProps) {
  // Convert emoji shortcodes to actual emojis
  const processEmojis = (text: string) => {
    const emojiMap: Record<string, string> = {
      ':)': '😊',
      ':-)': '😊',
      ':(': '😢',
      ':-(': '😢',
      ':D': '😃',
      ':-D': '😃',
      ';)': '😉',
      ';-)': '😉',
      ':P': '😛',
      ':-P': '😛',
      ':o': '😮',
      ':-o': '😮',
      '<3': '❤️',
      '</3': '💔',
      ':thumbsup:': '👍',
      ':thumbsdown:': '👎',
      ':fire:': '🔥',
      ':heart:': '❤️',
      ':laugh:': '😂',
      ':cry:': '😢',
      ':love:': '😍',
      ':wink:': '😉',
      ':smile:': '😊',
      ':sad:': '😢',
      ':angry:': '😡',
      ':surprised:': '😮',
      ':confused:': '😕',
      ':cool:': '😎',
      ':party:': '🎉',
      ':rocket:': '🚀',
      ':star:': '⭐',
      ':check:': '✅',
      ':x:': '❌'
    }

    let processed = text
    Object.entries(emojiMap).forEach(([shortcode, emoji]) => {
      processed = processed.replace(new RegExp(escapeRegExp(shortcode), 'g'), emoji)
    })
    return processed
  }

  const escapeRegExp = (string: string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  const processedContent = processEmojis(content)

  // Simple text formatter with basic markdown-like features
  const formatText = (text: string) => {
    const lines = text.split('\n')
    
    return lines.map((line, index) => {
      // Handle code blocks (basic support)
      if (line.startsWith('```')) {
        return null // Skip code block markers for now
      }
      
      // Handle headers
      if (line.startsWith('# ')) {
        return <h1 key={index} className="text-lg font-bold mb-2">{line.slice(2)}</h1>
      }
      if (line.startsWith('## ')) {
        return <h2 key={index} className="text-base font-bold mb-2">{line.slice(3)}</h2>
      }
      if (line.startsWith('### ')) {
        return <h3 key={index} className="text-sm font-bold mb-1">{line.slice(4)}</h3>
      }
      
      // Handle bold text
      let processedLine = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Handle italic text
      processedLine = processedLine.replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Handle inline code
      processedLine = processedLine.replace(/`(.*?)`/g, '<code class="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm font-mono">$1</code>')
      
      // Handle markdown links
      processedLine = processedLine.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline break-all">$1</a>')
      
      // Handle plain URLs and make them mobile-friendly with smart truncation
      processedLine = processedLine.replace(
        /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g, 
        (match) => {
          const url = match
          const displayUrl = url.length > 50 ? url.substring(0, 47) + '...' : url
          return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline break-all word-break-all overflow-wrap-anywhere" title="${url}">${displayUrl}</a>`
        }
      )
      
      // Handle very long words (non-URL) that might cause overflow
      processedLine = processedLine.replace(
        /(\S{30,})/g,
        (match) => {
          // Skip if it's already wrapped in HTML tags (like URLs)
          if (match.includes('<') || match.includes('>')) {
            return match
          }
          return `<span style="word-break: break-all; overflow-wrap: anywhere;">${match}</span>`
        }
      )
      
      if (line.trim() === '') {
        return <br key={index} />
      }
      
      return (
        <p key={index} className="mb-2 last:mb-0 break-words overflow-wrap-anywhere hyphens-auto" dangerouslySetInnerHTML={{ __html: processedLine }} />
      )
    }).filter(Boolean)
  }

  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none break-words overflow-wrap-anywhere ${className}`} style={{
      wordBreak: 'break-word',
      overflowWrap: 'anywhere',
      hyphens: 'auto'
    }}>
      {formatText(processedContent)}
    </div>
  )
}