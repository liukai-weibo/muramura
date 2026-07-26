import crypto from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { BackupData, BackupDataV3, BackupDocument } from '@knowledge-base/contracts'
import { BackupApplicationService } from '../packages/application/src/index'
import { createMySqlPool, MySqlBackupRepository, MySqlItemRepository, MySqlReviewRepository, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const required = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_MIGRATOR_PASSWORD', 'MYSQL_ROOT_PASSWORD']
const enabled = required.every(name => Boolean(process.env[name]))
const prefix = 'mysql-m2b-'
const id = () => `${prefix}${crypto.randomUUID()}`
const timestamp = '2026-07-23T00:00:00.000Z'
let appPool: ReturnType<typeof createMySqlPool> | undefined
let migratorPool: ReturnType<typeof createMySqlPool> | undefined
let rootPool: ReturnType<typeof createMySqlPool> | undefined
let database = ''
let appUser = ''
let appPassword = ''
let migratorUser = ''
let migratorPassword = ''

function config(user: string, password: string): MySqlConnectionConfig {
  return { host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 2 }
}

function data(): BackupData {
  const itemOne = id(); const itemTwo = id(); const review = id(); const method = id(); const tombstone = id()
  return {
    items: [
      { id: itemOne, title: 'active', content: 'body', status: 'doing', startAction: 'start', createdAt: timestamp, updatedAt: timestamp },
      { id: itemTwo, title: 'deleted', content: '', status: 'abandoned', createdAt: timestamp, updatedAt: timestamp, deletedAt: timestamp },
    ],
    reviews: [{ id: review, itemId: itemOne, actualAction: 'act', result: 'result', effective: 'effective', incompatible: 'incompatible', reason: 'reason', adjustment: 'adjustment', newIdeas: 'ideas', createdAt: timestamp, updatedAt: timestamp }],
    methods: [{ id: method, title: 'method', applicable: 'when', unsuitable: '', steps: 'steps', validationCount: 1, version: 1, createdAt: timestamp, updatedAt: timestamp }],
    methodEvidence: [{ id: id(), methodId: method, reviewId: review, relation: 'formation', methodVersion: 1, createdAt: timestamp }],
    methodVersions: [{ id: id(), methodId: method, version: 1, title: 'method', applicable: 'when', unsuitable: '', steps: 'steps', sourceReviewId: review, createdAt: timestamp }],
    methodApplications: [{ id: id(), methodId: method, methodVersion: 1, itemId: itemTwo, createdAt: timestamp }],
    itemStatusEvents: [{ id: id(), itemId: itemOne, toStatus: 'doing', createdAt: timestamp }, { id: id(), itemId: itemTwo, fromStatus: 'idea_to_try', toStatus: 'abandoned', createdAt: timestamp }],
    itemLinks: [{ id: id(), sourceReviewId: review, targetItemId: itemTwo, type: 'derived_from_review', createdAt: timestamp }],
    methodTombstones: [{ methodId: tombstone, title: 'purged', permanentlyDeletedAt: timestamp, versions: [{ version: 1 }]}],
  }
}

function normalized(value: BackupData | BackupDataV3): BackupDataV3 {
  return {
    ...value,
    items: [...value.items].sort((left, right) => left.id.localeCompare(right.id)), reviews: [...value.reviews].sort((left, right) => left.id.localeCompare(right.id)), methods: [...value.methods].sort((left, right) => left.id.localeCompare(right.id)), methodEvidence: [...value.methodEvidence].sort((left, right) => left.id.localeCompare(right.id)), methodVersions: [...value.methodVersions].sort((left, right) => left.methodId.localeCompare(right.methodId) || left.version - right.version || left.id.localeCompare(right.id)), methodApplications: [...value.methodApplications].sort((left, right) => left.id.localeCompare(right.id)), itemStatusEvents: [...value.itemStatusEvents].sort((left, right) => left.itemId.localeCompare(right.itemId) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)), itemLinks: [...value.itemLinks].sort((left, right) => left.id.localeCompare(right.id)), methodTombstones: [...value.methodTombstones].sort((left, right) => left.methodId.localeCompare(right.methodId)), explorationTracks: [...('explorationTracks' in value ? value.explorationTracks : [])].sort((left, right) => left.id.localeCompare(right.id)),
  }
}

function document(value: BackupData | BackupDataV3, version: 1 | 2 | 3 = 2): string {
  const base = { format: 'knowledge-base-backup' as const, version: version === 3 ? 3 as const : 2 as const, exportedAt: timestamp, appVersion: 'test', data: value } as BackupDocument
  return JSON.stringify(version === 1 ? { ...base, version, data: { ...value, methodTombstones: undefined } } : base)
}

function v3Data(): BackupDataV3 {
  const value = data(); const active = id(); const deleted = id()
  value.items[0]!.explorationTrackId = active; value.items[1]!.explorationTrackId = deleted
  return { ...value, explorationTracks: [
    { id: active, name: '当前主线', normalizedName: '当前主线', createdAt: timestamp, updatedAt: timestamp },
    { id: deleted, name: '已删除主线', normalizedName: '已删除主线', createdAt: timestamp, updatedAt: timestamp, deletedAt: timestamp },
  ] }
}

describe.runIf(enabled)('MySQL M2-B Review and Backup repositories', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '')
    database = `kbm2b_${suffix}`
    appUser = `kbm2ba_${suffix.slice(0, 23)}`
    migratorUser = `kbm2bm_${suffix.slice(0, 23)}`
    appPassword = crypto.randomUUID()
    migratorPassword = crypto.randomUUID()
    rootPool = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await rootPool.query(`CREATE DATABASE \`${database}\``)
    await rootPool.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword])
    await rootPool.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await rootPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${appUser}'@'%'`)
    await rootPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`)
    await rootPool.query('FLUSH PRIVILEGES')
    appPool = createMySqlPool(config(appUser, appPassword))
    migratorPool = createMySqlPool(config(migratorUser, migratorPassword))
    await runMySqlMigrations(migratorPool, `${process.cwd()}/migrations`)
  })

  afterAll(async () => {
    await appPool?.end(); await migratorPool?.end()
    if (rootPool) {
      await rootPool.query(`DROP DATABASE IF EXISTS \`${database}\``)
      await rootPool.query(`DROP USER IF EXISTS '${appUser}'@'%'`)
      await rootPool.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`)
      await rootPool.end()
    }
  })

  afterEach(async () => {
    const repository = new MySqlBackupRepository(appPool!)
    await repository.replaceData({ items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [], methodTombstones: [] })
    await appPool!.query('DELETE FROM system_metadata')
  })

  async function reviewRelationSnapshot(reviewId: string) {
    const [reviews, evidence, versions] = await Promise.all([
      appPool!.query('SELECT * FROM reviews WHERE id=? ORDER BY id', [reviewId]),
      appPool!.query('SELECT * FROM method_evidence WHERE review_id=? ORDER BY id', [reviewId]),
      appPool!.query('SELECT * FROM method_versions WHERE source_review_id=? ORDER BY id', [reviewId]),
    ])
    return { reviews: reviews[0], evidence: evidence[0], versions: versions[0] }
  }

  it('persists Reviews with required validation, trimming, Item existence and one-Review semantics', async () => {
    const items = new MySqlItemRepository(appPool!)
    const reviews = new MySqlReviewRepository(appPool!)
    const item = await items.create({ title: id() })
    const input = { itemId: item.id, actualAction: ' action ', result: ' result ', effective: ' effective ', incompatible: ' incompatible ', reason: ' reason ', adjustment: ' adjustment ', newIdeas: ' ideas ' }
    const review = await reviews.create(input)
    expect(review).toMatchObject({ itemId: item.id, actualAction: 'action', result: 'result', effective: 'effective', incompatible: 'incompatible', reason: 'reason', adjustment: 'adjustment', newIdeas: 'ideas' })
    expect(await reviews.getById(review.id)).toEqual(review)
    expect(await reviews.getByItemId(item.id)).toEqual(review)
    await expect(reviews.create(input)).rejects.toThrow('该事项已经完成复盘')
    await expect(reviews.create({ ...input, itemId: id() })).rejects.toThrow('事项不存在')
    await expect(reviews.create({ ...input, actualAction: ' ', result: ' ' })).rejects.toThrow('请填写：实际行动、结果')
    await reviews.delete(review.id)
    expect(await reviews.getById(review.id)).toBeUndefined()
  })

  it('refuses to delete a Review referenced by MethodEvidence without changing affected records', async () => {
    const items = new MySqlItemRepository(appPool!)
    const reviews = new MySqlReviewRepository(appPool!)
    const item = await items.create({ title: id() })
    const review = await reviews.create({ itemId: item.id, actualAction: 'action', result: 'result', effective: '', incompatible: '', reason: '', adjustment: '' })
    await appPool!.execute('INSERT INTO method_evidence(id,method_id,review_id,relation,method_version,created_at) VALUES(?,?,?,"formation",1,UTC_TIMESTAMP(3))', [id(), id(), review.id])
    const before = await reviewRelationSnapshot(review.id)
    await expect(reviews.delete(review.id)).rejects.toThrow('复盘存在方法关联，暂不能删除')
    expect(await reviewRelationSnapshot(review.id)).toEqual(before)
  })

  it('refuses to delete a Review referenced by MethodVersion source without changing affected records', async () => {
    const items = new MySqlItemRepository(appPool!)
    const reviews = new MySqlReviewRepository(appPool!)
    const item = await items.create({ title: id() })
    const review = await reviews.create({ itemId: item.id, actualAction: 'action', result: 'result', effective: '', incompatible: '', reason: '', adjustment: '' })
    await appPool!.execute('INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at) VALUES(?,?,1,"method","","","",?,UTC_TIMESTAMP(3))', [id(), id(), review.id])
    const before = await reviewRelationSnapshot(review.id)
    await expect(reviews.delete(review.id)).rejects.toThrow('复盘存在方法关联，暂不能删除')
    expect(await reviewRelationSnapshot(review.id)).toEqual(before)
  })

  it('round trips v2 BackupData through parse, replace and export without changing system metadata', async () => {
    const repository = new MySqlBackupRepository(appPool!); const service = new BackupApplicationService(repository); const value = data(); const metadataKey = id()
    await appPool!.execute('INSERT INTO system_metadata(`key`,value,updated_at) VALUES(?,?,UTC_TIMESTAMP(3))', [metadataKey, 'private-value'])
    await service.restoreBackup(service.parseAndValidate(document(value)))
    expect(await repository.exportData()).toEqual(normalized(value))
    const [metadata] = await appPool!.query('SELECT value FROM system_metadata WHERE `key`=?', [metadataKey])
    expect(metadata).toEqual([{ value: 'private-value' }]); expect(JSON.stringify(await service.createBackup())).not.toContain(metadataKey)
  })

  it('normalizes v1 omissions before replacing data', async () => {
    const repository = new MySqlBackupRepository(appPool!); const service = new BackupApplicationService(repository); const value = data(); const v1 = JSON.parse(document(value, 1)) as { data: BackupData }
    delete (v1.data.items[0] as { startAction?: string }).startAction; delete (v1.data as Partial<BackupData>).methodApplications; delete (v1.data as Partial<BackupData>).itemStatusEvents
    await service.restoreBackup(service.parseAndValidate(JSON.stringify(v1)))
    const exported = await repository.exportData()
    expect(exported.methodTombstones).toEqual([]); expect(exported.methodApplications).toEqual([]); expect(exported.itemStatusEvents).toHaveLength(value.items.length); expect(exported.items[0]).not.toHaveProperty('startAction')
    expect(exported.explorationTracks).toEqual([]); expect(exported.items.every(item => item.explorationTrackId === undefined)).toBe(true)
  })

  it('round trips V3 tracks, deletedAt and exact Item associations without exporting system metadata', async () => {
    const repository = new MySqlBackupRepository(appPool!); const service = new BackupApplicationService(repository); const value = v3Data(); const metadataKey = id()
    await appPool!.execute('INSERT INTO system_metadata(`key`,value,updated_at) VALUES(?,?,UTC_TIMESTAMP(3))', [metadataKey, 'private-value'])
    const parsed = service.parseAndValidate(document(value, 3))
    expect(parsed.version).toBe(3)
    await service.restoreBackup(parsed)
    expect(await repository.exportData()).toEqual(normalized(value))
    expect(await service.createBackup()).toMatchObject({ version: 3, data: { explorationTracks: normalized(value).explorationTracks } })
    const [metadata] = await appPool!.query('SELECT value FROM system_metadata WHERE `key`=?', [metadataKey])
    expect(metadata).toEqual([{ value: 'private-value' }])
  })

  it('rejects invalid V3 Track references before writes with all ten business collections unchanged', async () => {
    const repository = new MySqlBackupRepository(appPool!); const service = new BackupApplicationService(repository); const baseline = v3Data(); await repository.replaceData(baseline)
    const invalid = v3Data(); invalid.items[0]!.explorationTrackId = id()
    expect(() => service.parseAndValidate(document(invalid, 3))).toThrow('V3 事项引用了不存在的主线')
    expect(await repository.exportData()).toEqual(normalized(baseline))
  })

  it('rejects invalid V3 IDs, names, normalized names and timestamps before restore writes', async () => {
    const repository = new MySqlBackupRepository(appPool!); const service = new BackupApplicationService(repository); const baseline = v3Data(); await repository.replaceData(baseline)
    const cases: Array<[string, (value: BackupDataV3) => void, string]> = [
      ['ID', value => { value.items[0]!.id = '' }, '事项存在空 ID 或重复 ID'],
      ['名称', value => { value.explorationTracks[0]!.name = ' ' }, 'V3 主线名称或规范名无效'],
      ['规范名', value => { value.explorationTracks[0]!.normalizedName = '不一致' }, 'V3 主线名称或规范名无效'],
      ['时间', value => { value.explorationTracks[0]!.createdAt = 'not-a-time' }, 'V3 主线存在无效时间'],
    ]
    for (const [, mutate, message] of cases) {
      const invalid = structuredClone(v3Data())
      mutate(invalid)
      expect(() => service.parseAndValidate(document(invalid, 3))).toThrow(message)
      expect(await repository.exportData()).toEqual(normalized(baseline))
    }
  })

  it('rejects invalid backups during parsing with zero MySQL writes', async () => {
    const repository = new MySqlBackupRepository(appPool!); const service = new BackupApplicationService(repository); const baseline = data(); await repository.replaceData(baseline)
    const invalid: BackupData = { ...baseline, items: [...baseline.items, { ...baseline.items[0]! }] }
    expect(() => service.parseAndValidate(document(invalid))).toThrow('事项存在空 ID 或重复 ID')
    expect(await repository.exportData()).toEqual(normalized(baseline))
  })

  it('rolls all nine BackupData collections back when final status event insertion fails', async () => {
    const baselineRepository = new MySqlBackupRepository(appPool!); const baseline = data(); await baselineRepository.replaceData(baseline)
    const failing = new MySqlBackupRepository(appPool!, { beforeItemStatusEventInsert: () => { throw new Error('test final event failure') } })
    await expect(failing.replaceData(data())).rejects.toThrow('test final event failure')
    expect(await baselineRepository.exportData()).toEqual(normalized(baseline))
  })

  it('rolls all ten V3 collections back when final status event insertion fails', async () => {
    const baselineRepository = new MySqlBackupRepository(appPool!); const baseline = v3Data(); await baselineRepository.replaceData(baseline)
    const failing = new MySqlBackupRepository(appPool!, { beforeItemStatusEventInsert: () => { throw new Error('test final event failure') } })
    await expect(failing.replaceData(v3Data())).rejects.toThrow('test final event failure')
    expect(await baselineRepository.exportData()).toEqual(normalized(baseline))
  })
})
