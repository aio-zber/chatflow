'use client'

import { useState, useEffect, useCallback } from 'react'

interface UseInfiniteScrollOptions {
  threshold?: number
  rootMargin?: string
}

export function useInfiniteScroll(
  callback: () => void,
  hasMore: boolean,
  loading: boolean,
  options: UseInfiniteScrollOptions = {}
) {
  const [isFetching, setIsFetching] = useState(false)
  const [targetElement, setTargetElement] = useState<Element | null>(null)

  const { threshold = 0.1, rootMargin = '100px' } = options

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries
      if (entry.isIntersecting && hasMore && !loading && !isFetching) {
        setIsFetching(true)
        callback()
      }
    },
    [callback, hasMore, loading, isFetching]
  )

  useEffect(() => {
    if (!targetElement) return

    const observer = new IntersectionObserver(handleObserver, {
      threshold,
      rootMargin,
    })

    observer.observe(targetElement)

    return () => {
      if (targetElement) {
        observer.unobserve(targetElement)
      }
    }
  }, [targetElement, handleObserver, threshold, rootMargin])

  useEffect(() => {
    if (!loading && isFetching) {
      setIsFetching(false)
    }
  }, [loading])

  return { setTargetElement, isFetching }
}