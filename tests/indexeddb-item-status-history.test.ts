import { afterEach, describe, expect, it } from 'vitest'

import type { BackupData, BackupDocumentV2 } from '@knowledge-base/contracts'
import { BackupApplicationService, ItemApplicationService } from '@knowledge-base/application'
import {
  IndexedDbItemRepository,
  createIndexedDbRepository,
  type KnowledgeDatabase,
} from '@knowledge-base/storage-indexeddb'

const databases: KnowledgeDatabase[] = []
const fixedTime = new Date('2026-07-23T10:00:00.000Z')

function createServices(now?: () => string) {
  const storage = createIndexedDbRepository(`indexeddb-status-history-${crypto.randomUUID()}`)
  databases.push(storage.database)
  return {
    items: new ItemApplicationService(new IndexedDbItemRepository(storage.database, { now })),
    backup: new BackupApplicationService(storage.backupRepository),
  }
}

async function createRepeatedHistory() {
  const { items } = createServices(() => fixedTime.toISOString())
  const item = await items.createIdea({ title: '同毫秒历史' })
  await items.startExecution(item.id, '立即开始')
  await items.changeStatus(item.id, 'paused')
  await items.changeStatus(item.id, 'doing')
  return items.listStatusEvents(item.id)
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('IndexedDB ItemStatusEvent 时间顺序', () => {
  it('同一毫秒内为单一事项持久化严格单调的真实状态历史', async () => {
    const events = await createRepeatedHistory()

    expect(events.map(({ fromStatus, toStatus }) => ({ fromStatus, toStatus }))).toEqual([
      { fromStatus: undefined, toStatus: 'idea_to_try' },
      { fromStatus: 'idea_to_try', toStatus: 'doing' },
      { fromStatus: 'doing', toStatus: 'paused' },
      { fromStatus: 'paused', toStatus: 'doing' },
    ])
    expect(events.map((event) => event.createdAt)).toEqual([
      '2026-07-23T10:00:00.000Z',
      '2026-07-23T10:00:00.001Z',
      '2026-07-23T10:00:00.002Z',
      '2026-07-23T10:00:00.003Z',
    ])
  })

  it('重复执行同一毫秒历史时保持稳定', async () => {
    const first = await createRepeatedHistory()
    const second = await createRepeatedHistory()

    expect(second.map(({ fromStatus, toStatus, createdAt }) => ({ fromStatus, toStatus, createdAt })))
      .toEqual(first.map(({ fromStatus, toStatus, createdAt }) => ({ fromStatus, toStatus, createdAt })))
  })

  it('仅在各自 Item 内补偿时间，不影响其他事项', async () => {
    const { items } = createServices(() => fixedTime.toISOString())

    const first = await items.createIdea({ title: '第一事项' })
    await items.startExecution(first.id, '开始第一事项')
    await items.changeStatus(first.id, 'paused')
    const second = await items.createIdea({ title: '第二事项' })
    await items.changeStatus(second.id, 'doing')

    expect((await items.listStatusEvents(first.id)).map((event) => event.createdAt)).toEqual([
      '2026-07-23T10:00:00.000Z',
      '2026-07-23T10:00:00.001Z',
      '2026-07-23T10:00:00.002Z',
    ])
    expect((await items.listStatusEvents(second.id)).map((event) => event.createdAt)).toEqual([
      '2026-07-23T10:00:00.000Z',
      '2026-07-23T10:00:00.001Z',
    ])
  })

  it('恢复旧备份的同毫秒历史时不改写事件，并以 ID 稳定排序', async () => {
    const source = createServices()
    const target = createServices()
    const item = await source.items.createIdea({ title: '旧备份事项' })
    await source.items.changeStatus(item.id, 'doing')
    await source.items.changeStatus(item.id, 'paused')
    const document = await source.backup.createBackup()
    const oldEvents = document.data.itemStatusEvents
      .filter((event) => event.itemId === item.id)
      .map((event, index) => ({ ...event, id: `old-event-${3 - index}`, createdAt: fixedTime.toISOString() }))
    const restoredData: BackupData = {
      ...document.data,
      itemStatusEvents: document.data.itemStatusEvents.map((event) =>
        event.itemId === item.id ? oldEvents.find((oldEvent) => oldEvent.toStatus === event.toStatus)! : event,
      ),
      methodTombstones: document.data.methodTombstones ?? [],
    }
    const restored: BackupDocumentV2 = {
      format: 'knowledge-base-backup',
      version: 2,
      exportedAt: document.exportedAt,
      appVersion: document.appVersion,
      data: restoredData,
    }

    await target.backup.restoreBackup(restored)

    const restoredEvents = await target.items.listStatusEvents(item.id)
    expect(restoredEvents).toEqual([...oldEvents].sort((left, right) => left.id.localeCompare(right.id)))
    const exported = await target.backup.createBackup()
    expect(exported.data.itemStatusEvents).toHaveLength(restored.data.itemStatusEvents.length)
    expect(exported.data.itemStatusEvents).toEqual(expect.arrayContaining(restored.data.itemStatusEvents))
  })
})
