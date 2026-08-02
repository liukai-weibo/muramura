import crypto from 'node:crypto'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runInitialPlatformAdminCli } from '../apps/api/src/grant-initial-platform-admin'
import { createMySqlPool, MySqlAuthRepository, runMySqlMigrations } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
let database = ''
let appUser = ''
let migratorUser = ''
let appPassword = ''
let migratorPassword = ''
let root: Pool
let app: Pool
let migrator: Pool

describe.runIf(enabled)('initial platform administrator CLI', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '')
    database = `kb_platform_cli_${suffix}`
    appUser = `kb_platform_app_${suffix.slice(0, 15)}`
    migratorUser = `kb_platform_mig_${suffix.slice(0, 15)}`
    appPassword = crypto.randomUUID()
    migratorPassword = crypto.randomUUID()
    expect(database).not.toBe('knowledge_base')
    expect(database).not.toBe('knowledge_base_uat')
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``)
    await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword])
    await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${database}\`.* TO '${appUser}'@'%'`)
    await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,DROP,INDEX,REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`)
    const config = (user: string, password: string) => ({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 2 })
    app = createMySqlPool(config(appUser, appPassword))
    migrator = createMySqlPool(config(migratorUser, migratorPassword))
    await runMySqlMigrations(migrator, `${process.cwd()}/migrations`)
    const auth = new MySqlAuthRepository(app)
    await auth.createUser({ id: 'target-a', username: 'target-a', passwordHash: 'scrypt$redacted', createdAt: '2026-07-30T00:00:00.000Z' })
    await auth.createUser({ id: 'target-b', username: 'target-b', passwordHash: 'scrypt$redacted', createdAt: '2026-07-30T00:00:00.000Z' })
    await app.query("INSERT INTO users(id,username,password_hash,created_at) VALUES ('no-member','no-member','scrypt$redacted',UTC_TIMESTAMP(3))")
  })

  afterAll(async () => {
    await app?.end()
    await migrator?.end()
    await root?.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`)
    await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`)
    await root?.end()
  })
  beforeEach(async () => {
    await app.query('DELETE FROM security_audit_events')
    await app.query("DELETE FROM user_roles WHERE role_code='platform_admin'")
  })

  const environment = () => ({
    MYSQL_HOST: process.env.MYSQL_HOST!, MYSQL_PORT: process.env.MYSQL_PORT!, MYSQL_DATABASE: database,
    MYSQL_APP_USER: appUser, MYSQL_APP_PASSWORD: appPassword, MYSQL_POOL_CONNECTION_LIMIT: '2',
  })
  const invoke = async (args: string[], env: NodeJS.ProcessEnv = environment()) => {
    const stdout: string[] = []; const stderr: string[] = []
    const code = await runInitialPlatformAdminCli(args, env, { stdout: value => stdout.push(value), stderr: value => stderr.push(value) })
    return { code, stdout, stderr }
  }
  const args = (userId: string, expected = database) => ['--', `--user-id=${userId}`, `--expected-database=${expected}`, '--apply']

  it('rejects invalid arguments before environment access and rejects database/schema gates without writes', async () => {
    const inaccessible = new Proxy({}, { get: () => { throw new Error('environment accessed') } }) as NodeJS.ProcessEnv
    for (const invalid of [[], ['--user-id=target-a'], [...args('target-a'), '--apply'], [...args('target-a'), 'extra'], ['--user-id=', `--expected-database=${database}`, '--apply']]) {
      const result = await invoke(invalid, inaccessible)
      expect(result).toMatchObject({ code: 1, stdout: [], stderr: [expect.stringMatching(/^USAGE:/)] })
    }
    expect(await invoke(args('target-a', `${database}_wrong`))).toMatchObject({ code: 1, stdout: [], stderr: ['DATABASE_MISMATCH'] })
    const [versionRows] = await app.query<Array<RowDataPacket & { version: number; name: string; checksum: string; applied_at: Date }>>('SELECT version,name,checksum,applied_at FROM schema_migrations WHERE version=6')
    await app.query('DELETE FROM schema_migrations WHERE version=6')
    try { expect(await invoke(args('target-a'))).toMatchObject({ code: 1, stdout: [], stderr: ['SCHEMA_NOT_READY'] }) }
    finally {
      const row = versionRows[0]!
      await app.query('INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES (?,?,?,?)', [row.version, row.name, row.checksum, row.applied_at])
    }
    await migrator.query('RENAME TABLE security_audit_events TO security_audit_events_missing')
    try { expect(await invoke(args('target-a'))).toMatchObject({ code: 1, stdout: [], stderr: ['SCHEMA_NOT_READY'] }) }
    finally { await migrator.query('RENAME TABLE security_audit_events_missing TO security_audit_events') }
    expect((await app.query("SELECT role_code FROM user_roles WHERE role_code='platform_admin'"))[0]).toEqual([])
  })

  it('rejects missing or non-member targets, grants once, and returns same-target initialization without a new audit', async () => {
    expect(await invoke(args('missing'))).toMatchObject({ code: 1, stdout: [], stderr: ['PLATFORM_ADMIN_USER_NOT_FOUND'] })
    expect(await invoke(args('no-member'))).toMatchObject({ code: 1, stdout: [], stderr: ['PLATFORM_ADMIN_TARGET_NOT_MEMBER'] })
    const granted = await invoke(args('target-a'))
    expect(granted.code).toBe(0)
    expect(granted.stderr).toEqual([])
    expect(granted.stdout).toHaveLength(1)
    const output = JSON.parse(granted.stdout[0]!)
    expect(output).toEqual({ status: 'granted', database, userId: 'target-a', operationId: expect.any(String) })
    expect(JSON.stringify(output)).not.toMatch(/password|hash|secret|token|username/i)
    const beforeAudit = Number(((await app.query<Array<RowDataPacket & { count: number }>>('SELECT COUNT(*) count FROM security_audit_events'))[0][0]!).count)
    expect(await invoke(args('target-a'))).toMatchObject({ code: 0, stderr: [], stdout: [JSON.stringify({ status: 'already-initialized', database, userId: 'target-a' })] })
    expect(Number(((await app.query<Array<RowDataPacket & { count: number }>>('SELECT COUNT(*) count FROM security_audit_events'))[0][0]!).count)).toBe(beforeAudit)
    expect(await invoke(args('target-b'))).toMatchObject({ code: 1, stdout: [], stderr: ['PLATFORM_ADMIN_ALREADY_INITIALIZED'] })
    expect((await app.query("SELECT user_id,granted_by_user_id FROM user_roles WHERE role_code='platform_admin'"))[0]).toEqual([{ user_id: 'target-a', granted_by_user_id: null }])
    expect((await app.query('SELECT actor_user_id,target_user_id,action_code FROM security_audit_events'))[0]).toEqual([{ actor_user_id: null, target_user_id: 'target-a', action_code: 'platform_admin_granted' }])
  })

  it('serializes concurrent CLI calls for different and identical explicit targets', async () => {
    const different = await Promise.all([invoke(args('target-a')), invoke(args('target-b'))])
    expect(different.filter(result => result.code === 0)).toHaveLength(1)
    expect(different.filter(result => result.code === 1)).toEqual([expect.objectContaining({ stdout: [], stderr: ['PLATFORM_ADMIN_ALREADY_INITIALIZED'] })])
    expect((await app.query("SELECT user_id FROM user_roles WHERE role_code='platform_admin'"))[0]).toHaveLength(1)
    expect((await app.query('SELECT id FROM security_audit_events'))[0]).toHaveLength(1)

    await app.query('DELETE FROM security_audit_events')
    await app.query("DELETE FROM user_roles WHERE role_code='platform_admin'")
    const same = await Promise.all([invoke(args('target-a')), invoke(args('target-a'))])
    expect(same.map(result => result.code)).toEqual([0, 0])
    expect(same.map(result => JSON.parse(result.stdout[0]!).status).sort()).toEqual(['already-initialized', 'granted'])
    expect((await app.query("SELECT user_id FROM user_roles WHERE role_code='platform_admin'"))[0]).toEqual([{ user_id: 'target-a' }])
    expect((await app.query('SELECT id FROM security_audit_events'))[0]).toHaveLength(1)
  })
})
