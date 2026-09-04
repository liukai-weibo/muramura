import { afterEach, describe, expect, it, vi } from 'vitest'

import { BackupApplicationService, ItemApplicationService, MethodApplicationService, ReviewApplicationService } from '@knowledge-base/application'
import type { BackupDocument } from '@knowledge-base/contracts'
import { createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

  const databases: KnowledgeDatabase[] = []
function services() {
  const storage = createIndexedDbRepository(`method-lifecycle-${crypto.randomUUID()}`)
  databases.push(storage.database)
  return {
    storage,
    items: new ItemApplicationService(storage.repository),
    applications: new MethodApplicationService(storage.methodApplicationRepository),
    reviews: new ReviewApplicationService(storage.reviewRepository, storage.methodRepository, storage.reviewWorkflowRepository),
    backup: new BackupApplicationService(storage.backupRepository),
  }
}
  const fields = { actualAction: '行动', result: '结果', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '' }
async function formMethod(s: ReturnType<typeof services>) {
  const item = await s.items.createIdea({ title: '来源' })
  return s.reviews.completeReview({ itemId: item.id, ...fields, method: { title: '方法', applicable: '场景', steps: '步骤' } })
}
afterEach(async () => { await Promise.all(databases.map((database) => database.delete())); databases.length = 0 })

describe('方法生命周期数据层', () => {
  it('回收站方法不可复用，恢复后关系与版本保持可用', async () => {
    const s = services(); const formed = await formMethod(s); const method = formed.method!
    const applied = await s.applications.createItem(method.id, '使用方法')
    await s.storage.methodRepository.moveToTrash(method.id)
    expect(await s.reviews.listMethods()).toEqual([])
    expect(await s.applications.getContextResultForItem(applied.id)).toMatchObject({ status: 'method-in-trash', method: { id: method.id } })
    await expect(s.applications.createItem(method.id, '不可复用')).rejects.toThrow('方法不存在')
    await s.storage.methodRepository.restore(method.id)
    expect(await s.applications.getContextResultForItem(applied.id)).toMatchObject({ status: 'available', version: { version: 1 } })
  })

  it('到期清理创建最小墓碑、保留证据应用且历史读取为 method-purged', async () => {
    const s = services(); const formed = await formMethod(s); const method = formed.method!
    const applied = await s.applications.createItem(method.id, '历史使用')
    await s.storage.methodRepository.moveToTrash(method.id)
    await s.storage.database.methods.update(method.id, { deletedAt: '2000-01-01T00:00:00.000Z' })
    await s.storage.methodRepository.purgeDeletedBefore('2000-01-02T00:00:00.000Z')
    expect(await s.storage.database.methods.get(method.id)).toBeUndefined()
    expect(await s.storage.database.methodVersions.where('methodId').equals(method.id).count()).toBe(0)
    expect(await s.storage.database.methodEvidence.where('methodId').equals(method.id).count()).toBe(1)
    expect(await s.storage.database.methodTombstones.get(method.id)).toEqual(expect.objectContaining({ methodId: method.id, title: method.title, versions: [{ version: 1 }] }))
    expect(await s.applications.getContextResultForItem(applied.id)).toMatchObject({ status: 'method-purged', tombstone: { methodId: method.id } })
  })
  it('版本映射无法证明历史应用时，永久清理整体回滚', async () => {
    const s = services(); const formed = await formMethod(s); const method = formed.method!
    const applied = await s.applications.createItem(method.id, '历史使用')
    await s.storage.database.methodApplications.update((await s.storage.database.methodApplications.where('itemId').equals(applied.id).first())!.id, { methodVersion: 99 })
    await s.storage.methodRepository.moveToTrash(method.id)
    await s.storage.database.methods.update(method.id, { deletedAt: '2000-01-01T00:00:00.000Z' })

    await expect(s.storage.methodRepository.purgeDeletedBefore('2000-01-02T00:00:00.000Z')).rejects.toThrow('无法证明的历史版本')
    expect(await s.storage.database.methods.get(method.id)).toBeDefined()
    expect(await s.storage.database.methodVersions.where('methodId').equals(method.id).count()).toBe(1)
    expect(await s.storage.database.methodTombstones.get(method.id)).toBeUndefined()
    expect(await s.storage.database.methodEvidence.where('methodId').equals(method.id).count()).toBe(1)
    expect(await s.storage.database.methodApplications.where('itemId').equals(applied.id).count()).toBe(1)
  })

  it('墓碑写入失败时，永久清理多表事务整体回滚', async () => {
    const s = services(); const formed = await formMethod(s); const method = formed.method!
    await s.storage.methodRepository.moveToTrash(method.id)
    await s.storage.database.methods.update(method.id, { deletedAt: '2000-01-01T00:00:00.000Z' })
    const put = vi.spyOn(s.storage.database.methodTombstones, 'put').mockRejectedValueOnce(new Error('模拟墓碑写入失败'))

    await expect(s.storage.methodRepository.purgeDeletedBefore('2000-01-02T00:00:00.000Z')).rejects.toThrow('模拟墓碑写入失败')
    expect(await s.storage.database.methods.get(method.id)).toBeDefined()
    expect(await s.storage.database.methodVersions.where('methodId').equals(method.id).count()).toBe(1)
    expect(await s.storage.database.methodTombstones.get(method.id)).toBeUndefined()
    expect(await s.storage.database.methodEvidence.where('methodId').equals(method.id).count()).toBe(1)
    put.mockRestore()
  })

  it('事项清理仅在方法墓碑失去最后一条证据和应用引用后回收', async () => {
    const s = services(); const formed = await formMethod(s); const method = formed.method!
    const applied = await s.applications.createItem(method.id, '历史使用')
    await s.storage.methodRepository.moveToTrash(method.id)
    await s.storage.database.methods.update(method.id, { deletedAt: '2000-01-01T00:00:00.000Z' })
    await s.storage.methodRepository.purgeDeletedBefore('2000-01-02T00:00:00.000Z')

    const sourceItem = await s.storage.database.items.get((await s.storage.database.reviews.toCollection().first())!.itemId)
    await s.storage.database.items.update(sourceItem!.id, { deletedAt: '2000-01-01T00:00:00.000Z' })
    await s.storage.repository.purgeDeletedBefore('2000-01-02T00:00:00.000Z')
    expect(await s.storage.database.methodTombstones.get(method.id)).toBeDefined()

    await s.storage.database.items.update(applied.id, { deletedAt: '2000-01-01T00:00:00.000Z' })
    await s.storage.repository.purgeDeletedBefore('2000-01-02T00:00:00.000Z')
    expect(await s.storage.database.methodTombstones.get(method.id)).toBeUndefined()
  })

  it('v2 可恢复，v1 缺少墓碑集合可兼容，墓碑应用版本断裂被拒绝', async () => {
    const s = services(); const formed = await formMethod(s); const method = formed.method!
    const applied = await s.applications.createItem(method.id, '历史使用')
    const v1Document = await s.backup.createBackup()
    await s.storage.methodRepository.moveToTrash(method.id)
    await s.storage.database.methods.update(method.id, { deletedAt: '2000-01-01T00:00:00.000Z' })
    await s.storage.methodRepository.purgeDeletedBefore('2000-01-02T00:00:00.000Z')
    const document = await s.backup.createBackup()
    expect(document.version).toBe(2)
    const target = services(); const parsed = target.backup.parseAndValidate(JSON.stringify(document)); await target.backup.restoreBackup(parsed)
    expect(await target.applications.getContextResultForItem(applied.id)).toMatchObject({ status: 'method-purged' })
    const legacy = JSON.parse(JSON.stringify(v1Document)) as BackupDocument
    legacy.version = 1; delete (legacy.data as { methodTombstones?: unknown }).methodTombstones
    expect(target.backup.parseAndValidate(JSON.stringify(legacy)).data.methodTombstones).toEqual([])
    const broken = JSON.parse(JSON.stringify(document)) as BackupDocument
    const tombstones = broken.data.methodTombstones ?? []
    tombstones[0]!.versions = []
    broken.data = { ...broken.data, methodTombstones: tombstones }
    expect(() => target.backup.parseAndValidate(JSON.stringify(broken))).toThrow('方法应用引用了不存在的方法版本')
  })
})
