import { afterEach, describe, expect, it, vi } from 'vitest'

import { BackupApplicationService, ItemApplicationService, MethodApplicationService, ReviewApplicationService } from '@knowledge-base/application'
import type { BackupDocument } from '@knowledge-base/contracts'
import { createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

const databases: KnowledgeDatabase[] = []
const fields = { actualAction: '行动', result: '结果', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '' }

function services() {
  const storage = createIndexedDbRepository(`start-action-${crypto.randomUUID()}`)
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
  vi.restoreAllMocks()
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('启动动作快照', () => {
  it('有输入首次启动时原子保存 trim 后快照、doing 状态与唯一事件', async () => {
    const s = services()
    const item = await s.items.createIdea({ title: '启动事项' })
    const started = await s.items.startExecution(item.id, '  打开文档写第一行  ')

    expect(started).toMatchObject({ status: 'doing', startAction: '打开文档写第一行' })
    expect(await s.items.listStatusEvents(item.id)).toEqual([
      expect.objectContaining({ toStatus: 'idea_to_try' }),
      expect.objectContaining({ fromStatus: 'idea_to_try', toStatus: 'doing' }),
    ])
  })

  it('无输入、空输入与纯空白均可启动但不写启动动作', async () => {
    const s = services()
    for (const input of [undefined, '', '   ']) {
      const item = await s.items.createIdea({ title: `无输入-${String(input)}` })
      const started = await s.items.startExecution(item.id, input)
      expect(started.status).toBe('doing')
      expect(started.startAction).toBeUndefined()
    }
  })

  it('Item 或事件写入失败时，快照、状态和事件整体回滚', async () => {
    const s = services()
    const itemFailure = await s.items.createIdea({ title: '事项失败' })
    const itemPut = vi.spyOn(s.storage.database.items, 'put').mockRejectedValueOnce(new Error('事项写入失败'))
    await expect(s.items.startExecution(itemFailure.id, '动作')).rejects.toThrow('事项写入失败')
    expect(await s.storage.database.items.get(itemFailure.id)).toEqual(itemFailure)
    expect(await s.items.listStatusEvents(itemFailure.id)).toHaveLength(1)
    itemPut.mockRestore()

    const eventFailure = await s.items.createIdea({ title: '事件失败' })
    const eventAdd = vi.spyOn(s.storage.database.itemStatusEvents, 'add').mockRejectedValueOnce(new Error('事件写入失败'))
    await expect(s.items.startExecution(eventFailure.id, '动作')).rejects.toThrow('事件写入失败')
    expect(await s.storage.database.items.get(eventFailure.id)).toEqual(eventFailure)
    expect(await s.items.listStatusEvents(eventFailure.id)).toHaveLength(1)
    eventAdd.mockRestore()
  })

  it('不存在、回收站和非 idea_to_try 状态拒绝；快照不能重写', async () => {
    const s = services()
    await expect(s.items.startExecution('missing', '动作')).rejects.toThrow('事项不存在')
    const deleted = await s.items.createIdea({ title: '已删除' })
    await s.items.deleteItem(deleted.id)
    await expect(s.items.startExecution(deleted.id, '动作')).rejects.toThrow('事项不存在')

    const paused = await s.items.createIdea({ title: '暂停事项' })
    await s.items.startExecution(paused.id, '原动作')
    await s.items.changeStatus(paused.id, 'paused')
    await expect(s.items.startExecution(paused.id, '新动作')).rejects.toThrow()
    expect((await s.storage.database.items.get(paused.id))).toMatchObject({ status: 'paused', startAction: '原动作' })
    await s.items.changeStatus(paused.id, 'doing')
    expect((await s.storage.database.items.get(paused.id))?.startAction).toBe('原动作')
  })

  it('删除、恢复与复盘方法流程均保留快照事实', async () => {
    const s = services()
    const item = await s.items.createIdea({ title: '历史快照' })
    await s.items.startExecution(item.id, '先写一行')
    await s.items.deleteItem(item.id)
    expect((await s.storage.database.items.get(item.id))?.startAction).toBe('先写一行')
    const restored = await s.items.restoreItem(item.id)
    expect(restored.startAction).toBe('先写一行')
    await s.items.changeStatus(item.id, 'waiting_review')
    await s.reviews.completeReview({ itemId: item.id, ...fields, method: { title: '方法', applicable: '场景', steps: '步骤' } })
    expect((await s.storage.database.items.get(item.id))).toMatchObject({ status: 'reviewed', startAction: '先写一行' })
  })

  it('新备份保留快照，旧备份缺字段合法，非 string 快照拒绝', async () => {
    const s = services()
    const item = await s.items.createIdea({ title: '备份快照' })
    const started = await s.items.startExecution(item.id, '保存启动动作')
    const document = await s.backup.createBackup()
    const target = services()
    await target.backup.restoreBackup(target.backup.parseAndValidate(JSON.stringify(document)))
    expect(await target.storage.database.items.get(item.id)).toEqual(started)

    const legacy = JSON.parse(JSON.stringify(document)) as BackupDocument
    delete legacy.data.items[0]!.startAction
    const legacyTarget = services()
    await legacyTarget.backup.restoreBackup(legacyTarget.backup.parseAndValidate(JSON.stringify(legacy)))
    expect((await legacyTarget.storage.database.items.get(item.id))?.startAction).toBeUndefined()

    const broken = JSON.parse(JSON.stringify(document)) as BackupDocument
    ;(broken.data.items[0] as { startAction?: unknown }).startAction = 1
    expect(() => target.backup.parseAndValidate(JSON.stringify(broken))).toThrow('无效启动动作')
  })
})
