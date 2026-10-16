import { Text, View } from '@tarojs/components'

interface HomeMoodCardProps { onOpenMoodCreate: () => void }

export function HomeMoodCard({ onOpenMoodCreate }: HomeMoodCardProps) {
  return (
    <View className='home-mood-card card-transition' role='button' aria-label='记录今日事件' onClick={onOpenMoodCreate}>
      <View className='home-mood-card-glow' aria-hidden='true' />
      <View className='home-mood-card-copy'>
        <Text className='home-mood-card-kicker'>今日事件</Text>
        <Text className='home-mood-card-title'>今天发生了什么？</Text>
        <Text className='home-mood-card-description'>记下一件小事，点滴积累你的生活轨迹。</Text>
      </View>
      <Text className='home-mood-card-action' aria-hidden='true'>记录 →</Text>
    </View>
  )
}
