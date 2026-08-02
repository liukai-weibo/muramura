import { describe, expect, it } from 'vitest'
import {
  buildDashboardReport,
  parseAndValidateBackup,
  sortTrashEntries,
} from '@knowledge-base/application'
import type { DashboardSnapshot, TrashEntry } from '@knowledge-base/contracts'
import { normalizeExplorationTrackName } from '@knowledge-base/domain'

const timestamp = '2026-08-02T00:00:00.000Z'

describe('Application 可直接测试的规则函数', () => {
  it('使用唯一 Domain 规则规范化探索主线名称', () => {
    expect(normalizeExplorationTrackName('  Ａ计划  ')).toEqual({
      name: 'A计划',
      normalizedName: 'a计划',
    })
    expect(() => normalizeExplorationTrackName('   ')).toThrowError(expect.objectContaining({
      code: 'EXPLORATION_TRACK_NAME_REQUIRED',
    }))
    expect(() => normalizeExplorationTrackName('a'.repeat(81))).toThrowError(expect.objectContaining({
      code: 'EXPLORATION_TRACK_NAME_TOO_LONG',
    }))
  })

  it('不依赖 Repository 即可解析旧备份并固定补齐 ID', () => {
    const ids = ['status-event-1']
    const parsed = parseAndValidateBackup(JSON.stringify({
      format: 'knowledge-base-backup',
      version: 1,
      exportedAt: timestamp,
      appVersion: 'test',
      data: {
        items: [{ id: 'item-1', title: '事项', content: '', status: 'idea_to_try', createdAt: timestamp, updatedAt: timestamp }],
        reviews: [],
        methods: [],
        methodEvidence: [],
        itemLinks: [],
      },
    }), () => ids.shift()!)

    expect(parsed.version).toBe(2)
    expect(parsed.data.itemStatusEvents).toEqual([{
      id: 'status-event-1',
      itemId: 'item-1',
      toStatus: 'idea_to_try',
      createdAt: timestamp,
    }])
  })

  it('不实例化 Service 即可验证统一回收站排序', () => {
    const entries: TrashEntry[] = [
      { type: 'method', id: 'method-b', title: 'B', deletedAt: timestamp },
      { type: 'item', id: 'item-b', title: 'B', deletedAt: timestamp },
      { type: 'item', id: 'item-a', title: 'A', deletedAt: timestamp },
      { type: 'exploration-track', id: 'track-new', title: '新', deletedAt: '2026-08-03T00:00:00.000Z' },
    ]

    expect(sortTrashEntries(entries).map(({ id }) => id)).toEqual([
      'track-new',
      'item-a',
      'item-b',
      'method-b',
    ])
    expect(entries[0]?.id).toBe('method-b')
  })

  it('不依赖 DashboardRepository 即可计算空快照报告', () => {
    const snapshot: DashboardSnapshot = {
      items: [],
      reviews: [],
      methods: [],
      methodEvidence: [],
      methodVersions: [],
      methodApplications: [],
      itemStatusEvents: [],
    }

    expect(buildDashboardReport(snapshot, '7d', new Date(timestamp))).toMatchObject({
      window: '7d',
      metrics: {
        newItems: 0,
        startedExecutions: 0,
        completedReviews: 0,
        newMethods: 0,
        methodValidations: 0,
        methodRevisions: 0,
        methodApplications: 0,
      },
      backlog: {
        ideaToTry: 0,
        doing: 0,
        waitingReview: 0,
        paused: 0,
        ideaLater: 0,
      },
      unreviewedMethodActions: 0,
    })
  })
})
