import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const flag = readFileSync(new URL('../apps/client/src/pages/index/home-dashboard/home-insight-feature.ts', import.meta.url), 'utf8')
const dashboard = readFileSync(new URL('../apps/client/src/pages/index/home-dashboard/index.tsx', import.meta.url), 'utf8')
const page = readFileSync(new URL('../apps/client/src/pages/index/index.tsx', import.meta.url), 'utf8')
const summaryCard = readFileSync(new URL('../apps/client/src/pages/index/home-dashboard/home-daily-summary-card.tsx', import.meta.url), 'utf8')
const dietCard = readFileSync(new URL('../apps/client/src/pages/index/home-dashboard/home-daily-diet-card.tsx', import.meta.url), 'utf8')

// 两张 AI 分析卡暂时从首页下线：只隐藏与停止自动生成，组件、接口、历史数据都保留。
describe('home insight cards are switched off', () => {
  it('keeps the flag off', () => {
    expect(flag).toContain('export const HOME_INSIGHT_CARDS_ENABLED = false')
  })

  it('hides both cards behind the flag without deleting them', () => {
    expect(dashboard).toContain('{HOME_INSIGHT_CARDS_ENABLED && <View className=\'home-dynamic-row\'>')
    expect(dashboard).toContain('HomeDailySummaryCard')
    expect(dashboard).toContain('HomeDailyDietCard')
    expect(summaryCard).toContain('近期状态小结')
    expect(dietCard).toContain('今日饮食推荐')
  })

  it('skips the daily summary and diet auto-generation calls', () => {
    expect(page).toContain('if (HOME_INSIGHT_CARDS_ENABLED && active && !summary)')
    expect(page).toContain('if (HOME_INSIGHT_CARDS_ENABLED && active && !dietRec)')
  })

  it('keeps the reading code so the cards can be restored', () => {
    expect(page).toContain('getDailySummary(todayLocalDate())')
    expect(page).toContain('getDailyDietRecommendation(todayLocalDate())')
    expect(page).toContain('startMidnightAutoGenerate')
  })
})
