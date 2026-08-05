import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { ScrollView, View } from '@tarojs/components'

interface ScrollerContextValue { scrollToEnd: () => void }
const ScrollerContext = createContext<ScrollerContextValue>({ scrollToEnd: () => undefined })
export function MessageScrollerProvider({ children }: { children?: React.ReactNode }) { return <ScrollerContext.Provider value={{ scrollToEnd: () => undefined }}>{children}</ScrollerContext.Provider> }
export function MessageScroller({ children, className = '', autoScrollKey, onReachTop }: { children?: React.ReactNode; className?: string; autoScrollKey?: string | number; onReachTop?: () => void }) {
  const [scrollTop, setScrollTop] = useState(0)
  const scrollToEnd = () => setScrollTop(999999)
  useEffect(() => { if (autoScrollKey !== undefined) scrollToEnd() }, [autoScrollKey])
  const value = useMemo(() => ({ scrollToEnd }), [])
  return <ScrollerContext.Provider value={value}><ScrollView className={`experimental-ai-scroller ${className}`} scrollY scrollTop={scrollTop} onScroll={(event) => { const nextScrollTop = event.detail.scrollTop; setScrollTop(nextScrollTop); if (nextScrollTop < 80) onReachTop?.() }}>{children}</ScrollView></ScrollerContext.Provider>
}
export function MessageScrollerViewport({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <View className={`experimental-ai-scroller-viewport ${className}`}>{children}</View> }
export function MessageScrollerContent({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <View className={`experimental-ai-scroller-content ${className}`}>{children}</View> }
export function MessageScrollerItem({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <View className={`experimental-ai-scroller-item ${className}`}>{children}</View> }
export function MessageScrollerButton({ children, className = '', onClick }: { children?: React.ReactNode; className?: string; onClick?: () => void }) { return <View className={`experimental-ai-scroller-button ${className}`} onClick={onClick}>{children}</View> }
export const useMessageScroller = () => useContext(ScrollerContext)
export const useMessageScrollerScrollable = useMessageScroller
export const useMessageScrollerVisibility = () => ({ isAtEnd: true, isAtStart: true })
