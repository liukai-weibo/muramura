import { View } from '@tarojs/components'
import type { DashboardBacklog, DailySummary, DailyDietRecommendation, Item, ItemStatus } from '@knowledge-base/contracts'
import { HomeHeroBanner } from './home-hero-banner'
import { HomeDailyNoteCard } from './home-daily-note-card'
import { HomeMoodCard } from './home-mood-card'
import { HomeMealCard } from './home-meal-card'
import { HomeDailySummaryCard } from './home-daily-summary-card'
import { HomeDailyDietCard } from './home-daily-diet-card'
import './home-dashboard.scss'

interface HomeDashboardProps {
  items: Item[]
  backlog?: DashboardBacklog
  onOpenItem: (itemId: string) => void
  onOpenBacklog: (status: ItemStatus) => void
  onOpenCapture: () => void
  onOpenDailyNotes: () => void
  onOpenMoodCreate: () => void
  onOpenMeals: () => void
  onOpenDailySummary: () => void
  onOpenDailyDiet: () => void
  dailySummary?: DailySummary
  dailySummaryLoading?: boolean
  dailyDiet?: DailyDietRecommendation
  dailyDietLoading?: boolean
}

export function HomeDashboard({ items, onOpenItem, onOpenBacklog, onOpenCapture, onOpenDailyNotes, onOpenMoodCreate, onOpenMeals, onOpenDailySummary, onOpenDailyDiet, dailySummary, dailySummaryLoading, dailyDiet, dailyDietLoading }: HomeDashboardProps) {
  const focusItem = items.filter((item) => item.status === 'doing' && !item.deletedAt).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]

  return <View className='home-dashboard'>
    <View className='home-primary-row'>
      <HomeDailyNoteCard onOpenDailyNotes={onOpenDailyNotes} />
      <HomeHeroBanner focusItem={focusItem} onOpenFocus={onOpenItem} onOpenIdeaPool={() => onOpenBacklog('idea_to_try')} onOpenCapture={onOpenCapture} />
    </View>
    <View className='home-checkin-row'>
      <HomeMoodCard onOpenMoodCreate={onOpenMoodCreate} />
      <HomeMealCard onOpenMeals={onOpenMeals} />
    </View>
    <View className='home-dynamic-row'>
      <HomeDailySummaryCard summary={dailySummary} loading={dailySummaryLoading} onOpen={onOpenDailySummary} />
      <HomeDailyDietCard recommendation={dailyDiet} loading={dailyDietLoading} onOpen={onOpenDailyDiet} />
    </View>
  </View>
}
