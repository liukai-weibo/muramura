import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiServer } from '../apps/api/src/index'
import { createMySqlPool, MySqlItemRepository, MySqlReviewWorkflowRepository, MySqlSearchRepository, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD'].every(key => Boolean(process.env[key]))
const currentMigrationVersion = Math.max(...fs.readdirSync(path.resolve(__dirname, '..', 'migrations'))
  .filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
  .map(file => Number(file.slice(0, 3))))
let database = ''; let appUser = ''; let migratorUser = ''; let appPassword = ''; let migratorPassword = ''; let seededReviewId = ''; let seededMethodId = ''; let currentUserId = ''; let sessionCookie = ''; let root: ReturnType<typeof createMySqlPool>; let app: ReturnType<typeof createMySqlPool>; let server: http.Server
const config = (user: string, password: string): MySqlConnectionConfig => ({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 3 })
const request = (path: string, options: http.RequestOptions = {}, body?: string, target = server) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: unknown }>((resolve, reject) => {
  const address = target.address() as { port: number }; const headers = { ...options.headers, ...(sessionCookie && path.startsWith('/api/v1/') ? { cookie: sessionCookie } : {}) }; const probe = http.request({ host: '127.0.0.1', port: address.port, path, ...options, headers }, response => { let text = ''; response.on('data', chunk => { text += chunk }); response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: JSON.parse(text) })) }); probe.on('error', reject); probe.end(body)
})

describe.runIf(enabled)('MySQL M5-A candidate read API', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', ''); database = `kbm5a_${suffix}`; appUser = `kbm5aa_${suffix.slice(0, 22)}`; migratorUser = `kbm5am_${suffix.slice(0, 22)}`; appPassword = crypto.randomUUID(); migratorPassword = crypto.randomUUID()
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 }); await root.query(`CREATE DATABASE \`${database}\``); await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword]); await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword]); await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${appUser}'@'%'`); await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`); await root.query('FLUSH PRIVILEGES')
    app = createMySqlPool(config(appUser, appPassword)); const migrator = createMySqlPool(config(migratorUser, migratorPassword)); await runMySqlMigrations(migrator, `${process.cwd()}/migrations`); await migrator.end()
    server = createApiServer(config(appUser, appPassword)); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const registrationBody = JSON.stringify({ username: `m5a_${suffix}`, password: crypto.randomUUID() })
    const registration = await request('/api/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' } }, registrationBody)
    currentUserId = (registration.body as { user: { id: string } }).user.id; sessionCookie = String(registration.headers['set-cookie']).split(';')[0]!
    const scope = { userId: currentUserId }
    const item = await new MySqlItemRepository(app, undefined, scope).create({ title: 'searchable item', content: 'needle', status: 'waiting_review' }); const completed = await new MySqlReviewWorkflowRepository(app, undefined, scope).complete({ itemId: item.id, actualAction: 'action', result: 'result', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '', method: { title: 'searchable method', applicable: 'needle', steps: 'steps' } }); seededReviewId = completed.review.id; seededMethodId = completed.method!.id
  })
  afterAll(async () => { await new Promise<void>(resolve => server?.close(() => resolve())); await app?.end(); await root?.query(`DROP DATABASE IF EXISTS \`${database}\``); await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`); await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`); await root?.end() })

  it('serves health, Search and Dashboard through Application services with request IDs', async () => {
    const health = await request('/health'); expect(health.status).toBe(200); expect(health.body).toMatchObject({ status: 'ready', database, schemaVersion: currentMigrationVersion })
    const search = await request('/api/v1/search?query=needle', { headers: { origin: 'http://127.0.0.1:10086' } }); expect(search.status).toBe(200); expect(search.headers).toMatchObject({ 'access-control-allow-origin': 'http://127.0.0.1:10086', 'cache-control': 'no-store' }); expect(search.headers['x-request-id']).toBeTruthy(); expect(search.body).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'item' }), expect.objectContaining({ type: 'method' })]))
    const dashboard = await request('/api/v1/dashboard?window=all'); expect(dashboard.status).toBe(200); expect(dashboard.body).toMatchObject({ window: 'all', metrics: expect.any(Object) })
  })

  it('serves only active Methods and maps Method and Review database failures to sanitized errors', async () => {
    const scope = { userId: currentUserId }
    const trashedItem = await new MySqlItemRepository(app, undefined, scope).create({ title: 'trashed method item', status: 'waiting_review' })
    const trashed = await new MySqlReviewWorkflowRepository(app, undefined, scope).complete({ itemId: trashedItem.id, actualAction: 'action', result: 'result', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '', method: { title: 'trashed method', applicable: 'applicable', steps: 'steps' } })
    await app.execute('UPDATE methods SET deleted_at=?,updated_at=? WHERE id=?', ['2026-07-23 00:00:00.000', '2026-07-23 00:00:00.000', trashed.method!.id])

    const methods = await request('/api/v1/methods')
    expect(methods.status).toBe(200)
    expect(methods.headers).toMatchObject({ 'cache-control': 'no-store' })
    expect(methods.headers['x-request-id']).toBeTruthy()
    expect(methods.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: seededMethodId, title: 'searchable method', applicable: 'needle', steps: 'steps', validationCount: 1, version: 1 })]))
    expect(methods.body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: trashed.method!.id })]))

    const unavailable = createApiServer({ ...config(appUser, 'wrong-password'), connectionLimit: 1 })
    await new Promise<void>(resolve => unavailable.listen(0, '127.0.0.1', resolve))
    try {
      for (const path of ['/api/v1/methods', `/api/v1/reviews/${seededReviewId}`]) {
        const response = await request(path, {}, undefined, unavailable)
        expect(response.status).toBe(503)
        expect(response.body).toEqual({ error: { code: 'MYSQL_UNAVAILABLE', message: '本地 MySQL 候选环境当前不可用', requestId: expect.any(String) } })
      }
    } finally {
      await new Promise<void>(resolve => unavailable.close(() => resolve()))
    }
  })

  it('serves existing Reviews and keeps missing Reviews distinct from database failures', async () => {
    const review = await request(`/api/v1/reviews/${seededReviewId}`)
    expect(review.status).toBe(200)
    expect(review.headers).toMatchObject({ 'cache-control': 'no-store' })
    expect(review.headers['x-request-id']).toBeTruthy()
    expect(review.body).toMatchObject({ id: seededReviewId, actualAction: 'action', result: 'result' })

    const missing = await request(`/api/v1/reviews/${crypto.randomUUID()}`)
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: { code: 'NOT_FOUND', message: '复盘不存在', requestId: expect.any(String) } })
  })

  it('keeps Search on one consistent snapshot when a related Review commits mid-read', async () => {
    const item = await new MySqlItemRepository(app).create({ title: 'snapshot item', status: 'waiting_review' })
    const repository = new MySqlSearchRepository(app, {
      afterItemsRead: async () => {
        await app.execute('INSERT INTO reviews(id,item_id,actual_action,result,effective,incompatible,reason,adjustment,new_ideas,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', [crypto.randomUUID(), item.id, 'mid-read needle', 'result', '', '', '', '', '', '2026-07-23 00:00:00.000', '2026-07-23 00:00:00.000'])
      },
    })
    const results = await repository.search('needle')
    expect(results.some(result => result.type === 'review' && result.itemId === item.id)).toBe(false)
    expect((await new MySqlSearchRepository(app).search('needle')).some(result => result.type === 'review' && result.itemId === item.id)).toBe(true)
  })

  it('maps Search connection failures to a sanitized MySQL error DTO', async () => {
    const unavailable = createApiServer({ ...config(appUser, 'wrong-password'), connectionLimit: 1 })
    await new Promise<void>(resolve => unavailable.listen(0, '127.0.0.1', resolve))
    try {
      const response = await request('/api/v1/search?query=needle', {}, undefined, unavailable)
      expect(response.status).toBe(503)
      expect(response.body).toEqual({ error: { code: 'MYSQL_UNAVAILABLE', message: '本地 MySQL 候选环境当前不可用', requestId: expect.any(String) } })
    } finally {
      await new Promise<void>(resolve => unavailable.close(() => resolve()))
    }
  })

  it('enforces read-only routes, exact CORS, body bounds and sanitized errors', async () => {
    const method = await request('/api/v1/search?query=x', { method: 'POST' }); expect(method.status).toBe(405); expect(method.body).toMatchObject({ error: { code: 'METHOD_NOT_ALLOWED', requestId: expect.any(String) } })
    expect((await request('/api/v1/search?query=x', { headers: { origin: 'http://evil.example' } })).status).toBe(403)
    expect((await request('/api/v1/dashboard?window=bad')).body).toMatchObject({ error: { code: 'VALIDATION_FAILED', requestId: expect.any(String) } })
    const tooLargeBody = 'x'.repeat(64 * 1024 + 1); const tooLarge = await request('/api/v1/search', { headers: { 'content-length': String(tooLargeBody.length) } }, tooLargeBody); expect(tooLarge.status).toBe(413); expect(tooLarge.body).toMatchObject({ error: { code: 'REQUEST_TOO_LARGE', requestId: expect.any(String) } })
    const unknown = await request('/api/v1/nope'); expect(unknown.status).toBe(404); expect(unknown.body).toMatchObject({ error: { code: 'NOT_FOUND_ROUTE', requestId: expect.any(String) } })
  })
})
