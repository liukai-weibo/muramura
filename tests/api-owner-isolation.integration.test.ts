import crypto from 'node:crypto'
import http from 'node:http'
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiServer } from '../apps/api/src/index'
import { createMySqlPool, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
const businessTables = ['items', 'reviews', 'methods', 'method_evidence', 'method_versions', 'method_applications', 'item_status_events', 'item_links', 'method_tombstones', 'exploration_tracks'] as const
type Response = { status: number; headers: http.IncomingHttpHeaders; body: any }
let database = ''; let appUser = ''; let migratorUser = ''; let root: ReturnType<typeof createMySqlPool>; let app: ReturnType<typeof createMySqlPool>; let server: http.Server

const request = (path: string, init: http.RequestOptions = {}, body?: string) => new Promise<Response>((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: (server.address() as { port: number }).port, path, ...init }, response => {
    const chunks: Buffer[] = []
    response.on('data', chunk => chunks.push(Buffer.from(chunk)))
    response.on('end', () => { const raw = Buffer.concat(chunks).toString(); resolve({ status: response.statusCode ?? 0, headers: response.headers, body: raw ? JSON.parse(raw) : undefined }) })
  })
  req.on('error', reject); if (body) req.write(body); req.end()
})
const json = (path: string, value: unknown, cookie?: string, method = 'POST') => request(path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }, JSON.stringify(value))
const get = (path: string, cookie?: string) => request(path, { headers: cookie ? { cookie } : {} })
const del = (path: string, cookie: string) => request(path, { method: 'DELETE', headers: { cookie } })
const cookieOf = (response: Response) => String(response.headers['set-cookie']).split(';')[0]!
const expect404 = (response: Response) => { expect(response.status).toBe(404); expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND', requestId: expect.any(String) } }); expect(response.headers['cache-control']).toBe('no-store') }

describe.runIf(enabled)('all business owner isolation', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', ''); database = `kb_owner_${suffix}`; appUser = `kb_owner_app_${suffix.slice(0, 17)}`; migratorUser = `kb_owner_mig_${suffix.slice(0, 17)}`
    const appPassword = crypto.randomUUID(); const migratorPassword = crypto.randomUUID()
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``)
    await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword]); await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${database}\`.* TO '${appUser}'@'%'`); await root.query(`GRANT SELECT,INSERT,CREATE,ALTER,INDEX,REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`)
    const config = (user: string, password: string): MySqlConnectionConfig => ({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 2 })
    const migrator = createMySqlPool(config(migratorUser, migratorPassword)); await runMySqlMigrations(migrator, `${process.cwd()}/migrations`); await migrator.end()
    app = createMySqlPool(config(appUser, appPassword)); server = createApiServer(config(appUser, appPassword)); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  })
  afterAll(async () => {
    await new Promise<void>(resolve => server?.close(() => resolve())); await app?.end()
    await root?.query(`DROP DATABASE IF EXISTS \`${database}\``); await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`); await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`); await root?.end()
  })

  it('requires a server session for every existing business route', async () => {
    const response = await get('/api/v1/items')
    expect(response.status).toBe(401); expect(response.body).toMatchObject({ error: { code: 'UNAUTHORIZED', requestId: expect.any(String) } })
  })

  it('isolates full read/write workflows and maps cross-user IDs to 404', async () => {
    const aRegister = await json('/api/v1/auth/register', { username: `owner_a_${crypto.randomUUID()}`, password: 'password-a' }); const a = cookieOf(aRegister); const aId = aRegister.body.user.id as string
    const bRegister = await json('/api/v1/auth/register', { username: `owner_b_${crypto.randomUUID()}`, password: 'password-b' }); const b = cookieOf(bRegister); const bId = bRegister.body.user.id as string

    const track = await json('/api/v1/exploration-tracks', { name: `track-${crypto.randomUUID()}` }, a); const trackId = track.body.id as string
    const source = await json('/api/v1/items', { title: 'owner-a-source', explorationTrack: { type: 'existing', trackId } }, a); const itemId = source.body.id as string
    await json(`/api/v1/items/${itemId}/start`, { startAction: 'act' }, a)
    const completed = await json('/api/v1/reviews/complete', { itemId, actualAction: 'done', result: 'owner-a-result', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: 'owner-a-derived', method: { title: 'owner-a-method', applicable: 'owner-a-needle', steps: 'step' } }, a)
    expect(completed.status).toBe(201)
    const reviewId = completed.body.review.id as string; const methodId = completed.body.method.id as string; const derivedId = completed.body.createdIdea.id as string
    const applied = await json('/api/v1/method-applications', { methodId, title: 'owner-a-applied' }, a); const appliedId = applied.body.id as string

    expect((await get('/api/v1/items', a)).body.map((value: { id: string }) => value.id)).toEqual(expect.arrayContaining([itemId, derivedId, appliedId]))
    expect((await get('/api/v1/items', b)).body).toEqual([])
    expect((await get('/api/v1/methods', b)).body).toEqual([])
    expect((await get('/api/v1/exploration-tracks', b)).body).toEqual([])
    expect((await get('/api/v1/search?query=owner-a-needle', a)).body.length).toBeGreaterThan(0)
    expect((await get('/api/v1/search?query=owner-a-needle', b)).body).toEqual([])
    expect((await get('/api/v1/dashboard?window=all', a)).body.metrics.newItems).toBeGreaterThan(0)
    expect((await get('/api/v1/dashboard?window=all', b)).body.metrics.newItems).toBe(0)

    const snapshot = async () => Promise.all(businessTables.map(async table => {
      const [rows] = await app.query(`SELECT * FROM \`${table}\` ORDER BY 1`)
      return [table, rows] as const
    }))
    const beforeCrossUserAttempts = await snapshot()
    for (const response of [
      await get(`/api/v1/items/${itemId}`, b), await get(`/api/v1/items/${itemId}/status-events`, b), await get(`/api/v1/items/${itemId}/exploration-track`, b),
      await get(`/api/v1/reviews/${reviewId}`, b), await get(`/api/v1/reviews/by-item/${itemId}`, b), await get(`/api/v1/methods/${methodId}/versions`, b),
      await get(`/api/v1/methods/${methodId}/evidence`, b), await get(`/api/v1/methods/by-review/${reviewId}`, b), await get(`/api/v1/method-applications/${appliedId}/context`, b),
      await get(`/api/v1/method-source-displays?itemIds=${appliedId}`, b), await get(`/api/v1/exploration-tracks/${trackId}/history`, b), await get(`/api/v1/items?status=idea_to_try&explorationTrackId=${trackId}`, b),
      await json(`/api/v1/items/${itemId}/status`, { status: 'abandoned' }, b), await json(`/api/v1/items/${itemId}/exploration-track`, { trackId }, b, 'PUT'), await del(`/api/v1/items/${itemId}`, b), await del(`/api/v1/exploration-tracks/${trackId}`, b),
    ]) expect404(response)
    expect(await snapshot()).toEqual(beforeCrossUserAttempts)

    await del(`/api/v1/items/${derivedId}`, a)
    expect404(await json(`/api/v1/items/${derivedId}/restore`, {}, b))
    expect((await json(`/api/v1/items/${derivedId}/restore`, {}, a)).status).toBe(200)
    await del(`/api/v1/exploration-tracks/${trackId}`, a)
    expect404(await json(`/api/v1/exploration-tracks/${trackId}/restore`, {}, b))
    expect((await json(`/api/v1/exploration-tracks/${trackId}/restore`, {}, a)).status).toBe(200)
    await del(`/api/v1/methods/${methodId}`, a)
    expect404(await json(`/api/v1/methods/${methodId}/restore`, {}, b))
    expect((await json(`/api/v1/methods/${methodId}/restore`, {}, a)).status).toBe(200)

    const retainedItem = await json('/api/v1/items', { title: 'retained-source' }, a)
    await json(`/api/v1/items/${retainedItem.body.id}/start`, { startAction: 'act' }, a)
    expect((await json('/api/v1/reviews/complete', {
      itemId: retainedItem.body.id,
      actualAction: 'done',
      result: 'owner-a-retained-result',
      effective: '',
      incompatible: '',
      reason: '',
      adjustment: '',
      newIdeas: '',
      method: { title: 'retained-method', applicable: 'owner-a-retained-needle', steps: 'step' },
    }, a)).status).toBe(201)
    await del(`/api/v1/methods/${methodId}`, a)
    await app.query('UPDATE methods SET deleted_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 31 DAY) WHERE id = ? AND owner_user_id = ?', [methodId, aId])
    expect((await get('/api/v1/trash?filter=method', a)).status).toBe(200)
    expect((await get('/api/v1/trash?filter=method', b)).body).toEqual([])

    const [owners] = await app.query<Array<RowDataPacket & { table_name: string; owner_user_id: string; count: number }>>(`SELECT 'items' table_name,owner_user_id,COUNT(*) count FROM items GROUP BY owner_user_id UNION ALL SELECT 'reviews',owner_user_id,COUNT(*) FROM reviews GROUP BY owner_user_id UNION ALL SELECT 'methods',owner_user_id,COUNT(*) FROM methods GROUP BY owner_user_id UNION ALL SELECT 'method_evidence',owner_user_id,COUNT(*) FROM method_evidence GROUP BY owner_user_id UNION ALL SELECT 'method_versions',owner_user_id,COUNT(*) FROM method_versions GROUP BY owner_user_id UNION ALL SELECT 'method_applications',owner_user_id,COUNT(*) FROM method_applications GROUP BY owner_user_id UNION ALL SELECT 'item_status_events',owner_user_id,COUNT(*) FROM item_status_events GROUP BY owner_user_id UNION ALL SELECT 'item_links',owner_user_id,COUNT(*) FROM item_links GROUP BY owner_user_id UNION ALL SELECT 'method_tombstones',owner_user_id,COUNT(*) FROM method_tombstones GROUP BY owner_user_id UNION ALL SELECT 'exploration_tracks',owner_user_id,COUNT(*) FROM exploration_tracks GROUP BY owner_user_id`)
    expect(owners.every(row => row.owner_user_id === aId && Number(row.count) > 0)).toBe(true)
    expect(owners.some(row => row.owner_user_id === bId)).toBe(false)
    expect(new Set(owners.map(row => row.table_name))).toEqual(new Set(businessTables))
  })
})
