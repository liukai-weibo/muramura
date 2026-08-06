import { useMemo } from 'react'
import { Text, View } from '@tarojs/components'

const THINKING_MESSAGES = [
  '嗯，我好好想想',
  '让我理一理思路',
  '稍等，我琢磨下',
  '我在认真思考哦',
  '等等，我捋捋看',
  '让我好好琢磨下',
  '我稍微想一想哈',
  '嗯，让我想想看',
  '正在梳理想法呢',
  '等我消化一下哦',
  '我再好好捋一遍',
  '容我思考片刻',
  '让我理理头绪',
  '唔，有点费脑子',
  '我这边想一想哈',
  '等我琢磨琢磨',
  '我正在消化信息',
  '嗯，再想想看哦',
  '让我过一遍看看',
  '稍等，我理清楚',
] as const

interface ExperimentalAiThinkingIndicatorProps {
  isGenerating: boolean
  hasReceivedToken: boolean
  generationId: number
}

export function ExperimentalAiThinkingIndicator({ isGenerating, hasReceivedToken, generationId }: ExperimentalAiThinkingIndicatorProps) {
  const message = useMemo(() => THINKING_MESSAGES[Math.floor(Math.random() * THINKING_MESSAGES.length)] ?? THINKING_MESSAGES[0], [generationId])
  if (!isGenerating || hasReceivedToken) return null
  return <View className="experimental-ai-thinking-indicator is-thinking" role="status" aria-live="polite">
    <Text className="experimental-ai-thinking-copy">{message}</Text>
    <Text className="experimental-ai-thinking-dots" aria-hidden="true"><Text className="experimental-ai-thinking-dot">.</Text><Text className="experimental-ai-thinking-dot">.</Text><Text className="experimental-ai-thinking-dot">.</Text></Text>
  </View>
}
