import { Text, View } from '@tarojs/components'

interface HomeMealCardProps { onOpenMeals: () => void }

export function HomeMealCard({ onOpenMeals }: HomeMealCardProps) {
  return (
    <View className='home-meal-card card-transition' role='button' aria-label='记录今天三餐' onClick={onOpenMeals}>
      <View className='home-meal-card-glow' aria-hidden='true' />
      <View className='home-meal-card-copy'>
        <Text className='home-meal-card-kicker'>一日三餐</Text>
        <Text className='home-meal-card-title'>今天吃了吗？</Text>
        <Text className='home-meal-card-description'>简单记下吃了什么和当下感受，留住每天的味道。</Text>
      </View>
      <Text className='home-meal-card-action' aria-hidden='true'>记录 →</Text>
    </View>
  )
}
