import { afterEach, describe, expect, it } from 'vitest'
import { BackupApplicationService, ItemApplicationService, ReviewApplicationService } from '@knowledge-base/application'
import type { Item, Method, MethodEvidence, Review } from '@knowledge-base/contracts'
import { Dexie, createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

const databases: KnowledgeDatabase[] = []

function createServices() {
  const storage = createIndexedDbRepository(`sprint-four-${crypto.randomUUID()}`)
  databases.push(storage.database)
  return {
    storage,
    items: new ItemApplicationService(storage.repository),
    reviews: new ReviewApplicationService(
      storage.reviewRepository,
      storage.methodRepository,
      storage.reviewWorkflowRepository,
    ),
    backup: new BackupApplicationService(storage.backupRepository),
  }
}

const reviewFields = {
  actualAction: '按计划执行了一次真实实验',
  result: '得到一条可以用于判断方法的结果',
  effective: '步骤顺序有效',
  incompatible: '',
  reason: '启动条件明确',
  adjustment: '',
  newIdeas: '',
}

async function createWaitingReviewItem(services: ReturnType<typeof createServices>, title: string) {
  const item = await services.items.createIdea({ title })
  await services.items.changeStatus(item.id, 'doing')
  return services.items.changeStatus(item.id, 'waiting_review')
}

async function createInitialMethod(services: ReturnType<typeof createServices>) {
  const item = await createWaitingReviewItem(services, '形成初始方法')
  return services.reviews.completeReview({
    itemId: item.id,
    ...reviewFields,
    method: {
      title: '稳定启动方法',
      applicable: '普通工作日',
      unsuitable: '身体不适时',
      steps: '清理桌面 → 执行二十五分钟 → 记录结果',
    },
  })
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('Sprint 4 方法迭代与证据链', () => {
  it('首次形成方法时创建 v1 快照和真实复盘证据', async () => {
    const services = createServices()
    const result = await createInitialMethod(services)
    const method = result.method!

    expect(method).toMatchObject({ version: 1, validationCount: 1 })
    expect(await services.reviews.listMethodVersions(method.id)).toEqual([
      expect.objectContaining({
        methodId: method.id,
        version: 1,
        title: '稳定启动方法',
        sourceReviewId: result.review.id,
      }),
    ])
    expect(await services.storage.database.methodEvidence.where('methodId').equals(method.id).toArray()).toEqual([
      expect.objectContaining({ methodId: method.id, reviewId: result.review.id }),
    ])
  })

  it('仅验证时增加验证次数和证据，但不升级版本或新增快照', async () => {
    const services = createServices()
    const initial = await createInitialMethod(services)
    const item = await createWaitingReviewItem(services, '再次验证已有方法')

    const validated = await services.reviews.completeReview({
      itemId: item.id,
      ...reviewFields,
      existingMethod: { methodId: initial.method!.id },
    })

    expect(validated.method).toMatchObject({ version: 1, validationCount: 2 })
    expect(await services.reviews.listMethodVersions(initial.method!.id)).toHaveLength(1)
    expect(await services.storage.database.methodEvidence.where('methodId').equals(initial.method!.id).count()).toBe(2)
  })

  it('修订时升级版本、保留旧内容并用本次复盘生成新快照', async () => {
    const services = createServices()
    const initial = await createInitialMethod(services)
    const item = await createWaitingReviewItem(services, '根据新证据修订方法')

    const revised = await services.reviews.completeReview({
      itemId: item.id,
      ...reviewFields,
      existingMethod: {
        methodId: initial.method!.id,
        revision: {
          title: '稳定启动方法',
          applicable: '普通工作日或低能量时',
          unsuitable: '身体不适时',
          steps: '清理桌面 → 先做五分钟 → 延长至二十五分钟 → 记录结果',
        },
      },
    })
    const versions = await services.reviews.listMethodVersions(initial.method!.id)

    expect(revised.method).toMatchObject({ version: 2, validationCount: 2, steps: expect.stringContaining('先做五分钟') })
    expect(versions.map((version) => version.version)).toEqual([1, 2])
    expect(versions[0]).toMatchObject({ version: 1, steps: '清理桌面 → 执行二十五分钟 → 记录结果' })
    expect(versions[1]).toMatchObject({ version: 2, sourceReviewId: revised.review.id, steps: expect.stringContaining('先做五分钟') })
    expect(await services.storage.database.methodEvidence.where('methodId').equals(initial.method!.id).count()).toBe(2)
  })

  it('验证不存在的方法失败时原子回滚复盘并保留待复盘状态', async () => {
    const services = createServices()
    const item = await createWaitingReviewItem(services, '验证事务原子性')

    await expect(services.reviews.completeReview({
      itemId: item.id,
      ...reviewFields,
      existingMethod: { methodId: 'missing-method' },
    })).rejects.toThrow('方法不存在')

    expect(await services.storage.database.reviews.where('itemId').equals(item.id).count()).toBe(0)
    expect(await services.storage.database.items.get(item.id)).toMatchObject({ status: 'waiting_review' })
    expect(await services.storage.database.methodEvidence.count()).toBe(0)
  })

  it('从 v3 升级时为已有方法补建一次当前版本快照且重开不重复', async () => {
    const databaseName = `sprint-four-migration-${crypto.randomUUID()}`
    const legacy = new Dexie(databaseName)
    legacy.version(3).stores({
      items: 'id, status, createdAt, updatedAt, deletedAt',
      reviews: 'id, &itemId, createdAt, updatedAt',
      methods: 'id, createdAt, updatedAt',
      methodEvidence: 'id, methodId, reviewId, [methodId+reviewId]',
      itemLinks: 'id, sourceReviewId, targetItemId, type',
    })
    const timestamp = '2026-07-01T08:00:00.000Z'
    const item: Item = { id: 'item-1', title: '历史事项', content: '', status: 'reviewed', createdAt: timestamp, updatedAt: timestamp }
    const review: Review = {
      id: 'review-1', itemId: item.id, actualAction: '执行历史实验', result: '得到历史结果',
      effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '', createdAt: timestamp, updatedAt: timestamp,
    }
    const method: Method = {
      id: 'method-1', title: '历史方法', applicable: '历史场景', unsuitable: '', steps: '历史步骤',
      validationCount: 3, version: 2, createdAt: timestamp, updatedAt: timestamp,
    }
    const evidence: MethodEvidence = { id: 'evidence-1', methodId: method.id, reviewId: review.id, createdAt: timestamp }

    await legacy.open()
    await legacy.table<Item, string>('items').add(item)
    await legacy.table<Review, string>('reviews').add(review)
    await legacy.table<Method, string>('methods').add(method)
    await legacy.table<MethodEvidence, string>('methodEvidence').add(evidence)
    legacy.close()

    const storage = createIndexedDbRepository(databaseName)
    databases.push(storage.database)
    await storage.database.open()
    expect(await storage.database.methodVersions.toArray()).toEqual([
      expect.objectContaining({ methodId: method.id, version: 2, title: method.title, sourceReviewId: review.id, createdAt: timestamp }),
    ])

    storage.database.close()
    await storage.database.open()
    expect(await storage.database.methodVersions.where('methodId').equals(method.id).count()).toBe(1)
  })

  it('新备份保留版本历史，旧备份缺少版本表时可自动补建并恢复', async () => {
    const source = createServices()
    const initial = await createInitialMethod(source)
    const revisionItem = await createWaitingReviewItem(source, '为备份创建方法修订')
    await source.reviews.completeReview({
      itemId: revisionItem.id,
      ...reviewFields,
      existingMethod: {
        methodId: initial.method!.id,
        revision: {
          title: '稳定启动方法 v2', applicable: '更多场景', unsuitable: '', steps: '先做五分钟 → 继续执行',
        },
      },
    })
    const document = await source.backup.createBackup()
    expect(document.data.methodVersions.map((version) => version.version).sort()).toEqual([1, 2])

    const legacyDocument = JSON.parse(JSON.stringify(document)) as Record<string, any>
    delete legacyDocument.data.methodVersions
    const target = createServices()
    const parsed = target.backup.parseAndValidate(JSON.stringify(legacyDocument))
    expect(parsed.data.methodVersions).toEqual([
      expect.objectContaining({ methodId: initial.method!.id, version: 2, title: '稳定启动方法 v2' }),
    ])
    await target.backup.restoreBackup(parsed)
    expect(await target.reviews.listMethodVersions(initial.method!.id)).toHaveLength(1)

    const broken = JSON.parse(JSON.stringify(document)) as Record<string, any>
    broken.data.methodVersions[0].methodId = 'missing-method'
    expect(() => target.backup.parseAndValidate(JSON.stringify(broken))).toThrow('方法版本引用了不存在的方法或复盘')
  })
})
