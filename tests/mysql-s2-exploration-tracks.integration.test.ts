import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createMySqlPool,
  MySqlExplorationTrackRepository,
  MySqlItemRepository,
  type MySqlConnectionConfig,
  type MySqlExplorationTrackRepositoryTestHooks,
  runMySqlMigrations,
} from '../packages/storage-mysql/src/index'

const required = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD']
const enabled = required.every(name => Boolean(process.env[name]))
const root = path.resolve(__dirname, '..')
let database = ''
let appUser = ''
let migratorUser = ''
let appPassword = ''
let migratorPassword = ''
let rootPool: ReturnType<typeof createMySqlPool>
let appPool: ReturnType<typeof createMySqlPool>
let migratorPool: ReturnType<typeof createMySqlPool>
let migrationDirectory = ''

const testId = () => `s2-${crypto.randomUUID()}`
const config = (user: string, password: string): MySqlConnectionConfig => ({
  host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 4,
})

async function count(table: string): Promise<number> {
  const [rows] = await appPool.query<Array<RowDataPacket & { count: number }>>(`SELECT COUNT(*) AS count FROM ${table}`)
  return rows[0]!.count
}

async function snapshot(): Promise<Record<string, number>> {
  const tables = ['exploration_tracks', 'items', 'item_status_events', 'reviews', 'methods', 'method_versions', 'method_evidence', 'method_applications', 'method_tombstones', 'item_links']
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, await count(table)])))
}

async function fullSnapshot(): Promise<Record<string, RowDataPacket[]>> {
  const tables = ['exploration_tracks', 'items', 'item_status_events', 'reviews', 'methods', 'method_versions', 'method_evidence', 'method_applications', 'method_tombstones', 'item_links']
  return Object.fromEntries(await Promise.all(tables.map(async table => {
    const [rows] = await appPool.query<RowDataPacket[]>(`SELECT * FROM ${table} ORDER BY 1`)
    return [table, rows]
  })))
}

async function createTrack(repository: MySqlExplorationTrackRepository, name = testId()) {
  return repository.create({ id: testId(), name, normalizedName: name.toLowerCase(), createdAt: '2026-07-24T00:00:00.000Z' })
}

async function createItem(repository: MySqlExplorationTrackRepository, id = testId()) {
  return repository.createItemWithExplorationTrack(
    { id, title: id, content: '', status: 'idea_to_try', createdAt: '2026-07-24T00:00:00.000Z' },
    { type: 'new', name: `主线-${id}`, normalizedName: `主线-${id}` },
  )
}

async function createTemporaryDatabase() {
  const suffix = crypto.randomUUID().replaceAll('-', '')
  database = `kb_s2_${suffix}`
  appUser = `kbs2a_${suffix.slice(0, 22)}`
  migratorUser = `kbs2m_${suffix.slice(0, 22)}`
  appPassword = crypto.randomUUID()
  migratorPassword = crypto.randomUUID()
  expect(database).toMatch(/^kb_s2_/)
  expect(database).not.toBe(process.env.MYSQL_DATABASE)
  expect(database).not.toBe('knowledge_base')
  expect(database).not.toBe('knowledge_base_uat')
  rootPool = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
  await rootPool.query(`CREATE DATABASE \`${database}\``)
  await rootPool.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword])
  await rootPool.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
  await rootPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${appUser}'@'%'`)
  await rootPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`)
  await rootPool.query('FLUSH PRIVILEGES')
  appPool = createMySqlPool(config(appUser, appPassword))
  migratorPool = createMySqlPool(config(migratorUser, migratorPassword))
  migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-s2-'))
  for (const name of ['001_initial_schema.sql', '002_add_system_metadata.sql', '003_method_lifecycle_constraints.sql', '004_add_exploration_tracks.sql']) {
    fs.copyFileSync(path.join(root, 'migrations', name), path.join(migrationDirectory, name))
  }
  await runMySqlMigrations(migratorPool, migrationDirectory)
}

async function destroyTemporaryDatabase() {
  await appPool?.end(); await migratorPool?.end()
  await rootPool?.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await rootPool?.query(`DROP USER IF EXISTS '${appUser}'@'%'`)
  await rootPool?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`)
  await rootPool?.end()
  if (migrationDirectory) fs.rmSync(migrationDirectory, { recursive: true, force: true })
}

describe.runIf(enabled)('探索主线 S2 MySQL Repository 与原子工作流', () => {
  beforeAll(createTemporaryDatabase)
  afterAll(destroyTemporaryDatabase)

  it('只使用随机临时库，app 保持 DML-only', async () => {
    await expect(appPool.query('CREATE TABLE s2_forbidden(id INT)')).rejects.toMatchObject({ code: 'ER_TABLEACCESS_DENIED_ERROR' })
    const [current] = await appPool.query<Array<RowDataPacket & { currentDatabase: string }>>('SELECT DATABASE() AS currentDatabase')
    expect(current[0]?.currentDatabase).toBe(database)
  })

  it('在同一事务提交 existing 与 new 的 Track、Item 和初始状态事件', async () => {
    const repository = new MySqlExplorationTrackRepository(appPool)
    const existing = await createTrack(repository, `existing-${testId()}`)
    const existingItem = await repository.createItemWithExplorationTrack(
      { id: testId(), title: 'existing item', content: 'x', status: 'doing', createdAt: '2026-07-24T00:00:00.000Z' },
      { type: 'existing', trackId: existing.id },
    )
    const newItem = await createItem(repository)
    expect(existingItem.explorationTrackId).toBe(existing.id)
    expect(newItem.explorationTrackId).toBeDefined()
    const [events] = await appPool.query<Array<RowDataPacket & { item_id: string; to_status: string }>>('SELECT item_id,to_status FROM item_status_events WHERE item_id IN (?,?) ORDER BY item_id', [existingItem.id, newItem.id])
    expect(events).toEqual(expect.arrayContaining([
      { item_id: existingItem.id, to_status: 'doing' },
      { item_id: newItem.id, to_status: 'idea_to_try' },
    ]))
  })

  it('在 Track、Item、Event 与提交前失败时回滚 new 工作流，不留下半成品', async () => {
    const hooks: Array<keyof MySqlExplorationTrackRepositoryTestHooks> = ['beforeTrackInsert', 'beforeItemInsert', 'beforeStatusEventInsert', 'beforeCommit']
    for (const hook of hooks) {
      const before = await snapshot()
      const repository = new MySqlExplorationTrackRepository(appPool, { [hook]: () => { throw new Error(`injected ${hook}`) } })
      await expect(createItem(repository)).rejects.toThrow(`injected ${hook}`)
      expect(await snapshot()).toEqual(before)
    }
  })

  it('拒绝不存在或已删除 existing Track，且没有 Item 或 Event 副作用', async () => {
    const repository = new MySqlExplorationTrackRepository(appPool)
    const deleted = await createTrack(repository, `deleted-${testId()}`)
    await repository.softDelete(deleted.id, '2026-07-24T01:00:00.000Z')
    for (const trackId of ['missing-track', deleted.id]) {
      const before = await snapshot()
      await expect(repository.createItemWithExplorationTrack(
        { id: testId(), title: 'must fail', createdAt: '2026-07-24T00:00:00.000Z' }, { type: 'existing', trackId },
      )).rejects.toThrow('探索主线不存在或已删除')
      expect(await snapshot()).toEqual(before)
    }
  })

  it('并发同规范名 new 工作流至多提交一个完整结果，另一方稳定名称冲突', async () => {
    const normalizedName = `race-${testId()}`
    const makeRequest = () => new MySqlExplorationTrackRepository(appPool).createItemWithExplorationTrack(
      { id: testId(), title: 'race', createdAt: '2026-07-24T00:00:00.000Z' },
      { type: 'new', name: normalizedName, normalizedName },
    )
    const results = await Promise.allSettled([makeRequest(), makeRequest()])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')[0]?.reason).toMatchObject({ code: 'conflict' })
    const [tracks] = await appPool.query('SELECT id FROM exploration_tracks WHERE normalized_name=?', [normalizedName])
    expect(tracks).toHaveLength(1)
  })

  it('不存在或已删除 Item 与 Item 更新失败均不产生关联写入', async () => {
    const repository = new MySqlExplorationTrackRepository(appPool)
    const track = await createTrack(repository, `target-${testId()}`)
    await expect(repository.assignItemToExplorationTrack('missing-item', track.id)).rejects.toMatchObject({ code: 'item-not-found' })
    const item = await repository.createItemWithExplorationTrack(
      { id: testId(), title: 'deleted item', createdAt: '2026-07-24T00:00:00.000Z' }, { type: 'existing', trackId: track.id },
    )
    await appPool.execute('UPDATE items SET deleted_at=UTC_TIMESTAMP(3) WHERE id=?', [item.id])
    await expect(repository.removeItemFromExplorationTrack(item.id)).rejects.toMatchObject({ code: 'item-not-found' })

    const stableItem = await repository.createItemWithExplorationTrack(
      { id: testId(), title: 'stable item', createdAt: '2026-07-24T00:00:00.000Z' }, { type: 'existing', trackId: track.id },
    )
    const replacement = await createTrack(repository, `replacement-${testId()}`)
    const failing = new MySqlExplorationTrackRepository(appPool, { beforeItemUpdate: () => { throw new Error('injected item update') } })
    await expect(failing.assignItemToExplorationTrack(stableItem.id, replacement.id)).rejects.toThrow('injected item update')
    expect(await repository.getItemContext(stableItem.id)).toMatchObject({ status: 'available', track: { id: track.id } })
  })

  it('unavailable 保留断裂 trackId，assign 与 remove 均拒绝且不改写关联', async () => {
    const repository = new MySqlExplorationTrackRepository(appPool)
    const track = await createTrack(repository, `broken-${testId()}`)
    const item = await repository.createItemWithExplorationTrack(
      { id: testId(), title: 'broken association', createdAt: '2026-07-24T00:00:00.000Z' }, { type: 'existing', trackId: track.id },
    )
    await rootPool.query('SET FOREIGN_KEY_CHECKS=0')
    try {
      await rootPool.query(`DELETE FROM \`${database}\`.exploration_tracks WHERE id=?`, [track.id])
    } finally {
      await rootPool.query('SET FOREIGN_KEY_CHECKS=1')
    }
    expect(await repository.getItemContext(item.id)).toEqual({ status: 'unavailable', itemId: item.id, trackId: track.id })
    const replacement = await createTrack(repository, `replacement-${testId()}`)
    await expect(repository.assignItemToExplorationTrack(item.id, replacement.id)).rejects.toMatchObject({ code: 'unavailable' })
    await expect(repository.removeItemFromExplorationTrack(item.id)).rejects.toMatchObject({ code: 'unavailable' })
    const [rows] = await appPool.query<Array<RowDataPacket & { exploration_track_id: string }>>('SELECT exploration_track_id FROM items WHERE id=?', [item.id])
    expect(rows).toEqual([{ exploration_track_id: track.id }])
  })

  it('软删除与恢复 Track 不改写关联 Item 或初始状态事件', async () => {
    const repository = new MySqlExplorationTrackRepository(appPool)
    const track = await createTrack(repository, `lifecycle-${testId()}`)
    const item = await repository.createItemWithExplorationTrack(
      { id: testId(), title: 'preserved relation', createdAt: '2026-07-24T00:00:00.000Z' }, { type: 'existing', trackId: track.id },
    )
    const [beforeItems] = await appPool.query('SELECT id,exploration_track_id,status FROM items WHERE id=?', [item.id])
    const [beforeEvents] = await appPool.query('SELECT item_id,to_status FROM item_status_events WHERE item_id=?', [item.id])
    await repository.softDelete(track.id, '2026-07-24T01:00:00.000Z')
    await repository.restore(track.id, '2026-07-24T02:00:00.000Z')
    expect((await appPool.query('SELECT id,exploration_track_id,status FROM items WHERE id=?', [item.id]))[0]).toEqual(beforeItems)
    expect((await appPool.query('SELECT item_id,to_status FROM item_status_events WHERE item_id=?', [item.id]))[0]).toEqual(beforeEvents)
  })

  it('删除并恢复 Item 后保留原 Track ID，且回收站 Item 不进入主线历史', async () => {
    const tracks = new MySqlExplorationTrackRepository(appPool)
    const items = new MySqlItemRepository(appPool)
    const track = await createTrack(tracks, `item-lifecycle-${testId()}`)
    const associated = await tracks.createItemWithExplorationTrack(
      { id: testId(), title: 'deleted item', createdAt: '2026-07-24T00:00:00.000Z' }, { type: 'existing', trackId: track.id },
    )
    await items.delete(associated.id)
    expect((await tracks.getHistory(track.id))?.history).toEqual([])
    await items.restore(associated.id)
    expect((await tracks.getItemContext(associated.id))).toMatchObject({ status: 'available', track: { id: track.id } })
  })

  it('按冻结顺序返回 active、selectable、deleted 与受限状态定位', async () => {
    const repository = new MySqlExplorationTrackRepository(appPool)
    const alpha = await createTrack(repository, `alpha-${testId()}`)
    const beta = await createTrack(repository, `beta-${testId()}`)
    const doing = await repository.createItemWithExplorationTrack(
      { id: testId(), title: 'doing item', status: 'doing', createdAt: '2026-07-24T00:00:00.000Z' }, { type: 'existing', trackId: alpha.id },
    )
    const abandoned = await repository.createItemWithExplorationTrack(
      { id: testId(), title: 'abandoned item', status: 'abandoned', createdAt: '2026-07-24T00:00:00.000Z' }, { type: 'existing', trackId: alpha.id },
    )
    const history = await repository.getHistory(alpha.id)
    expect(history?.currentAssociatedItems).toMatchObject([{ status: 'doing', items: [{ item: { id: doing.id } }] }])
    expect(history?.history.map(entry => entry.item.id)).toContain(doing.id)
    expect(history?.abandonedHistory.map(entry => entry.item.id)).toContain(abandoned.id)
    expect(await repository.listItemsByTrackAndStatus(alpha.id, 'doing')).toMatchObject([{ id: doing.id }])
    await expect(repository.listItemsByTrackAndStatus(alpha.id, 'reviewed' as never)).rejects.toMatchObject({ code: 'invalid-status' })
    expect((await repository.listSelectable()).map(track => track.id)).toEqual(expect.arrayContaining([alpha.id, beta.id]))
    await repository.softDelete(beta.id, '2026-07-24T01:00:00.000Z')
    expect((await repository.listDeleted()).map(entry => entry.track.id)).toContain(beta.id)
    expect((await repository.listActive()).map(entry => entry.track.id)).not.toContain(beta.id)
  })

  it('已删除 Track 的关联仅可读取，拒绝改归入或移除且零写入', async () => {
    const repository = new MySqlExplorationTrackRepository(appPool)
    const deletedTrack = await createTrack(repository, `deleted-${testId()}`)
    const replacement = await createTrack(repository, `replacement-${testId()}`)
    const item = await repository.createItemWithExplorationTrack(
      { id: testId(), title: 'deleted association', createdAt: '2026-07-24T00:00:00.000Z' }, { type: 'existing', trackId: deletedTrack.id },
    )
    await repository.softDelete(deletedTrack.id, '2026-07-24T01:00:00.000Z')

    expect(await repository.getItemContext(item.id)).toMatchObject({
      status: 'track-deleted',
      itemId: item.id,
      track: { id: deletedTrack.id, deletedAt: expect.any(String) },
    })

    const assertRejectedWithoutWrites = async (action: () => Promise<unknown>) => {
      const before = await fullSnapshot()
      const [beforeItem] = await appPool.query<RowDataPacket[]>('SELECT exploration_track_id,updated_at FROM items WHERE id=?', [item.id])
      const [beforeEvents] = await appPool.query<RowDataPacket[]>('SELECT * FROM item_status_events WHERE item_id=? ORDER BY id', [item.id])

      await expect(action()).rejects.toMatchObject({ code: 'deleted' })

      expect(await fullSnapshot()).toEqual(before)
      expect((await appPool.query<RowDataPacket[]>('SELECT exploration_track_id,updated_at FROM items WHERE id=?', [item.id]))[0]).toEqual(beforeItem)
      expect((await appPool.query<RowDataPacket[]>('SELECT * FROM item_status_events WHERE item_id=? ORDER BY id', [item.id]))[0]).toEqual(beforeEvents)
    }

    await assertRejectedWithoutWrites(() => repository.assignItemToExplorationTrack(item.id, replacement.id))
    await assertRejectedWithoutWrites(() => repository.removeItemFromExplorationTrack(item.id))
    expect(await repository.getItemContext(item.id)).toMatchObject({
      status: 'track-deleted',
      itemId: item.id,
      track: { id: deletedTrack.id, deletedAt: expect.any(String) },
    })
  })
})
