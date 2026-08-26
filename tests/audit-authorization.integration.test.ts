import crypto from 'node:crypto'
import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiServer } from '../apps/api/src/index'
import { createMySqlPool, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
let database = ''; let appUser = ''; let migratorUser = ''
let root: ReturnType<typeof createMySqlPool>; let app: ReturnType<typeof createMySqlPool>; let server: http.Server

interface RawResponse { status: number; headers: http.IncomingHttpHeaders; raw: string }
function rawRequest(path: string, cookie?: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ host: '127.0.0.1', port: (server.address() as { port: number }).port, path, headers: cookie ? { cookie } : {} }, incoming => {
      const chunks: Buffer[] = []
      incoming.on('data', chunk => chunks.push(Buffer.from(chunk)))
      incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, raw: Buffer.concat(chunks).toString('utf8') }))
    })
    outgoing.on('error', reject); outgoing.end()
  })
}
function register(username: string, password: string): Promise<{ cookie: string; userId: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ username, password })
    const outgoing = http.request({ host: '127.0.0.1', port: (server.address() as { port: number }).port, path: '/api/v1/auth/register', method: 'POST', headers: { 'content-type': 'application/json' } }, incoming => {
      const chunks: Buffer[] = []
      incoming.on('data', chunk => chunks.push(Buffer.from(chunk)))
      incoming.on('end', () => {
        const raw = Buffer.concat(chunks).toString()
        const parsed = JSON.parse(raw) as { user: { id: string } }
        resolve({ cookie: String(incoming.headers['set-cookie']).split(';')[0]!, userId: parsed.user.id })
      })
    })
    outgoing.on('error', reject); outgoing.write(body); outgoing.end()
  })
}

describe.runIf(enabled)('audit center authorization', () => {
  let adminCookie = ''; let adminId = ''; let ordinaryAdminId = ''; let ordinaryAdminCookie = ''; let memberCookie = ''

  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '')
    database = `kb_audit_api_${suffix}`; appUser = `kb_audit_app_${suffix.slice(0, 15)}`; migratorUser = `kb_audit_mig_${suffix.slice(0, 15)}`
    expect(database).not.toMatch(/^knowledge_base(?:_uat)?$/)
    const appPassword = crypto.randomUUID(); const migratorPassword = crypto.randomUUID()
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``)
    await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword]); await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${database}\`.* TO '${appUser}'@'%'`)
    await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,DROP,INDEX,REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`)
    const config = (user: string, password: string): MySqlConnectionConfig => ({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 8 })
    const migrator = createMySqlPool(config(migratorUser, migratorPassword)); await runMySqlMigrations(migrator, `${process.cwd()}/migrations`); await migrator.end()
    app = createMySqlPool(config(appUser, appPassword)); server = createApiServer(config(appUser, appPassword)); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

    const admin = await register('audit-admin', 'password-admin'); adminCookie = admin.cookie; adminId = admin.userId
    const ordinaryAdmin = await register('audit-ordinary-admin', 'password-ordinary-admin'); ordinaryAdminCookie = ordinaryAdmin.cookie; ordinaryAdminId = ordinaryAdmin.userId
    const member = await register('audit-member', 'password-member'); memberCookie = member.cookie
    await app.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES (?,'platform_admin',NULL,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [adminId])
    await app.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES (?,'ordinary_admin',NULL,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [ordinaryAdminId])
  }, 60_000)

  afterAll(async () => {
    const failures: unknown[] = []
    if (server) try { await new Promise<void>(resolve => server.close(() => resolve())) } catch (error) { failures.push(error) }
    if (app) try { await app.end() } catch (error) { failures.push(error) }
    if (root) {
      try { if (database) await root.query(`DROP DATABASE IF EXISTS \`${database}\``) } catch (error) { failures.push(error) }
      try { if (appUser) await root.query(`DROP USER IF EXISTS '${appUser}'@'%'`) } catch (error) { failures.push(error) }
      try { if (migratorUser) await root.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`) } catch (error) { failures.push(error) }
      try { await root.end() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'temporary audit API resources were not fully cleaned')
  }, 60_000)

  it('requires a session and reserves the audit center to platform_admin only', async () => {
    const unauthenticated = await rawRequest('/api/v1/admin/audit/events')
    expect(unauthenticated.status).toBe(401)

    const ordinaryAdminEvents = await rawRequest('/api/v1/admin/audit/events', ordinaryAdminCookie)
    expect(ordinaryAdminEvents.status).toBe(403)
    expect(JSON.parse(ordinaryAdminEvents.raw)).toMatchObject({ error: { code: 'FORBIDDEN', message: '无权访问审计中心' } })

    const memberEvents = await rawRequest('/api/v1/admin/audit/events', memberCookie)
    expect(memberEvents.status).toBe(403)
    expect(JSON.parse(memberEvents.raw)).toMatchObject({ error: { code: 'FORBIDDEN', message: '无权执行平台管理操作' } })

    const memberExport = await rawRequest('/api/v1/admin/audit/export', memberCookie)
    expect(memberExport.status).toBe(403)

    const adminEvents = await rawRequest('/api/v1/admin/audit/events', adminCookie)
    expect(adminEvents.status).toBe(200)
    expect(JSON.parse(adminEvents.raw)).toMatchObject({ items: [], page: 1, pageSize: 20, total: 0 })
  })

  it('exports a BOM-prefixed CSV for platform_admin', async () => {
    const exported = await rawRequest('/api/v1/admin/audit/export', adminCookie)
    expect(exported.status).toBe(200)
    expect(exported.headers['content-type']).toContain('text/csv')
    expect(exported.headers['content-disposition']).toContain('audit-events.csv')
    expect(exported.raw.startsWith('\uFEFF')).toBe(true)
    expect(exported.raw).toContain('时间,用户,模块,操作,目标ID,快照,风险等级')
  })
})

