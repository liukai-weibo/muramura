import { Text, View } from '@tarojs/components'
import type { DailyDietRecommendation } from '@knowledge-base/contracts'

interface HomeDailyDietCardProps {
  recommendation?: DailyDietRecommendation
  loading?: boolean
  onOpen: () => void
}

const PREVIEW_LENGTH = 150

export function HomeDailyDietCard({ recommendation, loading, onOpen }: HomeDailyDietCardProps) {
  const preview = recommendation ? recommendation.content.replace(/\s+/g, ' ').slice(0, PREVIEW_LENGTH) : undefined
  return (
    <View className={`home-daily-diet-card card-transition${loading ? ' is-loading' : ''}`} role='button' aria-label='今日饮食推荐' onClick={onOpen}>
      <View className='home-daily-diet-card-glow' aria-hidden='true' />
      <View className='home-daily-diet-card-copy'>
        <Text className='home-daily-diet-card-kicker'>今日饮食推荐</Text>
        {preview ? (
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
