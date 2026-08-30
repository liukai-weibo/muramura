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
      moodEntries: [{ entryDate: '2026-08-24', moodLevel: 4, content: '今天心情不错', createdAt: '2026-08-24T05:10:00.000Z' }],
      mealEntries: [{ entryDate: '2026-08-23', mealType: 'lunch', content: '牛肉面', feeling: 4, createdAt: '2026-08-23T04:05:00.000Z' }],
      dashboard: { metrics: { newItems: 0, startedExecutions: 0, completedReviews: 0, newMethods: 0, methodValidations: 0, methodRevisions: 0, methodApplications: 0 }, backlog: { ideaToTry: 0, doing: 0, waitingReview: 0, paused: 0, ideaLater: 0 }, unreviewedMethodActions: 0, facts: [] },
    } as AiKnowledgeOverview
    const context = formatKnowledgeContext(overview, '', undefined, [], 24000, [], 'UTC')
    expect(context).toContain('Mood entries (all available dates, date is authoritative)')
    expect(context).toContain('- 2026-08-24 05:10 | level 4 | 今天心情不错')
    expect(context).toContain('- 2026-08-23 04:05 | 午餐 | 牛肉面 | feeling 4')
  })
})

describe('ai context item ordering', () => {
  it('orders injected items doing-first then by updatedAt desc', () => {
    const overview = {
      profile: { username: 'u', roles: ['member'], createdAt: '2026-01-01T00:00:00.000Z' },
      itemStatusCounts: { doing: 2, reviewed: 2 },
      items: [
        { id: '1', title: '旧-已复盘', content: '', status: 'reviewed', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
        { id: '2', title: '新-已复盘', content: '', status: 'reviewed', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' },
        { id: '3', title: '进行中-早期', content: '', status: 'doing', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' },
        { id: '4', title: '进行中-近期', content: '', status: 'doing', createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z' },
        { id: '5', title: '历史-以后再说', content: '', status: 'idea_later', createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z' },
      ],
      explorations: [],
      reviews: [],
      methods: [],
      moodEntries: [],
      mealEntries: [],
      trash: [],
      dashboard: { metrics: {}, backlog: { ideaToTry: 0, doing: 0, waitingReview: 0, paused: 0, ideaLater: 0 }, unreviewedMethodActions: 0, facts: [] },
    } as any
    const out = formatKnowledgeContext(overview, '', undefined, [], 100000)
    const itemsSection = out.split('Items (cite by title')[1] ?? ''
    const idxDoingRecent = itemsSection.indexOf('进行中-近期')
    const idxDoingEarly = itemsSection.indexOf('进行中-早期')
    const idxReviewedNew = itemsSection.indexOf('新-已复盘')
    const idxReviewedOld = itemsSection.indexOf('旧-已复盘')
    const idxLater = itemsSection.indexOf('历史-以后再说')
    expect(idxDoingRecent).toBeGreaterThanOrEqual(0)
    // doing group comes before non-doing group
    const firstNonDoing = Math.min(idxReviewedNew, idxReviewedOld, idxLater)
    expect(Math.min(idxDoingRecent, idxDoingEarly)).toBeLessThan(firstNonDoing)
    // within doing: updatedAt desc
    expect(idxDoingRecent).toBeLessThan(idxDoingEarly)
    // within non-doing: later(08-24) -> 新(08-20) -> 旧(08-01) desc
    expect(idxLater).toBeLessThan(idxReviewedNew)
    expect(idxReviewedNew).toBeLessThan(idxReviewedOld)
  })
})

describe('ai context ROI grouping signals', () => {
  it('groups items by exploration track with track return signals and item signals', () => {
    const overview = {
      profile: { username: 'u', roles: ['member'], createdAt: '2026-01-01T00:00:00.000Z' },
      itemStatusCounts: { doing: 2, reviewed: 1 },
      items: [
        { id: 'i1', title: '主线A-进行中', content: '', status: 'doing', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z', explorationTrackId: 'ta', lastDoingAt: '2026-08-25T00:00:00.000Z', recentDoingCount30d: 3, lastReviewedAt: undefined },
        { id: 'i2', title: '主线A-已复盘', content: '', status: 'reviewed', createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', explorationTrackId: 'ta', lastDoingAt: '2026-08-20T00:00:00.000Z', recentDoingCount30d: 1, lastReviewedAt: '2026-08-24T00:00:00.000Z' },
        { id: 'i3', title: '散项-进行中', content: '', status: 'doing', createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z', lastDoingAt: '2026-08-27T00:00:00.000Z', recentDoingCount30d: 2, lastReviewedAt: undefined },
        { id: 'i4', title: '主线B-今日新增', content: '', status: 'doing', createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z', explorationTrackId: 'tb', lastDoingAt: '2026-08-28T00:00:00.000Z', recentDoingCount30d: 1, lastReviewedAt: undefined },
      ],
      explorations: [
        { id: 'ta', name: '主线A', itemCount: 2, doingCount: 1, recentActivityCount30d: 4, lastActivityAt: '2026-08-25T00:00:00.000Z', reviewedCount30d: 1, derivedMethodCount: 2 },
        { id: 'tb', name: '主线B', itemCount: 1, doingCount: 1, recentActivityCount30d: 1, lastActivityAt: '2026-08-28T00:00:00.000Z', reviewedCount30d: 0, derivedMethodCount: 0 },
      ],
      reviews: [],
      methods: [],
      moodEntries: [],
      mealEntries: [],
      trash: [],
      dashboard: { metrics: {}, backlog: { ideaToTry: 0, doing: 0, waitingReview: 0, paused: 0, ideaLater: 0 }, unreviewedMethodActions: 0, facts: [] },
    } as any
    const out = formatKnowledgeContext(overview, '', undefined, [], 100000)
    const trackSection = out.split('Exploration tracks and their last-30-day return signals')[1] ?? ''
    const itemsSection = out.split('(grouped by exploration track)')[1] ?? ''
    // track return signals present
    expect(trackSection).toContain('主线A')
    expect(trackSection).toContain('近30天执行=4')
    expect(trackSection).toContain('近30天复盘=1')
    expect(trackSection).toContain('派生方法应用=2')
    expect(trackSection).toContain('主线B')
    // items grouped: 主线A before 散项 group; each item carries signals
    const idxA = itemsSection.indexOf('主线A')
    const idxNone = itemsSection.indexOf('无主线')
    expect(idxA).toBeGreaterThanOrEqual(0)
    expect(idxNone).toBeGreaterThan(idxA)
    expect(itemsSection).toContain('lastDoing=2026-08-25T00:00:00.000Z | 近30天执行=3')
    expect(itemsSection).toContain('lastReviewed=2026-08-24T00:00:00.000Z')
    expect(itemsSection).toContain('散项-进行中')
    // 主线B group also present
    expect(itemsSection).toContain('主线B')
  })
})
