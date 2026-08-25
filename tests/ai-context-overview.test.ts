import { describe, expect, it } from 'vitest'
import { AiKnowledgeOverviewApplicationService, formatKnowledgeContext } from '../packages/application/src/ai-context'
import type { AiKnowledgeOverview, AuthUser } from '@knowledge-base/contracts'

const user: AuthUser = { id: 'user-1', username: 'tester', roles: ['member'] as any, createdAt: '2026-01-01T00:00:00.000Z' }

function dashboardStub() {
  return {
    async getSnapshot() {
      return { items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [] }
    },
    async getReport() {
      return { window: 'all', metrics: { newItems: 0, startedExecutions: 0, completedReviews: 0, newMethods: 0, methodValidations: 0, methodRevisions: 0, methodApplications: 0 }, metricRecords: {}, backlog: { ideaToTry: 0, doing: 0, waitingReview: 0, paused: 0, ideaLater: 0 }, unreviewedMethodActions: 0, facts: [] }
    },
  }
}

function explorationsStub() {
  return {
    async listActiveExplorationTracks() { return [] },
    async listDeletedExplorationTracks() { return [] },
  }
}

function moodStub(rows: Array<{ entryDate: string; moodLevel: number; content: string }>) {
  return { async listRange() { return rows } }
}

function mealStub(rows: Array<{ entryDate: string; mealType: string; content: string; feeling: number }>) {
  return { async listRange() { return rows } }
}

describe('ai knowledge overview includes mood/meal/daily summaries', () => {
  it('reads all-dates mood, meal and daily summaries into overview', async () => {
    const service = new AiKnowledgeOverviewApplicationService(
      dashboardStub() as any, explorationsStub() as any, undefined, undefined,
      moodStub([{ entryDate: '2026-08-24', moodLevel: 4, content: '今天心情不错' }]) as any,
      mealStub([{ entryDate: '2026-08-23', mealType: 'lunch', content: '牛肉面', feeling: 4 }]) as any,
    )
    const overview = await service.read(user)
    expect(overview.moodEntries).toMatchObject([{ entryDate: '2026-08-24', moodLevel: 4, content: '今天心情不错' }])
    expect(overview.mealEntries).toMatchObject([{ entryDate: '2026-08-23', mealType: 'lunch', content: '牛肉面', feeling: 4 }])
  })

  it('drops mood/meal/summary sections when repositories are absent', async () => {
    const service = new AiKnowledgeOverviewApplicationService(dashboardStub() as any, explorationsStub() as any)
    const overview = await service.read(user)
    expect(overview.moodEntries).toEqual([])
    expect(overview.mealEntries).toEqual([])
    const context = formatKnowledgeContext(overview, '', undefined, [], 24000)
    expect(context).not.toContain('Mood entries')
    expect(context).not.toContain('Meal entries')
  })

  it('formats mood/meal/daily summary sections with dates', async () => {
    const overview = {
      profile: { username: 'tester', roles: ['member'] as any, createdAt: '2026-01-01T00:00:00.000Z' },
      itemStatusCounts: {},
      items: [], explorations: [], reviews: [], methods: [],
      moodEntries: [{ entryDate: '2026-08-24', moodLevel: 4, content: '今天心情不错' }],
      mealEntries: [{ entryDate: '2026-08-23', mealType: 'lunch', content: '牛肉面', feeling: 4 }],
      dashboard: { metrics: { newItems: 0, startedExecutions: 0, completedReviews: 0, newMethods: 0, methodValidations: 0, methodRevisions: 0, methodApplications: 0 }, backlog: { ideaToTry: 0, doing: 0, waitingReview: 0, paused: 0, ideaLater: 0 }, unreviewedMethodActions: 0, facts: [] },
    } as AiKnowledgeOverview
    const context = formatKnowledgeContext(overview, '', undefined, [], 24000)
    expect(context).toContain('Mood entries (all available dates, date is authoritative)')
    expect(context).toContain('- 2026-08-24 | level 4 | 今天心情不错')
    expect(context).toContain('- 2026-08-23 | 午餐 | 牛肉面 | feeling 4')
  })
})
