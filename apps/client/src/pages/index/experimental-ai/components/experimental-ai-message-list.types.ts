import type { ReactNode } from 'react'

export interface ExperimentalAiMessageListProps<T extends { id: string }> {
  messages: T[]
  renderMessage: (message: T) => ReactNode
  onReachTop?: () => void
  scrollKey?: string | number
}
