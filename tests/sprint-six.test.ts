import { afterEach, describe, expect, it } from 'vitest'
import { BackupApplicationService, ItemApplicationService, MethodApplicationService, ReviewApplicationService } from '@knowledge-base/application'
import type { BackupDocument } from '@knowledge-base/contracts'
import { Dexie, createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

  const databases: KnowledgeDatabase[] = []

function createServices() {
  const storage = createIndexedDbRepository(`sprint-six-${crypto.randomUUID()}`)
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
  actualAction: '完成一次真实行动', result: '得到可验证结果', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '',
}

async function createMethod(services: ReturnType<typeof createServices>) {
  const item = await services.items.createIdea({ title: '形成方法' })
  await services.items.changeStatus(item.id, 'doing')
  return services.reviews.completeReview({
    itemId: item.id,
    ...reviewFields,
    method: { title: '行动方法 v1', applicable: '普通场景', steps: '执行第一版步骤' },
  })
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('Sprint 6 方法复用与行动验证', () => {
  it('从方法创建想试试事项，并冻结当时的方法版本', async () => {
    const services = createServices()
    const formed = await createMethod(services)

    const item = await services.methods.createItem(formed.method!.id, '真实使用方法', '记录本次场景')
    const context = await services.methods.getContextForItem(item.id)

    expect(item).toMatchObject({ title: '真实使用方法', content: '记录本次场景', status: 'idea_to_try' })
    expect(context).toMatchObject({
      application: { methodId: formed.method!.id, methodVersion: 1, itemId: item.id },
      method: { id: formed.method!.id },
      version: { version: 1, title: '行动方法 v1', steps: '执行第一版步骤' },
    })
  })

  it('方法后续修订不会污染事项实际使用的历史版本', async () => {
    const services = createServices()
    const formed = await createMethod(services)
    const appliedItem = await services.methods.createItem(formed.method!.id, '使用第一版')
    const revisionItem = await services.items.createIdea({ title: '修订方法' })
    await services.reviews.completeReview({
      itemId: revisionItem.id,
      ...reviewFields,
      existingMethod: {
        methodId: formed.method!.id,
        revision: { title: '行动方法 v2', applicable: '扩展场景', steps: '执行第二版步骤' },
      },
    })

    const context = await services.methods.getContextForItem(appliedItem.id)
    expect(context).toMatchObject({
      application: { methodVersion: 1 },
      method: { version: 2, title: '行动方法 v2' },
      version: { version: 1, title: '行动方法 v1', steps: '执行第一版步骤' },
    })
  })

  it('方法不存在或事项创建失败时不留下半成品关系', async () => {
    const services = createServices()
    await expect(services.methods.createItem('missing-method', '无效行动')).rejects.toThrow('方法不存在')
    expect(await services.storage.database.items.count()).toBe(0)
    expect(await services.storage.database.methodApplications.count()).toBe(0)

    const formed = await createMethod(services)
    await expect(services.methods.createItem(formed.method!.id, '')).rejects.toThrow('标题不能为空')
    expect(await services.storage.database.methodApplications.count()).toBe(0)
  })

  it('v4 数据库升级后创建空的方法应用表且重开不改变数据', async () => {
    const databaseName = `sprint-six-migration-${crypto.randomUUID()}`
    const legacy = new Dexie(databaseName)
    legacy.version(4).stores({
      items: 'id, status, createdAt, updatedAt, deletedAt',
      reviews: 'id, &itemId, createdAt, updatedAt',
      methods: 'id, createdAt, updatedAt',
      methodEvidence: 'id, methodId, reviewId, [methodId+reviewId]',
      methodVersions: 'id, methodId, version, [methodId+version], sourceReviewId',
      itemLinks: 'id, sourceReviewId, targetItemId, type',
    })
    await legacy.open()
    legacy.close()

    const storage = createIndexedDbRepository(databaseName)
    databases.push(storage.database)
    await storage.database.open()
    expect(await storage.database.methodApplications.count()).toBe(0)
    storage.database.close()
    await storage.database.open()
    expect(await storage.database.methodApplications.count()).toBe(0)
  })

  it('备份保留方法应用，旧备份缺表时补空，断裂版本引用会拒绝', async () => {
    const source = createServices()
    const formed = await createMethod(source)
    const item = await source.methods.createItem(formed.method!.id, '备份方法应用')
    const document = await source.backup.createBackup()
    expect(document.data.methodApplications).toEqual([
      expect.objectContaining({ methodId: formed.method!.id, methodVersion: 1, itemId: item.id }),
    ])

    const target = createServices()
    const parsed = target.backup.parseAndValidate(JSON.stringify(document))
    await target.backup.restoreBackup(parsed)
    expect(await target.methods.getContextForItem(item.id)).toMatchObject({ application: { methodVersion: 1 } })

    const legacy = JSON.parse(JSON.stringify(document)) as Record<string, any>
    delete legacy.data.methodApplications
    expect(target.backup.parseAndValidate(JSON.stringify(legacy)).data.methodApplications).toEqual([])

    const broken = JSON.parse(JSON.stringify(document)) as BackupDocument
    broken.data.methodApplications[0]!.methodVersion = 99
    expect(() => target.backup.parseAndValidate(JSON.stringify(broken))).toThrow('方法应用引用了不存在的方法版本')
  })
})
