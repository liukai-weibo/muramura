import { afterEach, describe, expect, it } from 'vitest'

import { BackupApplicationService, ItemApplicationService, MethodApplicationService, ReviewApplicationService } from '@knowledge-base/application'
import { IndexedDbItemRepository, createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

const databases: KnowledgeDatabase[] = []
const reviewFields = { actualAction: '行动', result: '结果', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '' }

function services() {
  const storage = createIndexedDbRepository(`purge-restore-${crypto.randomUUID()}`)
  databases.push(storage.database)
  return {
    storage,
    items: new ItemApplicationService(storage.repository),
    applications: new MethodApplicationService(storage.methodApplicationRepository),
    reviews: new ReviewApplicationService(storage.reviewRepository, storage.methodRepository, storage.reviewWorkflowRepository),
    backup: new BackupApplicationService(storage.backupRepository),
  }
}

async function createMethod(s: ReturnType<typeof services>) {
  const source = await s.items.createIdea({ title: '方法来源' })
  await s.items.changeStatus(source.id, 'doing')
  await s.items.changeStatus(source.id, 'waiting_review')
  return s.reviews.completeReview({ itemId: source.id, ...reviewFields, method: { title: '方法', applicable: '场景', steps: '步骤' } })
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('事项永久清理与恢复交错', () => {
  it('恢复在 purge 进入事务前提交时，事务内重检不会清理已恢复事项及其关联', async () => {
    const s = services()
    const formed = await createMethod(s)
    const item = await s.applications.createItem(formed.method!.id, '待恢复的历史应用')
    await s.items.changeStatus(item.id, 'doing')
    await s.items.changeStatus(item.id, 'waiting_review')
    await s.reviews.completeReview({ itemId: item.id, ...reviewFields })
    await s.items.deleteItem(item.id)
    await s.storage.database.items.update(item.id, { deletedAt: '2000-01-01T00:00:00.000Z' })

    const eventsBefore = await s.items.listStatusEvents(item.id)
    const reviewBefore = await s.storage.database.reviews.where('itemId').equals(item.id).first()
    const applicationBefore = await s.storage.database.methodApplications.where('itemId').equals(item.id).first()
    let releasePurge!: () => void
    const purgeGate = new Promise<void>((resolve) => { releasePurge = resolve })
    let signalPurgePaused!: () => void
    const purgePaused = new Promise<void>((resolve) => { signalPurgePaused = resolve })
    const repository = new IndexedDbItemRepository(s.storage.database, {
      beforePurgeTransaction: async () => {
        signalPurgePaused()
        await purgeGate
      },
    })

    const purge = repository.purgeDeletedBefore('2000-01-02T00:00:00.000Z')
    await purgePaused
    const restored = await s.items.restoreItem(item.id)
    releasePurge()
    await purge

    expect(restored.deletedAt).toBeUndefined()
    const surviving = await s.storage.database.items.get(item.id)
    expect(surviving).toMatchObject({ id: item.id })
    expect(surviving?.deletedAt).toBeUndefined()
    expect(await s.storage.database.reviews.where('itemId').equals(item.id).first()).toEqual(reviewBefore)
    expect(await s.storage.database.methodApplications.where('itemId').equals(item.id).first()).toEqual(applicationBefore)
    expect(await s.items.listStatusEvents(item.id)).toEqual(eventsBefore)

    const backup = await s.backup.createBackup()
    const target = services()
    await target.backup.restoreBackup(target.backup.parseAndValidate(JSON.stringify(backup)))
    const restoredItem = await target.storage.database.items.get(item.id)
    expect(restoredItem).toMatchObject({ id: item.id })
    expect(restoredItem?.deletedAt).toBeUndefined()
    expect(await target.storage.database.reviews.where('itemId').equals(item.id).first()).toEqual(reviewBefore)
    expect(await target.storage.database.methodApplications.where('itemId').equals(item.id).first()).toEqual(applicationBefore)
  })
})
