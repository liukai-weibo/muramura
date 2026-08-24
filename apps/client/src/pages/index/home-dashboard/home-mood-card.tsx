import { Text, View } from '@tarojs/components'

interface HomeMoodCardProps { onOpenMoodCreate: () => void }

export function HomeMoodCard({ onOpenMoodCreate }: HomeMoodCardProps) {
  return (
    <View className='home-mood-card card-transition' role='button' aria-label='记录今日情绪' onClick={onOpenMoodCreate}>
      <View className='home-mood-card-glow' aria-hidden='true' />
      <View className='home-mood-card-copy'>
        <Text className='home-mood-card-kicker'>今日情绪</Text>
        <Text className='home-mood-card-title'>今天有感到开心吗？</Text>
        <Text className='home-mood-card-description'>点击记录此刻的心情，点滴积累你的情绪轨迹。</Text>
      </View>
      <Text className='home-mood-card-action' aria-hidden='true'>记录 →</Text>
    </View>
  )
}
