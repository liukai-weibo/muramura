import crypto from 'node:crypto'
import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiServer } from '../apps/api/src/index'
import { createMySqlPool, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
let database = ''; let appUser = ''; let migratorUser = ''; let root: ReturnType<typeof createMySqlPool>; let app: ReturnType<typeof createMySqlPool>; let server: http.Server
const request = (path: string, init: http.RequestOptions = {}, body?: string) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: unknown }>((resolve, reject) => { const req = http.request({ host: '127.0.0.1', port: (server.address() as { port: number }).port, path, ...init }, response => { const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => { const raw = Buffer.concat(chunks).toString(); resolve({ status: response.statusCode ?? 0, headers: response.headers, body: raw ? JSON.parse(raw) : undefined }) }); }); req.on('error', reject); if (body) req.write(body); req.end() })
const json = (path: string, value: unknown, cookie?: string, method = 'POST') => request(path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }, JSON.stringify(value))
const cookieOf = (response: { headers: http.IncomingHttpHeaders }) => String(response.headers['set-cookie']).split(';')[0]!

describe.runIf(enabled)('authentication API', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', ''); database = `kb_accounts_${suffix}`; appUser = `kb_auth_app_${suffix.slice(0, 19)}`; migratorUser = `kb_auth_migrator_${suffix.slice(0, 14)}`
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``); await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [crypto.randomUUID()]); await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [crypto.randomUUID()])
    const appPassword = crypto.randomUUID(); const migratorPassword = crypto.randomUUID(); await root.query(`ALTER USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword]); await root.query(`ALTER USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword]); await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${database}\`.* TO '${appUser}'@'%'`); await root.query(`GRANT SELECT,INSERT,UPDATE,CREATE,ALTER,INDEX,REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`)
    const cfg = (user: string, password: string): MySqlConnectionConfig => ({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 1 }); const migrator = createMySqlPool(cfg(migratorUser, migratorPassword)); await runMySqlMigrations(migrator, `${process.cwd()}/migrations`); await migrator.end(); app = createMySqlPool(cfg(appUser, appPassword)); server = createApiServer(cfg(appUser, appPassword)); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  })
  afterAll(async () => { await new Promise<void>(resolve => server?.close(() => resolve())); await app?.end(); await root?.query(`DROP DATABASE IF EXISTS \`${database}\``); await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`); await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`); await root?.end() })
  it('registers, authenticates, expires, logs out, and never exposes secrets', async () => {
    const registered = await json('/api/v1/auth/register', { username: ' alice ', password: 'password-123' }); expect(registered.status, JSON.stringify(registered.body)).toBe(201); expect(registered.body).toEqual({ user: { id: expect.any(String), username: 'alice', roles: ['member'], createdAt: expect.any(String) } }); expect(JSON.stringify(registered.body)).not.toMatch(/password|hash|token|secret/i)
    const setCookie = String(registered.headers['set-cookie']); expect(setCookie).toMatch(/HttpOnly; SameSite=Lax; Path=\/; Expires=/); expect(setCookie).not.toMatch(/Secure/); const cookie = setCookie.split(';')[0]!
    const duplicate = await json('/api/v1/auth/register', { username: 'alice', password: 'password-123' }); expect(duplicate.status).toBe(409); expect(duplicate.body).toMatchObject({ error: { code: 'CONFLICT', requestId: expect.any(String) } })
    const memberSession = await request('/api/v1/auth/session', { headers: { cookie } }); expect(memberSession.status).toBe(200); expect(memberSession.body).toMatchObject({ user: { roles: ['member'] } })
    const userId = (registered.body as { user: { id: string } }).user.id
    await app.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES (?,'platform_admin',NULL,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [userId])
    expect((await request('/api/v1/auth/session', { headers: { cookie } })).body).toMatchObject({ user: { roles: ['member', 'platform_admin'] } })
    await app.query("DELETE FROM user_roles WHERE user_id=? AND role_code='platform_admin'", [userId])
    expect((await request('/api/v1/auth/session', { headers: { cookie } })).body).toMatchObject({ user: { roles: ['member'] } })
    const bad = await json('/api/v1/auth/login', { username: 'alice', password: 'wrong-password' }); expect(bad.status).toBe(401); expect(bad.body).toMatchObject({ error: { code: 'UNAUTHORIZED', requestId: expect.any(String) } })
    const loggedOut = await json('/api/v1/auth/logout', {}, cookie); expect(loggedOut.status).toBe(204); expect(String(loggedOut.headers['set-cookie'])).toMatch(/Expires=Thu, 01 Jan 1970/)
    const expired = await request('/api/v1/auth/session', { headers: { cookie } }); expect(expired.status).toBe(401); expect(expired.body).toMatchObject({ error: { code: 'UNAUTHORIZED', requestId: expect.any(String) } })
    const loggedIn = await json('/api/v1/auth/login', { username: 'alice', password: 'password-123' }); expect(loggedIn.status).toBe(200); expect(loggedIn.body).toMatchObject({ user: { roles: ['member'] } }); expect(JSON.stringify(loggedIn.body)).not.toMatch(/password|hash|token|secret/i); const loginCookie = String(loggedIn.headers['set-cookie']).split(';')[0]!; await root.query(`UPDATE \`${database}\`.user_sessions SET expires_at=UTC_TIMESTAMP(3) - INTERVAL 1 SECOND`)
    expect((await request('/api/v1/auth/session', { headers: { cookie: loginCookie } })).status).toBe(401)
    const missing = await request('/api/v1/auth/session'); expect(missing.status).toBe(401); expect(missing.headers['cache-control']).toBe('no-store')
    const forbidden = await request('/health', { headers: { origin: 'http://invalid.example' } }); expect(forbidden.status).toBe(403); expect(forbidden.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', requestId: expect.any(String) } })
  })

  it('changes own username and password through account routes', async () => {
    const registered = await json('/api/v1/auth/register', { username: 'account-user', password: 'password-123' })
    expect(registered.status).toBe(201)
    const cookie = cookieOf(registered)

    const renamed = await json('/api/v1/account/username', { username: ' account-renamed ' }, cookie, 'PATCH')
    expect(renamed.status).toBe(200)
    expect(renamed.body).toMatchObject({ username: 'account-renamed', roles: ['member'] })
    expect((await request('/api/v1/auth/session', { headers: { cookie } })).body).toMatchObject({ user: { username: 'account-renamed' } })

    await json('/api/v1/auth/register', { username: 'taken-name', password: 'password-123' })
    const conflict = await json('/api/v1/account/username', { username: 'taken-name' }, cookie, 'PATCH')
    expect(conflict.status).toBe(409)

    const wrong = await json('/api/v1/account/password', { currentPassword: 'wrong-password', newPassword: 'password-456' }, cookie)
    expect(wrong.status).toBe(401)
    expect(wrong.body).toMatchObject({ error: { code: 'UNAUTHORIZED', businessCode: 'AUTH_CURRENT_PASSWORD_INVALID', requestId: expect.any(String) } })

    const changed = await json('/api/v1/account/password', { currentPassword: 'password-123', newPassword: 'password-456' }, cookie)
    expect(changed.status).toBe(204)
    expect(String(changed.headers['set-cookie'])).toMatch(/Expires=Thu, 01 Jan 1970/)
    expect((await request('/api/v1/auth/session', { headers: { cookie } })).status).toBe(401)

    const oldLogin = await json('/api/v1/auth/login', { username: 'account-renamed', password: 'password-123' })
    expect(oldLogin.status).toBe(401)
    const newLogin = await json('/api/v1/auth/login', { username: 'account-renamed', password: 'password-456' })
    expect(newLogin.status).toBe(200)
  })
})
