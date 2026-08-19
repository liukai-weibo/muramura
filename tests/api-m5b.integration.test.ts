import crypto from 'node:crypto'
import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiServer } from '../apps/api/src/index'
import { createMySqlPool, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD'].every(key => Boolean(process.env[key]))
let database = ''; let appUser = ''; let migratorUser = ''; let appPassword = ''; let migratorPassword = ''; let sessionCookie = ''; let root: ReturnType<typeof createMySqlPool>; let server: http.Server
const config = (user: string, password: string): MySqlConnectionConfig => ({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 3 })
type Response = { status: number; headers: http.IncomingHttpHeaders; body?: unknown }
const request = (path: string, options: http.RequestOptions = {}, body?: string, target = server) => new Promise<Response>((resolve, reject) => {
  const address = target.address() as { port: number }
  const headers = { ...options.headers, ...(sessionCookie && path.startsWith('/api/v1/') ? { cookie: sessionCookie } : {}) }
  const probe = http.request({ host: '127.0.0.1', port: address.port, path, ...options, headers }, response => { let text = ''; response.on('data', chunk => { text += chunk }); response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, ...(text ? { body: JSON.parse(text) } : {}) })) })
  probe.on('error', reject); probe.end(body)
})
const jsonRequest = (path: string, value: unknown, method = 'POST') => request(path, { method, headers: { 'content-type': 'application/json' } }, JSON.stringify(value))
const expectHeaders = (response: Response) => { expect(response.headers).toMatchObject({ 'cache-control': 'no-store' }); expect(response.headers['x-request-id']).toBeTruthy() }

// M5-B1 only proves candidate API → Application → MySQL with random synthetic data.
describe.runIf(enabled)('MySQL M5-B1 candidate write API', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', ''); database = `kbm5b_${suffix}`; appUser = `kbm5ba_${suffix.slice(0, 22)}`; migratorUser = `kbm5bm_${suffix.slice(0, 22)}`; appPassword = crypto.randomUUID(); migratorPassword = crypto.randomUUID()
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``); await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword]); await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${appUser}'@'%'`); await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`); await root.query('FLUSH PRIVILEGES')
    const migrator = createMySqlPool(config(migratorUser, migratorPassword)); await runMySqlMigrations(migrator, `${process.cwd()}/migrations`); await migrator.end()
    server = createApiServer(config(appUser, appPassword)); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const registered = await jsonRequest('/api/v1/auth/register', { username: `m5b_${suffix}`, password: crypto.randomUUID() })
    sessionCookie = String(registered.headers['set-cookie']).split(';')[0]!
  })
  afterAll(async () => { await new Promise<void>(resolve => server?.close(() => resolve())); await root?.query(`DROP DATABASE IF EXISTS \`${database}\``); await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`); await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`); await root?.end() })

  it('accepts configured H5 origins and rejects unconfigured origins for CORS', async () => {
    const allowed = await request('/health', { headers: { origin: 'http://127.0.0.1:10086' } })
    expect(allowed.status).toBe(200)
    expect(allowed.headers['access-control-allow-origin']).toBe('http://127.0.0.1:10086')
    expect(allowed.headers.vary).toBe('origin')
    const cloud = await request('/health', { headers: { origin: 'http://47.97.69.175:10086' } })
    expect(cloud.status).toBe(200)
    expect(cloud.headers['access-control-allow-origin']).toBe('http://47.97.69.175:10086')
    const rejected = await request('/health', { headers: { origin: 'http://192.168.128.1:10086' } })
    expect(rejected.status).toBe(403)
    expect(rejected.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', message: '不允许的请求来源' } })
  })

  it('exposes only the frozen Exploration Track routes and constrained Item locator', async () => {
    const created = await jsonRequest('/api/v1/exploration-tracks', { name: ' API Track ' }); expect(created.status).toBe(201); expectHeaders(created)
    const track = created.body as { id: string; name: string }; expect(track.name).toBe('API Track')
    expect((await request('/api/v1/exploration-tracks/selectable')).body).toEqual(expect.arrayContaining([expect.objectContaining({ id: track.id })]))
    const item = await jsonRequest('/api/v1/items', { title: 'tracked', explorationTrack: { type: 'existing', trackId: track.id } }); expect(item.status).toBe(201)
    const itemId = (item.body as { id: string }).id
    expect((await request(`/api/v1/items/${itemId}/exploration-track`)).body).toMatchObject({ status: 'available', track: { id: track.id } })
    expect((await request(`/api/v1/items?status=idea_to_try&explorationTrackId=${track.id}`)).body).toEqual([expect.objectContaining({ id: itemId })])
    expect((await request(`/api/v1/items?status=idea_to_try`)).status).toBe(400)
    expect((await request(`/api/v1/exploration-tracks/${track.id}/history`)).body).toMatchObject({ track: { id: track.id } })
    expect((await request(`/api/v1/exploration-tracks/${track.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await request('/api/v1/exploration-tracks/deleted')).body).toMatchObject([{ track: { id: track.id } }])
    expect((await jsonRequest(`/api/v1/exploration-tracks/${track.id}/restore`, {})).status).toBe(200)
    expect((await request('/api/v1/exploration-tracks/unfrozen')).status).toBe(405)
  })

  it('maps abandoned exploration association writes to validation failure without writing and restores ability after refresh', async () => {
    const original = await jsonRequest('/api/v1/exploration-tracks', { name: 'abandoned original' })
    const replacement = await jsonRequest('/api/v1/exploration-tracks', { name: 'abandoned replacement' })
    const item = await jsonRequest('/api/v1/items', { title: 'abandoned item', explorationTrack: { type: 'existing', trackId: (original.body as { id: string }).id } })
    const itemId = (item.body as { id: string }).id
    await jsonRequest(`/api/v1/items/${itemId}/status`, { status: 'abandoned' })
    const before = await request('/api/v1/backup')
    const reassignment = await jsonRequest(`/api/v1/items/${itemId}/exploration-track`, { trackId: (replacement.body as { id: string }).id }, 'PUT')
    expect(reassignment.status).toBe(400); expectHeaders(reassignment)
    expect(reassignment.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', requestId: expect.any(String) } })
    const removal = await request(`/api/v1/items/${itemId}/exploration-track`, { method: 'DELETE' })
    expect(removal.status).toBe(400); expectHeaders(removal)
    expect(removal.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', requestId: expect.any(String) } })
    expect((await request('/api/v1/backup')).body).toMatchObject({ data: (before.body as { data: unknown }).data })
    await jsonRequest(`/api/v1/items/${itemId}/status`, { status: 'idea_to_try' })
    expect((await jsonRequest(`/api/v1/items/${itemId}/exploration-track`, { trackId: (replacement.body as { id: string }).id }, 'PUT')).status).toBe(200)
  })

  it('requires explicit confirmation before overwriting a restart start action without retrying', async () => {
    const item = await jsonRequest('/api/v1/items', { title: 'restart overwrite' })
    const itemId = (item.body as { id: string }).id
    await jsonRequest(`/api/v1/items/${itemId}/start`, { startAction: 'original action' })
    await jsonRequest(`/api/v1/items/${itemId}/status`, { status: 'abandoned' })
    await jsonRequest(`/api/v1/items/${itemId}/status`, { status: 'idea_to_try' })
    const before = await request('/api/v1/backup')
    const beforeEvents = await request(`/api/v1/items/${itemId}/status-events`)
    const rejected = await jsonRequest(`/api/v1/items/${itemId}/start`, { startAction: 'replacement action' })
    expect(rejected.status).toBe(409); expectHeaders(rejected)
    expect(rejected.body).toMatchObject({ error: { code: 'CONFLICT', requestId: expect.any(String) } })
    expect((await request('/api/v1/backup')).body).toMatchObject({ data: (before.body as { data: unknown }).data })
    const started = await jsonRequest(`/api/v1/items/${itemId}/start`, { startAction: 'replacement action', overwriteExistingStartAction: true })
    expect(started.status).toBe(200); expectHeaders(started)
    expect(started.body).toMatchObject({ status: 'doing', startAction: 'replacement action' })
    const events = await request(`/api/v1/items/${itemId}/status-events`)
    expect((events.body as unknown[]).length).toBe((beforeEvents.body as unknown[]).length + 1)
    expect((events.body as Array<{ fromStatus?: string; toStatus: string }>).at(-1)).toMatchObject({ fromStatus: 'idea_to_try', toStatus: 'doing' })
  })

  it('preserves the existing Item, completeReview, Method and MethodApplication Application workflows', async () => {
    const created = await jsonRequest('/api/v1/items', { title: ' API item ', content: ' original ' }); expect(created.status).toBe(201); expectHeaders(created)
    const item = created.body as { id: string; title: string; status: string }; expect(item).toMatchObject({ title: 'API item', status: 'idea_to_try' })
    const content = await jsonRequest(`/api/v1/items/${item.id}/content`, { content: 'updated' }, 'PATCH'); expect(content.status).toBe(200)
    const started = await jsonRequest(`/api/v1/items/${item.id}/start`, { startAction: 'first step' }); expect(started.status).toBe(200); expect(started.body).toMatchObject({ status: 'doing', startAction: 'first step' })
    const completed = await jsonRequest('/api/v1/reviews/complete', { itemId: item.id, actualAction: 'did it', result: 'worked', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '', method: { title: 'API method', applicable: 'when testing', steps: 'use API' } })
    expect(completed.status).toBe(201); expectHeaders(completed)
    const complete = completed.body as { review: { id: string }; method: { id: string }; item: { status: string } }; expect(complete.item.status).toBe('reviewed')

    const events = await request(`/api/v1/items/${item.id}/status-events`); expect(events.status).toBe(200); expect(events.body).toEqual(expect.arrayContaining([expect.objectContaining({ toStatus: 'reviewed' })]))
    const review = await request(`/api/v1/reviews/by-item/${item.id}`); expect(review.status).toBe(200); expect(review.body).toMatchObject({ id: complete.review.id })
    expect((await request(`/api/v1/methods/${complete.method.id}/versions`)).body).toEqual(expect.arrayContaining([expect.objectContaining({ version: 1 })]))
    expect((await request(`/api/v1/methods/${complete.method.id}/evidence`)).body).toEqual(expect.arrayContaining([expect.objectContaining({ reviewId: complete.review.id, relation: 'formation' })]))
    expect((await request(`/api/v1/methods/by-review/${complete.review.id}`)).body).toEqual(expect.arrayContaining([expect.objectContaining({ id: complete.method.id })]))

    const application = await jsonRequest('/api/v1/method-applications', { methodId: complete.method.id, title: 'apply method', content: 'application content' }); expect(application.status).toBe(201)
    const appliedItem = application.body as { id: string }
    expect((await request(`/api/v1/method-applications/${appliedItem.id}/context`)).body).toMatchObject({ status: 'available', application: { itemId: appliedItem.id, methodId: complete.method.id } })
    expect((await request(`/api/v1/method-source-displays?itemIds=${appliedItem.id}`)).body).toEqual([expect.objectContaining({ itemId: appliedItem.id, status: 'available', title: 'API method' })])
  })

  it('keeps soft delete, restore, Trash and Backup on existing Application semantics', async () => {
    const item = (await jsonRequest('/api/v1/items', { title: 'trash candidate' })).body as { id: string }
    const deleted = await request(`/api/v1/items/${item.id}`, { method: 'DELETE' }); expect(deleted.status).toBe(204); expectHeaders(deleted)
    const trash = await request('/api/v1/trash?filter=item'); expect(trash.status).toBe(200); expect(trash.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: item.id, type: 'item' })]))
    const restored = await jsonRequest(`/api/v1/trash/item/${item.id}/restore`, {}); expect(restored.status).toBe(200); expect(restored.body).toMatchObject({ id: item.id })
    const deletedAgain = await request(`/api/v1/items/${item.id}`, { method: 'DELETE' }); expect(deletedAgain.status).toBe(204)
    const directRestore = await jsonRequest(`/api/v1/items/${item.id}/restore`, {}); expect(directRestore.status).toBe(200); expect(directRestore.body).toMatchObject({ id: item.id })

    const methodItem = (await jsonRequest('/api/v1/items', { title: 'method trash source' })).body as { id: string }
    await jsonRequest(`/api/v1/items/${methodItem.id}/start`, {})
    const completed = await jsonRequest('/api/v1/reviews/complete', { itemId: methodItem.id, actualAction: 'done', result: 'result', effective: '', incompatible: '', reason: '', adjustment: '', method: { title: 'trashable method', applicable: 'case', steps: 'step' } })
    const method = completed.body as { method: { id: string } }
    const methodDeleted = await request(`/api/v1/methods/${method.method.id}`, { method: 'DELETE' }); expect(methodDeleted.status).toBe(204)
    const methodTrash = await request('/api/v1/trash?filter=method'); expect(methodTrash.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: method.method.id, type: 'method' })]))
    const methodRestored = await jsonRequest(`/api/v1/methods/${method.method.id}/restore`, {}); expect(methodRestored.status).toBe(200); expect(methodRestored.body).toMatchObject({ id: method.method.id })

    const backup = await request('/api/v1/backup'); expect(backup.status).toBe(200); expectHeaders(backup); expect(backup.body).toMatchObject({ format: 'knowledge-base-backup', version: 3 })
    const invalid = await jsonRequest('/api/v1/backup/restore', { format: 'wrong' }); expect(invalid.status).toBe(400); expect(invalid.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', requestId: expect.any(String) } })
    const restoredBackup = await jsonRequest('/api/v1/backup/restore', backup.body); expect(restoredBackup.status).toBe(204); expectHeaders(restoredBackup)
  })

  it('lists deleted exploration tracks through the existing trash route with frozen filtering and ordering', async () => {
    const track = await jsonRequest('/api/v1/exploration-tracks', { name: 'trash exploration track' })
    const trackId = (track.body as { id: string }).id
    await request(`/api/v1/exploration-tracks/${trackId}`, { method: 'DELETE' })
    const trackTrash = await request('/api/v1/trash?filter=exploration-track')
    expect(trackTrash.status).toBe(200); expectHeaders(trackTrash)
    expect(trackTrash.body).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'exploration-track', id: trackId, title: 'trash exploration track', deletedAt: expect.any(String) })]))
    const allTrash = await request('/api/v1/trash?filter=all')
    expect(allTrash.status).toBe(200); expectHeaders(allTrash)
    const entries = allTrash.body as Array<{ type: 'item' | 'method' | 'exploration-track'; id: string; deletedAt: string }>
    const order = { item: 0, method: 1, 'exploration-track': 2 }
    expect(entries).toEqual([...entries].sort((left, right) => right.deletedAt.localeCompare(left.deletedAt) || order[left.type] - order[right.type] || left.id.localeCompare(right.id)))
  })

  it('enforces the 16 MiB Backup restore body boundary without writing data', async () => {
    const before = await request('/api/v1/backup'); expect(before.status).toBe(200)
    const withinLimit = JSON.stringify({ format: 'wrong', padding: 'x'.repeat(16 * 1024 * 1024 - 128) })
    expect(Buffer.byteLength(withinLimit)).toBeLessThanOrEqual(16 * 1024 * 1024)
    const parsed = await request('/api/v1/backup/restore', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(withinLimit)) } }, withinLimit)
    expect(parsed.status).toBe(400); expectHeaders(parsed); expect(parsed.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', requestId: expect.any(String) } })
    const overLimit = JSON.stringify({ format: 'wrong', padding: 'x'.repeat(16 * 1024 * 1024) })
    const rejected = await request('/api/v1/backup/restore', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(overLimit)) } }, overLimit)
    expect(rejected.status).toBe(413); expectHeaders(rejected); expect(rejected.body).toMatchObject({ error: { code: 'REQUEST_TOO_LARGE', requestId: expect.any(String) } })
    expect((await request('/api/v1/backup')).body).toMatchObject({ data: (before.body as { data: unknown }).data })
  })

  it('maps a V3 broken explorationTrackId to validation failure without writing any collection', async () => {
    const before = await request('/api/v1/backup'); const invalid = structuredClone(before.body) as { data: { items: Array<Record<string, unknown>> } }
    invalid.data.items[0]!.explorationTrackId = crypto.randomUUID()
    const response = await jsonRequest('/api/v1/backup/restore', invalid)
    expect(response.status).toBe(400); expectHeaders(response); expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', requestId: expect.any(String) } })
    expect((await request('/api/v1/backup')).body).toMatchObject({ data: (before.body as { data: unknown }).data })
  })

  it('returns stable validation, conflict and transport errors without creating success DTOs', async () => {
    const invalid = await jsonRequest('/api/v1/items', { title: '  ' }); expect(invalid.status).toBe(400); expect(invalid.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', message: '标题不能为空', requestId: expect.any(String) } })
    const overlong = await jsonRequest('/api/v1/items', { title: '😀'.repeat(21) }); expect(overlong.status).toBe(400); expect(overlong.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', message: '标题最多 20 个字符', requestId: expect.any(String) } })
    const invalidReview = await jsonRequest('/api/v1/reviews/complete', { itemId: crypto.randomUUID() }); expect(invalidReview.status).toBe(400); expect(invalidReview.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', requestId: expect.any(String) } })
    const item = (await jsonRequest('/api/v1/items', { title: 'conflict item' })).body as { id: string }
    const illegal = await jsonRequest(`/api/v1/items/${item.id}/status`, { status: 'reviewed' }); expect(illegal.status).toBe(409); expect(illegal.body).toMatchObject({ error: { code: 'CONFLICT', requestId: expect.any(String) } })
    const nonJson = await request('/api/v1/items', { method: 'POST', headers: { 'content-type': 'text/plain' } }, 'x'); expect(nonJson.status).toBe(415); expect(nonJson.body).toMatchObject({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', requestId: expect.any(String) } })
    const tooMany = await request(`/api/v1/method-source-displays?itemIds=${Array.from({ length: 101 }, () => crypto.randomUUID()).join(',')}`); expect(tooMany.status).toBe(400)
    const tooLong = await request(`/api/v1/method-source-displays?itemIds=${'a'.repeat(8 * 1024)}`); expect(tooLong.status).toBe(400); expect(tooLong.body).toEqual({ error: { code: 'VALIDATION_FAILED', message: 'itemIds 参数无效', requestId: expect.any(String) } })
    const malformedPath = await request('/api/v1/items/%E0'); expect(malformedPath.status).toBe(500); expect(malformedPath.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: '本地服务当前发生未分类错误', requestId: expect.any(String) } })
    for (const [path, method, code, message] of [
      ['/api/v1/items', 'PUT', 'METHOD_NOT_ALLOWED', '不允许的请求方法'],
      ['/api/v1/items/test-item/content', 'GET', 'METHOD_NOT_ALLOWED', '不允许的请求方法'],
      ['/health', 'POST', 'METHOD_NOT_ALLOWED', '不允许的请求方法'],
      ['/api/v1/unknown', 'GET', 'NOT_FOUND_ROUTE', '路由不存在'],
    ] as const) {
      const response = await request(path, { method })
      expect(response.status).toBe(code === 'METHOD_NOT_ALLOWED' ? 405 : 404)
      expect(response.body).toEqual({ error: { code, message, requestId: expect.any(String) } })
      expectHeaders(response)
    }
    const tooLarge = await request('/api/v1/items', { method: 'POST', headers: { 'content-length': String(64 * 1024 + 1) } }); expect(tooLarge.status).toBe(413)
  })

  it('maps unavailable MySQL writes to a sanitized 503 rather than a successful write', async () => {
    const unavailable = createApiServer({ ...config(appUser, 'wrong-password'), connectionLimit: 1 }); await new Promise<void>(resolve => unavailable.listen(0, '127.0.0.1', resolve))
    try {
      const health = await request('/health', {}, undefined, unavailable)
      expect(health.status).toBe(503); expectHeaders(health)
      expect(health.body).toEqual({ status: 'database-unavailable', message: '本地 MySQL 候选环境当前不可用' })
      expect(JSON.stringify(health.body)).not.toContain('diagnosticId')
      const frozenGet = await request('/api/v1/exploration-tracks', {}, undefined, unavailable)
      expect(frozenGet.status).toBe(503); expectHeaders(frozenGet)
      expect(frozenGet.body).toEqual({ error: { code: 'MYSQL_UNAVAILABLE', message: '本地 MySQL 候选环境当前不可用', requestId: expect.any(String) } })
      const response = await jsonRequestFor(unavailable, '/api/v1/items', { title: 'must not save' })
      expect(response.status).toBe(503)
      expect(response.body).toEqual({ error: { code: 'MYSQL_UNAVAILABLE', message: '本地 MySQL 候选环境当前不可用', requestId: expect.any(String) } })
    } finally { await new Promise<void>(resolve => unavailable.close(() => resolve())) }
  })
})

const jsonRequestFor = (server: http.Server, path: string, value: unknown) => request(path, { method: 'POST', headers: { 'content-type': 'application/json' } }, JSON.stringify(value), server)
