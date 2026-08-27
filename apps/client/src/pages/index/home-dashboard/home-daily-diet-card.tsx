import { Text, View } from '@tarojs/components'
import type { DailyDietRecommendation } from '@knowledge-base/contracts'

interface HomeDailyDietCardProps {
  recommendation?: DailyDietRecommendation
  loading?: boolean
  /** 流式生成预览：生成中未落库时优先展示实时文本 */
  streamPreview?: string
  onOpen: () => void
}

const PREVIEW_LENGTH = 150

export function HomeDailyDietCard({ recommendation, loading, streamPreview, onOpen }: HomeDailyDietCardProps) {
  const preview = recommendation ? recommendation.content.replace(/\s+/g, ' ').slice(0, PREVIEW_LENGTH) : undefined
  const streamed = streamPreview ? streamPreview.replace(/\s+/g, ' ').slice(0, PREVIEW_LENGTH) : undefined
  const streaming = Boolean(streamPreview)
  return (
    <View className={`home-daily-diet-card card-transition${loading || streaming ? ' is-loading' : ''}`} role='button' aria-label='今日饮食推荐' onClick={onOpen}>
      <View className='home-daily-diet-card-glow' aria-hidden='true' />
      <View className='home-daily-diet-card-copy'>
        <Text className='home-daily-diet-card-kicker'>今日饮食推荐</Text>
        {streamed ? (
          <Text className='home-daily-diet-card-content'>{streamed}{streaming ? <Text className='generation-cursor' aria-hidden='true'>▍</Text> : '…'}</Text>
        ) : preview ? (
          <Text className='home-daily-diet-card-content'>{preview}{recommendation && recommendation.content.length > PREVIEW_LENGTH ? '…' : ''}</Text>
        ) : loading ? (
          <Text className='home-daily-diet-card-hint'>生成中…</Text>
        ) : (
          <Text className='home-daily-diet-card-title'>今天吃什么好？</Text>
        )}
        <Text className='home-daily-diet-card-description'>{preview ? '查看今日推荐' : '自动生成你的今日建议'}</Text>
      </View>
      <Text className='home-daily-diet-card-action' aria-hidden='true'>查看 →</Text>
    </View>
  )
}
