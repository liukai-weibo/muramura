import crypto from 'node:crypto'
import http from 'node:http'
import {
  BackupApplicationService,
  AuthenticationApplicationService,
  DashboardApplicationService,
  ExplorationTrackApplicationService,
  ItemApplicationService,
  MethodApplicationService,
  MethodLifecycleApplicationService,
  PlatformAdministrationApplicationService,
  ReviewApplicationService,
  SearchApplicationService,
  TrashApplicationService,
} from '@knowledge-base/application'
import { itemStatuses, type ApiErrorBody, type AuthUser, type BackupDocument, type CompleteReviewInput, type CurrentAssociatedStatus, type ExplorationTrackSelection, type ItemStatus, type PlatformRole, type PublicBusinessErrorCode, type TrashFilter } from '@knowledge-base/contracts'
import {
  createMySqlPool,
  getMySqlHealth,
  MySqlAuthRepository,
  MySqlBackupRepository,
  MySqlDashboardRepository,
  MySqlExplorationTrackRepository,
  MySqlItemRepository,
  MySqlMethodApplicationRepository,
  MySqlMethodRepository,
  MySqlPlatformAdministrationRepository,
  MySqlReviewRepository,
  MySqlReviewWorkflowRepository,
  MySqlSearchRepository,
  readMySqlConfig,
  type MySqlConnectionConfig,
} from '@knowledge-base/storage-mysql'
import {
  ApiError,
  mapFailure,
  reportUnexpectedFailure,
  type ApiErrorCode,
} from './api-errors'

const allowedApiOrigins = new Set([
  'http://127.0.0.1:10086',
])
const normalBodyLimit = 64 * 1024
const backupBodyLimit = 16 * 1024 * 1024
const methodSourceDisplaysUrlLimit = 8 * 1024
type Services = ReturnType<typeof createServices>

const requestId = () => crypto.randomUUID()
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown) => typeof value === 'string' ? value : undefined

function json(response: http.ServerResponse, status: number, value: unknown, id: string, extra: Record<string, string> = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': id, ...extra })
  response.end(JSON.stringify(value))
}
function empty(response: http.ServerResponse, status: number, id: string) {
  response.writeHead(status, { 'cache-control': 'no-store', 'x-request-id': id })
  response.end()
}
function error(response: http.ServerResponse, status: number, code: ApiErrorCode, message: string, id: string, businessCode?: PublicBusinessErrorCode) {
  const body: ApiErrorBody = { error: { code, message, requestId: id, ...(businessCode ? { businessCode } : {}) } }
  json(response, status, body, id)
}
function cors(request: http.IncomingMessage, response: http.ServerResponse, id: string): boolean {
  const origin = request.headers.origin
  if (!origin) return true
  if (!allowedApiOrigins.has(origin)) { error(response, 403, 'VALIDATION_FAILED', '不允许的请求来源', id); return false }
  response.setHeader('access-control-allow-origin', origin)
  response.setHeader('vary', 'origin')
  response.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type, x-request-id')
  return true
}
async function readJson(request: http.IncomingMessage, limit: number): Promise<unknown> {
  const contentType = request.headers['content-type']
  if (!contentType?.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', '仅接受 application/json 请求')
  const declared = Number(request.headers['content-length'] ?? '0')
  if (!Number.isFinite(declared) || declared > limit) throw new ApiError(413, 'REQUEST_TOO_LARGE', '请求内容超过大小限制')
  let size = 0; const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new ApiError(413, 'REQUEST_TOO_LARGE', '请求内容超过大小限制')
    chunks.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new ApiError(400, 'VALIDATION_FAILED', '请求不是有效的 JSON') }
}
function requireObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ApiError(400, 'VALIDATION_FAILED', '请求体必须是 JSON 对象')
  return value
}
function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_FAILED', `${label}必须是字符串`)
  return value
}
function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, label)
}
function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new ApiError(400, 'VALIDATION_FAILED', `${label}必须是布尔值`)
  return value
}
function emptyWithCookie(response: http.ServerResponse, status: number, id: string, cookie: string) { response.writeHead(status, { 'cache-control': 'no-store', 'x-request-id': id, 'set-cookie': cookie }); response.end() }
function sessionSecret(request: http.IncomingMessage): Buffer | undefined { const raw = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('kb_session='))?.slice('kb_session='.length); if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) return undefined; try { const value = Buffer.from(raw, 'base64url'); return value.length === 32 ? value : undefined } catch { return undefined } }
function sessionCookie(secret: Buffer, expiresAt: string): string { return `kb_session=${secret.toString('base64url')}; HttpOnly; SameSite=Lax; Path=/; Expires=${new Date(expiresAt).toUTCString()}` }
function expiredSessionCookie(): string { return 'kb_session=; HttpOnly; SameSite=Lax; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT' }
function parseStatus(value: unknown): ItemStatus {
  if (typeof value !== 'string' || !itemStatuses.includes(value as ItemStatus)) throw new ApiError(400, 'VALIDATION_FAILED', '事项状态无效')
  return value as ItemStatus
}
function parseExplorationTrackSelection(value: unknown): ExplorationTrackSelection | undefined {
  if (value === undefined) return undefined
  const selection = requireObject(value)
  if (selection.type === 'existing') return { type: 'existing', trackId: requiredString(selection.trackId, 'explorationTrack.trackId') }
  if (selection.type === 'new') return { type: 'new', name: requiredString(selection.name, 'explorationTrack.name') }
  throw new ApiError(400, 'VALIDATION_FAILED', '主线选择无效')
}
function parseCurrentAssociatedStatus(value: string | null): CurrentAssociatedStatus {
  if (value !== 'doing' && value !== 'idea_to_try' && value !== 'idea_later' && value !== 'paused') throw new ApiError(400, 'VALIDATION_FAILED', '事项状态无效')
  return value
}
function createServices(config: MySqlConnectionConfig, scope?: { userId: string }, sharedPool?: ReturnType<typeof createMySqlPool>) {
  const pool = sharedPool ?? createMySqlPool(config)
  const items = new MySqlItemRepository(pool, undefined, scope)
  const methods = new MySqlMethodRepository(pool, undefined, scope)
  const reviews = new MySqlReviewRepository(pool, scope)
  const methodApplications = new MySqlMethodApplicationRepository(pool, undefined, scope)
  const explorationTracks = new MySqlExplorationTrackRepository(pool, undefined, scope)
  return {
    pool,
    items: new ItemApplicationService(items, explorationTracks),
    explorationTracks: new ExplorationTrackApplicationService(explorationTracks, explorationTracks),
    reviews: new ReviewApplicationService(reviews, methods, new MySqlReviewWorkflowRepository(pool, undefined, scope)),
    methods: new MethodLifecycleApplicationService(methods),
    methodApplications: new MethodApplicationService(methodApplications),
    trash: new TrashApplicationService(items, methods, explorationTracks),
    search: new SearchApplicationService(new MySqlSearchRepository(pool, undefined, scope)),
    dashboard: new DashboardApplicationService(new MySqlDashboardRepository(pool, scope)),
    backup: new BackupApplicationService(new MySqlBackupRepository(pool, undefined, scope)),
    auth: new AuthenticationApplicationService(new MySqlAuthRepository(pool)),
    platformAdministration: new PlatformAdministrationApplicationService(new MySqlPlatformAdministrationRepository(pool)),
  }
}

export function createApiServer(config = readMySqlConfig(process.env, 'app')): http.Server {
  const services = createServices(config)
  const server = http.createServer(async (request, response) => {
    const id = requestId(); const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (!cors(request, response, id)) return
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'x-request-id': id, 'cache-control': 'no-store' }); response.end(); return }
    const declaredLength = Number(request.headers['content-length'] ?? '0')
    const bodyLimit = url.pathname === '/api/v1/backup/restore' ? backupBodyLimit : normalBodyLimit
    const isAdminRequest = url.pathname.startsWith('/api/v1/admin/')
    if (!isAdminRequest && (!Number.isFinite(declaredLength) || declaredLength > bodyLimit)) { error(response, 413, 'REQUEST_TOO_LARGE', '请求内容超过大小限制', id); return }
    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        try { const health = await getMySqlHealth(services.pool, config.database); json(response, 200, { status: 'ready', database: health.database, schemaVersion: health.schemaVersion }, id) }
        catch { json(response, 503, { status: 'database-unavailable', message: '本地 MySQL 候选环境当前不可用' }, id) }
        return
      }
      if (url.pathname === '/health') { error(response, 405, 'METHOD_NOT_ALLOWED', '不允许的请求方法', id); return }
      if (!url.pathname.startsWith('/api/v1/')) { error(response, 404, 'NOT_FOUND_ROUTE', '路由不存在', id); return }
      if (url.pathname.startsWith('/api/v1/auth/')) { await route(request, response, url, services, id); return }
      const session = await services.auth.current(sessionSecret(request))
      if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'authentication required')
      if (isAdminRequest) {
        if (!session.user.roles.includes('platform_admin')) throw new ApiError(403, 'FORBIDDEN', '无权执行平台管理操作')
        if (!Number.isFinite(declaredLength) || declaredLength > normalBodyLimit) throw new ApiError(413, 'REQUEST_TOO_LARGE', '请求内容超过大小限制')
      }
      await route(request, response, url, createServices(config, { userId: session.user.id }, services.pool), id, session.user)
    } catch (cause) {
      reportUnexpectedFailure(id, cause)
      const failure = mapFailure(cause)
      error(response, failure.status, failure.code, failure.message, id, failure.businessCode)
    }
  })
  server.once('close', () => { void services.pool.end() })
  return server
}

async function route(request: http.IncomingMessage, response: http.ServerResponse, url: URL, services: Services, id: string, actor?: AuthUser): Promise<void> {
  const { method = 'GET' } = request; const path = url.pathname
  const match = (pattern: RegExp) => pattern.exec(path)?.slice(1)
  if (method === 'POST' && path === '/api/v1/auth/register') { const body = requireObject(await readJson(request, normalBodyLimit)); const result = await services.auth.register({ username: requiredString(body.username, 'username'), password: requiredString(body.password, 'password') }); return json(response, 201, result.session, id, { 'set-cookie': sessionCookie(result.secret, result.expiresAt) }) }
  if (method === 'POST' && path === '/api/v1/auth/login') { const body = requireObject(await readJson(request, normalBodyLimit)); const result = await services.auth.login({ username: requiredString(body.username, 'username'), password: requiredString(body.password, 'password') }); return json(response, 200, result.session, id, { 'set-cookie': sessionCookie(result.secret, result.expiresAt) }) }
  if (method === 'POST' && path === '/api/v1/auth/logout') { await services.auth.logout(sessionSecret(request)); return emptyWithCookie(response, 204, id, expiredSessionCookie()) }
  if (method === 'GET' && path === '/api/v1/auth/session') { const session = await services.auth.current(sessionSecret(request)); if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'authentication required'); return json(response, 200, session, id) }
  if (method === 'GET' && path === '/api/v1/admin/users') {
    const administrator = requireAdministrator(actor)
    return json(response, 200, await services.platformAdministration.listUsers(administrator, parseAdminUserListQuery(url.searchParams)), id)
  }
  let adminValues = match(/^\/api\/v1\/admin\/users\/([^/]+)\/roles$/)
  if (method === 'PUT' && adminValues) {
    const administrator = requireAdministrator(actor)
    const body = requireExactObject(await readJson(request, normalBodyLimit), ['roles', 'operationId'])
    return json(response, 200, await services.platformAdministration.setUserRoles(administrator, {
      targetUserId: parseAdminTargetId(adminValues[0]!),
      roles: parseAdminRoles(body.roles),
      operationId: requiredString(body.operationId, 'operationId'),
    }), id)
  }
  adminValues = match(/^\/api\/v1\/admin\/users\/([^/]+)\/revoke-sessions$/)
  if (method === 'POST' && adminValues) {
    const administrator = requireAdministrator(actor)
    const body = requireExactObject(await readJson(request, normalBodyLimit), ['operationId'])
    return json(response, 200, await services.platformAdministration.revokeAllUserSessions(administrator, {
      targetUserId: parseAdminTargetId(adminValues[0]!),
      operationId: requiredString(body.operationId, 'operationId'),
    }), id)
  }
  if (method === 'GET' && path === '/api/v1/search') return json(response, 200, await services.search.search(url.searchParams.get('query') ?? ''), id)
  if (method === 'GET' && path === '/api/v1/dashboard') { const window = url.searchParams.get('window'); if (window !== '7d' && window !== '30d' && window !== 'all') throw new ApiError(400, 'VALIDATION_FAILED', '无效的仪表盘时间范围'); return json(response, 200, await services.dashboard.getReport(window), id) }
  if (method === 'GET' && path === '/api/v1/methods') return json(response, 200, await services.reviews.listMethods(), id)
  if (method === 'GET' && path === '/api/v1/items/trash') return json(response, 200, await services.items.listTrash(), id)
  if (method === 'GET' && path === '/api/v1/items') {
    const statuses = url.searchParams.getAll('status'); const trackIds = url.searchParams.getAll('explorationTrackId')
    if (statuses.length === 0 && trackIds.length === 0) return json(response, 200, await services.items.listItems(), id)
    if (statuses.length !== 1 || trackIds.length !== 1 || !trackIds[0]) throw new ApiError(400, 'VALIDATION_FAILED', '事项定位参数无效')
    return json(response, 200, await services.explorationTracks.listItemsByExplorationTrackAndStatus(trackIds[0]!, parseCurrentAssociatedStatus(statuses[0]!)), id)
  }
  if (method === 'POST' && path === '/api/v1/items') { const body = requireObject(await readJson(request, normalBodyLimit)); return json(response, 201, await services.items.createIdea({ title: optionalString(body.title, 'title'), content: optionalString(body.content, 'content'), saveForLater: body.saveForLater === true, explorationTrack: parseExplorationTrackSelection(body.explorationTrack) }), id) }
  if (method === 'GET' && path === '/api/v1/exploration-tracks') return json(response, 200, await services.explorationTracks.listActiveExplorationTracks(), id)
  if (method === 'GET' && path === '/api/v1/exploration-tracks/selectable') return json(response, 200, await services.explorationTracks.listSelectableExplorationTracks(), id)
  if (method === 'GET' && path === '/api/v1/exploration-tracks/deleted') return json(response, 200, await services.explorationTracks.listDeletedExplorationTracks(), id)
  if (method === 'POST' && path === '/api/v1/exploration-tracks') { const body = requireObject(await readJson(request, normalBodyLimit)); return json(response, 201, await services.explorationTracks.createExplorationTrack(requiredString(body.name, 'name')), id) }
  if (method === 'POST' && path === '/api/v1/reviews/complete') { const body = requireObject(await readJson(request, normalBodyLimit)); return json(response, 201, await services.reviews.completeReview(parseReview(body)), id) }
  if (method === 'POST' && path === '/api/v1/method-applications') { const body = requireObject(await readJson(request, normalBodyLimit)); return json(response, 201, await services.methodApplications.createItem(requiredString(body.methodId, 'methodId'), requiredString(body.title, 'title'), optionalString(body.content, 'content')), id) }
  if (method === 'GET' && path === '/api/v1/backup') return json(response, 200, await services.backup.createBackup(), id)
  if (method === 'POST' && path === '/api/v1/backup/restore') { const raw = await readJson(request, backupBodyLimit); const document = services.backup.parseAndValidate(JSON.stringify(raw)); await services.backup.restoreBackup(document); return empty(response, 204, id) }
  if (method === 'GET' && path === '/api/v1/trash') { const filter = url.searchParams.get('filter'); if (filter !== 'all' && filter !== 'item' && filter !== 'method' && filter !== 'exploration-track') throw new ApiError(400, 'VALIDATION_FAILED', '无效的回收站筛选条件'); return json(response, 200, await services.trash.listTrashEntries(filter as TrashFilter), id) }
  if (method === 'GET' && path === '/api/v1/method-source-displays') { const raw = url.searchParams.get('itemIds') ?? ''; const itemIds = raw ? raw.split(',') : []; if (url.pathname.length + url.search.length > methodSourceDisplaysUrlLimit || itemIds.length > 100 || itemIds.some(value => !value)) throw new ApiError(400, 'VALIDATION_FAILED', 'itemIds 参数无效'); return json(response, 200, await services.methodApplications.listSourceDisplaysForItems(itemIds), id) }

  let values = match(/^\/api\/v1\/exploration-tracks\/([^/]+)\/history$/)
  if (method === 'GET' && values) { const history = await services.explorationTracks.getExplorationTrackHistory(decodeURIComponent(values[0]!)); if (!history) throw new ApiError(404, 'NOT_FOUND', '探索主线不存在'); return json(response, 200, history, id) }
  values = match(/^\/api\/v1\/exploration-tracks\/([^/]+)\/restore$/)
  if (method === 'POST' && values) return json(response, 200, await services.explorationTracks.restoreExplorationTrack(decodeURIComponent(values[0]!)), id)
  values = match(/^\/api\/v1\/exploration-tracks\/([^/]+)$/)
  if (method === 'PATCH' && values) { const body = requireObject(await readJson(request, normalBodyLimit)); return json(response, 200, await services.explorationTracks.renameExplorationTrack(decodeURIComponent(values[0]!), requiredString(body.name, 'name')), id) }
  if (method === 'DELETE' && values) { await services.explorationTracks.deleteExplorationTrack(decodeURIComponent(values[0]!)); return empty(response, 204, id) }
  values = match(/^\/api\/v1\/reviews\/by-item\/([^/]+)$/)
  if (method === 'GET' && values) { const review = await services.reviews.getReviewForItem(decodeURIComponent(values[0]!)); if (!review) throw new ApiError(404, 'NOT_FOUND', '复盘不存在'); return json(response, 200, review, id) }
  values = match(/^\/api\/v1\/reviews\/([^/]+)$/)
  if (method === 'GET' && values) { const review = await services.reviews.getReview(decodeURIComponent(values[0]!)); if (!review) throw new ApiError(404, 'NOT_FOUND', '复盘不存在'); return json(response, 200, review, id) }
  values = match(/^\/api\/v1\/items\/([^/]+)\/exploration-track$/)
  if (method === 'GET' && values) { const context = await services.explorationTracks.getItemExplorationTrackContext(decodeURIComponent(values[0]!)); if (!context) throw new ApiError(404, 'NOT_FOUND', '事项不存在'); return json(response, 200, context, id) }
  if (method === 'PUT' && values) { const body = requireObject(await readJson(request, normalBodyLimit)); return json(response, 200, await services.explorationTracks.assignItemToExplorationTrack(decodeURIComponent(values[0]!), requiredString(body.trackId, 'trackId')), id) }
  if (method === 'DELETE' && values) { await services.explorationTracks.removeItemFromExplorationTrack(decodeURIComponent(values[0]!)); return empty(response, 204, id) }
  values = match(/^\/api\/v1\/items\/([^/]+)\/status-events$/)
  if (method === 'GET' && values) return json(response, 200, await services.items.listStatusEvents(decodeURIComponent(values[0]!)), id)
  values = match(/^\/api\/v1\/items\/([^/]+)\/content$/)
  if (method === 'PATCH' && values) { const body = requireObject(await readJson(request, normalBodyLimit)); return json(response, 200, await services.items.updateItemContent(decodeURIComponent(values[0]!), requiredString(body.content, 'content')), id) }
  values = match(/^\/api\/v1\/items\/([^/]+)\/start$/)
  if (method === 'POST' && values) { const body = requireObject(await readJson(request, normalBodyLimit)); return json(response, 200, await services.items.startExecution(decodeURIComponent(values[0]!), optionalString(body.startAction, 'startAction'), optionalBoolean(body.overwriteExistingStartAction, 'overwriteExistingStartAction')), id) }
  values = match(/^\/api\/v1\/items\/([^/]+)\/status$/)
  if (method === 'POST' && values) { const body = requireObject(await readJson(request, normalBodyLimit)); return json(response, 200, await services.items.changeStatus(decodeURIComponent(values[0]!), parseStatus(body.status)), id) }
  values = match(/^\/api\/v1\/items\/([^/]+)\/restore$/)
  if (method === 'POST' && values) return json(response, 200, await services.items.restoreItem(decodeURIComponent(values[0]!)), id)
  values = match(/^\/api\/v1\/items\/([^/]+)$/)
  if (method === 'GET' && values) return json(response, 200, await services.items.getItem(decodeURIComponent(values[0]!)), id)
  if (method === 'DELETE' && values) { await services.items.deleteItem(decodeURIComponent(values[0]!)); return empty(response, 204, id) }
  values = match(/^\/api\/v1\/methods\/by-review\/([^/]+)$/)
  if (method === 'GET' && values) return json(response, 200, await services.reviews.listMethodsFromReview(decodeURIComponent(values[0]!)), id)
  values = match(/^\/api\/v1\/methods\/([^/]+)\/versions$/)
  if (method === 'GET' && values) return json(response, 200, await services.reviews.listMethodVersions(decodeURIComponent(values[0]!)), id)
  values = match(/^\/api\/v1\/methods\/([^/]+)\/evidence$/)
  if (method === 'GET' && values) return json(response, 200, await services.reviews.listMethodEvidenceDetails(decodeURIComponent(values[0]!)), id)
  values = match(/^\/api\/v1\/methods\/([^/]+)\/restore$/)
  if (method === 'POST' && values) return json(response, 200, await services.methods.restore(decodeURIComponent(values[0]!)), id)
  values = match(/^\/api\/v1\/methods\/([^/]+)$/)
  if (method === 'DELETE' && values) { await services.methods.moveToTrash(decodeURIComponent(values[0]!)); return empty(response, 204, id) }
  values = match(/^\/api\/v1\/method-applications\/([^/]+)\/context$/)
  if (method === 'GET' && values) return json(response, 200, await services.methodApplications.getContextResultForItem(decodeURIComponent(values[0]!)), id)
  values = match(/^\/api\/v1\/trash\/(item|method)\/([^/]+)\/restore$/)
  if (method === 'POST' && values) return json(response, 200, values[0] === 'item' ? await services.items.restoreItem(decodeURIComponent(values[1]!)) : await services.methods.restore(decodeURIComponent(values[1]!)), id)
  if (isKnownApiPath(path)) { error(response, 405, 'METHOD_NOT_ALLOWED', '不允许的请求方法', id); return }
  error(response, 404, 'NOT_FOUND_ROUTE', '路由不存在', id)
}

function isKnownApiPath(path: string): boolean {
  return [
    '/api/v1/search', '/api/v1/dashboard', '/api/v1/methods', '/api/v1/items', '/api/v1/reviews/complete', '/api/v1/method-applications', '/api/v1/backup', '/api/v1/backup/restore', '/api/v1/trash', '/api/v1/method-source-displays', '/api/v1/auth/register', '/api/v1/auth/login', '/api/v1/auth/logout', '/api/v1/auth/session', '/api/v1/admin/users',
    /^\/api\/v1\/admin\/users\/[^/]+\/(?:roles|revoke-sessions)$/,
    '/api/v1/exploration-tracks', '/api/v1/exploration-tracks/selectable', '/api/v1/exploration-tracks/deleted',
    /^\/api\/v1\/exploration-tracks\/[^/]+(?:\/(?:history|restore))?$/,
    /^\/api\/v1\/reviews\/(?:by-item\/)?[^/]+$/,
    /^\/api\/v1\/items\/[^/]+(?:\/(?:status-events|content|start|status|restore|exploration-track))?$/,
    /^\/api\/v1\/methods\/(?:by-review\/[^/]+|[^/]+(?:\/(?:versions|evidence|restore))?)$/,
    /^\/api\/v1\/method-applications\/[^/]+\/context$/,
    /^\/api\/v1\/trash\/(?:item|method)\/[^/]+\/restore$/,
  ].some(pattern => typeof pattern === 'string' ? pattern === path : pattern.test(path))
}

function requireAdministrator(actor: AuthUser | undefined): AuthUser {
  if (!actor?.roles.includes('platform_admin')) throw new ApiError(403, 'FORBIDDEN', '无权执行平台管理操作')
  return actor
}

function requireExactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const body = requireObject(value)
  const actual = Object.keys(body).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ApiError(400, 'VALIDATION_FAILED', '请求体字段无效')
  }
  return body
}

function parseAdminRoles(value: unknown): PlatformRole[] {
  if (!Array.isArray(value) || value.some(role => typeof role !== 'string')) throw new ApiError(400, 'VALIDATION_FAILED', 'roles 参数无效')
  if (value.length === 1 && value[0] === 'member') return ['member']
  if (value.length === 2 && value[0] === 'member' && value[1] === 'platform_admin') return ['member', 'platform_admin']
  throw new ApiError(400, 'VALIDATION_FAILED', 'roles 参数无效')
}

function parseAdminTargetId(encoded: string): string {
  let value: string
  try { value = decodeURIComponent(encoded) } catch { throw new ApiError(400, 'VALIDATION_FAILED', '目标用户 ID 无效') }
  if (value.length < 1 || value.length > 128 || value.trim() !== value || /[\u0000-\u001f\u007f/?#]/.test(value)) {
    throw new ApiError(400, 'VALIDATION_FAILED', '目标用户 ID 无效')
  }
  return value
}

function parseAdminUserListQuery(parameters: URLSearchParams): { page: number; query?: string } {
  for (const key of parameters.keys()) if (key !== 'page' && key !== 'query') throw new ApiError(400, 'VALIDATION_FAILED', '用户列表查询参数无效')
  const pages = parameters.getAll('page')
  const queries = parameters.getAll('query')
  if (pages.length > 1 || queries.length > 1) throw new ApiError(400, 'VALIDATION_FAILED', '用户列表查询参数无效')
  const rawPage = pages[0]
  if (rawPage !== undefined && !/^[1-9][0-9]*$/.test(rawPage)) throw new ApiError(400, 'VALIDATION_FAILED', '页码无效')
  const page = rawPage === undefined ? 1 : Number(rawPage)
  if (!Number.isSafeInteger(page)) throw new ApiError(400, 'VALIDATION_FAILED', '页码无效')
  const query = queries[0]?.trim()
  if (query !== undefined && query.length > 80) throw new ApiError(400, 'VALIDATION_FAILED', '搜索文本过长')
  return query ? { page, query } : { page }
}

function parseReview(body: Record<string, unknown>): CompleteReviewInput {
  const method = body.method === undefined ? undefined : parseMethod(requireObject(body.method))
  const existingRaw = body.existingMethod === undefined ? undefined : requireObject(body.existingMethod)
  const existingMethod = existingRaw ? { methodId: requiredString(existingRaw.methodId, 'existingMethod.methodId'), ...(existingRaw.revision === undefined ? {} : { revision: parseMethod(requireObject(existingRaw.revision)) }) } : undefined
  return { itemId: requiredString(body.itemId, 'itemId'), actualAction: requiredString(body.actualAction, 'actualAction'), result: requiredString(body.result, 'result'), effective: requiredString(body.effective, 'effective'), incompatible: requiredString(body.incompatible, 'incompatible'), reason: requiredString(body.reason, 'reason'), adjustment: requiredString(body.adjustment, 'adjustment'), newIdeas: optionalString(body.newIdeas, 'newIdeas'), ...(method ? { method } : {}), ...(existingMethod ? { existingMethod } : {}) }
}
function parseMethod(body: Record<string, unknown>) { return { title: requiredString(body.title, 'method.title'), applicable: requiredString(body.applicable, 'method.applicable'), unsuitable: optionalString(body.unsuitable, 'method.unsuitable'), steps: requiredString(body.steps, 'method.steps') } }

export function readApiListenConfig(environment: NodeJS.ProcessEnv): { host: '127.0.0.1'; port: 32146 } {
  const host = environment.API_HOST ?? '127.0.0.1'; const port = Number(environment.API_PORT ?? '32146')
  if (host !== '127.0.0.1' || port !== 32146) throw new Error('API 仅允许监听 127.0.0.1:32146')
  return { host, port }
}
