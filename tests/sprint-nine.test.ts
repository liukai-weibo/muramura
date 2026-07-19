import { afterEach, describe, expect, it } from 'vitest'

import { BackupApplicationService, DashboardApplicationService, ItemApplicationService } from '@knowledge-base/application'
import type { Item } from '@knowledge-base/contracts'
import { Dexie, createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

const databases: KnowledgeDatabase[] = []

function createServices(name = `sprint-nine-${crypto.randomUUID()}`) {
  const storage = createIndexedDbRepository(name)
  databases.push(storage.database)
  return {
    storage,
    items: new ItemApplicationService(storage.repository),
    dashboard: new DashboardApplicationService(storage.dashboardRepository),
    backup: new BackupApplicationService(storage.backupRepository),
  }
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('Sprint 9 状态事件日志', () => {
  it('创建事项写入基线，真实状态迁移按顺序追加事件', async () => {
    const services = createServices()
    const created = await services.items.createIdea({ title: '记录真实状态变化' })
    await services.items.changeStatus(created.id, 'doing')
    await services.items.changeStatus(created.id, 'paused')
    await services.items.changeStatus(created.id, 'doing')

    const events = await services.storage.database.itemStatusEvents
      .where('itemId').equals(created.id).sortBy('createdAt')
    expect(events).toHaveLength(4)
    expect(events[0]).toMatchObject({ itemId: created.id, toStatus: 'idea_to_try' })
    expect(events[0]!.fromStatus).toBeUndefined()
    expect(events.slice(1).map(({ fromStatus, toStatus }) => ({ fromStatus, toStatus }))).toEqual([
      { fromStatus: 'idea_to_try', toStatus: 'doing' },
      { fromStatus: 'doing', toStatus: 'paused' },
      { fromStatus: 'paused', toStatus: 'doing' },
    ])
  })

  it('仪表盘只统计明确进入进行中的事件，不把基线伪装成开始执行', async () => {
    const services = createServices()
    const created = await services.items.createIdea({ title: '开始次数口径' })
    expect((await services.dashboard.getReport('all')).metrics.startedExecutions).toBe(0)

    await services.items.changeStatus(created.id, 'doing')
    await services.items.changeStatus(created.id, 'paused')
    await services.items.changeStatus(created.id, 'doing')
    expect((await services.dashboard.getReport('all')).metrics.startedExecutions).toBe(2)
  })

  it('从 v5 升级只为旧事项生成当前状态基线且重开不重复', async () => {
    const databaseName = `sprint-nine-migration-${crypto.randomUUID()}`
    const legacy = new Dexie(databaseName)
    legacy.version(5).stores({
      items: 'id, status, createdAt, updatedAt, deletedAt',
      reviews: 'id, &itemId, createdAt, updatedAt',
      methods: 'id, createdAt, updatedAt',
      methodEvidence: 'id, methodId, reviewId, [methodId+reviewId]',
      methodVersions: 'id, methodId, version, [methodId+version], sourceReviewId',
      methodApplications: 'id, methodId, methodVersion, &itemId, [methodId+methodVersion]',
      itemLinks: 'id, sourceReviewId, targetItemId, type',
    })
    const createdAt = '2026-07-01T08:00:00.000Z'
    const oldItem: Item = {
      id: 'legacy-item', title: '旧事项', content: '', status: 'waiting_review', createdAt, updatedAt: createdAt,
    }
    await legacy.open()
    await legacy.table<Item, string>('items').add(oldItem)
    legacy.close()

    const services = createServices(databaseName)
    await services.storage.database.open()
    expect(await services.storage.database.itemStatusEvents.toArray()).toEqual([
      expect.objectContaining({ itemId: oldItem.id, toStatus: 'waiting_review', createdAt }),
    ])
    expect((await services.dashboard.getReport('all')).metrics.startedExecutions).toBe(0)

    services.storage.database.close()
    await services.storage.database.open()
    expect(await services.storage.database.itemStatusEvents.count()).toBe(1)
  })

  it('新备份保留事件日志，旧备份缺失日志时自动生成基线', async () => {
    const source = createServices()
    const created = await source.items.createIdea({ title: '备份状态日志' })
    await source.items.changeStatus(created.id, 'doing')
    const document = await source.backup.createBackup()
    expect(document.data.itemStatusEvents).toHaveLength(2)

    const target = createServices()
    const parsed = target.backup.parseAndValidate(JSON.stringify(document))
    await target.backup.restoreBackup(parsed)
    expect(await target.storage.database.itemStatusEvents.count()).toBe(2)

    const legacy = JSON.parse(JSON.stringify(document)) as Record<string, any>
    delete legacy.data.itemStatusEvents
    const parsedLegacy = target.backup.parseAndValidate(JSON.stringify(legacy))
    expect(parsedLegacy.data.itemStatusEvents).toEqual([
      expect.objectContaining({ itemId: created.id, toStatus: 'doing', createdAt: created.createdAt }),
    ])
  })
})
