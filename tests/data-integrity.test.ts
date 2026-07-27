import { afterEach, describe, expect, it } from 'vitest'

import { BackupApplicationService, ItemApplicationService, MethodApplicationService, ReviewApplicationService } from '@knowledge-base/application'
import type { BackupDocument } from '@knowledge-base/contracts'
import { createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

  const databases: KnowledgeDatabase[] = []

function createServices() {
  const storage = createIndexedDbRepository(`data-integrity-${crypto.randomUUID()}`)
  databases.push(storage.database)
  return {
    storage,
    items: new ItemApplicationService(storage.repository),
    methods: new MethodApplicationService(storage.methodApplicationRepository),
    reviews: new ReviewApplicationService(storage.reviewRepository, storage.methodRepository, storage.reviewWorkflowRepository),
    backup: new BackupApplicationService(storage.backupRepository),
  }
}

  const reviewFields = {
  actualAction: '完成真实行动', result: '得到结果', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '',
}

async function createMethod(services: ReturnType<typeof createServices>) {
  const item = await services.items.createIdea({ title: '方法来源事项' })
  await services.items.changeStatus(item.id, 'doing')
  const completed = await services.reviews.completeReview({
    itemId: item.id,
    ...reviewFields,
    method: { title: '可信方法', applicable: '适用', steps: '执行步骤' },
  })
  return { item, method: completed.method! }
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('数据可信性与备份恢复修复', () => {
  it('区分未关联、完整关联与三种关联断裂原因', async () => {
    const services = createServices()
    const unassociated = await services.items.createIdea({ title: '无方法事项' })
    expect(await services.methods.getContextResultForItem(unassociated.id)).toEqual({ status: 'no-association' })

    const { method } = await createMethod(services)
    const applied = await services.methods.createItem(method.id, '方法行动')
    expect(await services.methods.getContextResultForItem(applied.id)).toMatchObject({
      status: 'available', application: { methodId: method.id }, method: { id: method.id }, version: { version: 1 },
    })

    await services.storage.database.methods.delete(method.id)
    expect(await services.methods.getContextResultForItem(applied.id)).toMatchObject({
      status: 'unavailable', application: { methodId: method.id }, reason: 'method-missing',
    })

    await services.storage.database.methodVersions.where('methodId').equals(method.id).delete()
    expect(await services.methods.getContextResultForItem(applied.id)).toMatchObject({
      status: 'unavailable', application: { methodId: method.id }, reason: 'method-and-version-missing',
    })

    const separate = await createMethod(services)
    const separatelyApplied = await services.methods.createItem(separate.method.id, '另一方法行动')
    await services.storage.database.methodVersions.where('methodId').equals(separate.method.id).delete()
    expect(await services.methods.getContextResultForItem(separatelyApplied.id)).toMatchObject({
      status: 'unavailable', application: { methodId: separate.method.id }, reason: 'version-missing',
    })
  })

  it('永久清理保留有应用的方法时清空断裂版本来源，并使导出可恢复', async () => {
    const source = createServices()
    const { item, method } = await createMethod(source)
    await source.methods.createItem(method.id, '保留方法的真实应用')
    const review = await source.reviews.getReviewForItem(item.id)
    await source.storage.database.items.update(item.id, { deletedAt: '2000-01-01T00:00:00.000Z' })

    await source.items.listItems()

    expect(await source.storage.database.reviews.get(review!.id)).toBeUndefined()
    expect(await source.storage.database.methodEvidence.where('methodId').equals(method.id).count()).toBe(0)
    const retainedVersions = await source.storage.database.methodVersions.where('methodId').equals(method.id).toArray()
    expect(retainedVersions).toHaveLength(1)
    expect(retainedVersions[0]).toMatchObject({ version: 1 })
    expect(retainedVersions[0]!.sourceReviewId).toBeUndefined()

    const document = await source.backup.createBackup()
    const target = createServices()
    const parsed = target.backup.parseAndValidate(JSON.stringify(document))
    await target.backup.restoreBackup(parsed)
    expect(await target.backup.createBackup()).toMatchObject({ data: document.data })
  })

  it('仅归一化历史备份中断裂的可选版本来源，必填断裂仍拒绝', async () => {
    const source = createServices()
    const { method } = await createMethod(source)
    const document = await source.backup.createBackup()
    const legacy = JSON.parse(JSON.stringify(document)) as BackupDocument
    legacy.data.methodVersions[0]!.sourceReviewId = 'missing-review'

    const target = createServices()
    const parsed = target.backup.parseAndValidate(JSON.stringify(legacy))
    expect(parsed.data.methodVersions[0]!.sourceReviewId).toBeUndefined()
    await target.backup.restoreBackup(parsed)
    const restoredVersion = await target.storage.database.methodVersions.get(parsed.data.methodVersions[0]!.id)
    expect(restoredVersion).toMatchObject({ id: parsed.data.methodVersions[0]!.id })
    expect(restoredVersion!.sourceReviewId).toBeUndefined()

    const brokenEvidence = JSON.parse(JSON.stringify(document)) as BackupDocument
    brokenEvidence.data.methodEvidence[0]!.reviewId = 'missing-review'
    expect(() => target.backup.parseAndValidate(JSON.stringify(brokenEvidence))).toThrow('方法证据引用了不存在的方法或复盘')

    const applied = await source.methods.createItem(method.id, '必填关系行动')
    const appliedDocument = await source.backup.createBackup()
    const brokenApplication = JSON.parse(JSON.stringify(appliedDocument)) as BackupDocument
    brokenApplication.data.methodApplications[0]!.itemId = 'missing-item'
    expect(() => target.backup.parseAndValidate(JSON.stringify(brokenApplication))).toThrow('方法应用引用了不存在的方法或事项')
    expect(applied.id).toBeTruthy()
  })
})
