import crypto from 'node:crypto'
import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiServer } from '../apps/api/src/index'
import { createMySqlPool, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
let database = ''; let appUser = ''; let migratorUser = ''; let root: ReturnType<typeof createMySqlPool>; let server: http.Server
const request = (path: string, init: http.RequestOptions = {}, body?: string) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: unknown }>((resolve, reject) => { const req = http.request({ host: '127.0.0.1', port: (server.address() as { port: number }).port, path, ...init }, response => { const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => { const raw = Buffer.concat(chunks).toString(); resolve({ status: response.statusCode ?? 0, headers: response.headers, body: raw ? JSON.parse(raw) : undefined }) }); }); req.on('error', reject); if (body) req.write(body); req.end() })
const json = (path: string, value: unknown, cookie?: string) => request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }, JSON.stringify(value))

describe.runIf(enabled)('authentication API', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', ''); database = `kb_accounts_${suffix}`; appUser = `kb_auth_app_${suffix.slice(0, 19)}`; migratorUser = `kb_auth_migrator_${suffix.slice(0, 14)}`
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``); await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [crypto.randomUUID()]); await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [crypto.randomUUID()])
    const appPassword = crypto.randomUUID(); const migratorPassword = crypto.randomUUID(); await root.query(`ALTER USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword]); await root.query(`ALTER USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword]); await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${database}\`.* TO '${appUser}'@'%'`); await root.query(`GRANT SELECT,INSERT,CREATE,ALTER,INDEX,REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`)
    const cfg = (user: string, password: string): MySqlConnectionConfig => ({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 1 }); const migrator = createMySqlPool(cfg(migratorUser, migratorPassword)); await runMySqlMigrations(migrator, `${process.cwd()}/migrations`); await migrator.end(); server = createApiServer(cfg(appUser, appPassword)); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  })
  afterAll(async () => { await new Promise<void>(resolve => server?.close(() => resolve())); await root?.query(`DROP DATABASE IF EXISTS \`${database}\``); await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`); await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`); await root?.end() })
  it('registers, authenticates, expires, logs out, and never exposes secrets', async () => {
    const registered = await json('/api/v1/auth/register', { username: ' alice ', password: 'password-123' }); expect(registered.status, JSON.stringify(registered.body)).toBe(201); expect(registered.body).toEqual({ user: { id: expect.any(String), username: 'alice', createdAt: expect.any(String) } }); expect(JSON.stringify(registered.body)).not.toMatch(/password|hash|token|secret/i)
    const setCookie = String(registered.headers['set-cookie']); expect(setCookie).toMatch(/HttpOnly; SameSite=Lax; Path=\/; Expires=/); expect(setCookie).not.toMatch(/Secure/); const cookie = setCookie.split(';')[0]!
    const duplicate = await json('/api/v1/auth/register', { username: 'alice', password: 'password-123' }); expect(duplicate.status).toBe(409); expect(duplicate.body).toMatchObject({ error: { code: 'CONFLICT', requestId: expect.any(String) } })
    expect((await request('/api/v1/auth/session', { headers: { cookie } })).status).toBe(200)
    const bad = await json('/api/v1/auth/login', { username: 'alice', password: 'wrong-password' }); expect(bad.status).toBe(401); expect(bad.body).toMatchObject({ error: { code: 'UNAUTHORIZED', requestId: expect.any(String) } })
    const loggedOut = await json('/api/v1/auth/logout', {}, cookie); expect(loggedOut.status).toBe(204); expect(String(loggedOut.headers['set-cookie'])).toMatch(/Expires=Thu, 01 Jan 1970/)
    const expired = await request('/api/v1/auth/session', { headers: { cookie } }); expect(expired.status).toBe(401); expect(expired.body).toMatchObject({ error: { code: 'UNAUTHORIZED', requestId: expect.any(String) } })
    const loggedIn = await json('/api/v1/auth/login', { username: 'alice', password: 'password-123' }); expect(loggedIn.status).toBe(200); const loginCookie = String(loggedIn.headers['set-cookie']).split(';')[0]!; await root.query(`UPDATE \`${database}\`.user_sessions SET expires_at=UTC_TIMESTAMP(3) - INTERVAL 1 SECOND`)
    expect((await request('/api/v1/auth/session', { headers: { cookie: loginCookie } })).status).toBe(401)
    const missing = await request('/api/v1/auth/session'); expect(missing.status).toBe(401); expect(missing.headers['cache-control']).toBe('no-store')
    const forbidden = await request('/health', { headers: { origin: 'http://invalid.example' } }); expect(forbidden.status).toBe(403); expect(forbidden.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', requestId: expect.any(String) } })
  })
})
