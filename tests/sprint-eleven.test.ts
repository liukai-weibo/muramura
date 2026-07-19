import { afterEach, describe, expect, it } from 'vitest'

import { BackupApplicationService, ItemApplicationService } from '@knowledge-base/application'
import { createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

const databases: KnowledgeDatabase[] = []

function createServices() {
  const storage = createIndexedDbRepository(`sprint-eleven-${crypto.randomUUID()}`)
  databases.push(storage.database)
  return {
    items: new ItemApplicationService(storage.repository),
    backup: new BackupApplicationService(storage.backupRepository),
  }
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('Sprint 11 单事项流转历史', () => {
  it('通过应用层按发生顺序返回指定事项的完整状态事件', async () => {
    const { items } = createServices()
    const first = await items.createIdea({ title: '查看完整流转' })
    const other = await items.createIdea({ title: '其他事项' })
    await items.changeStatus(first.id, 'doing')
    await items.changeStatus(first.id, 'paused')
    await items.changeStatus(first.id, 'doing')
    await items.changeStatus(other.id, 'doing')

    const events = await items.listStatusEvents(first.id)

    expect(events).toHaveLength(4)
    expect(events.map(({ itemId }) => itemId)).toEqual(Array(4).fill(first.id))
    expect(events.map(({ fromStatus, toStatus }) => ({ fromStatus, toStatus }))).toEqual([
      { fromStatus: undefined, toStatus: 'idea_to_try' },
      { fromStatus: 'idea_to_try', toStatus: 'doing' },
      { fromStatus: 'doing', toStatus: 'paused' },
      { fromStatus: 'paused', toStatus: 'doing' },
    ])
    expect(events.map(({ createdAt }) => createdAt)).toEqual(
      [...events].map(({ createdAt }) => createdAt).sort(),
    )
  })

  it('不存在的事项不会暴露孤立事件查询', async () => {
    const { items } = createServices()
    await expect(items.listStatusEvents('missing-item')).rejects.toThrow('事项不存在')
  })
})

describe('Sprint 11 恢复前安全备份', () => {
  it('先交付当前数据快照，再用选中备份覆盖数据', async () => {
    const source = createServices()
    const target = createServices()
    await source.items.createIdea({ title: '准备恢复的数据' })
    await target.items.createIdea({ title: '恢复前的当前数据' })
    const restoreDocument = await source.backup.createBackup()
    let preservedTitle = ''

    await target.backup.restoreBackupSafely(restoreDocument, (safetyBackup) => {
      preservedTitle = safetyBackup.data.items[0]?.title ?? ''
    })

    expect(preservedTitle).toBe('恢复前的当前数据')
    expect((await target.items.listItems()).map((item) => item.title)).toEqual(['准备恢复的数据'])
  })

  it('安全快照未成功交付时禁止覆盖当前数据', async () => {
    const source = createServices()
    const target = createServices()
    await source.items.createIdea({ title: '不应恢复的数据' })
    await target.items.createIdea({ title: '必须保留的当前数据' })
    const restoreDocument = await source.backup.createBackup()

    await expect(target.backup.restoreBackupSafely(restoreDocument, () => {
      throw new Error('安全备份下载失败')
    })).rejects.toThrow('安全备份下载失败')

    expect((await target.items.listItems()).map((item) => item.title)).toEqual(['必须保留的当前数据'])
  })
})
