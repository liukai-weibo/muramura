import { Text, View } from '@tarojs/components'
import type { DailySummary } from '@knowledge-base/contracts'

interface HomeDailySummaryCardProps {
  summary?: DailySummary
  loading?: boolean
  onOpen: () => void
}

const PREVIEW_LENGTH = 150

export function HomeDailySummaryCard({ summary, loading, onOpen }: HomeDailySummaryCardProps) {
  const preview = summary ? summary.content.replace(/\s+/g, ' ').slice(0, PREVIEW_LENGTH) : undefined
  return (
    <View className={`home-daily-summary-card card-transition${loading ? ' is-loading' : ''}`} role='button' aria-label='近期状态小结' onClick={onOpen}>
      <View className='home-daily-summary-card-glow' aria-hidden='true' />
      <View className='home-daily-summary-card-copy'>
        <Text className='home-daily-summary-card-kicker'>近期状态小结</Text>
        {preview ? (
          <Text className='home-daily-summary-card-content'>{preview}{summary && summary.content.length > PREVIEW_LENGTH ? '…' : ''}</Text>
        ) : loading ? (
          <Text className='home-daily-summary-card-hint'>生成中…</Text>
        ) : (
          <Text className='home-daily-summary-card-title'>最近状态怎么样？</Text>
        )}
        <Text className='home-daily-summary-card-description'>{preview ? '查看近期状态小结' : '自动总结你的近期状态与要点'}</Text>
      </View>
      <Text className='home-daily-summary-card-action' aria-hidden='true'>查看 →</Text>
    </View>
  )
}
