import { Text, View } from '@tarojs/components'
import type { DashboardBacklog, ItemStatus } from '@knowledge-base/contracts'

interface HomeWidgetsGridProps {
  backlog?: DashboardBacklog
  onOpenBacklog: (status: ItemStatus) => void
}

export function HomeWidgetsGrid({ backlog, onOpenBacklog }: HomeWidgetsGridProps) {
  const ideaToTry = backlog?.ideaToTry ?? 0
  const doing = backlog?.doing ?? 0
  const waitingReview = backlog?.waitingReview ?? 0
  const widgets: Array<{ label: string; value: number; description: string; status: ItemStatus }> = [
    { label: '当前行动', value: doing, description: '正在推进的事项', status: 'doing' },
    { label: '待处理', value: ideaToTry + doing, description: '想试试与进行中', status: 'idea_to_try' },
    { label: '待复盘', value: waitingReview, description: '等待事实复盘', status: 'waiting_review' },
  ]

  return <View className='home-widgets-section' aria-label='行动概览'>
    {widgets.map((widget) => <View key={widget.label} className='home-widget card-transition' onClick={() => onOpenBacklog(widget.status)}>
      <Text className='home-widget-label'>{widget.label}</Text>
      <Text className='home-widget-value'>{widget.value}</Text>
      <Text className='home-widget-description'>{widget.description}</Text>
    </View>)}
  </View>
}
