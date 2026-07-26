import crypto from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  createMySqlPool,
  MySqlItemRepository,
  MySqlMethodApplicationRepository,
  MySqlMethodRepository,
  MySqlReviewRepository,
  runMySqlMigrations,
  type MySqlConnectionConfig,
} from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_MIGRATOR_PASSWORD', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
const id = () => `mysql-m3b-${crypto.randomUUID()}`
let database = ''; let appUser = ''; let migratorUser = ''; let appPassword = ''; let migratorPassword = ''
let root: ReturnType<typeof createMySqlPool>; let app: ReturnType<typeof createMySqlPool>; let migrator: ReturnType<typeof createMySqlPool>
const config = (user: string, password: string): MySqlConnectionConfig => ({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 2 })
const methodInput = (title = '方法') => ({ title, applicable: '适用', unsuitable: '', steps: '步骤' })

async function snapshot() {
  const tables = ['items', 'reviews', 'methods', 'method_versions', 'method_evidence', 'method_applications', 'method_tombstones', 'item_links', 'item_status_events']
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, (await app.query(`SELECT * FROM ${table} ORDER BY 1`))[0]])))
}

describe.runIf(enabled)('MySQL M3-B method application and purge repositories', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', ''); database = `kbm3b_${suffix}`; appUser = `kbm3ba_${suffix.slice(0, 22)}`; migratorUser = `kbm3bm_${suffix.slice(0, 22)}`; appPassword = crypto.randomUUID(); migratorPassword = crypto.randomUUID()
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``); await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword]); await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${appUser}'@'%'`); await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`); await root.query('FLUSH PRIVILEGES')
    app = createMySqlPool(config(appUser, appPassword)); migrator = createMySqlPool(config(migratorUser, migratorPassword)); await runMySqlMigrations(migrator, `${process.cwd()}/migrations`)
  })
  afterAll(async () => { await app?.end(); await migrator?.end(); await root?.query(`DROP DATABASE IF EXISTS \`${database}\``); await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`); await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`); await root?.end() })
  afterEach(async () => { for (const table of ['item_links', 'item_status_events', 'method_applications', 'method_evidence', 'method_versions', 'method_tombstones', 'methods', 'reviews', 'items']) await app.query(`DELETE FROM ${table}`) })

  async function review() { const item = await new MySqlItemRepository(app).create({ title: id() }); return new MySqlReviewRepository(app).create({ itemId: item.id, actualAction: '行动', result: '结果', effective: '', incompatible: '', reason: '', adjustment: '' }) }
  async function activeMethod() { const source = await review(); return new MySqlMethodRepository(app).createFromReview(methodInput(), source.id) }

  it('creates Item, initial event, and Application atomically and rejects unavailable methods without writes', async () => {
    const method = await activeMethod(); const repository = new MySqlMethodApplicationRepository(app)
    const item = await repository.createItem({ methodId: method.id, title: ' 应用事项 ', content: ' 内容 ' })
    expect(item).toMatchObject({ title: '应用事项', content: '内容', status: 'idea_to_try' })
    expect((await app.query('SELECT method_id,method_version,item_id FROM method_applications WHERE item_id=?', [item.id]))[0]).toEqual([{ method_id: method.id, method_version: 1, item_id: item.id }])
    expect((await new MySqlItemRepository(app).listStatusEvents(item.id)).map(event => event.toStatus)).toEqual(['idea_to_try'])
    const before = await snapshot(); await expect(repository.createItem({ methodId: id(), title: '不应创建' })).rejects.toThrow('选择的方法不存在'); expect(await snapshot()).toEqual(before)
    await new MySqlMethodRepository(app).moveToTrash(method.id); const trashedBefore = await snapshot(); await expect(repository.createItem({ methodId: method.id, title: '不应创建' })).rejects.toThrow('选择的方法不存在'); expect(await snapshot()).toEqual(trashedBefore)
  })

  it('rolls Item, event, and Application back when the terminal application write fails', async () => {
    const method = await activeMethod(); const before = await snapshot()
    const repository = new MySqlMethodApplicationRepository(app, { beforeApplicationInsert: () => { throw new Error('injected application failure') } })
    await expect(repository.createItem({ methodId: method.id, title: '不应创建' })).rejects.toThrow('injected application failure')
    expect(await snapshot()).toEqual(before)
  })

  it('returns only structure-proven application contexts and displays', async () => {
    const method = await activeMethod(); const repository = new MySqlMethodApplicationRepository(app); const item = await repository.createItem({ methodId: method.id, title: '应用' })
    expect((await repository.getContextResultByItemId(item.id)).status).toBe('available')
    await new MySqlMethodRepository(app).moveToTrash(method.id); expect((await repository.getContextResultByItemId(item.id)).status).toBe('method-in-trash')
    await new MySqlMethodRepository(app).purgeDeletedBefore('2999-01-01T00:00:00.000Z'); expect((await repository.getContextResultByItemId(item.id)).status).toBe('method-purged')
    expect(await repository.listSourceDisplaysForItems([item.id, id()])).toEqual([{ status: 'method-purged', itemId: item.id, title: '方法' }, { status: 'no-association', itemId: expect.any(String) }])
    await app.query('DELETE FROM method_tombstones WHERE method_id=?', [method.id]); expect(await repository.getContextResultByItemId(item.id)).toMatchObject({ status: 'unavailable', reason: 'method-and-version-missing' })
  })

  it('purges a trashed Method only with proof, preserving historical Evidence and Application atomically', async () => {
    const method = await activeMethod(); const application = new MySqlMethodApplicationRepository(app); const item = await application.createItem({ methodId: method.id, title: '应用' }); const repository = new MySqlMethodRepository(app)
    await repository.moveToTrash(method.id); await repository.purgeDeletedBefore('2999-01-01T00:00:00.000Z')
    expect((await app.query('SELECT * FROM methods WHERE id=?', [method.id]))[0]).toEqual([]); expect((await app.query('SELECT * FROM method_versions WHERE method_id=?', [method.id]))[0]).toEqual([])
    expect((await app.query('SELECT * FROM method_evidence WHERE method_id=?', [method.id]))[0]).toHaveLength(1); expect((await app.query('SELECT * FROM method_applications WHERE item_id=?', [item.id]))[0]).toHaveLength(1)
    expect((await application.getContextResultByItemId(item.id)).status).toBe('method-purged')
    const invalidMethod = await activeMethod(); const invalidItem = await new MySqlItemRepository(app).create({ title: '异常应用' }); await app.query('INSERT INTO method_applications(id,method_id,method_version,item_id,created_at) VALUES(?,?,99,?,UTC_TIMESTAMP(3))', [id(), invalidMethod.id, invalidItem.id]); await repository.moveToTrash(invalidMethod.id); const before = await snapshot()
    await expect(repository.purgeDeletedBefore('2999-01-01T00:00:00.000Z')).rejects.toThrow('方法应用引用了无法证明的历史版本'); expect(await snapshot()).toEqual(before)
  })

  it('purges a deleted Item through real relationships and rolls every affected table back on terminal failure', async () => {
    const items = new MySqlItemRepository(app); const reviewRepository = new MySqlReviewRepository(app); const methodRepository = new MySqlMethodRepository(app)
    const sourceItem = await items.create({ title: '来源事项' }); const sourceReview = await reviewRepository.create({ itemId: sourceItem.id, actualAction: '行动', result: '结果', effective: '', incompatible: '', reason: '', adjustment: '' }); const method = await methodRepository.createFromReview(methodInput(), sourceReview.id)
    await app.query('INSERT INTO item_links(id,source_review_id,target_item_id,type,created_at) VALUES(?,?,?,"derived_from_review",UTC_TIMESTAMP(3))', [id(), sourceReview.id, sourceItem.id]); await items.delete(sourceItem.id); await items.purgeDeletedBefore('2999-01-01T00:00:00.000Z')
    expect((await app.query('SELECT * FROM items WHERE id=?', [sourceItem.id]))[0]).toEqual([]); expect((await app.query('SELECT * FROM reviews WHERE id=?', [sourceReview.id]))[0]).toEqual([]); expect((await app.query('SELECT * FROM methods WHERE id=?', [method.id]))[0]).toEqual([])
    const rollbackItem = await items.create({ title: '回滚事项' }); await items.delete(rollbackItem.id); const before = await snapshot(); const failing = new MySqlItemRepository(app, { beforePurgeDeleteItem: () => { throw new Error('injected terminal purge failure') } })
    await expect(failing.purgeDeletedBefore('2999-01-01T00:00:00.000Z')).rejects.toThrow('injected terminal purge failure'); expect(await snapshot()).toEqual(before)
  })

  it('keeps Review delete evidence/source rejection and allows an unrelated Review deletion', async () => {
    const repository = new MySqlReviewRepository(app); const methodRepository = new MySqlMethodRepository(app); const evidenceReview = await review(); await methodRepository.createFromReview(methodInput(), evidenceReview.id); const beforeEvidence = await snapshot(); await expect(repository.delete(evidenceReview.id)).rejects.toThrow('复盘存在方法关联，暂不能删除'); expect(await snapshot()).toEqual(beforeEvidence)
    const sourceReview = await review(); const method = await methodRepository.createFromReview(methodInput('另一方法'), sourceReview.id); const beforeSource = await snapshot(); await expect(repository.delete(sourceReview.id)).rejects.toThrow('复盘存在方法关联，暂不能删除'); expect(await snapshot()).toEqual(beforeSource)
    const standalone = await review(); await repository.delete(standalone.id); expect(await repository.getById(standalone.id)).toBeUndefined(); expect(await methodRepository.listVersions(method.id)).toHaveLength(1)
  })
})
