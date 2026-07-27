import { afterEach, describe, expect, it } from 'vitest'

import { ItemApplicationService, MethodApplicationService, ReviewApplicationService } from '@knowledge-base/application'
import { createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

  const databases: KnowledgeDatabase[] = []
  const fields = { actualAction: '行动', result: '结果', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '' }

function services() {
  const storage = createIndexedDbRepository(`item-method-source-${crypto.randomUUID()}`)
  databases.push(storage.database)
  return {
    storage,
    items: new ItemApplicationService(storage.repository),
    applications: new MethodApplicationService(storage.methodApplicationRepository),
    reviews: new ReviewApplicationService(storage.reviewRepository, storage.methodRepository, storage.reviewWorkflowRepository),
  }
}

async function formMethod(s: ReturnType<typeof services>) {
  const item = await s.items.createIdea({ title: '方法来源' })
  await s.items.changeStatus(item.id, 'doing')
  return s.reviews.completeReview({ itemId: item.id, ...fields, method: { title: '可信方法', applicable: '场景', steps: '步骤' } })
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('事项池方法来源批量展示读模型', () => {
  it('批量返回无关联、可用、回收站、墓碑与各类断裂关联的可信展示', async () => {
    const s = services()
    const none = await s.items.createIdea({ title: '无关联' })
    const formed = await formMethod(s)
    const available = await s.applications.createItem(formed.method!.id, '可用关联')

    const trashMethod = await formMethod(s)
    const inTrash = await s.applications.createItem(trashMethod.method!.id, '回收站关联')
    await s.storage.methodRepository.moveToTrash(trashMethod.method!.id)

    const purgedMethod = await formMethod(s)
    const purged = await s.applications.createItem(purgedMethod.method!.id, '墓碑关联')
    await s.storage.methodRepository.moveToTrash(purgedMethod.method!.id)
    await s.storage.database.methods.update(purgedMethod.method!.id, { deletedAt: '2000-01-01T00:00:00.000Z' })
    await s.storage.methodRepository.purgeDeletedBefore('2000-01-02T00:00:00.000Z')

    const methodMissing = await formMethod(s)
    const versionTitle = await s.applications.createItem(methodMissing.method!.id, '版本可读')
    await s.storage.database.methods.delete(methodMissing.method!.id)

    const versionMissing = await formMethod(s)
    const methodTitle = await s.applications.createItem(versionMissing.method!.id, '方法可读')
    await s.storage.database.methodVersions.where('methodId').equals(versionMissing.method!.id).delete()

    const unavailable = await formMethod(s)
    const noTitle = await s.applications.createItem(unavailable.method!.id, '双缺失')
    await s.storage.database.methods.delete(unavailable.method!.id)
    await s.storage.database.methodVersions.where('methodId').equals(unavailable.method!.id).delete()

    const ids = [none.id, available.id, inTrash.id, purged.id, versionTitle.id, methodTitle.id, noTitle.id, none.id, '', 'missing-item']
    const result = await s.applications.listSourceDisplaysForItems(ids)

    expect(result).toEqual([
      { status: 'no-association', itemId: none.id },
      { status: 'available', itemId: available.id, title: '可信方法' },
      { status: 'method-in-trash', itemId: inTrash.id, title: '可信方法' },
      { status: 'method-purged', itemId: purged.id, title: '可信方法' },
      { status: 'unavailable', itemId: versionTitle.id, title: '可信方法' },
      { status: 'unavailable', itemId: methodTitle.id, title: '可信方法' },
      { status: 'unavailable', itemId: noTitle.id },
      { status: 'no-association', itemId: 'missing-item' },
    ])
  })

  it('查询不改写任何关联、方法、版本、墓碑或事项事实', async () => {
    const s = services()
    const formed = await formMethod(s)
    const item = await s.applications.createItem(formed.method!.id, '只读关联')
    const before = await Promise.all([
      s.storage.database.items.get(item.id),
      s.storage.database.methodApplications.where('itemId').equals(item.id).first(),
      s.storage.database.methods.get(formed.method!.id),
      s.storage.database.methodVersions.where('methodId').equals(formed.method!.id).toArray(),
      s.storage.database.methodTombstones.get(formed.method!.id),
    ])

    await s.applications.listSourceDisplaysForItems([item.id])

    expect(await Promise.all([
      s.storage.database.items.get(item.id),
      s.storage.database.methodApplications.where('itemId').equals(item.id).first(),
      s.storage.database.methods.get(formed.method!.id),
      s.storage.database.methodVersions.where('methodId').equals(formed.method!.id).toArray(),
      s.storage.database.methodTombstones.get(formed.method!.id),
    ])).toEqual(before)
  })
})
