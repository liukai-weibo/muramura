import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, View } from '@tarojs/components'

interface ScrollerContextValue { scrollToEnd: () => void }
const ScrollerContext = createContext<ScrollerContextValue>({ scrollToEnd: () => undefined })
export function MessageScrollerProvider({ children }: { children?: React.ReactNode }) { return <ScrollerContext.Provider value={{ scrollToEnd: () => undefined }}>{children}</ScrollerContext.Provider> }
export function MessageScroller({ children, className = '', autoScrollKey, onReachTop }: { children?: React.ReactNode; className?: string; autoScrollKey?: string | number; onReachTop?: () => void }) {
  const [scrollTop, setScrollTop] = useState(0)
  const [scrollMetrics, setScrollMetrics] = useState({ viewport: 1, content: 1 })
  const shellRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLElement | null>(null)
  const dragStartRef = useRef<{ clientY: number; scrollTop: number } | null>(null)
  const scrollToEnd = () => setScrollTop(999999)
  useEffect(() => { if (autoScrollKey !== undefined) scrollToEnd() }, [autoScrollKey])
  useEffect(() => {
    const measure = () => {
      const node = scrollRef.current
      if (!node) return
      setScrollMetrics({ viewport: node.clientHeight || 1, content: node.scrollHeight || 1 })
    }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined
    if (observer && shellRef.current) observer.observe(shellRef.current)
    if (observer && scrollRef.current) observer.observe(scrollRef.current)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  const maxScrollTop = Math.max(0, scrollMetrics.content - scrollMetrics.viewport)
  const canScroll = maxScrollTop > 0
  const trackHeight = Math.max(0, scrollMetrics.viewport)
  const thumbHeight = canScroll ? Math.max(28, (scrollMetrics.viewport / scrollMetrics.content) * trackHeight) : 0
  const thumbTravel = Math.max(0, trackHeight - thumbHeight)
  const thumbTop = maxScrollTop ? Math.min(thumbTravel, (scrollTop / maxScrollTop) * thumbTravel) : 0
  const beginDrag = (event: any) => {
    event.preventDefault()
    dragStartRef.current = { clientY: event.clientY, scrollTop }
    const move = (moveEvent: MouseEvent) => {
      const drag = dragStartRef.current
      if (!drag || !thumbTravel) return
      const next = drag.scrollTop + ((moveEvent.clientY - drag.clientY) / thumbTravel) * maxScrollTop
      setScrollTop(Math.max(0, Math.min(maxScrollTop, next)))
    }
    const end = () => { dragStartRef.current = null; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', end) }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', end)
  }
  const value = useMemo(() => ({ scrollToEnd }), [])
  const ScrollbarThumb = View as unknown as React.ComponentType<any>
  return <ScrollerContext.Provider value={value}><View ref={shellRef} className="experimental-ai-scroll-shell"><ScrollView ref={(node) => { scrollRef.current = node as unknown as HTMLElement }} className={`experimental-ai-scroller ${className}`} scrollY scrollTop={scrollTop} onScroll={(event) => { const nextScrollTop = event.detail.scrollTop; const detail = event.detail as typeof event.detail & { clientHeight?: number; scrollHeight?: number }; setScrollTop(nextScrollTop); setScrollMetrics({ viewport: detail.clientHeight || scrollMetrics.viewport, content: detail.scrollHeight || scrollMetrics.content }); if (nextScrollTop < 80) onReachTop?.() }}>{children}</ScrollView>{canScroll && <View className="experimental-ai-custom-scrollbar" aria-hidden="true"><ScrollbarThumb className="experimental-ai-custom-scrollbar-thumb" style={{ height: `${thumbHeight}px`, transform: `translateY(${thumbTop}px)` }} onMouseDown={beginDrag} /></View>}</View></ScrollerContext.Provider>
}
export function MessageScrollerViewport({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <View className={`experimental-ai-scroller-viewport ${className}`}>{children}</View> }
export function MessageScrollerContent({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <View className={`experimental-ai-scroller-content ${className}`}>{children}</View> }
export function MessageScrollerItem({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <View className={`experimental-ai-scroller-item ${className}`}>{children}</View> }
export function MessageScrollerButton({ children, className = '', onClick }: { children?: React.ReactNode; className?: string; onClick?: () => void }) { return <View className={`experimental-ai-scroller-button ${className}`} onClick={onClick}>{children}</View> }
export const useMessageScroller = () => useContext(ScrollerContext)
export const useMessageScrollerScrollable = useMessageScroller
export const useMessageScrollerVisibility = () => ({ isAtEnd: true, isAtStart: true })
