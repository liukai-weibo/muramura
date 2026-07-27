import crypto from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ItemStatus } from '@knowledge-base/contracts'
import { allowedTransitions } from '@knowledge-base/domain'
import { createMySqlPool, MySqlItemRepository, type MySqlConnectionConfig, runMySqlMigrations } from '../packages/storage-mysql/src/index'

const required = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD']
const enabled = required.every(name => Boolean(process.env[name]))
let database = ''
let appUser = ''
let migratorUser = ''
let appPassword = ''
let migratorPassword = ''
let rootPool: ReturnType<typeof createMySqlPool>
let appPool: ReturnType<typeof createMySqlPool>
let migratorPool: ReturnType<typeof createMySqlPool>
const config = (user: string, password: string): MySqlConnectionConfig => ({
  host: process.env.MYSQL_HOST!,
  port: Number(process.env.MYSQL_PORT!),
  database,
  user,
  password,
  connectionLimit: 2,
})
const prefix = 'mysql-m2a-'
const cutoff = '2099-01-01T00:00:00.000Z'
const testId = () => `${prefix}${crypto.randomUUID()}`
const statuses: ItemStatus[] = ['idea_to_try', 'idea_later', 'doing', 'paused', 'waiting_review', 'reviewed', 'archived_no_review', 'abandoned']

async function snapshot(itemId: string) {
  const [items] = await appPool.query('SELECT * FROM items WHERE id=? ORDER BY id', [itemId])
  const [events] = await appPool.query('SELECT * FROM item_status_events WHERE item_id=? ORDER BY id', [itemId])
  const [reviews] = await appPool.query('SELECT * FROM reviews WHERE item_id=? ORDER BY id', [itemId])
  const [links] = await appPool.query('SELECT * FROM item_links WHERE target_item_id=? OR source_review_id IN (SELECT id FROM reviews WHERE item_id=?) ORDER BY id', [itemId, itemId])
  const [applications] = await appPool.query('SELECT * FROM method_applications WHERE item_id=? ORDER BY id', [itemId])
  const [evidence] = await appPool.query('SELECT * FROM method_evidence WHERE review_id IN (SELECT id FROM reviews WHERE item_id=?) ORDER BY id', [itemId])
  const [versions] = await appPool.query('SELECT * FROM method_versions WHERE source_review_id IN (SELECT id FROM reviews WHERE item_id=?) ORDER BY id', [itemId])
  return { items, events, reviews, links, applications, evidence, versions }
}

async function seedReview(itemId: string) {
  const reviewId = testId()
  await appPool.execute(
    'INSERT INTO reviews(id,item_id,actual_action,result,effective,incompatible,reason,adjustment,new_ideas,created_at,updated_at) VALUES(?,? ,"","","","","","","",UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))',
    [reviewId, itemId],
  )
  return reviewId
}

async function clearSyntheticData() {
  await appPool.query('DELETE FROM item_links WHERE id LIKE ? OR source_review_id LIKE ? OR target_item_id LIKE ?', [`${prefix}%`, `${prefix}%`, `${prefix}%`])
  await appPool.query('DELETE FROM method_applications WHERE id LIKE ? OR method_id LIKE ? OR item_id LIKE ?', [`${prefix}%`, `${prefix}%`, `${prefix}%`])
  await appPool.query('DELETE FROM method_evidence WHERE id LIKE ? OR method_id LIKE ? OR review_id LIKE ?', [`${prefix}%`, `${prefix}%`, `${prefix}%`])
  await appPool.query('DELETE FROM method_versions WHERE id LIKE ? OR method_id LIKE ? OR source_review_id LIKE ?', [`${prefix}%`, `${prefix}%`, `${prefix}%`])
  await appPool.query('DELETE FROM methods WHERE id LIKE ?', [`${prefix}%`])
  await appPool.query('DELETE FROM method_tombstones WHERE method_id LIKE ?', [`${prefix}%`])
  await appPool.query('DELETE FROM item_status_events WHERE id LIKE ? OR item_id LIKE ?', [`${prefix}%`, `${prefix}%`])
  await appPool.query('DELETE FROM reviews WHERE id LIKE ? OR item_id LIKE ?', [`${prefix}%`, `${prefix}%`])
  await appPool.query('DELETE FROM items WHERE id LIKE ?', [`${prefix}%`])
}

describe.runIf(enabled)('MySQL M2-A Item Repository', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '')
    database = `kb_m2a_${suffix}`
    appUser = `kbm2aa_${suffix.slice(0, 22)}`
    migratorUser = `kbm2am_${suffix.slice(0, 22)}`
    appPassword = crypto.randomUUID()
    migratorPassword = crypto.randomUUID()
    expect(database).toMatch(/^kb_m2a_/)
    expect(database).not.toBe(process.env.MYSQL_DATABASE)
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
    await runMySqlMigrations(migratorPool, `${process.cwd()}/migrations`)
  })
  afterAll(async () => {
    await appPool?.end()
    await migratorPool?.end()
    await rootPool?.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await rootPool?.query(`DROP USER IF EXISTS '${appUser}'@'%'`)
    await rootPool?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`)
    await rootPool?.end()
  })
  afterEach(async () => { await clearSyntheticData() })

  it('creates trimmed items with atomic initial history and preserves UTC contract fields', async () => {
    const repository = new MySqlItemRepository(appPool)
    const item = await repository.create({ title: ` ${testId()} `, content: ' content ' })
    expect(item).toMatchObject({ content: 'content', status: 'idea_to_try' })
    expect(item.title).toMatch(/^mysql-m2a-/)
    expect(item).not.toHaveProperty('startAction')
    expect(item.createdAt).toMatch(/Z$/)
    expect(item.updatedAt).toMatch(/Z$/)
    expect(await repository.listStatusEvents(item.id)).toMatchObject([{ itemId: item.id, toStatus: 'idea_to_try' }])
    expect(await repository.list()).toContainEqual(expect.objectContaining({ id: item.id }))
    await repository.delete(item.id)
    expect(await repository.listDeleted()).toContainEqual(expect.objectContaining({ id: item.id }))
    await expect(repository.create({ title: ' ' })).rejects.toThrow('标题不能为空')
  })

  it('writes Item and initial history atomically when event insertion fails', async () => {
    const title = testId()
    const repository = new MySqlItemRepository(appPool!, { beforeStatusEventInsert: () => { throw new Error('test event failure') } })
    await expect(repository.create({ title })).rejects.toThrow('test event failure')
    const [items] = await appPool!.query('SELECT * FROM items WHERE title=?', [title])
    expect(items).toEqual([])
  })

  it('supports every legal state transition and rejects every illegal transition without mutation', async () => {
    const repository = new MySqlItemRepository(appPool!)
    for (const from of statuses) {
      for (const to of statuses) {
        const item = await repository.create({ title: testId(), status: from })
        const before = await snapshot(item.id)
        if (allowedTransitions(from).includes(to)) {
          const updated = await repository.changeStatus(item.id, to)
          expect(updated.status).toBe(to)
          const events = await repository.listStatusEvents(item.id)
          expect(events.at(-1)).toMatchObject({ fromStatus: from, toStatus: to })
        } else {
          await expect(repository.changeStatus(item.id, to)).rejects.toThrow(`不允许从 ${from}`)
          expect(await snapshot(item.id)).toEqual(before)
        }
      }
    }
  }, 30000)

  it('rolls status and start snapshots back when their final event write fails', async () => {
    const stable = new MySqlItemRepository(appPool!)
    const failing = new MySqlItemRepository(appPool!, { beforeStatusEventInsert: () => { throw new Error('test event failure') } })
    const statusItem = await stable.create({ title: testId() })
    const statusBefore = await snapshot(statusItem.id)
    await expect(failing.changeStatus(statusItem.id, 'doing')).rejects.toThrow('test event failure')
    expect(await snapshot(statusItem.id)).toEqual(statusBefore)

    const startItem = await stable.create({ title: testId() })
    const startBefore = await snapshot(startItem.id)
    await expect(failing.startExecution(startItem.id, { startAction: ' start ' })).rejects.toThrow('test event failure')
    expect(await snapshot(startItem.id)).toEqual(startBefore)
  })

  it('normalizes start actions, retains content across status changes, and never revives deleted Items', async () => {
    const repository = new MySqlItemRepository(appPool!)
    const item = await repository.create({ title: testId() })
    const started = await repository.startExecution(item.id, { startAction: ' start ' })
    expect(started).toMatchObject({ status: 'doing', startAction: 'start' })
    await repository.updateContent(item.id, { content: ' saved ' })
    expect(await repository.changeStatus(item.id, 'paused')).toMatchObject({ status: 'paused', content: 'saved', startAction: 'start' })
    await repository.delete(item.id)
    await expect(repository.updateContent(item.id, { content: 'must fail' })).rejects.toThrow('事项不存在')
    expect(await repository.getById(item.id)).toMatchObject({ status: 'paused', content: 'saved', deletedAt: expect.any(String) })
    await repository.restore(item.id)
    expect(await repository.getById(item.id)).toMatchObject({ status: 'paused', content: 'saved', startAction: 'start' })

    const concurrent = await repository.create({ title: testId() })
    await Promise.all([
      repository.updateContent(concurrent.id, { content: ' concurrent content ' }),
      repository.changeStatus(concurrent.id, 'doing'),
    ])
    expect(await repository.getById(concurrent.id)).toMatchObject({ status: 'doing', content: 'concurrent content' })

    const empty = await repository.create({ title: testId() })
    const emptyStarted = await repository.startExecution(empty.id, { startAction: '   ' })
    expect(emptyStarted).toMatchObject({ status: 'doing' })
    expect(emptyStarted).not.toHaveProperty('startAction')
  })

  it('requires confirmation before atomically overwriting an existing start action after restart', async () => {
    const repository = new MySqlItemRepository(appPool!)
    const item = await repository.create({ title: testId() })
    await repository.startExecution(item.id, { startAction: 'original action' })
    await repository.changeStatus(item.id, 'abandoned')
    await repository.changeStatus(item.id, 'idea_to_try')

    const before = await snapshot(item.id)
    await expect(repository.startExecution(item.id, { startAction: 'replacement action' })).rejects.toThrow('启动动作已存在，不能重写')
    expect(await snapshot(item.id)).toEqual(before)

    const started = await repository.startExecution(item.id, { startAction: 'replacement action', overwriteExistingStartAction: true })
    expect(started).toMatchObject({ status: 'doing', startAction: 'replacement action' })
    const events = await repository.listStatusEvents(item.id)
    expect(events.filter(event => event.toStatus === 'doing')).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({ fromStatus: 'idea_to_try', toStatus: 'doing' })
  })

  it('does not purge an Item restored before the purge transaction reads current candidates', async () => {
    const base = new MySqlItemRepository(appPool!)
    const item = await base.create({ title: testId() })
    await base.delete(item.id)
    const repository = new MySqlItemRepository(appPool!, { beforePurgeTransaction: async () => { await base.restore(item.id) } })
    await repository.purgeDeletedBefore(cutoff)
    expect(await base.getById(item.id)).toMatchObject({ id: item.id })
    expect(await base.listStatusEvents(item.id)).toHaveLength(1)
  })

  it('purges unassociated Items and their determined links without treating isolated tombstones as blockers', async () => {
    const repository = new MySqlItemRepository(appPool!)
    const target = await repository.create({ title: testId() })
    const other = await repository.create({ title: testId() })
    const item = await repository.create({ title: testId() })
    const itemReview = await seedReview(item.id)
    const otherReview = await seedReview(other.id)
    await appPool!.execute('INSERT INTO item_links(id,source_review_id,target_item_id,type,created_at) VALUES(?,?,?,"derived",UTC_TIMESTAMP(3))', [testId(), itemReview, target.id])
    await appPool!.execute('INSERT INTO item_links(id,source_review_id,target_item_id,type,created_at) VALUES(?,?,?,"derived",UTC_TIMESTAMP(3))', [testId(), otherReview, item.id])
    const tombstoneId = testId()
    await appPool!.execute('INSERT INTO method_tombstones(method_id,title,permanently_deleted_at,versions) VALUES(?,"isolated",UTC_TIMESTAMP(3),JSON_ARRAY())', [tombstoneId])
    await repository.delete(item.id)
    await repository.purgeDeletedBefore(cutoff)
    expect(await repository.getById(item.id)).toBeUndefined()
    const [links] = await appPool!.query('SELECT id FROM item_links WHERE source_review_id=? OR target_item_id=?', [itemReview, item.id])
    const [reviews] = await appPool!.query('SELECT id FROM reviews WHERE id=?', [itemReview])
    const [tombstones] = await appPool!.query('SELECT method_id FROM method_tombstones WHERE method_id=?', [tombstoneId])
    expect(links).toEqual([])
    expect(reviews).toEqual([])
    expect(tombstones).toHaveLength(1)
  })

  it('purges an Item with a real MethodApplication relation and removes now-unreferenced Method history', async () => {
    const repository = new MySqlItemRepository(appPool!)
    const item = await repository.create({ title: testId() })
    const reviewId = await seedReview(item.id)
    const methodId = testId(); const versionId = testId(); const applicationId = testId()
    const tombstoneId = methodId
    await appPool!.execute('INSERT INTO methods(id,title,applicable,unsuitable,steps,validation_count,version,created_at,updated_at) VALUES(?,?,"","","",1,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))', [methodId, '应用方法'])
    await appPool!.execute('INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at) VALUES(?,?,1,"应用方法","","","",NULL,UTC_TIMESTAMP(3))', [versionId, methodId])
    await appPool!.execute('INSERT INTO method_applications(id,method_id,method_version,item_id,created_at) VALUES(?,?,1,?,UTC_TIMESTAMP(3))', [applicationId, methodId, item.id])
    await appPool!.execute('INSERT INTO method_tombstones(method_id,title,permanently_deleted_at,versions) VALUES(?,?,UTC_TIMESTAMP(3),JSON_ARRAY(JSON_OBJECT("version", 1)))', [tombstoneId, '应用方法'])
    const linkedTarget = await repository.create({ title: testId() })
    await appPool!.execute('INSERT INTO item_links(id,source_review_id,target_item_id,type,created_at) VALUES(?,?,?,"derived",UTC_TIMESTAMP(3))', [testId(), reviewId, linkedTarget.id])
    await repository.delete(item.id)

    await repository.purgeDeletedBefore(cutoff)

    expect((await appPool!.query('SELECT * FROM items WHERE id=?', [item.id]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM item_status_events WHERE item_id=?', [item.id]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM reviews WHERE id=?', [reviewId]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM item_links WHERE source_review_id=? OR target_item_id=?', [reviewId, item.id]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM method_applications WHERE id=?', [applicationId]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM method_versions WHERE method_id=?', [methodId]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM methods WHERE id=?', [methodId]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM method_tombstones WHERE method_id=?', [tombstoneId]))[0]).toEqual([])
  })

  it('purges an Item with a real MethodEvidence relation without orphaning Method history', async () => {
    const repository = new MySqlItemRepository(appPool!)
    const item = await repository.create({ title: testId() })
    const reviewId = await seedReview(item.id)
    const methodId = testId(); const versionId = testId(); const evidenceId = testId()
    await appPool!.execute('INSERT INTO methods(id,title,applicable,unsuitable,steps,validation_count,version,created_at,updated_at) VALUES(?,?,"","","",1,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))', [methodId, '证据方法'])
    await appPool!.execute('INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at) VALUES(?,?,1,"证据方法","","","",NULL,UTC_TIMESTAMP(3))', [versionId, methodId])
    await appPool!.execute('INSERT INTO method_evidence(id,method_id,review_id,relation,method_version,created_at) VALUES(?,?,?,"formation",1,UTC_TIMESTAMP(3))', [evidenceId, methodId, reviewId])
    const target = await repository.create({ title: testId() })
    await appPool!.execute('INSERT INTO item_links(id,source_review_id,target_item_id,type,created_at) VALUES(?,?,?,"derived",UTC_TIMESTAMP(3))', [testId(), reviewId, target.id])
    await repository.delete(item.id)

    await repository.purgeDeletedBefore(cutoff)

    expect((await appPool!.query('SELECT * FROM items WHERE id=?', [item.id]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM item_status_events WHERE item_id=?', [item.id]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM reviews WHERE id=?', [reviewId]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM item_links WHERE source_review_id=? OR target_item_id=?', [reviewId, item.id]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM method_evidence WHERE id=?', [evidenceId]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM method_versions WHERE method_id=?', [methodId]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM methods WHERE id=?', [methodId]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM method_tombstones WHERE method_id=?', [methodId]))[0]).toEqual([])
  })

  it('nulls only the purged Review source on a Method with remaining real Evidence', async () => {
    const repository = new MySqlItemRepository(appPool!)
    const item = await repository.create({ title: testId() })
    const deletedReviewId = await seedReview(item.id)
    const retainedItem = await repository.create({ title: testId() })
    const retainedReviewId = await seedReview(retainedItem.id)
    const methodId = testId(); const deletedSourceVersionId = testId(); const retainedVersionId = testId(); const retainedEvidenceId = testId()
    await appPool!.execute('INSERT INTO methods(id,title,applicable,unsuitable,steps,validation_count,version,created_at,updated_at) VALUES(?,?,"","","",1,2,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))', [methodId, '保留方法'])
    await appPool!.execute('INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at) VALUES(?,?,1,"保留方法","","","",?,UTC_TIMESTAMP(3))', [deletedSourceVersionId, methodId, deletedReviewId])
    await appPool!.execute('INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at) VALUES(?,?,2,"保留方法","","","",?,UTC_TIMESTAMP(3))', [retainedVersionId, methodId, retainedReviewId])
    await appPool!.execute('INSERT INTO method_evidence(id,method_id,review_id,relation,method_version,created_at) VALUES(?,?,?,"validation",2,UTC_TIMESTAMP(3))', [retainedEvidenceId, methodId, retainedReviewId])
    await appPool!.execute('INSERT INTO item_links(id,source_review_id,target_item_id,type,created_at) VALUES(?,?,?,"derived",UTC_TIMESTAMP(3))', [testId(), deletedReviewId, retainedItem.id])
    await repository.delete(item.id)

    await repository.purgeDeletedBefore(cutoff)

    expect((await appPool!.query('SELECT * FROM items WHERE id=?', [item.id]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM item_status_events WHERE item_id=?', [item.id]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM reviews WHERE id=?', [deletedReviewId]))[0]).toEqual([])
    expect((await appPool!.query('SELECT * FROM item_links WHERE source_review_id=?', [deletedReviewId]))[0]).toEqual([])
    expect((await appPool!.query('SELECT source_review_id FROM method_versions WHERE id=?', [deletedSourceVersionId]))[0]).toEqual([{ source_review_id: null }])
    expect((await appPool!.query('SELECT source_review_id FROM method_versions WHERE id=?', [retainedVersionId]))[0]).toEqual([{ source_review_id: retainedReviewId }])
    expect((await appPool!.query('SELECT * FROM methods WHERE id=?', [methodId]))[0]).toHaveLength(1)
    expect((await appPool!.query('SELECT * FROM method_evidence WHERE id=?', [retainedEvidenceId]))[0]).toHaveLength(1)
    expect((await appPool!.query('SELECT * FROM reviews WHERE id=?', [retainedReviewId]))[0]).toHaveLength(1)
  })
})
