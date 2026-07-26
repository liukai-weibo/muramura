import crypto from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createMySqlPool, MySqlItemRepository, MySqlReviewWorkflowRepository, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_MIGRATOR_PASSWORD', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
const id = () => `mysql-m4b-${crypto.randomUUID()}`
let database = ''; let appUser = ''; let migratorUser = ''; let appPassword = ''; let migratorPassword = ''
let root: ReturnType<typeof createMySqlPool>; let app: ReturnType<typeof createMySqlPool>; let migrator: ReturnType<typeof createMySqlPool>
const config = (user: string, password: string): MySqlConnectionConfig => ({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 4 })
const reviewInput = (itemId: string) => ({ itemId, actualAction: ' action ', result: ' result ', effective: ' effective ', incompatible: ' incompatible ', reason: ' reason ', adjustment: ' adjustment ', newIdeas: '' })
const methodInput = (suffix = '') => ({ title: ` title ${suffix} `, applicable: ` applicable ${suffix} `, unsuitable: ` unsuitable ${suffix} `, steps: ` steps ${suffix} ` })
const tables = ['items', 'reviews', 'methods', 'method_versions', 'method_evidence', 'method_applications', 'method_tombstones', 'item_links', 'item_status_events']

async function snapshot() {
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, (await app.query(`SELECT * FROM ${table} ORDER BY 1`))[0]])))
}

describe.runIf(enabled)('MySQL M4-B complete Review workflow with methods', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', ''); database = `kbm4b_${suffix}`; appUser = `kbm4ba_${suffix.slice(0, 22)}`; migratorUser = `kbm4bm_${suffix.slice(0, 22)}`; appPassword = crypto.randomUUID(); migratorPassword = crypto.randomUUID()
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``); await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword]); await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${appUser}'@'%'`); await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`); await root.query('FLUSH PRIVILEGES')
    app = createMySqlPool(config(appUser, appPassword)); migrator = createMySqlPool(config(migratorUser, migratorPassword)); await runMySqlMigrations(migrator, `${process.cwd()}/migrations`)
  })
  afterAll(async () => { await app?.end(); await migrator?.end(); await root?.query(`DROP DATABASE IF EXISTS \`${database}\``); await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`); await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`); await root?.end() })
  afterEach(async () => { for (const table of ['item_links', 'item_status_events', 'method_applications', 'method_evidence', 'method_versions', 'method_tombstones', 'methods', 'reviews', 'items']) await app.query(`DELETE FROM ${table}`) })

  async function waitingItem() { return new MySqlItemRepository(app).create({ title: id(), status: 'waiting_review' }) }
  async function formedMethod() {
    const item = await waitingItem()
    return (await new MySqlReviewWorkflowRepository(app).complete({ ...reviewInput(item.id), method: methodInput('formed') })).method!
  }

  it('forms a trimmed Method, v1 and formation Evidence with the Review atomically', async () => {
    const item = await waitingItem()
    const result = await new MySqlReviewWorkflowRepository(app).complete({ ...reviewInput(item.id), method: methodInput('formation') })
    expect(result.method).toMatchObject({ title: 'title formation', applicable: 'applicable formation', unsuitable: 'unsuitable formation', steps: 'steps formation', validationCount: 1, version: 1 })
    const [versions] = await app.query<any[]>('SELECT * FROM method_versions WHERE method_id=?', [result.method!.id])
    const [evidence] = await app.query<any[]>('SELECT * FROM method_evidence WHERE method_id=?', [result.method!.id])
    expect(versions).toMatchObject([{ version: 1, source_review_id: result.review.id }])
    expect(evidence).toMatchObject([{ review_id: result.review.id, relation: 'formation', method_version: 1 }])
    expect((await new MySqlItemRepository(app).getById(item.id))?.status).toBe('reviewed')
  })

  it('validates an active Method without creating a Version', async () => {
    const method = await formedMethod(); const item = await waitingItem()
    const result = await new MySqlReviewWorkflowRepository(app).complete({ ...reviewInput(item.id), existingMethod: { methodId: method.id } })
    expect(result.method).toMatchObject({ id: method.id, validationCount: 2, version: 1 })
    expect((await app.query('SELECT * FROM method_versions WHERE method_id=?', [method.id]))[0]).toHaveLength(1)
    expect((await app.query('SELECT * FROM method_evidence WHERE method_id=? AND review_id=?', [method.id, result.review.id]))[0]).toMatchObject([{ relation: 'validation', method_version: 1 }])
  })

  it('revises an active Method while retaining its prior Version', async () => {
    const method = await formedMethod(); const item = await waitingItem()
    const result = await new MySqlReviewWorkflowRepository(app).complete({ ...reviewInput(item.id), existingMethod: { methodId: method.id, revision: methodInput('revision') } })
    expect(result.method).toMatchObject({ id: method.id, title: 'title revision', validationCount: 2, version: 2 })
    const [versions] = await app.query<any[]>('SELECT version,title,source_review_id FROM method_versions WHERE method_id=? ORDER BY version', [method.id])
    expect(versions).toMatchObject([{ version: 1, title: 'title formed' }, { version: 2, title: 'title revision', source_review_id: result.review.id }])
    expect((await app.query('SELECT * FROM method_evidence WHERE method_id=? AND review_id=?', [method.id, result.review.id]))[0]).toMatchObject([{ relation: 'revision', method_version: 2 }])
  })

  it('retains the M4-A no-method completion path', async () => {
    const item = await waitingItem(); const result = await new MySqlReviewWorkflowRepository(app).complete(reviewInput(item.id))
    expect(result.method).toBeUndefined(); expect((await app.query('SELECT * FROM methods'))[0]).toHaveLength(0)
    expect((await new MySqlItemRepository(app).getById(item.id))?.status).toBe('reviewed')
  })

  it('rejects invalid method choices and inputs with all nine collections unchanged', async () => {
    const item = await waitingItem(); const method = await formedMethod(); const repository = new MySqlReviewWorkflowRepository(app)
    const before = await snapshot()
    await expect(repository.complete({ ...reviewInput(item.id), method: methodInput(), existingMethod: { methodId: method.id } })).rejects.toThrow('不能同时形成新方法和验证已有方法')
    await expect(repository.complete({ ...reviewInput(item.id), method: { ...methodInput(), title: ' ' } })).rejects.toThrow('请完成方法标题、适用情况和具体步骤')
    await expect(repository.complete({ ...reviewInput(item.id), existingMethod: { methodId: method.id, revision: { ...methodInput(), steps: ' ' } } })).rejects.toThrow('请完成方法标题、适用情况和具体步骤')
    await expect(repository.complete({ ...reviewInput(item.id), existingMethod: { methodId: id() } })).rejects.toThrow('选择的方法不存在')
    expect(await snapshot()).toEqual(before)
    await app.execute('UPDATE methods SET deleted_at=? WHERE id=?', ['2026-07-23 00:00:00.000', method.id])
    const deletedBefore = await snapshot()
    await expect(repository.complete({ ...reviewInput(item.id), existingMethod: { methodId: method.id } })).rejects.toThrow('选择的方法不存在')
    expect(await snapshot()).toEqual(deletedBefore)
  })

  it.each([
    ['formation', 'review'], ['formation', 'method'], ['formation', 'version'], ['formation', 'evidence'], ['formation', 'item'], ['formation', 'event'], ['formation', 'commit'],
    ['validation', 'review'], ['validation', 'method'], ['validation', 'evidence'], ['validation', 'item'], ['validation', 'event'], ['validation', 'commit'],
    ['revision', 'review'], ['revision', 'method'], ['revision', 'version'], ['revision', 'evidence'], ['revision', 'item'], ['revision', 'event'], ['revision', 'commit'],
  ] as const)('rolls all nine collections back when %s %s phase fails', async (path, phase) => {
    const existing = path === 'formation' ? undefined : await formedMethod(); const item = await waitingItem(); const before = await snapshot()
    const repository = new MySqlReviewWorkflowRepository(app, {
      beforeReviewInsert: () => { if (phase === 'review') throw new Error('review failure') },
      beforeMethodWrite: () => { if (phase === 'method') throw new Error('method failure') },
      beforeVersionInsert: () => { if (phase === 'version') throw new Error('version failure') },
      beforeEvidenceInsert: () => { if (phase === 'evidence') throw new Error('evidence failure') },
      beforeItemUpdate: () => { if (phase === 'item') throw new Error('item failure') },
      beforeStatusEventInsert: () => { if (phase === 'event') throw new Error('event failure') },
      beforeCommit: connection => { if (phase === 'commit') connection.destroy() },
    })
    const method = path === 'formation' ? methodInput(path) : undefined
    const existingMethod = existing ? { methodId: existing.id, ...(path === 'revision' ? { revision: methodInput(path) } : {}) } : undefined
    await expect(repository.complete({ ...reviewInput(item.id), ...(method ? { method } : {}), ...(existingMethod ? { existingMethod } : {}) })).rejects.toThrow(phase === 'commit' ? undefined : `${phase} failure`)
    expect(await snapshot()).toEqual(before)
  })

  it('permits at most one concurrent formation for the same Item', async () => {
    const item = await waitingItem(); const first = new MySqlReviewWorkflowRepository(app); const second = new MySqlReviewWorkflowRepository(app)
    const results = await Promise.allSettled([first.complete({ ...reviewInput(item.id), method: methodInput('first') }), second.complete({ ...reviewInput(item.id), method: methodInput('second') })])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1); expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((await app.query('SELECT * FROM reviews WHERE item_id=?', [item.id]))[0]).toHaveLength(1)
    expect((await app.query('SELECT * FROM methods'))[0]).toHaveLength(1)
    expect((await app.query('SELECT * FROM method_versions'))[0]).toHaveLength(1)
    expect((await app.query('SELECT * FROM method_evidence'))[0]).toHaveLength(1)
    expect((await app.query('SELECT * FROM item_status_events WHERE item_id=?', [item.id]))[0]).toHaveLength(2)
  })
})
