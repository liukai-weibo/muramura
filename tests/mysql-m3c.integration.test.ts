import crypto from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { BackupData, BackupDataV3, BackupDocument } from '@knowledge-base/contracts'
import { BackupApplicationService } from '../packages/application/src/index'
import { createMySqlPool, MySqlBackupRepository, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_MIGRATOR_PASSWORD', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
const id = () => `mysql-m3c-${crypto.randomUUID()}`
const timestamp = '2026-07-23T00:00:00.000Z'
let database = ''; let appUser = ''; let migratorUser = ''; let appPassword = ''; let migratorPassword = ''
let root: ReturnType<typeof createMySqlPool>; let app: ReturnType<typeof createMySqlPool>; let migrator: ReturnType<typeof createMySqlPool>
const config = (user: string, password: string): MySqlConnectionConfig => ({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 2 })

function data(): BackupData {
  const sourceItem = id(); const applicationItem = id(); const sourceReview = id(); const validationReview = id(); const method = id(); const tombstone = id()
  return {
    items: [
      { id: sourceItem, title: 'source', content: '', status: 'reviewed', createdAt: timestamp, updatedAt: timestamp },
      { id: applicationItem, title: 'application', content: 'body', status: 'doing', startAction: 'start', createdAt: timestamp, updatedAt: timestamp },
    ],
    reviews: [
      { id: sourceReview, itemId: sourceItem, actualAction: 'formation', result: 'formed', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '', createdAt: timestamp, updatedAt: timestamp },
      { id: validationReview, itemId: applicationItem, actualAction: 'validation', result: 'validated', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '', createdAt: timestamp, updatedAt: timestamp },
    ],
    methods: [{ id: method, title: 'active', applicable: 'when', unsuitable: '', steps: 'steps', validationCount: 2, version: 2, createdAt: timestamp, updatedAt: timestamp }],
    methodVersions: [
      { id: id(), methodId: method, version: 1, title: 'active', applicable: 'when', unsuitable: '', steps: 'v1', sourceReviewId: sourceReview, createdAt: timestamp },
      { id: id(), methodId: method, version: 2, title: 'active v2', applicable: 'when', unsuitable: '', steps: 'v2', sourceReviewId: validationReview, createdAt: timestamp },
    ],
    methodEvidence: [
      { id: id(), methodId: method, reviewId: sourceReview, relation: 'formation', methodVersion: 1, createdAt: timestamp },
      { id: id(), methodId: method, reviewId: validationReview, relation: 'revision', methodVersion: 2, createdAt: timestamp },
    ],
    methodApplications: [{ id: id(), methodId: method, methodVersion: 2, itemId: applicationItem, createdAt: timestamp }],
    itemStatusEvents: [
      { id: id(), itemId: sourceItem, toStatus: 'reviewed', createdAt: timestamp },
      { id: id(), itemId: applicationItem, fromStatus: 'idea_to_try', toStatus: 'doing', createdAt: timestamp },
    ],
    itemLinks: [{ id: id(), sourceReviewId: sourceReview, targetItemId: applicationItem, type: 'derived_from_review', createdAt: timestamp }],
    methodTombstones: [{ methodId: tombstone, title: 'purged', permanentlyDeletedAt: timestamp, versions: [{ version: 1 }, { version: 2 }]}],
  }
}

function normalized(value: BackupData): BackupDataV3 {
  return {
    ...value,
    items: [...value.items].sort((a, b) => a.id.localeCompare(b.id)), reviews: [...value.reviews].sort((a, b) => a.id.localeCompare(b.id)), methods: [...value.methods].sort((a, b) => a.id.localeCompare(b.id)), methodEvidence: [...value.methodEvidence].sort((a, b) => a.id.localeCompare(b.id)), methodVersions: [...value.methodVersions].sort((a, b) => a.methodId.localeCompare(b.methodId) || a.version - b.version || a.id.localeCompare(b.id)), methodApplications: [...value.methodApplications].sort((a, b) => a.id.localeCompare(b.id)), itemStatusEvents: [...value.itemStatusEvents].sort((a, b) => a.itemId.localeCompare(b.itemId) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)), itemLinks: [...value.itemLinks].sort((a, b) => a.id.localeCompare(b.id)), methodTombstones: [...value.methodTombstones].sort((a, b) => a.methodId.localeCompare(b.methodId)), explorationTracks: [],
  }
}

function document(value: BackupData, version: 1 | 2 = 2): string {
  const base: BackupDocument = { format: 'knowledge-base-backup', version: 2, exportedAt: timestamp, appVersion: 'test', data: value }
  return JSON.stringify(version === 1 ? { ...base, version: 1, data: { ...value, methodTombstones: undefined } } : base)
}

async function businessSnapshot() {
  const tables = ['items', 'reviews', 'methods', 'method_versions', 'method_evidence', 'method_applications', 'method_tombstones', 'item_links', 'item_status_events']
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, (await app.query(`SELECT * FROM ${table} ORDER BY 1`))[0]])))
}

async function metadata(key: string) { return (await app.query('SELECT value FROM system_metadata WHERE `key`=?', [key]))[0] }

describe.runIf(enabled)('MySQL M3-C complete lifecycle BackupData', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', ''); database = `kbm3c_${suffix}`; appUser = `kbm3ca_${suffix.slice(0, 22)}`; migratorUser = `kbm3cm_${suffix.slice(0, 22)}`; appPassword = crypto.randomUUID(); migratorPassword = crypto.randomUUID()
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``); await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword]); await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${appUser}'@'%'`); await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`); await root.query('FLUSH PRIVILEGES')
    app = createMySqlPool(config(appUser, appPassword)); migrator = createMySqlPool(config(migratorUser, migratorPassword)); await runMySqlMigrations(migrator, `${process.cwd()}/migrations`)
  })
  afterAll(async () => { await app?.end(); await migrator?.end(); await root?.query(`DROP DATABASE IF EXISTS \`${database}\``); await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`); await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`); await root?.end() })
  afterEach(async () => { await new MySqlBackupRepository(app).replaceData({ items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [], methodTombstones: [] }); await app.query('DELETE FROM system_metadata') })

  it('round trips complete v2 Method lifecycle data in deterministic BackupData order without exporting metadata', async () => {
    const repository = new MySqlBackupRepository(app); const service = new BackupApplicationService(repository); const value = data(); const key = id()
    await app.execute('INSERT INTO system_metadata(`key`,value,updated_at) VALUES(?,?,UTC_TIMESTAMP(3))', [key, 'private'])
    await service.restoreBackup(service.parseAndValidate(document(value)))
    expect(await repository.exportData()).toEqual(normalized(value)); expect(await metadata(key)).toEqual([{ value: 'private' }]); expect(JSON.stringify(await service.createBackup())).not.toContain(key)
  })

  it('preserves v1 normalization and optional sourceReviewId compatibility', async () => {
    const repository = new MySqlBackupRepository(app); const service = new BackupApplicationService(repository); const value = data(); const legacy = JSON.parse(document(value, 1)) as { data: BackupData }
    delete (legacy.data.methodVersions[0] as { sourceReviewId?: string }).sourceReviewId
    await service.restoreBackup(service.parseAndValidate(JSON.stringify(legacy)))
    const exported = await repository.exportData()
    expect(exported.methodTombstones).toEqual([]); expect(exported.methodApplications).toEqual(value.methodApplications); expect(exported.methodVersions[0]).not.toHaveProperty('sourceReviewId')
  })

  it('rejects lifecycle reference violations before replaceData and leaves business data and metadata unchanged', async () => {
    const repository = new MySqlBackupRepository(app); const service = new BackupApplicationService(repository); const baseline = data(); const key = id(); await repository.replaceData(baseline); await app.execute('INSERT INTO system_metadata(`key`,value,updated_at) VALUES(?,?,UTC_TIMESTAMP(3))', [key, 'stable'])
    const cases: Array<[string, BackupData, string]> = [
      ['broken Review', { ...baseline, methodEvidence: [{ ...baseline.methodEvidence[0]!, reviewId: id() }] }, '方法证据引用了不存在的方法或复盘'],
      ['duplicate Application Item', { ...baseline, methodApplications: [...baseline.methodApplications, { ...baseline.methodApplications[0]!, id: id() }] }, '同一事项不能关联多个方法应用'],
      ['active tombstone conflict', { ...baseline, methodTombstones: [...baseline.methodTombstones, { methodId: baseline.methods[0]!.id, title: 'bad', permanentlyDeletedAt: timestamp, versions: [{ version: 1 }] }] }, '方法与墓碑不能同时存在'],
      ['unproven tombstone version', { ...baseline, methodApplications: [{ ...baseline.methodApplications[0]!, methodId: baseline.methodTombstones[0]!.methodId, methodVersion: 99 }] }, '方法应用引用了不存在的方法版本'],
      ['broken Version Method', { ...baseline, methodVersions: [{ ...baseline.methodVersions[0]!, methodId: id() }] }, '方法版本引用了不存在的方法或复盘'],
    ]
    for (const [, invalid, message] of cases) {
      expect(() => service.parseAndValidate(document(invalid))).toThrow(message)
      expect(await repository.exportData()).toEqual(normalized(baseline)); expect(await metadata(key)).toEqual([{ value: 'stable' }])
    }
  })

  it('rolls every lifecycle collection and metadata back when final event insertion fails', async () => {
    const baseline = data(); const repository = new MySqlBackupRepository(app); const key = id(); await repository.replaceData(baseline); await app.execute('INSERT INTO system_metadata(`key`,value,updated_at) VALUES(?,?,UTC_TIMESTAMP(3))', [key, 'stable']); const before = await businessSnapshot()
    const failing = new MySqlBackupRepository(app, { beforeItemStatusEventInsert: () => { throw new Error('injected final event failure') } })
    await expect(failing.replaceData(data())).rejects.toThrow('injected final event failure')
    expect(await businessSnapshot()).toEqual(before); expect(await metadata(key)).toEqual([{ value: 'stable' }])
  })
})
