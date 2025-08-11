'use client'

import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import 'highlight.js/styles/github-dark.css'

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

  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none ${className}`}>
      <ReactMarkdown
        rehypePlugins={[rehypeHighlight, rehypeRaw]}
        components={{
          // Customize code blocks
          code: ({ node, inline, className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '')
            return !inline && match ? (
              <pre className="bg-gray-100 dark:bg-gray-800 rounded-md p-3 overflow-x-auto">
                <code className={className} {...props}>
                  {children}
                </code>
              </pre>
            ) : (
              <code 
                className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm font-mono" 
                {...props}
              >
                {children}
              </code>
            )
          },
          // Customize links
          a: ({ node, href, children, ...props }) => (
            <a 
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
              {...props}
            >
              {children}
            </a>
          ),
          // Customize blockquotes
          blockquote: ({ node, children, ...props }) => (
            <blockquote 
              className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic text-gray-600 dark:text-gray-400"
              {...props}
            >
              {children}
            </blockquote>
          ),
          // Remove default margins
          p: ({ node, children, ...props }) => (
            <p className="mb-2 last:mb-0" {...props}>
              {children}
            </p>
          ),
          // Style lists
          ul: ({ node, children, ...props }) => (
            <ul className="list-disc list-inside mb-2" {...props}>
              {children}
            </ul>
          ),
          ol: ({ node, children, ...props }) => (
            <ol className="list-decimal list-inside mb-2" {...props}>
              {children}
            </ol>
          ),
          // Style headers
          h1: ({ node, children, ...props }) => (
            <h1 className="text-lg font-bold mb-2" {...props}>
              {children}
            </h1>
          ),
          h2: ({ node, children, ...props }) => (
            <h2 className="text-base font-bold mb-2" {...props}>
              {children}
            </h2>
          ),
          h3: ({ node, children, ...props }) => (
            <h3 className="text-sm font-bold mb-1" {...props}>
              {children}
            </h3>
          ),
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}