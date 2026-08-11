import { Image, Text, View } from '@tarojs/components'
import { useState } from 'react'
import type { DisplayEffectMode } from '../display-effect-preference'
import { GuideDetailModal, type HomeGuide } from './guide-detail-modal'

const guides: HomeGuide[] = [
  {
    id: 'start', tag: '启动 SOP', title: '把行动缩小到现在能开始的一步', summary: '不要求完整计划，只确定下一步真实动作。',
    detail: '先选择一件想推进的事项，再把它缩小为十分钟内可以开始的动作。完成后再决定下一步，而不是在开始前设计完整计划。',
    imageUrl: new URL('../../../assets/home/guides/cat-playful-stretch.png', import.meta.url).href,
  },
  {
    id: 'breakdown', tag: '项目拆解', title: '先找可验证的最小动作', summary: '用执行与复盘校准方向，不制造额外管理负担。',
    detail: '面对复杂事项时，只拆到下一次可以执行和验证的动作。真正的阻力、结果和新线索，应该在行动之后通过复盘进入系统。',
    imageUrl: new URL('../../../assets/home/guides/cat-belly-up.png', import.meta.url).href,
  },
  {
    id: 'energy', tag: '精力管理', title: '记录真实阻力，而不是追加标签', summary: '让复盘保存可用证据，帮助下一次行动。',
    detail: '精力变化、阻力和有效做法都应作为一次行动复盘中的真实证据。只有反复出现的事实，才值得形成或修订方法。',
    imageUrl: new URL('../../../assets/home/guides/cat-curled-sleep.png', import.meta.url).href,
  },
]

interface HomeGuidesGridProps {
  displayEffectMode: DisplayEffectMode
}

export function HomeGuidesGrid({ displayEffectMode }: HomeGuidesGridProps) {
  const [selectedGuide, setSelectedGuide] = useState<HomeGuide>()

  return <View className='home-guides-section'>
    <View className='home-section-heading'><Text>系统心法与行动指南</Text><Text>三条行动提示</Text></View>
    <View className='home-guides-grid'>
      {guides.map((guide) => <View key={guide.id} className={`home-guide-card card-transition ${displayEffectMode === 'glass' ? 'soft-glass' : 'soft-glass-fallback'}`} onClick={() => setSelectedGuide(guide)}>
        <View className='home-guide-visual'><Image className='home-guide-cat-image' src={guide.imageUrl} mode='aspectFit' /></View>
        <View className='home-guide-content'><Text className='home-guide-tag'>{guide.tag}</Text><Text className='home-guide-title'>{guide.title}</Text><Text className='home-guide-summary'>{guide.summary}</Text></View>
      </View>)}
    </View>
    <GuideDetailModal guide={selectedGuide} onClose={() => setSelectedGuide(undefined)} />
  </View>
}
