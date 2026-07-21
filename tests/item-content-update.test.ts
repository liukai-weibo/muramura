import { afterEach, describe, expect, it } from 'vitest'

import { BackupApplicationService, ItemApplicationService, MethodApplicationService, ReviewApplicationService } from '@knowledge-base/application'
import { createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

const databases: KnowledgeDatabase[] = []

function services() {
  const storage = createIndexedDbRepository(`item-content-${crypto.randomUUID()}`)
  databases.push(storage.database)
  return {
    storage,
    items: new ItemApplicationService(storage.repository),
    applications: new MethodApplicationService(storage.methodApplicationRepository),
    reviews: new ReviewApplicationService(storage.reviewRepository, storage.methodRepository, storage.reviewWorkflowRepository),
    backup: new BackupApplicationService(storage.backupRepository),
  }
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('事项补充说明', () => {
  it('更新未删除事项的 content 与 updatedAt，允许显式清空且不创建状态事件', async () => {
    const s = services()
    const item = await s.items.createIdea({ title: '事项', content: '初始说明' })
    const beforeEvents = await s.storage.database.itemStatusEvents.where('itemId').equals(item.id).toArray()
    const updated = await s.items.updateItemContent(item.id, '  新说明  ')

    expect(updated).toMatchObject({ id: item.id, title: item.title, status: 'idea_to_try', createdAt: item.createdAt, content: '新说明' })
    expect(updated.updatedAt >= item.updatedAt).toBe(true)
    expect(await s.storage.database.itemStatusEvents.where('itemId').equals(item.id).toArray()).toEqual(beforeEvents)

    const cleared = await s.items.updateItemContent(item.id, '   ')
    expect(cleared.content).toBe('')
    expect(cleared.title).toBe(item.title)
    expect(cleared.status).toBe(item.status)
    expect(cleared.createdAt).toBe(item.createdAt)
    expect(await s.storage.database.itemStatusEvents.where('itemId').equals(item.id).toArray()).toEqual(beforeEvents)
  })

  it('八种未删除状态均可保存非空和空内容，且只改变 content 与 updatedAt', async () => {
    const s = services()
    for (const status of ['idea_to_try', 'idea_later', 'doing', 'paused', 'waiting_review', 'reviewed', 'archived_no_review', 'abandoned'] as const) {
      const item = await s.storage.repository.create({ title: status, content: '原说明', status })
      const events = await s.storage.database.itemStatusEvents.where('itemId').equals(item.id).toArray()
      const updated = await s.items.updateItemContent(item.id, `  ${status} 新说明  `)
      expect(updated).toMatchObject({ id: item.id, title: item.title, status, content: `${status} 新说明`, createdAt: item.createdAt })
      expect(updated.updatedAt >= item.updatedAt).toBe(true)
      expect(await s.storage.database.itemStatusEvents.where('itemId').equals(item.id).toArray()).toEqual(events)

      const cleared = await s.items.updateItemContent(item.id, '  ')
      expect(cleared).toMatchObject({ id: item.id, title: item.title, status, content: '', createdAt: item.createdAt })
      expect(await s.storage.database.itemStatusEvents.where('itemId').equals(item.id).toArray()).toEqual(events)
    }
  })

  it('不存在或回收站事项均拒绝且不改变原事实', async () => {
    const s = services()
    await expect(s.items.updateItemContent('missing', '说明')).rejects.toThrow('事项不存在')

    const deleted = await s.items.createIdea({ title: '已删除', content: '原说明' })
    await s.items.deleteItem(deleted.id)
    const deletedEvents = await s.storage.database.itemStatusEvents.where('itemId').equals(deleted.id).toArray()
    await expect(s.items.updateItemContent(deleted.id, '说明')).rejects.toThrow('事项不存在')
    expect(await s.storage.database.items.get(deleted.id)).toMatchObject({ id: deleted.id, deletedAt: expect.any(String), content: '原说明' })
    expect(await s.storage.database.itemStatusEvents.where('itemId').equals(deleted.id).toArray()).toEqual(deletedEvents)
  })

  it('历史状态更新背景不污染复盘、方法证据、方法应用或状态历史', async () => {
    const s = services()
    const source = await s.items.createIdea({ title: '形成方法' })
    await s.items.changeStatus(source.id, 'doing')
    await s.items.changeStatus(source.id, 'waiting_review')
    const formed = await s.reviews.completeReview({
      itemId: source.id,
      actualAction: '行动', result: '结果', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '',
      method: { title: '方法', applicable: '场景', steps: '步骤' },
    })
    const applied = await s.applications.createItem(formed.method!.id, '历史应用')
    await s.items.changeStatus(applied.id, 'doing')
    await s.items.changeStatus(applied.id, 'waiting_review')
    await s.reviews.completeReview({ itemId: applied.id, actualAction: '行动', result: '结果', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '', existingMethod: { methodId: formed.method!.id } })

    const [review, evidence, application, events] = await Promise.all([
      s.storage.database.reviews.where('itemId').equals(applied.id).first(),
      s.storage.database.methodEvidence.where('methodId').equals(formed.method!.id).toArray(),
      s.storage.database.methodApplications.where('itemId').equals(applied.id).first(),
      s.items.listStatusEvents(applied.id),
    ])
    const updated = await s.items.updateItemContent(applied.id, '已完成事项的背景补充')

    expect(updated).toMatchObject({ status: 'reviewed', content: '已完成事项的背景补充' })
    expect(await s.storage.database.reviews.where('itemId').equals(applied.id).first()).toEqual(review)
    expect(await s.storage.database.methodEvidence.where('methodId').equals(formed.method!.id).toArray()).toEqual(evidence)
    expect(await s.storage.database.methodApplications.where('itemId').equals(applied.id).first()).toEqual(application)
    expect(await s.items.listStatusEvents(applied.id)).toEqual(events)
  })

  it('更新内容会进入备份恢复与搜索，清空后旧内容不再命中', async () => {
    const s = services()
    const item = await s.items.createIdea({ title: '事项' })
    const updated = await s.items.updateItemContent(item.id, '唯一补充关键词')
    expect(await s.storage.searchRepository.search('唯一补充关键词')).toEqual([expect.objectContaining({ itemId: item.id })])

    const document = await s.backup.createBackup()
    const target = services()
    await target.backup.restoreBackup(target.backup.parseAndValidate(JSON.stringify(document)))
    expect(await target.items.getItem(item.id)).toEqual(updated)

    await s.items.updateItemContent(item.id, '')
    expect(await s.storage.searchRepository.search('唯一补充关键词')).toEqual([])
  })
})
