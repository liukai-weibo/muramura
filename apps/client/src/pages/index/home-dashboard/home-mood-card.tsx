import { useEffect, useState } from 'react'
import { Text, View } from '@tarojs/components'
import { currentMoodPrompt, msUntilNextMoodPrompt } from './mood-prompts'

interface HomeMoodCardProps { onOpenMoodCreate: () => void }

export function HomeMoodCard({ onOpenMoodCreate }: HomeMoodCardProps) {
  const [now, setNow] = useState(() => Date.now())
  const prompt = currentMoodPrompt(now)

  // 12 小时边界到了自动换一条；页面一直开着也不会停在旧文案上。
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(Date.now()), msUntilNextMoodPrompt(now) + 1000)
    return () => window.clearTimeout(timer)
  }, [now])

  return (
    <View className='home-mood-card card-transition' role='button' aria-label={`记录情绪波动：${prompt.question}`} onClick={onOpenMoodCreate}>
      <View className='home-mood-card-glow' aria-hidden='true' />
      <View className='home-mood-card-copy'>
        <Text className='home-mood-card-question'>{prompt.question}</Text>
        <Text className='home-mood-card-description'>{prompt.desc}</Text>
      </View>
      <Text className='home-mood-card-action' aria-hidden='true'>记录 →</Text>
    </View>
  )
}
