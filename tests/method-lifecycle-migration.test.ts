import { afterEach, describe, expect, it } from 'vitest'

import { Dexie, createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

const databases: KnowledgeDatabase[] = []

const v6Schema = {
  items: 'id, status, createdAt, updatedAt, deletedAt',
  reviews: 'id, &itemId, createdAt, updatedAt',
  methods: 'id, createdAt, updatedAt',
  methodEvidence: 'id, methodId, reviewId, [methodId+reviewId]',
  methodVersions: 'id, methodId, version, [methodId+version], sourceReviewId',
  methodApplications: 'id, methodId, methodVersion, &itemId, [methodId+methodVersion]',
  itemLinks: 'id, sourceReviewId, targetItemId, type',
  itemStatusEvents: 'id, itemId, fromStatus, toStatus, createdAt, [itemId+createdAt]',
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('方法生命周期 v7 迁移', () => {
  it('仅回填可由唯一版本来源可靠证明的形成与修订，其余历史证据降级为 unknown', async () => {
    const databaseName = `method-lifecycle-migration-${crypto.randomUUID()}`
    const legacy = new Dexie(databaseName)
    legacy.version(6).stores(v6Schema)
    await legacy.open()

    await legacy.table('methodEvidence').bulkAdd([
      { id: 'formation', methodId: 'method-a', reviewId: 'review-v1', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'revision', methodId: 'method-a', reviewId: 'review-v2', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'validation', methodId: 'method-a', reviewId: 'review-validation', createdAt: '2026-01-03T00:00:00.000Z' },
      { id: 'duplicate-source', methodId: 'method-b', reviewId: 'review-duplicate', createdAt: '2026-01-04T00:00:00.000Z' },
      { id: 'broken-source', methodId: 'method-c', reviewId: 'review-unmatched', createdAt: '2026-01-05T00:00:00.000Z' },
    ])
    await legacy.table('methodVersions').bulkAdd([
      { id: 'a-v1', methodId: 'method-a', version: 1, title: 'A', applicable: '场景', unsuitable: '', steps: '步骤', sourceReviewId: 'review-v1', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'a-v2', methodId: 'method-a', version: 2, title: 'A', applicable: '场景', unsuitable: '', steps: '步骤', sourceReviewId: 'review-v2', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'b-v1', methodId: 'method-b', version: 1, title: 'B', applicable: '场景', unsuitable: '', steps: '步骤', sourceReviewId: 'review-duplicate', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b-v2', methodId: 'method-b', version: 2, title: 'B', applicable: '场景', unsuitable: '', steps: '步骤', sourceReviewId: 'review-duplicate', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'c-v1', methodId: 'method-c', version: 1, title: 'C', applicable: '场景', unsuitable: '', steps: '步骤', sourceReviewId: 'review-other', createdAt: '2026-01-01T00:00:00.000Z' },
    ])
    legacy.close()

    const storage = createIndexedDbRepository(databaseName)
    databases.push(storage.database)
    await storage.database.open()

    expect(await storage.database.methodEvidence.get('formation')).toMatchObject({ relation: 'formation', methodVersion: 1 })
    expect(await storage.database.methodEvidence.get('revision')).toMatchObject({ relation: 'revision', methodVersion: 2 })
    for (const id of ['validation', 'duplicate-source', 'broken-source']) {
      const evidence = await storage.database.methodEvidence.get(id)
      expect(evidence).toMatchObject({ relation: 'unknown' })
      expect(evidence?.methodVersion).toBeUndefined()
    }
    expect(await storage.database.methodVersions.count()).toBe(5)
    expect(await storage.database.methodEvidence.count()).toBe(5)
  })
})
