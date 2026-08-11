import { Text, View } from '@tarojs/components'

export interface HomeGuide {
  id: string
  tag: string
  title: string
  summary: string
  detail: string
  imageUrl: string
}

interface GuideDetailModalProps {
  guide?: HomeGuide
  onClose: () => void
}

export function GuideDetailModal({ guide, onClose }: GuideDetailModalProps) {
  if (!guide) return null

  return <View className='home-guide-modal-backdrop' onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <View className='home-guide-modal' role='dialog' aria-modal='true' aria-label={guide.title}>
      <View className='home-guide-modal-heading'>
        <View><Text className='home-guide-tag'>{guide.tag}</Text><Text className='home-guide-modal-title'>{guide.title}</Text></View>
        <View className='home-guide-modal-close' onClick={onClose}><Text>关闭</Text></View>
      </View>
      <Text className='home-guide-modal-detail'>{guide.detail}</Text>
    </View>
  </View>
}
