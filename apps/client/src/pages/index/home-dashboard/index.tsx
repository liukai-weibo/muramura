import { View } from '@tarojs/components'
import type { DashboardBacklog, Item, ItemStatus } from '@knowledge-base/contracts'
import type { DisplayEffectMode } from '../display-effect-preference'
import { HomeGuidesGrid } from './home-guides-grid'
import { HomeHeroBanner } from './home-hero-banner'
import { HomeWidgetsGrid } from './home-widgets-grid'
import './home-dashboard.scss'

interface HomeDashboardProps {
  items: Item[]
  backlog?: DashboardBacklog
  onOpenItem: (itemId: string) => void
  onOpenBacklog: (status: ItemStatus) => void
  onOpenCapture: () => void
  displayEffectMode: DisplayEffectMode
}

export function HomeDashboard({ items, backlog, onOpenItem, onOpenBacklog, onOpenCapture, displayEffectMode }: HomeDashboardProps) {
  const focusItem = items.filter((item) => item.status === 'doing' && !item.deletedAt).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]

  return <View className='home-dashboard'>
    <HomeHeroBanner focusItem={focusItem} onOpenFocus={onOpenItem} onOpenIdeaPool={() => onOpenBacklog('idea_to_try')} onOpenCapture={onOpenCapture} />
    <HomeWidgetsGrid backlog={backlog} onOpenBacklog={onOpenBacklog} />
    <HomeGuidesGrid displayEffectMode={displayEffectMode} />
  </View>
}
