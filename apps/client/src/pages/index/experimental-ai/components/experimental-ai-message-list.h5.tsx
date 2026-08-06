import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ExperimentalAiMessageListProps } from './experimental-ai-message-list.types'
import { MessageScroller, MessageScrollerContent } from './experimental-ai-scroller'

function VirtualMessageList<T extends { id: string }>({ messages, renderMessage, onReachTop, scrollKey }: ExperimentalAiMessageListProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const reachedTopRef = useRef(false)
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => messages[index]?.id ?? index,
    estimateSize: () => 120,
    overscan: 8,
  })
  useEffect(() => { reachedTopRef.current = false }, [messages[0]?.id])
  useEffect(() => {
    if (scrollKey === undefined) return
    const frame = requestAnimationFrame(() => {
      virtualizer.measure()
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [scrollKey, virtualizer])
  return <div ref={scrollRef} className="experimental-ai-virtual-scroller" onScroll={(event) => { if (event.currentTarget.scrollTop < 80 && !reachedTopRef.current) { reachedTopRef.current = true; onReachTop?.() } }}><div className="experimental-ai-virtual-content" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>{virtualizer.getVirtualItems().map((item) => { const current = messages[item.index] as T & { role?: string } | undefined; const previous = messages[item.index - 1] as T & { role?: string } | undefined; return <div key={item.key} data-index={item.index} data-message-role={current?.role} data-previous-message-role={previous?.role} ref={virtualizer.measureElement} className="experimental-ai-virtual-item" style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}>{renderMessage(messages[item.index]!)}</div> })}</div></div>
}

export function ExperimentalAiMessageList<T extends { id: string }>(props: ExperimentalAiMessageListProps<T>) {
  if (props.messages.length <= 60) return <MessageScroller onReachTop={props.onReachTop} autoScrollKey={props.scrollKey}><MessageScrollerContent><div className="experimental-ai-message-list-fallback">{props.messages.map(props.renderMessage)}</div></MessageScrollerContent></MessageScroller>
  return <VirtualMessageList {...props} />
}
