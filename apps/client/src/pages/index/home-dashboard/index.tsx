import { Text, View } from '@tarojs/components'
import type { DashboardBacklog, DailySummary, DailyDietRecommendation, HomeAiCard, Item, ItemStatus } from '@knowledge-base/contracts'
import { HomeHeroBanner } from './home-hero-banner'
import { HomeDailyNoteCard } from './home-daily-note-card'
import { HomeMoodCard } from './home-mood-card'
import { HomeMealCard } from './home-meal-card'
import { HomeDailySummaryCard } from './home-daily-summary-card'
import { HomeDailyDietCard } from './home-daily-diet-card'
import { HomeAiCardView } from '../features/home-ai-card/home-ai-card-view'
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
  homeAiCards?: HomeAiCard[]
  homeAiCardPreviews?: Record<string, string>
  homeAiCardLoading?: boolean
  homeAiCardFailed?: boolean
  onOpenHomeAiCard: (card: HomeAiCard) => void
  onEditHomeAiCard: (card: HomeAiCard) => void
  onAddHomeAiCard: () => void
}

export function HomeDashboard({ items, onOpenItem, onOpenBacklog, onOpenCapture, onOpenDailyNotes, onOpenMoodCreate, onOpenMeals, onOpenDailySummary, onOpenDailyDiet, dailySummary, dailySummaryLoading, dailyDiet, dailyDietLoading, homeAiCards = [], homeAiCardPreviews = {}, homeAiCardLoading = false, homeAiCardFailed = false, onOpenHomeAiCard, onEditHomeAiCard, onAddHomeAiCard }: HomeDashboardProps) {
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
    <View className='home-custom-ai-row'>
      {homeAiCards.filter(card => !card.isHidden).map(card => (
        <HomeAiCardView
          key={card.id}
          card={card}
          preview={homeAiCardPreviews[card.id]}
          loading={homeAiCardLoading}
          failed={homeAiCardFailed && !homeAiCardPreviews[card.id]}
          onOpen={() => onOpenHomeAiCard(card)}
          onEdit={() => onEditHomeAiCard(card)}
        />
      ))}
      <View className='home-ai-card-add' role='button' aria-label='新增自定义AI卡片' onClick={onAddHomeAiCard}>
        <Text className='home-ai-card-add-text'>➕ 新增自定义AI卡片</Text>
      </View>
    </View>
  </View>
}