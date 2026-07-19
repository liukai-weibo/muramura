import { describe, expect, it } from 'vitest'
import { DashboardApplicationService } from '@knowledge-base/application'
import type {
  DashboardRepository,
  DashboardSnapshot,
  Item,
  ItemStatus,
  Method,
  MethodApplication,
  MethodEvidence,
  MethodVersion,
  Review,
} from '@knowledge-base/contracts'

const now = new Date('2026-07-18T12:00:00.000Z')
const recent = '2026-07-16T12:00:00.000Z'
const earlier = '2026-06-28T12:00:00.000Z'
const old = '2026-05-01T12:00:00.000Z'

function item(id: string, status: ItemStatus, createdAt = recent): Item {
  return { id, title: id, content: '', status, createdAt, updatedAt: createdAt }
}

function review(id: string, itemId: string, createdAt = recent): Review {
  return {
    id,
    itemId,
    actualAction: '',
    result: '',
    effective: '',
    incompatible: '',
    reason: '',
    adjustment: '',
    newIdeas: '',
    createdAt,
    updatedAt: createdAt,
  }
}

function method(id: string, createdAt = recent): Method {
  return {
    id,
    title: `方法 ${id}`,
    applicable: '',
    unsuitable: '',
    steps: '',
    validationCount: 1,
    version: 1,
    createdAt,
    updatedAt: createdAt,
  }
}

function evidence(id: string, methodId: string, reviewId: string, createdAt = recent): MethodEvidence {
  return { id, methodId, reviewId, createdAt }
}

function version(id: string, methodId: string, value: number, sourceReviewId: string, createdAt = recent): MethodVersion {
  return {
    id,
    methodId,
    version: value,
    title: `方法 ${methodId}`,
    applicable: '',
    unsuitable: '',
    steps: '',
    sourceReviewId,
    createdAt,
  }
}

function application(id: string, methodId: string, itemId: string, createdAt = recent): MethodApplication {
  return { id, methodId, methodVersion: 1, itemId, createdAt }
}

function service(snapshot: DashboardSnapshot) {
  const repository: DashboardRepository = { getSnapshot: async () => snapshot }
  return new DashboardApplicationService(repository)
}

function snapshot(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    items: [],
    reviews: [],
    methods: [],
    methodEvidence: [],
    methodVersions: [],
    methodApplications: [],
    itemStatusEvents: [],
    ...overrides,
  }
}

describe('Sprint 8 周期复盘仪表盘', () => {
  it('按 7 天、30 天和全部时间准确切换窗口', async () => {
    const dashboard = service(snapshot({
      items: [item('recent', 'idea_to_try', recent), item('earlier', 'doing', earlier), item('old', 'paused', old)],
      reviews: [review('recent-review', 'recent', recent), review('earlier-review', 'earlier', earlier), review('old-review', 'old', old)],
    }))

    expect((await dashboard.getReport('7d', now)).metrics).toMatchObject({ newItems: 1, completedReviews: 1 })
    expect((await dashboard.getReport('30d', now)).metrics).toMatchObject({ newItems: 2, completedReviews: 2 })
    expect((await dashboard.getReport('all', now)).metrics).toMatchObject({ newItems: 3, completedReviews: 3 })
  })

  it('区分首次形成、仅验证和修订方法', async () => {
    const dashboard = service(snapshot({
      methods: [method('formed')],
      methodEvidence: [
        evidence('formation', 'formed', 'formation-review'),
        evidence('validation', 'formed', 'validation-review'),
        evidence('revision', 'formed', 'revision-review'),
      ],
      methodVersions: [
        version('v1', 'formed', 1, 'formation-review'),
        version('v2', 'formed', 2, 'revision-review'),
      ],
    }))

    expect((await dashboard.getReport('7d', now)).metrics).toMatchObject({
      newMethods: 1,
      methodValidations: 1,
      methodRevisions: 1,
    })
  })

  it('当前积压不受时间窗口影响', async () => {
    const dashboard = service(snapshot({
      items: [
        item('try', 'idea_to_try', old),
        item('doing', 'doing', old),
        item('review', 'waiting_review', old),
        item('paused', 'paused', old),
        item('later', 'idea_later', old),
        item('done', 'reviewed', old),
      ],
    }))

    const sevenDays = await dashboard.getReport('7d', now)
    const allTime = await dashboard.getReport('all', now)
    expect(sevenDays.backlog).toEqual({ ideaToTry: 1, doing: 1, waitingReview: 1, paused: 1, ideaLater: 1 })
    expect(sevenDays.backlog).toEqual(allTime.backlog)
  })

  it('展示方法复利、未复盘行动和中性的事实提示', async () => {
    const dashboard = service(snapshot({
      items: [item('reviewed-item', 'reviewed'), item('open-item', 'doing')],
      reviews: [review('completed', 'reviewed-item')],
      methods: [method('alpha'), method('beta')],
      methodEvidence: [
        evidence('a1', 'alpha', 'r1'),
        evidence('a2', 'alpha', 'r2'),
        evidence('b1', 'beta', 'r3'),
      ],
      methodVersions: [version('beta-v2', 'beta', 2, 'r3')],
      methodApplications: [
        application('use-a1', 'alpha', 'reviewed-item'),
        application('use-a2', 'alpha', 'open-item'),
        application('use-b1', 'beta', 'other-item'),
      ],
    }))

    const report = await dashboard.getReport('7d', now)
    expect(report.mostValidated).toMatchObject({ methodId: 'alpha', count: 2 })
    expect(report.mostApplied).toMatchObject({ methodId: 'alpha', count: 2 })
    expect(report.recentlyRevised).toMatchObject({ methodId: 'beta', count: 2 })
    expect(report.unreviewedMethodActions).toBe(2)
    expect(report.facts).toHaveLength(4)
    expect(report.facts.join('')).not.toMatch(/应该|建议/)
  })
})
