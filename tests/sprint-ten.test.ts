import { describe, expect, it } from 'vitest'
import { DashboardApplicationService } from '@knowledge-base/application'
import type { DashboardRepository, DashboardSnapshot, ItemStatusEvent } from '@knowledge-base/contracts'

const recent = '2026-07-16T12:00:00.000Z'
const old = '2026-05-01T12:00:00.000Z'
const now = new Date('2026-07-18T12:00:00.000Z')

function createService(snapshot: DashboardSnapshot) {
  const repository: DashboardRepository = { getSnapshot: async () => snapshot }
  return new DashboardApplicationService(repository)
}

const events: ItemStatusEvent[] = [
  { id: 'baseline', itemId: 'recent-item', toStatus: 'idea_to_try', createdAt: recent },
  { id: 'start', itemId: 'recent-item', fromStatus: 'idea_to_try', toStatus: 'doing', createdAt: recent },
]

const snapshot: DashboardSnapshot = {
  items: [
    { id: 'recent-item', title: '近期事项', content: '', status: 'reviewed', createdAt: recent, updatedAt: recent },
    { id: 'old-item', title: '旧事项', content: '', status: 'idea_to_try', createdAt: old, updatedAt: old },
  ],
  reviews: [{
    id: 'review', itemId: 'recent-item', actualAction: '执行', result: '完成', effective: '', incompatible: '',
    reason: '', adjustment: '', newIdeas: '', createdAt: recent, updatedAt: recent,
  }],
  methods: [{
    id: 'method', title: '近期方法', applicable: '当前场景', unsuitable: '', steps: '执行', validationCount: 2,
    version: 2, createdAt: recent, updatedAt: recent,
  }],
  methodEvidence: [
    { id: 'formation', methodId: 'method', reviewId: 'formation-review', createdAt: recent },
    { id: 'validation', methodId: 'method', reviewId: 'review', createdAt: recent },
    { id: 'revision', methodId: 'method', reviewId: 'revision-review', createdAt: recent },
  ],
  methodVersions: [
    { id: 'v1', methodId: 'method', version: 1, title: '近期方法', applicable: '', unsuitable: '', steps: '', sourceReviewId: 'formation-review', createdAt: recent },
    { id: 'v2', methodId: 'method', version: 2, title: '近期方法', applicable: '', unsuitable: '', steps: '', sourceReviewId: 'revision-review', createdAt: recent },
  ],
  methodApplications: [{ id: 'application', methodId: 'method', methodVersion: 2, itemId: 'recent-item', createdAt: recent }],
  itemStatusEvents: events,
}

describe('Sprint 10 仪表盘下钻记录', () => {
  it('每项指标数量与下钻记录数一致并携带定位目标', async () => {
    const report = await createService(snapshot).getReport('7d', now)

    expect(report.metricRecords.newItems).toEqual([
      expect.objectContaining({ title: '近期事项', itemId: 'recent-item' }),
    ])
    expect(report.metricRecords.startedExecutions).toEqual([
      expect.objectContaining({ id: 'start', itemId: 'recent-item' }),
    ])
    expect(report.metricRecords.completedReviews[0]).toMatchObject({ itemId: 'recent-item' })
    expect(report.metricRecords.newMethods[0]).toMatchObject({ methodId: 'method' })
    expect(report.metricRecords.methodValidations[0]).toMatchObject({ id: 'validation', itemId: 'recent-item', methodId: 'method' })
    expect(report.metricRecords.methodRevisions[0]).toMatchObject({ methodId: 'method', detail: '修订至 v2' })
    expect(report.metricRecords.methodApplications[0]).toMatchObject({ itemId: 'recent-item', methodId: 'method' })

    for (const key of Object.keys(report.metrics) as Array<keyof typeof report.metrics>) {
      expect(report.metricRecords[key]).toHaveLength(report.metrics[key])
    }
  })

  it('时间窗口同步过滤数字和下钻记录', async () => {
    const dashboard = createService(snapshot)
    const sevenDays = await dashboard.getReport('7d', now)
    const allTime = await dashboard.getReport('all', now)

    expect(sevenDays.metrics.newItems).toBe(1)
    expect(sevenDays.metricRecords.newItems.map((record) => record.itemId)).toEqual(['recent-item'])
    expect(allTime.metrics.newItems).toBe(2)
    expect(allTime.metricRecords.newItems.map((record) => record.itemId)).toEqual(['recent-item', 'old-item'])
  })
})
