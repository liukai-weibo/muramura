import { View } from '@tarojs/components'
import type { ExperimentalAiMessageListProps } from './experimental-ai-message-list.types'
import { MessageScroller, MessageScrollerContent } from './experimental-ai-scroller'

export function ExperimentalAiMessageList<T extends { id: string }>({ messages, renderMessage, onReachTop, scrollKey }: ExperimentalAiMessageListProps<T>) {
  return <MessageScroller onReachTop={onReachTop} autoScrollKey={scrollKey}><MessageScrollerContent><View className="experimental-ai-message-list-fallback">{messages.map(renderMessage)}</View></MessageScrollerContent></MessageScroller>
}
