import { Text, View } from '@tarojs/components'
import type { Item } from '@knowledge-base/contracts'

interface HomeHeroBannerProps {
  focusItem?: Item
  onOpenFocus: (itemId: string) => void
  onOpenIdeaPool: () => void
  onOpenCapture: () => void
}

export function HomeHeroBanner({ focusItem, onOpenFocus, onOpenIdeaPool, onOpenCapture }: HomeHeroBannerProps) {
  const hasFocus = Boolean(focusItem)

  return <View className='home-hero-section'>
    <View className='home-hero-copy'>
      <Text className='home-hero-kicker'>今日推进</Text>
      <Text className='home-hero-title'>{hasFocus ? focusItem!.title : '从事项池挑选一件推进'}</Text>
      <Text className='home-hero-description'>{hasFocus ? '这件事已经开始，继续完成眼前的下一步。' : '没有进行中的事项。选一件真实的事，让行动重新开始。'}</Text>
      <View className='home-hero-actions'>
        <View className='home-action-button primary control-transition' onClick={() => hasFocus ? onOpenFocus(focusItem!.id) : onOpenIdeaPool()}><Text>{hasFocus ? '继续推进' : '查看想试试'}</Text></View>
        <View className='home-action-button secondary control-transition' onClick={onOpenCapture}><Text>快速捕获</Text></View>
      </View>
    </View>
    <View className='home-hero-status'>
      <Text>{hasFocus ? '进行中' : '等待选择'}</Text>
      <Text>{hasFocus ? '一件事足够' : '从真实行动开始'}</Text>
    </View>
  </View>
}
