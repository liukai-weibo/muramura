import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createMySqlPool, MySqlItemRepository, MySqlMethodRepository, MySqlReviewRepository, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_MIGRATOR_PASSWORD', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
const id = () => `mysql-m3a-${crypto.randomUUID().slice(0, 8)}`
let database = ''; let appUser = ''; let migratorUser = ''; let appPassword = ''; let migratorPassword = ''
let root: ReturnType<typeof createMySqlPool>; let app: ReturnType<typeof createMySqlPool>; let migrator: ReturnType<typeof createMySqlPool>
const config = (user: string, password: string): MySqlConnectionConfig => ({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 2 })
const input = (title = ' 方法 ') => ({ title, applicable: ' 适用 ', unsuitable: ' 不适用 ', steps: ' 步骤 ' })

describe.runIf(enabled)('MySQL M3-A Method lifecycle repository', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', ''); database = `kbm3a_${suffix}`; appUser = `kbm3aa_${suffix.slice(0, 22)}`; migratorUser = `kbm3am_${suffix.slice(0, 22)}`; appPassword = crypto.randomUUID(); migratorPassword = crypto.randomUUID()
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``); await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword]); await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${appUser}'@'%'`); await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`); await root.query('FLUSH PRIVILEGES')
    app = createMySqlPool(config(appUser, appPassword)); migrator = createMySqlPool(config(migratorUser, migratorPassword)); await runMySqlMigrations(migrator, `${process.cwd()}/migrations`)
  })
  afterAll(async () => { await app?.end(); await migrator?.end(); await root?.query(`DROP DATABASE IF EXISTS \`${database}\``); await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`); await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`); await root?.end() })
  afterEach(async () => { await app.query('DELETE FROM item_status_events'); await app.query('DELETE FROM item_links'); await app.query('DELETE FROM method_applications'); await app.query('DELETE FROM method_evidence'); await app.query('DELETE FROM method_versions'); await app.query('DELETE FROM methods'); await app.query('DELETE FROM reviews'); await app.query('DELETE FROM items') })
  async function review() { const item = await new MySqlItemRepository(app).create({ title: id() }); return new MySqlReviewRepository(app).create({ itemId: item.id, actualAction: '行动', result: '结果', effective: '', incompatible: '', reason: '', adjustment: '' }) }
  async function lifecycleSnapshot() { const [methods, versions, evidence] = await Promise.all([app.query('SELECT * FROM methods ORDER BY id'), app.query('SELECT * FROM method_versions ORDER BY id'), app.query('SELECT * FROM method_evidence ORDER BY id')]); return { methods: methods[0], versions: versions[0], evidence: evidence[0] } }

  async function expect003PreflightFailure(
    expectedError: string,
    seed: (pool: ReturnType<typeof createMySqlPool>) => Promise<void>,
  ) {
    const suffix = crypto.randomUUID().replaceAll('-', '')
    const temporaryDatabase = `kbm3ap_${suffix}`
    const temporaryAppUser = `kbm3apa_${suffix.slice(0, 21)}`
    const temporaryMigratorUser = `kbm3apm_${suffix.slice(0, 21)}`
    const temporaryAppPassword = crypto.randomUUID()
    const temporaryMigratorPassword = crypto.randomUUID()
    const migrationDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-m3a-migrations-'))
    let temporaryApp: ReturnType<typeof createMySqlPool> | undefined
    let temporaryMigrator: ReturnType<typeof createMySqlPool> | undefined
    try {
      await fs.copyFile(path.join(process.cwd(), 'migrations', '001_initial_schema.sql'), path.join(migrationDirectory, '001_initial_schema.sql'))
      await fs.copyFile(path.join(process.cwd(), 'migrations', '002_add_system_metadata.sql'), path.join(migrationDirectory, '002_add_system_metadata.sql'))
      await root.query(`CREATE DATABASE \`${temporaryDatabase}\``)
      await root.query(`CREATE USER '${temporaryAppUser}'@'%' IDENTIFIED BY ?`, [temporaryAppPassword])
      await root.query(`CREATE USER '${temporaryMigratorUser}'@'%' IDENTIFIED BY ?`, [temporaryMigratorPassword])
      await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${temporaryDatabase}\`.* TO '${temporaryAppUser}'@'%'`)
      await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON \`${temporaryDatabase}\`.* TO '${temporaryMigratorUser}'@'%'`)
      await root.query('FLUSH PRIVILEGES')
      temporaryApp = createMySqlPool({ ...config(temporaryAppUser, temporaryAppPassword), database: temporaryDatabase })
      temporaryMigrator = createMySqlPool({ ...config(temporaryMigratorUser, temporaryMigratorPassword), database: temporaryDatabase })
      await runMySqlMigrations(temporaryMigrator, migrationDirectory)
      await seed(temporaryApp)
      await fs.copyFile(path.join(process.cwd(), 'migrations', '003_method_lifecycle_constraints.sql'), path.join(migrationDirectory, '003_method_lifecycle_constraints.sql'))
      await expect(runMySqlMigrations(temporaryMigrator, migrationDirectory)).rejects.toThrow(expectedError)
      expect((await temporaryApp.query('SELECT version FROM schema_migrations ORDER BY version'))[0]).toEqual([{ version: 1 }, { version: 2 }])
      const [indexes] = await temporaryApp.query<Array<RowDataPacket & { index_name: string }>>(
        `SELECT DISTINCT index_name FROM information_schema.statistics WHERE table_schema=?
         AND index_name IN ('method_evidence_method_review_unique','method_evidence_review_id_idx','method_versions_source_review_id_idx','method_applications_item_id_unique','method_applications_method_version_idx')`,
        [temporaryDatabase],
      )
      expect(indexes).toEqual([])
      const [foreignKeys] = await temporaryApp.query<Array<RowDataPacket & { constraint_name: string }>>(
        `SELECT constraint_name FROM information_schema.table_constraints WHERE constraint_schema=? AND constraint_type='FOREIGN KEY'
         AND constraint_name IN ('method_evidence_review_fk','method_versions_source_review_fk')`, [temporaryDatabase],
      )
      expect(foreignKeys).toEqual([])
    } finally {
      await temporaryApp?.end(); await temporaryMigrator?.end()
      await root.query(`DROP DATABASE IF EXISTS \`${temporaryDatabase}\``)
      await root.query(`DROP USER IF EXISTS '${temporaryAppUser}'@'%'`)
      await root.query(`DROP USER IF EXISTS '${temporaryMigratorUser}'@'%'`)
      await fs.rm(migrationDirectory, { recursive: true, force: true })
    }
  }

  it('proves every 003 preflight failure leaves zero 003 DDL and no successful migration record', async () => {
    await expect003PreflightFailure('003 migration 预检失败：存在重复方法证据', async pool => {
      const itemId = id(); const reviewId = id(); const methodId = id()
      await pool.execute('INSERT INTO items(id,title,content,status,created_at,updated_at) VALUES(?,?,?,"idea_to_try",UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))', [itemId, 'item', ''])
      await pool.execute('INSERT INTO reviews(id,item_id,actual_action,result,effective,incompatible,reason,adjustment,new_ideas,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))', [reviewId, itemId, 'action', 'result', '', '', '', '', ''])
      await pool.execute('INSERT INTO method_evidence(id,method_id,review_id,relation,method_version,created_at) VALUES(?,?,?,"validation",1,UTC_TIMESTAMP(3)),(?,?,?,"validation",1,UTC_TIMESTAMP(3))', [id(), methodId, reviewId, id(), methodId, reviewId])
    })
    await expect003PreflightFailure('003 migration 预检失败：存在重复方法应用事项', async pool => {
      const itemId = id()
      await pool.execute('INSERT INTO items(id,title,content,status,created_at,updated_at) VALUES(?,?,?,"idea_to_try",UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))', [itemId, 'item', ''])
      await pool.execute('INSERT INTO method_applications(id,method_id,method_version,item_id,created_at) VALUES(?,?,1,?,UTC_TIMESTAMP(3)),(?,?,1,?,UTC_TIMESTAMP(3))', [id(), id(), itemId, id(), id(), itemId])
    })
    await expect003PreflightFailure('003 migration 预检失败：存在断裂方法证据复盘引用', async pool => {
      await pool.execute('INSERT INTO method_evidence(id,method_id,review_id,relation,method_version,created_at) VALUES(?,?,?,"validation",1,UTC_TIMESTAMP(3))', [id(), id(), id()])
    })
    await expect003PreflightFailure('003 migration 预检失败：存在断裂方法版本复盘引用', async pool => {
      await pool.execute('INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at) VALUES(?,?,1,"method","applicable","","steps",?,UTC_TIMESTAMP(3))', [id(), id(), id()])
    })
  })

  it('migrates 003 with minimal migrator privileges and keeps app DML-only', async () => {
    expect((await app.query('SELECT version FROM schema_migrations WHERE version=3'))[0]).toEqual([{ version: 3 }])
    await expect(app.query('ALTER TABLE methods ADD COLUMN m3a_forbidden INT')).rejects.toMatchObject({ code: 'ER_TABLEACCESS_DENIED_ERROR' })
  })
  it('validates input and missing Review without writes', async () => {
    const repository = new MySqlMethodRepository(app)
    await expect(repository.createFromReview(input(' '), id())).rejects.toThrow('请完成方法标题、适用情况和具体步骤')
    await expect(repository.createFromReview(input(), id())).rejects.toThrow('关联复盘不存在')
    await expect(repository.validateFromReview(id(), id())).rejects.toThrow('选择的方法不存在')
    expect((await app.query('SELECT * FROM methods'))[0]).toEqual([])
  })
  it('creates method v1 and formation Evidence atomically, then validates and revises it', async () => {
    const repository = new MySqlMethodRepository(app); const formedBy = await review(); const method = await repository.createFromReview(input(), formedBy.id)
    expect(method).toMatchObject({ title: '方法', applicable: '适用', validationCount: 1, version: 1 })
    expect(await repository.listVersions(method.id)).toHaveLength(1)
    const validating = await review(); const validated = await repository.validateFromReview(method.id, validating.id)
    expect(validated).toMatchObject({ validationCount: 2, version: 1 })
    const revising = await review(); const revised = await repository.validateFromReview(method.id, revising.id, input('修订'))
    expect(revised).toMatchObject({ title: '修订', validationCount: 3, version: 2 })
    expect((await repository.listVersions(method.id)).map(value => value.version)).toEqual([1, 2])
    await expect(repository.validateFromReview(method.id, validating.id)).rejects.toThrow('该复盘已经验证过这个方法')
  })
  it('rolls complete create and revision snapshots back after injected later failures', async () => {
    const failingCreate = new MySqlMethodRepository(app, { beforeWrite: step => { if (step === 'create-evidence') throw new Error('injected create failure') } })
    await expect(failingCreate.createFromReview(input(), (await review()).id)).rejects.toThrow('injected create failure')
    expect(await lifecycleSnapshot()).toEqual({ methods: [], versions: [], evidence: [] })
    const source = await review(); const baseline = new MySqlMethodRepository(app); const method = await baseline.createFromReview(input(), source.id); const validating = await review(); const before = await lifecycleSnapshot()
    const failingRevision = new MySqlMethodRepository(app, { beforeWrite: step => { if (step === 'validate-evidence') throw new Error('injected revision failure') } })
    await expect(failingRevision.validateFromReview(method.id, validating.id, input('不应写入'))).rejects.toThrow('injected revision failure')
    expect(await lifecycleSnapshot()).toEqual(before)
  })
  it('lists active and trashed methods, review links, ordered versions, and stable missing Item fallback', async () => {
    const repository = new MySqlMethodRepository(app); const source = await review(); const method = await repository.createFromReview(input(), source.id); const revisionReview = await review(); await repository.validateFromReview(method.id, revisionReview.id, input('v2'))
    expect((await repository.listByReviewId(source.id)).map(value => value.id)).toEqual([method.id]); expect((await repository.listVersions(method.id)).map(value => value.version)).toEqual([1, 2])
    await repository.moveToTrash(method.id); expect((await repository.list()).map(value => value.id)).toEqual([]); expect((await repository.listDeleted()).map(value => value.id)).toEqual([method.id]); expect(await repository.listByReviewId(source.id)).toEqual([])
    await expect(repository.validateFromReview(method.id, (await review()).id)).rejects.toThrow('选择的方法不存在')
    await repository.restore(method.id)
    const [reviewRows] = await app.query<Array<RowDataPacket & { item_id: string }>>('SELECT item_id FROM reviews WHERE id=?', [source.id])
    await app.query('UPDATE items SET deleted_at=UTC_TIMESTAMP(3) WHERE id=?', [reviewRows[0]!.item_id])
    expect(await repository.listEvidenceDetails(method.id)).toEqual(expect.arrayContaining([expect.objectContaining({ reviewId: source.id, itemId: reviewRows[0]!.item_id, itemTitle: '关联事项已不存在' })]))
  })
})
