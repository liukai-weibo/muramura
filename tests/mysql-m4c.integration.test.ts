import crypto from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BackupApplicationService } from '../packages/application/src/index'
import { createMySqlPool, MySqlBackupRepository, MySqlItemRepository, MySqlReviewWorkflowRepository, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_MIGRATOR_PASSWORD', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
const id = () => `mysql-m4c-${crypto.randomUUID()}`
let database = ''; let appUser = ''; let migratorUser = ''; let appPassword = ''; let migratorPassword = ''
let root: ReturnType<typeof createMySqlPool>; let app: ReturnType<typeof createMySqlPool>; let migrator: ReturnType<typeof createMySqlPool>
const config = (user: string, password: string): MySqlConnectionConfig => ({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 4 })
const reviewInput = (itemId: string, newIdeas = '') => ({ itemId, actualAction: 'action', result: 'result', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas })
const methodInput = (suffix = '') => ({ title: `title ${suffix}`, applicable: `applicable ${suffix}`, unsuitable: '', steps: `steps ${suffix}` })
const tables = ['items', 'reviews', 'methods', 'method_versions', 'method_evidence', 'method_applications', 'method_tombstones', 'item_links', 'item_status_events']
async function snapshot() { return Object.fromEntries(await Promise.all(tables.map(async table => [table, (await app.query(`SELECT * FROM ${table} ORDER BY 1`))[0]]))) }
const normalize = <T extends { id: string }>(values: T[]) => [...values].sort((a, b) => a.id.localeCompare(b.id))

// The existing backup contract exports each collection deterministically; only normalize
// the event collection's documented item/time/id ordering for this cross-path assertion.
function normalized(data: Awaited<ReturnType<MySqlBackupRepository['exportData']>>) {
  return { ...data, items: normalize(data.items), reviews: normalize(data.reviews), methods: normalize(data.methods), methodEvidence: normalize(data.methodEvidence), methodVersions: [...data.methodVersions].sort((a, b) => a.methodId.localeCompare(b.methodId) || a.version - b.version || a.id.localeCompare(b.id)), methodApplications: normalize(data.methodApplications), itemLinks: normalize(data.itemLinks), methodTombstones: [...data.methodTombstones].sort((a, b) => a.methodId.localeCompare(b.methodId)), itemStatusEvents: [...data.itemStatusEvents].sort((a, b) => a.itemId.localeCompare(b.itemId) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) }
}

describe.runIf(enabled)('MySQL M4-C derived Review workflow and BackupData', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', ''); database = `kbm4c_${suffix}`; appUser = `kbm4ca_${suffix.slice(0, 22)}`; migratorUser = `kbm4cm_${suffix.slice(0, 22)}`; appPassword = crypto.randomUUID(); migratorPassword = crypto.randomUUID()
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``); await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword]); await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${appUser}'@'%'`); await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`); await root.query('FLUSH PRIVILEGES')
    app = createMySqlPool(config(appUser, appPassword)); migrator = createMySqlPool(config(migratorUser, migratorPassword)); await runMySqlMigrations(migrator, `${process.cwd()}/migrations`)
  })
  afterAll(async () => { await app?.end(); await migrator?.end(); await root?.query(`DROP DATABASE IF EXISTS \`${database}\``); await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`); await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`); await root?.end() })
  afterEach(async () => { for (const table of ['item_links', 'item_status_events', 'method_applications', 'method_evidence', 'method_versions', 'method_tombstones', 'methods', 'reviews', 'items']) await app.query(`DELETE FROM ${table}`); await app.query('DELETE FROM system_metadata') })
  async function waitingItem() { return new MySqlItemRepository(app).create({ title: id(), status: 'waiting_review' }) }
  async function formedMethod() { const item = await waitingItem(); return (await new MySqlReviewWorkflowRepository(app).complete({ ...reviewInput(item.id), method: methodInput('base') })).method! }

  it.each(['', 'single idea', 'first line\nsecond line'] as const)('handles no, single-line, and multi-line newIdeas without extra links', async ideas => {
    const item = await waitingItem(); const result = await new MySqlReviewWorkflowRepository(app).complete(reviewInput(item.id, ideas))
    if (!ideas) { expect(result.createdIdea).toBeUndefined(); expect((await app.query('SELECT * FROM item_links'))[0]).toEqual([]); return }
    expect(result.createdIdea).toMatchObject({ status: 'idea_to_try', title: ideas.split(/\r?\n/, 1)[0], content: ideas.includes('\n') ? ideas : '' })
    expect((await app.query('SELECT * FROM item_links WHERE source_review_id=? AND target_item_id=?', [result.review.id, result.createdIdea!.id]))[0]).toMatchObject([{ type: 'derived_from_review' }])
    expect((await app.query('SELECT * FROM item_status_events WHERE item_id=?', [result.createdIdea!.id]))[0]).toMatchObject([{ from_status: null, to_status: 'idea_to_try' }])
  })

  it('limits the derived title to 120 characters while retaining the complete trimmed content', async () => {
    const ideas = `${'a'.repeat(140)}\nbody`; const item = await waitingItem(); const result = await new MySqlReviewWorkflowRepository(app).complete(reviewInput(item.id, ` ${ideas} `))
    expect(result.createdIdea).toMatchObject({ title: 'a'.repeat(120), content: ideas })
  })

  it.each(['formation', 'validation', 'revision'] as const)('combines %s method path with one derived Item and Link', async path => {
    const method = path === 'formation' ? undefined : await formedMethod(); const item = await waitingItem()
    const result = await new MySqlReviewWorkflowRepository(app).complete({ ...reviewInput(item.id, 'derived'), ...(path === 'formation' ? { method: methodInput(path) } : { existingMethod: { methodId: method!.id, ...(path === 'revision' ? { revision: methodInput(path) } : {}) } }) })
    expect(result.method).toBeDefined(); expect(result.createdIdea).toMatchObject({ title: 'derived' })
    expect((await app.query('SELECT * FROM item_links WHERE source_review_id=?', [result.review.id]))[0]).toHaveLength(1)
  })

  it.each(['formation', 'validation', 'revision'] as const)('keeps %s method path free of derived facts when newIdeas is blank', async path => {
    const method = path === 'formation' ? undefined : await formedMethod(); const item = await waitingItem()
    const result = await new MySqlReviewWorkflowRepository(app).complete({ ...reviewInput(item.id), ...(path === 'formation' ? { method: methodInput(path) } : { existingMethod: { methodId: method!.id, ...(path === 'revision' ? { revision: methodInput(path) } : {}) } }) })
    expect(result.method).toBeDefined(); expect(result.createdIdea).toBeUndefined()
    expect((await app.query('SELECT * FROM item_links WHERE source_review_id=?', [result.review.id]))[0]).toEqual([])
  })

  it.each(['derived-item', 'derived-event', 'link', 'item', 'event', 'commit'] as const)('rolls all nine collections back when %s fails', async phase => {
    const item = await waitingItem(); const before = await snapshot()
    const repository = new MySqlReviewWorkflowRepository(app, {
      beforeDerivedItemInsert: () => { if (phase === 'derived-item') throw new Error('derived item failure') },
      beforeDerivedStatusEventInsert: () => { if (phase === 'derived-event') throw new Error('derived event failure') },
      beforeItemLinkInsert: () => { if (phase === 'link') throw new Error('link failure') },
      beforeItemUpdate: () => { if (phase === 'item') throw new Error('item failure') },
      beforeStatusEventInsert: () => { if (phase === 'event') throw new Error('event failure') },
      beforeCommit: connection => { if (phase === 'commit') connection.destroy() },
    })
    await expect(repository.complete(reviewInput(item.id, 'derived'))).rejects.toThrow(phase === 'commit' ? undefined : `${phase.replace('derived-', 'derived ')} failure`)
    expect(await snapshot()).toEqual(before)
  })

  it.each(['method', 'version', 'evidence'] as const)('rolls derived facts back when formation %s fails', async phase => {
    const item = await waitingItem(); const before = await snapshot()
    const repository = new MySqlReviewWorkflowRepository(app, {
      beforeMethodWrite: () => { if (phase === 'method') throw new Error('method failure') }, beforeVersionInsert: () => { if (phase === 'version') throw new Error('version failure') }, beforeEvidenceInsert: () => { if (phase === 'evidence') throw new Error('evidence failure') },
    })
    await expect(repository.complete({ ...reviewInput(item.id, 'derived'), method: methodInput() })).rejects.toThrow(`${phase} failure`)
    expect(await snapshot()).toEqual(before)
  })

  it('allows only one concurrent derived completion for an Item', async () => {
    const item = await waitingItem(); const results = await Promise.allSettled([new MySqlReviewWorkflowRepository(app).complete(reviewInput(item.id, 'one')), new MySqlReviewWorkflowRepository(app).complete(reviewInput(item.id, 'two'))])
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1); expect((await app.query('SELECT * FROM reviews WHERE item_id=?', [item.id]))[0]).toHaveLength(1); expect((await app.query('SELECT * FROM item_links'))[0]).toHaveLength(1)
  })

  it('round trips complete M4 data through existing BackupData without metadata leakage', async () => {
    const original = await waitingItem(); const formation = await new MySqlReviewWorkflowRepository(app).complete({ ...reviewInput(original.id, 'formation idea\nbody'), method: methodInput('round') })
    const validationItem = await waitingItem(); await new MySqlReviewWorkflowRepository(app).complete({ ...reviewInput(validationItem.id, 'validation idea'), existingMethod: { methodId: formation.method!.id } })
    const revisionItem = await waitingItem(); await new MySqlReviewWorkflowRepository(app).complete({ ...reviewInput(revisionItem.id, 'revision idea'), existingMethod: { methodId: formation.method!.id, revision: methodInput('revised') } })
    const repository = new MySqlBackupRepository(app); const service = new BackupApplicationService(repository); const key = id(); await app.execute('INSERT INTO system_metadata(`key`,value,updated_at) VALUES(?,?,UTC_TIMESTAMP(3))', [key, 'private'])
    const exported = await repository.exportData(); const document = await service.createBackup(); await repository.replaceData({ items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [], methodTombstones: [] })
    await service.restoreBackup(service.parseAndValidate(JSON.stringify(document)))
    expect(normalized(await repository.exportData())).toEqual(normalized(exported)); expect((await app.query('SELECT value FROM system_metadata WHERE `key`=?', [key]))[0]).toMatchObject([{ value: 'private' }])
    expect(document).not.toContain(key)
  })
})
