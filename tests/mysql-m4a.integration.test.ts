import crypto from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createMySqlPool, MySqlItemRepository, MySqlReviewWorkflowRepository, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_MIGRATOR_PASSWORD', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
const id = () => `mysql-m4a-${crypto.randomUUID()}`
let database = ''; let appUser = ''; let migratorUser = ''; let appPassword = ''; let migratorPassword = ''
let root: ReturnType<typeof createMySqlPool>; let app: ReturnType<typeof createMySqlPool>; let migrator: ReturnType<typeof createMySqlPool>
const config = (user: string, password: string): MySqlConnectionConfig => ({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 3 })
const input = (itemId: string) => ({ itemId, actualAction: ' action ', result: ' result ', effective: ' effective ', incompatible: ' incompatible ', reason: ' reason ', adjustment: ' adjustment ', newIdeas: '' })

async function snapshot() {
  const tables = ['items', 'reviews', 'methods', 'method_versions', 'method_evidence', 'method_applications', 'method_tombstones', 'item_links', 'item_status_events']
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, (await app.query(`SELECT * FROM ${table} ORDER BY 1`))[0]])))
}

describe.runIf(enabled)('MySQL M4-A minimal Review workflow', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', ''); database = `kbm4a_${suffix}`; appUser = `kbm4aa_${suffix.slice(0, 22)}`; migratorUser = `kbm4am_${suffix.slice(0, 22)}`; appPassword = crypto.randomUUID(); migratorPassword = crypto.randomUUID()
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``); await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword]); await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${appUser}'@'%'`); await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`); await root.query('FLUSH PRIVILEGES')
    app = createMySqlPool(config(appUser, appPassword)); migrator = createMySqlPool(config(migratorUser, migratorPassword)); await runMySqlMigrations(migrator, `${process.cwd()}/migrations`)
  })
  afterAll(async () => { await app?.end(); await migrator?.end(); await root?.query(`DROP DATABASE IF EXISTS \`${database}\``); await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`); await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`); await root?.end() })
  afterEach(async () => { for (const table of ['item_links', 'item_status_events', 'method_applications', 'method_evidence', 'method_versions', 'method_tombstones', 'methods', 'reviews', 'items']) await app.query(`DELETE FROM ${table}`) })

  async function waitingItem() { return new MySqlItemRepository(app).create({ title: id(), status: 'waiting_review' }) }

  it('creates trimmed Review, reviewed Item, and exactly one final status event atomically', async () => {
    const item = await waitingItem(); const result = await new MySqlReviewWorkflowRepository(app).complete(input(item.id))
    expect(result.review).toMatchObject({ itemId: item.id, actualAction: 'action', result: 'result', effective: 'effective', incompatible: 'incompatible', reason: 'reason', adjustment: 'adjustment' })
    expect(result.item).toMatchObject({ id: item.id, status: 'reviewed' })
    expect((await new MySqlItemRepository(app).listStatusEvents(item.id)).map(value => [value.fromStatus, value.toStatus])).toEqual([[undefined, 'waiting_review'], ['waiting_review', 'reviewed']])
  })

  it('rejects invalid inputs and Item states with zero workflow writes', async () => {
    const repository = new MySqlReviewWorkflowRepository(app); const item = await waitingItem(); const before = await snapshot()
    await expect(repository.complete(input(id()))).rejects.toThrow('事项不存在')
    await expect(repository.complete({ ...input(item.id), actualAction: ' ', result: ' ' })).rejects.toThrow('请填写：实际行动、结果')
    await expect(repository.complete({ ...input(item.id), actualAction: ' ' })).rejects.toThrow('请填写：实际行动')
    await expect(repository.complete({ ...input(item.id), result: ' ' })).rejects.toThrow('请填写：结果')
    expect(await snapshot()).toEqual(before)
    await new MySqlItemRepository(app).delete(item.id); const deletedBefore = await snapshot(); await expect(repository.complete(input(item.id))).rejects.toThrow('事项不存在'); expect(await snapshot()).toEqual(deletedBefore)
    const wrong = await new MySqlItemRepository(app).create({ title: id() }); const wrongBefore = await snapshot(); await expect(repository.complete(input(wrong.id))).rejects.toThrow('只有已开始或待复盘事项可以完成复盘'); expect(await snapshot()).toEqual(wrongBefore)
  })

  it('rejects an Item that already has a Review without extra state event or mutation', async () => {
    const item = await waitingItem(); const repository = new MySqlReviewWorkflowRepository(app)
    await app.execute('INSERT INTO reviews(id,item_id,actual_action,result,effective,incompatible,reason,adjustment,new_ideas,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', [id(), item.id, 'action', 'result', '', '', '', '', '', '2026-07-23 00:00:00.000', '2026-07-23 00:00:00.000'])
    const before = await snapshot()
    await expect(repository.complete(input(item.id))).rejects.toThrow('该事项已经完成复盘'); expect(await snapshot()).toEqual(before)
  })

  it('rejects an already reviewed Item without extra state event or mutation', async () => {
    const item = await waitingItem(); const repository = new MySqlReviewWorkflowRepository(app); await repository.complete(input(item.id)); const before = await snapshot()
    await expect(repository.complete(input(item.id))).rejects.toThrow('只有已开始或待复盘事项可以完成复盘'); expect(await snapshot()).toEqual(before)
  })

  it.each(['review', 'item', 'event', 'commit'] as const)('rolls all nine collections back when %s phase fails', async phase => {
    const item = await waitingItem(); const before = await snapshot()
    const repository = new MySqlReviewWorkflowRepository(app, {
      beforeReviewInsert: () => { if (phase === 'review') throw new Error('review failure') },
      beforeItemUpdate: () => { if (phase === 'item') throw new Error('item failure') },
      beforeStatusEventInsert: () => { if (phase === 'event') throw new Error('event failure') },
      beforeCommit: connection => { if (phase === 'commit') connection.destroy() },
    })
    await expect(repository.complete(input(item.id))).rejects.toThrow(phase === 'commit' ? undefined : `${phase} failure`)
    expect(await snapshot()).toEqual(before)
  })

  it('permits at most one concurrent completion for the same Item', async () => {
    const item = await waitingItem(); const first = new MySqlReviewWorkflowRepository(app); const second = new MySqlReviewWorkflowRepository(app)
    const results = await Promise.allSettled([first.complete(input(item.id)), second.complete(input(item.id))])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1); expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((await app.query('SELECT * FROM reviews WHERE item_id=?', [item.id]))[0]).toHaveLength(1)
    expect((await app.query('SELECT * FROM item_status_events WHERE item_id=?', [item.id]))[0]).toHaveLength(2)
    const completed = await new MySqlItemRepository(app).getById(item.id)
    expect(completed?.status).toBe('reviewed')
  })
})
