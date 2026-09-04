import { afterEach, describe, expect, it, vi } from 'vitest'

import { ItemApplicationService, ReviewApplicationService } from '@knowledge-base/application'
import { createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

  const databases: KnowledgeDatabase[] = []

function services() {
  const storage = createIndexedDbRepository(`item-consistency-${crypto.randomUUID()}`)
  databases.push(storage.database)
  return {
    storage,
    items: new ItemApplicationService(storage.repository),
    reviews: new ReviewApplicationService(storage.reviewRepository, storage.methodRepository, storage.reviewWorkflowRepository),
  }
}

  const reviewFields = { actualAction: '行动', result: '结果', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '' }

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('Item Repository 并发读改写一致性', () => {
  it('内容保存与进行中事项并发后保留双方字段，事件来自最新状态', async () => {
    const s = services()
    const item = await s.items.createIdea({ title: '并发事项' })

    const [content, transitioned] = await Promise.all([
      s.items.updateItemContent(item.id, '已保存说明'),
      s.items.createIdea({ title: '并发事项二号' }),
    ])
    const finalItem = await s.items.getItem(item.id)
    const events = await s.items.listStatusEvents(item.id)

    expect(content.content).toBe('已保存说明')
    expect(transitioned.title).toBe('并发事项二号')
    expect(finalItem).toMatchObject({ status: 'doing', content: '已保存说明' })
    expect(events).toEqual([
      expect.objectContaining({ toStatus: 'idea_to_try' }),
      expect.objectContaining({ fromStatus: 'idea_to_try', toStatus: 'doing' }),
    ])
  })

  it('删除与内容保存交错时不丢失已提交内容；已删除后的保存稳定拒绝', async () => {
    const s = services()
    const item = await s.items.createIdea({ title: '删除交错' })
    await s.items.updateItemContent(item.id, '删除前已保存')
    await s.items.deleteItem(item.id)

    const deleted = await s.storage.database.items.get(item.id)
    expect(deleted).toMatchObject({ content: '删除前已保存' })
    expect(deleted?.deletedAt).toBeTruthy()
    const events = await s.items.listStatusEvents(item.id)
    await expect(s.items.updateItemContent(item.id, '不应写入')).rejects.toThrow('事项不存在')
    expect(await s.storage.database.items.get(item.id)).toEqual(deleted)
    expect(await s.items.listStatusEvents(item.id)).toEqual(events)
  })

  it('恢复仅移除 deletedAt，保留最新内容与状态且不创建状态事件', async () => {
    const s = services()
    const item = await s.items.createIdea({ title: '恢复交错' })
    await s.items.updateItemContent(item.id, '最新说明')
    await s.items.changeStatus(item.id, 'doing')
    await s.items.deleteItem(item.id)
    const events = await s.items.listStatusEvents(item.id)

    const restored = await s.items.restoreItem(item.id)
    expect(restored).toMatchObject({ content: '最新说明', status: 'doing' })
    expect(restored.deletedAt).toBeUndefined()
    expect(await s.items.listStatusEvents(item.id)).toEqual(events)
  })

  it('状态事件写入失败时状态回滚；Item 写入失败时不写事件', async () => {
    const s = services()
    const eventFailure = await s.items.createIdea({ title: '事件失败' })
    const eventAdd = vi.spyOn(s.storage.database.itemStatusEvents, 'add').mockRejectedValueOnce(new Error('事件写入失败'))
    await expect(s.items.changeStatus(eventFailure.id, 'doing')).rejects.toThrow('事件写入失败')
    expect((await s.storage.database.items.get(eventFailure.id))?.status).toBe('idea_to_try')
    expect(await s.items.listStatusEvents(eventFailure.id)).toHaveLength(1)
    eventAdd.mockRestore()

    const itemFailure = await s.items.createIdea({ title: '事项失败' })
    const itemPut = vi.spyOn(s.storage.database.items, 'put').mockRejectedValueOnce(new Error('事项写入失败'))
    await expect(s.items.changeStatus(itemFailure.id, 'doing')).rejects.toThrow('事项写入失败')
    expect(await s.items.listStatusEvents(itemFailure.id)).toHaveLength(1)
    itemPut.mockRestore()
  })

  it('completeReview 内嵌状态迁移继续与复盘写入保持全有或全无', async () => {
    const s = services()
    const item = await s.items.createIdea({ title: '嵌套事务' })
    await s.items.changeStatus(item.id, 'doing')
  const add = vi.spyOn(s.storage.database.itemStatusEvents, 'add').mockRejectedValueOnce(new Error('完成状态事件失败'))

    await expect(s.reviews.completeReview({ itemId: item.id, ...reviewFields })).rejects.toThrow('完成状态事件失败')
    expect(await s.storage.database.reviews.where('itemId').equals(item.id).count()).toBe(0)
    expect((await s.storage.database.items.get(item.id))?.status).toBe('doing')
    add.mockRestore()
  })
})
