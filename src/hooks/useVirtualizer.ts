'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'

interface VirtualizerOptions {
  itemHeight: number
  containerHeight: number
  itemCount: number
  overscan?: number
}

interface VirtualItem {
  index: number
  start: number
  end: number
  height: number
}

export function useVirtualizer({
  itemHeight,
  containerHeight,
  itemCount,
  overscan = 5,
}: VirtualizerOptions) {
  const [scrollTop, setScrollTop] = useState(0)

  const totalHeight = itemCount * itemHeight

  const visibleItems = useMemo(() => {
    const start = Math.floor(scrollTop / itemHeight)
    const end = Math.min(
      itemCount - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight)
    )

    const startIndex = Math.max(0, start - overscan)
    const endIndex = Math.min(itemCount - 1, end + overscan)

    const items: VirtualItem[] = []
    for (let i = startIndex; i <= endIndex; i++) {
      items.push({
        index: i,
        start: i * itemHeight,
        end: (i + 1) * itemHeight,
        height: itemHeight,
      })
    }

    return items
  }, [scrollTop, itemHeight, containerHeight, itemCount, overscan])

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

  const scrollToItem = useCallback(
    (index: number, align: 'start' | 'center' | 'end' = 'start') => {
      let scrollTo = index * itemHeight

      if (align === 'center') {
        scrollTo = scrollTo - containerHeight / 2 + itemHeight / 2
      } else if (align === 'end') {
        scrollTo = scrollTo - containerHeight + itemHeight
      }

      setScrollTop(Math.max(0, Math.min(scrollTo, totalHeight - containerHeight)))
    },
    [itemHeight, containerHeight, totalHeight]
  )

  return {
    visibleItems,
    totalHeight,
    handleScroll,
    scrollToItem,
    scrollTop,
  }
}
