import { View } from '@tarojs/components'
import type { DashboardBacklog, Item, ItemStatus } from '@knowledge-base/contracts'
import { HomeHeroBanner } from './home-hero-banner'
import { HomeDailyNoteCard } from './home-daily-note-card'
import './home-dashboard.scss'

interface HomeDashboardProps {
  items: Item[]
  backlog?: DashboardBacklog
  onOpenItem: (itemId: string) => void
  onOpenBacklog: (status: ItemStatus) => void
  onOpenCapture: () => void
  onOpenDailyNotes: () => void
}

export function HomeDashboard({ items, onOpenItem, onOpenBacklog, onOpenCapture, onOpenDailyNotes }: HomeDashboardProps) {
  const focusItem = items.filter((item) => item.status === 'doing' && !item.deletedAt).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]

  return <View className='home-dashboard'>
    <View className='home-primary-row'>
      <HomeDailyNoteCard onOpenDailyNotes={onOpenDailyNotes} />
      <HomeHeroBanner focusItem={focusItem} onOpenFocus={onOpenItem} onOpenIdeaPool={() => onOpenBacklog('idea_to_try')} onOpenCapture={onOpenCapture} />
    </View>
  </View>
}
