import crypto from 'node:crypto'
import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiServer } from '../apps/api/src/index'
import { createMySqlPool, MySqlAuthRepository, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
type Response = { status: number; headers: http.IncomingHttpHeaders; body: any }
let database = ''; let appUser = ''; let migratorUser = ''
let root: ReturnType<typeof createMySqlPool>; let app: ReturnType<typeof createMySqlPool>; let server: http.Server

const request = (path: string, init: http.RequestOptions = {}, body?: string) => new Promise<Response>((resolve, reject) => {
  const outgoing = http.request({ host: '127.0.0.1', port: (server.address() as { port: number }).port, path, ...init }, incoming => {
    const chunks: Buffer[] = []
    incoming.on('data', chunk => chunks.push(Buffer.from(chunk)))
    incoming.on('end', () => { const raw = Buffer.concat(chunks).toString(); resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: raw ? JSON.parse(raw) : undefined }) })
  })
  outgoing.on('error', reject); if (body !== undefined) outgoing.write(body); outgoing.end()
})
const json = (path: string, value: unknown, cookie?: string, method = 'POST') => request(path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }, JSON.stringify(value))
const get = (path: string, cookie?: string) => request(path, { headers: cookie ? { cookie } : {} })
const cookieOf = (response: Response) => String(response.headers['set-cookie']).split(';')[0]!
const expectError = (response: Response, status: number, code: string) => {
  expect(response.status).toBe(status)
  expect(response.body).toMatchObject({ error: { code, requestId: expect.any(String) } })
  expect(response.headers['cache-control']).toBe('no-store')
  expect(response.headers['x-request-id']).toBe(response.body.error.requestId)
}

let adminCookie = ''; let adminId = ''; let memberCookie = ''; let targetCookie = ''; let targetId = ''

describe.runIf(enabled)('platform administration API', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '')
    database = `kb_platform_api_${suffix}`; appUser = `kb_platform_app_${suffix.slice(0, 15)}`; migratorUser = `kb_platform_mig_${suffix.slice(0, 15)}`
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

    const admin = await json('/api/v1/auth/register', { username: 'api-admin', password: 'password-admin' }); adminCookie = cookieOf(admin); adminId = admin.body.user.id
    const member = await json('/api/v1/auth/register', { username: 'api-member', password: 'password-member' }); memberCookie = cookieOf(member)
    const target = await json('/api/v1/auth/register', { username: 'literal%_=target', password: 'password-target' }); targetCookie = cookieOf(target); targetId = target.body.user.id
    await app.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at) VALUES (?,'platform_admin',NULL,UTC_TIMESTAMP(3))", [adminId])
    const auth = new MySqlAuthRepository(app)
    for (let index = 0; index < 21; index++) {
      await auth.createUser({ id: `page-user-${String(index).padStart(2, '0')}`, username: `page-user-${String(index).padStart(2, '0')}`, passwordHash: 'scrypt$redacted', createdAt: `2026-07-${String(index + 1).padStart(2, '0')}T08:00:00.000Z` })
    }
  })

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
    if (failures.length) throw new AggregateError(failures, 'temporary platform API resources were not fully cleaned')
  })

  it('returns 401 without a session and the same pre-routing 403 to members', async () => {
    expectError(await get('/api/v1/admin/users'), 401, 'UNAUTHORIZED')
    const [before] = await app.query('SELECT (SELECT COUNT(*) FROM user_roles) roles,(SELECT COUNT(*) FROM user_sessions) sessions,(SELECT COUNT(*) FROM security_audit_events) audit')
    const oversized = JSON.stringify({ padding: 'x'.repeat(64 * 1024) })
    const oversizedHeaders = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(oversized) }
    expectError(await request('/api/v1/admin/users/target/roles', { method: 'PUT', headers: oversizedHeaders }, oversized), 401, 'UNAUTHORIZED')
    expectError(await request('/api/v1/admin/users/target/roles', { method: 'PUT', headers: { ...oversizedHeaders, cookie: 'kb_session=invalid' } }, oversized), 401, 'UNAUTHORIZED')
    for (const response of [
      await get('/api/v1/admin/users', memberCookie),
      await request('/api/v1/admin/users/%E0%A4%A/roles', { method: 'PUT', headers: { cookie: memberCookie } }, 'not-json'),
      await json('/api/v1/admin/users/missing/roles', { roles: ['unknown'], extra: true }, memberCookie, 'PUT'),
      await request('/api/v1/admin/users/target/roles', { method: 'PUT', headers: { ...oversizedHeaders, cookie: memberCookie } }, oversized),
      await get('/api/v1/admin/not-a-route', memberCookie),
    ]) {
      expectError(response, 403, 'FORBIDDEN')
      expect(response.body.error.message).toBe('无权执行平台管理操作')
    }
    expectError(await request('/api/v1/admin/users/target/roles', { method: 'PUT', headers: { ...oversizedHeaders, cookie: adminCookie } }, oversized), 413, 'REQUEST_TOO_LARGE')
    expect((await app.query('SELECT (SELECT COUNT(*) FROM user_roles) roles,(SELECT COUNT(*) FROM user_sessions) sessions,(SELECT COUNT(*) FROM security_audit_events) audit'))[0]).toEqual(before)
  })

  it('lists fixed pages with strict query validation, stable DTOs and literal search', async () => {
    const first = await get('/api/v1/admin/users', adminCookie)
    expect(first.status).toBe(200); expect(first.body.page).toBe(1); expect(first.body.pageSize).toBe(20); expect(first.body.total).toBe(24); expect(first.body.items).toHaveLength(20)
    expect(Object.keys(first.body.items[0])).toEqual(['id', 'username', 'roles', 'createdAt'])
    expect(JSON.stringify(first.body)).not.toMatch(/password|hash|secret|session|audit|email/i)
    const last = await get('/api/v1/admin/users?page=2', adminCookie); expect(last.body.items).toHaveLength(4)
    const empty = await get('/api/v1/admin/users?page=99', adminCookie); expect(empty.body).toMatchObject({ items: [], page: 99, pageSize: 20, total: 24 })
    const literal = await get('/api/v1/admin/users?query=%25_%3D', adminCookie); expect(literal.body.items.map((item: { id: string }) => item.id)).toEqual([targetId])
    for (const path of ['/api/v1/admin/users?page=', '/api/v1/admin/users?page=0', '/api/v1/admin/users?page=1.0', '/api/v1/admin/users?page=%2B1', '/api/v1/admin/users?page=1&page=2', '/api/v1/admin/users?query=a&query=b', '/api/v1/admin/users?pageSize=20']) {
      expectError(await get(path, adminCookie), 400, 'VALIDATION_FAILED')
    }
  })

  it('changes only another user role, returns a real reread, and maps protected failures', async () => {
    const grantOperation = crypto.randomUUID()
    const granted = await json(`/api/v1/admin/users/${targetId}/roles`, { roles: ['member', 'platform_admin'], operationId: grantOperation }, adminCookie, 'PUT')
    expect(granted.status).toBe(200); expect(granted.body).toEqual({ id: targetId, username: 'literal%_=target', roles: ['member', 'platform_admin'], createdAt: expect.any(String) })
    expect((await get('/api/v1/auth/session', targetCookie)).body.user.roles).toEqual(['member', 'platform_admin'])
    expectError(await json(`/api/v1/admin/users/${adminId}/roles`, { roles: ['member'], operationId: crypto.randomUUID() }, adminCookie, 'PUT'), 403, 'FORBIDDEN')
    expectError(await json('/api/v1/admin/users/missing/roles', { roles: ['member'], operationId: crypto.randomUUID() }, adminCookie, 'PUT'), 404, 'NOT_FOUND')
    expectError(await json(`/api/v1/admin/users/${targetId}/roles`, { roles: ['member'], operationId: grantOperation }, adminCookie, 'PUT'), 409, 'CONFLICT')
    expectError(await json(`/api/v1/admin/users/${targetId}/roles`, { roles: ['platform_admin', 'member'], operationId: crypto.randomUUID() }, adminCookie, 'PUT'), 400, 'VALIDATION_FAILED')
    const revoked = await json(`/api/v1/admin/users/${targetId}/roles`, { roles: ['member'], operationId: crypto.randomUUID() }, adminCookie, 'PUT')
    expect(revoked.body.roles).toEqual(['member'])
  })

  it('rejects a write when the authenticated actor is downgraded before the repository lock', async () => {
    await app.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at) VALUES (?,'platform_admin',?,UTC_TIMESTAMP(3))", [targetId, adminId])
    const connection = await app.getConnection()
    try {
      await connection.beginTransaction()
      await connection.query("SELECT user_id FROM user_roles FORCE INDEX (user_roles_role_user_idx) WHERE role_code='platform_admin' ORDER BY user_id FOR UPDATE")
      const auditBefore = Number((await app.query<any[]>("SELECT COUNT(*) count FROM security_audit_events"))[0][0].count)
      const pending = json(`/api/v1/admin/users/${targetId}/roles`, { roles: ['member'], operationId: crypto.randomUUID() }, adminCookie, 'PUT')
      await new Promise(resolve => setTimeout(resolve, 50))
      await connection.query("DELETE FROM user_roles WHERE user_id=? AND role_code='platform_admin'", [adminId])
      await connection.commit()
      expectError(await pending, 403, 'FORBIDDEN')
      expect(Number((await app.query<any[]>("SELECT COUNT(*) count FROM security_audit_events"))[0][0].count)).toBe(auditBefore)
      expect((await app.query<any[]>("SELECT role_code FROM user_roles WHERE user_id=? ORDER BY role_code", [targetId]))[0]).toEqual([{ role_code: 'member' }, { role_code: 'platform_admin' }])
    } finally {
      try { await connection.rollback() } catch { /* The transaction may already be committed. */ }
      connection.release()
      await app.query("INSERT IGNORE INTO user_roles(user_id,role_code,granted_by_user_id,created_at) VALUES (?,'platform_admin',NULL,UTC_TIMESTAMP(3))", [adminId])
      await app.query("DELETE FROM user_roles WHERE user_id=? AND role_code='platform_admin'", [targetId])
    }
  })

  it('revokes only another user sessions and leaves actor authorization intact', async () => {
    expectError(await json(`/api/v1/admin/users/${adminId}/revoke-sessions`, { operationId: crypto.randomUUID() }, adminCookie), 403, 'FORBIDDEN')
    const revoked = await json(`/api/v1/admin/users/${targetId}/revoke-sessions`, { operationId: crypto.randomUUID() }, adminCookie)
    expect(revoked.status).toBe(200); expect(revoked.body.revokedSessionCount).toBeGreaterThanOrEqual(1)
    expectError(await get('/api/v1/auth/session', targetCookie), 401, 'UNAUTHORIZED')
    expect((await get('/api/v1/admin/users', adminCookie)).status).toBe(200)
  })
})
