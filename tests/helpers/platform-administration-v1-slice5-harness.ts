import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import http, { type IncomingHttpHeaders, type Server } from 'node:http'
import os from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createApiServer } from '../../apps/api/src/index'
import { startApiMain } from '../../apps/api/src/main'
import { runInitialPlatformAdminCli } from '../../apps/api/src/grant-initial-platform-admin'
import { createMySqlPool, type MySqlConnectionConfig } from '../../packages/storage-mysql/src/index'

export const SLICE5_GATE_NAMES = [
  'KB_PLATFORM_V1_SLICE5_E2E',
  'KB_PLATFORM_V1_SLICE5_ALLOW_TEMP_DDL',
  'MYSQL_HOST',
  'MYSQL_PORT',
  'MYSQL_ROOT_PASSWORD',
] as const

export const slice5ExecutionEnabled = process.env.KB_PLATFORM_V1_SLICE5_E2E === '1'
  && process.env.KB_PLATFORM_V1_SLICE5_ALLOW_TEMP_DDL === 'YES-I-UNDERSTAND'
  && Boolean(process.env.MYSQL_HOST && process.env.MYSQL_PORT && process.env.MYSQL_ROOT_PASSWORD)

const databasePattern = /^kb_platform_v1s5_[0-9a-f]{24}$/
const appUserPattern = /^kb_pv1s5_app_[0-9a-f]{16}$/
const migratorUserPattern = /^kb_pv1s5_mig_[0-9a-f]{16}$/
const migrationsRoot = join(process.cwd(), 'migrations')
const h5Root = resolve(process.cwd(), 'apps/client/dist')
const businessTables = [
  'items', 'item_status_events', 'item_links', 'reviews', 'methods', 'method_evidence', 'method_versions',
  'method_applications', 'method_tombstones', 'exploration_tracks',
] as const

export type ProxyMode = 'normal' | 'delay-next-read' | 'drop-next-completed-write-response' | 'route-next-request-to-mysql-unavailable-api'

export interface SafeNetworkRecord {
  method: string
  path: string
  status: number
  errorCode?: string
  requestId?: string
  operationId: 'absent' | '<redacted>'
}

export interface HttpResult<T = unknown> {
  status: number
  headers: IncomingHttpHeaders
  body: T
}

export interface RuntimeSnapshot {
  database: 'knowledge_base' | 'knowledge_base_uat'
  tableCount: number
  schemaVersion: number
  platformTableCount: number
  sha256: string
}

interface ResourceNames {
  runId: string
  database: string
  appUser: string
  migratorUser: string
}

function safeError(message: string): Error {
  return new Error(message)
}

function assertLocalMySqlGate(): { host: string; port: number; rootPassword: string } {
  if (process.env.KB_PLATFORM_V1_SLICE5_E2E !== '1'
    || process.env.KB_PLATFORM_V1_SLICE5_ALLOW_TEMP_DDL !== 'YES-I-UNDERSTAND') throw safeError('SLICE5_EXECUTION_GATE_CLOSED')
  const host = process.env.MYSQL_HOST
  const port = Number(process.env.MYSQL_PORT)
  const rootPassword = process.env.MYSQL_ROOT_PASSWORD
  if (!host || !['127.0.0.1', 'localhost'].includes(host) || port !== 3306 || !rootPassword) throw safeError('SLICE5_LOCAL_MYSQL_GATE_REJECTED')
  if (!existsSync(join(h5Root, 'index.html'))) throw safeError('SLICE5_H5_BUILD_MISSING')
  return { host, port, rootPassword }
}

function resourceNames(): ResourceNames {
  const runId = crypto.randomBytes(12).toString('hex')
  const bounded = runId.slice(0, 16)
  const value = { runId, database: `kb_platform_v1s5_${runId}`, appUser: `kb_pv1s5_app_${bounded}`, migratorUser: `kb_pv1s5_mig_${bounded}` }
  if (!databasePattern.test(value.database) || !appUserPattern.test(value.appUser) || !migratorUserPattern.test(value.migratorUser)) throw safeError('SLICE5_RESOURCE_NAME_REJECTED')
  if (value.database === 'knowledge_base' || value.database === 'knowledge_base_uat') throw safeError('SLICE5_RUNTIME_DATABASE_REJECTED')
  return value
}

function normalizeValue(value: unknown): unknown {
  if (value === null) return { type: 'null' }
  if (Buffer.isBuffer(value)) return { type: 'buffer', hex: value.toString('hex') }
  if (value instanceof Date) return { type: 'date', iso: value.toISOString() }
  if (typeof value === 'bigint') return { type: 'bigint', value: value.toString() }
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (typeof value === 'object' && value) return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, normalizeValue(entry)]))
  return value
}

async function databaseSnapshot(root: Pool, database: RuntimeSnapshot['database']): Promise<RuntimeSnapshot> {
  const [tables] = await root.query<Array<RowDataPacket & { table_name: string }>>(
    "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema=? AND table_type='BASE TABLE' ORDER BY TABLE_NAME",
    [database],
  )
  const tableNames = tables.map(row => row.table_name)
  if (tableNames.length !== 15) throw safeError(`SLICE5_RUNTIME_TABLE_COUNT_${database}`)
  const [versions] = await root.query<Array<RowDataPacket & { version: number | null }>>(`SELECT MAX(version) version FROM \`${database}\`.schema_migrations`)
  const schemaVersion = Number(versions[0]?.version ?? 0)
  const platformTableCount = tableNames.filter(name => name === 'user_roles' || name === 'security_audit_events').length
  if (schemaVersion !== 5 || platformTableCount !== 0) throw safeError(`SLICE5_RUNTIME_SCHEMA_GATE_${database}`)

  const hash = crypto.createHash('sha256')
  const [columns] = await root.query<RowDataPacket[]>(
    'SELECT table_name,column_name,ordinal_position,column_type,is_nullable,column_default,extra FROM information_schema.columns WHERE table_schema=? ORDER BY table_name,ordinal_position',
    [database],
  )
  const [indexes] = await root.query<RowDataPacket[]>(
    'SELECT table_name,index_name,non_unique,seq_in_index,column_name,collation,sub_part FROM information_schema.statistics WHERE table_schema=? ORDER BY table_name,index_name,seq_in_index',
    [database],
  )
  const [constraints] = await root.query<RowDataPacket[]>(
    'SELECT table_name,constraint_name,constraint_type FROM information_schema.table_constraints WHERE table_schema=? ORDER BY table_name,constraint_name',
    [database],
  )
  hash.update(JSON.stringify(normalizeValue({ columns, indexes, constraints })))
  for (const table of tableNames) {
    const [primary] = await root.query<Array<RowDataPacket & { column_name: string }>>(
      "SELECT COLUMN_NAME AS column_name FROM information_schema.key_column_usage WHERE table_schema=? AND table_name=? AND constraint_name='PRIMARY' ORDER BY ORDINAL_POSITION",
      [database, table],
    )
    const order = primary.length ? ` ORDER BY ${primary.map(row => `\`${row.column_name}\``).join(',')}` : ''
    const [rows] = await root.query<RowDataPacket[]>(`SELECT * FROM \`${database}\`.\`${table}\`${order}`)
    hash.update(table)
    for (const row of rows) hash.update(JSON.stringify(normalizeValue(row)))
  }
  return { database, tableCount: tableNames.length, schemaVersion, platformTableCount, sha256: hash.digest('hex') }
}

function splitStatements(sql: string): string[] {
  return sql.split(/;\s*(?:\r?\n|$)/).map(value => value.trim()).filter(Boolean)
}

async function applyMigrations(pool: Pool, from: number, through: number): Promise<void> {
  const connection = await pool.getConnection()
  try {
    await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, name VARCHAR(255) NOT NULL, checksum CHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL) ENGINE=InnoDB')
    const [applied] = await connection.query<Array<RowDataPacket & { version: number }>>('SELECT version FROM schema_migrations')
    const versions = new Set(applied.map(row => Number(row.version)))
    const files = readdirSync(migrationsRoot).filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file)).sort()
    for (const file of files) {
      const version = Number(file.slice(0, 3))
      if (version < from || version > through || versions.has(version)) continue
      const sql = readFileSync(join(migrationsRoot, file), 'utf8')
      for (const statement of splitStatements(sql)) await connection.query(statement)
      await connection.query(
        'INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES (?,?,?,UTC_TIMESTAMP(3))',
        [version, file, crypto.createHash('sha256').update(sql).digest('hex')],
      )
    }
  } finally { connection.release() }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string' || address.address !== '127.0.0.1') return reject(safeError('SLICE5_NON_LOOPBACK_LISTENER'))
      resolveListen(address.port)
    })
  })
}

async function closeServer(server?: Server): Promise<void> {
  if (!server?.listening) return
  server.closeAllConnections()
  await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
}

function contentType(path: string): string {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' } as Record<string, string>)[extname(path)] ?? 'application/octet-stream'
}

function bodyErrorFacts(raw: Buffer): Pick<SafeNetworkRecord, 'errorCode' | 'requestId'> {
  try {
    const parsed = JSON.parse(raw.toString()) as { error?: { code?: unknown; requestId?: unknown } }
    return {
      ...(typeof parsed.error?.code === 'string' ? { errorCode: parsed.error.code } : {}),
      ...(typeof parsed.error?.requestId === 'string' ? { requestId: parsed.error.requestId } : {}),
    }
  } catch { return {} }
}

export class Slice5Harness {
  readonly names = resourceNames()
  readonly network: SafeNetworkRecord[] = []
  readonly secretValues = new Set<string>()
  readonly evidenceDirectory = join(os.tmpdir(), `kb-platform-v1-s5-${this.names.runId}`)
  readonly manifestPath = join(this.evidenceDirectory, 'resource-manifest.json')
  root?: Pool
  app?: Pool
  migrator?: Pool
  browser?: Browser
  normalApi?: Server
  faultApi?: Server
  h5?: Server
  normalApiPort = 0
  faultApiPort = 0
  h5Port = 0
  appPassword = crypto.randomBytes(32).toString('base64url')
  migratorPassword = crypto.randomBytes(32).toString('base64url')
  private mysql?: { host: string; port: number; rootPassword: string }
  private mode: ProxyMode = 'normal'
  private delayedRelease?: () => void
  private delayedPromise?: Promise<void>
  private acceptingProxy = true
  private operationIdsByRoute = new Map<string, Set<string>>()
  private preSnapshots?: RuntimeSnapshot[]
  postSnapshots?: RuntimeSnapshot[]
  startupFacts?: { schema5Rejected: boolean; schema6Allowed: boolean }
  grantFacts?: { app: string[]; migrator: string[] }

  config(user: string, password: string, limit = 8): MySqlConnectionConfig {
    if (!this.mysql) throw safeError('SLICE5_HARNESS_NOT_STARTED')
    return { host: this.mysql.host, port: this.mysql.port, database: this.names.database, user, password, connectionLimit: limit }
  }

  appEnvironment(): NodeJS.ProcessEnv {
    if (!this.mysql) throw safeError('SLICE5_HARNESS_NOT_STARTED')
    return {
      MYSQL_HOST: this.mysql.host,
      MYSQL_PORT: String(this.mysql.port),
      MYSQL_DATABASE: this.names.database,
      MYSQL_APP_USER: this.names.appUser,
      MYSQL_APP_PASSWORD: this.appPassword,
      MYSQL_POOL_CONNECTION_LIMIT: '2',
      API_HOST: '127.0.0.1',
      API_PORT: '32146',
    }
  }

  rememberSecret(value: string | undefined): void {
    if (value) this.secretValues.add(value)
  }

  async setup(): Promise<void> {
    this.mysql = assertLocalMySqlGate()
    this.rememberSecret(this.mysql.rootPassword)
    this.rememberSecret(this.appPassword)
    this.rememberSecret(this.migratorPassword)
    mkdirSync(this.evidenceDirectory, { recursive: false })
    writeFileSync(this.manifestPath, JSON.stringify({ database: this.names.database, appUser: this.names.appUser, migratorUser: this.names.migratorUser, stage: 'preflight' }))
    this.root = createMySqlPool({ host: this.mysql.host, port: this.mysql.port, database: 'mysql', user: 'root', password: this.mysql.rootPassword, connectionLimit: 2 })
    this.preSnapshots = await Promise.all([databaseSnapshot(this.root, 'knowledge_base'), databaseSnapshot(this.root, 'knowledge_base_uat')])

    const [existingDatabases] = await this.root.query<RowDataPacket[]>('SELECT schema_name FROM information_schema.schemata WHERE schema_name=?', [this.names.database])
    const [existingUsers] = await this.root.query<RowDataPacket[]>("SELECT user FROM mysql.user WHERE host='%' AND user IN (?,?)", [this.names.appUser, this.names.migratorUser])
    if (existingDatabases.length || existingUsers.length) throw safeError('SLICE5_RANDOM_RESOURCE_COLLISION')
    await this.root.query(`CREATE DATABASE \`${this.names.database}\``)
    await this.root.query(`CREATE USER '${this.names.appUser}'@'%' IDENTIFIED BY ?`, [this.appPassword])
    await this.root.query(`CREATE USER '${this.names.migratorUser}'@'%' IDENTIFIED BY ?`, [this.migratorPassword])
    await this.root.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${this.names.database}\`.* TO '${this.names.appUser}'@'%'`)
    await this.root.query(`GRANT SELECT,INSERT,CREATE,ALTER,INDEX,REFERENCES ON \`${this.names.database}\`.* TO '${this.names.migratorUser}'@'%'`)
    const [appGrants] = await this.root.query<Array<RowDataPacket & { Grants: string }>>(`SHOW GRANTS FOR '${this.names.appUser}'@'%'`)
    const [migratorGrants] = await this.root.query<Array<RowDataPacket & { Grants: string }>>(`SHOW GRANTS FOR '${this.names.migratorUser}'@'%'`)
    this.grantFacts = {
      app: appGrants.flatMap(row => Object.values(row).map(String)),
      migrator: migratorGrants.flatMap(row => Object.values(row).map(String)),
    }
    const appGrantText = this.grantFacts.app.join('\n').toUpperCase()
    const migratorGrantText = this.grantFacts.migrator.join('\n').toUpperCase()
    const appPermissions = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    const migratorPermissions = ['SELECT', 'INSERT', 'CREATE', 'ALTER', 'INDEX', 'REFERENCES']
    if (/GRANT OPTION|ALL PRIVILEGES/.test(`${appGrantText}\n${migratorGrantText}`)
      || appPermissions.some(permission => !appGrantText.includes(permission))
      || migratorPermissions.some(permission => !migratorGrantText.includes(permission))
      || /\b(CREATE|ALTER|INDEX|REFERENCES|DROP)\b/.test(appGrantText.replace('GRANT USAGE ON *.*', ''))
      || /\b(UPDATE|DELETE|DROP)\b/.test(migratorGrantText)) throw safeError('SLICE5_GRANT_GATE_REJECTED')

    this.migrator = createMySqlPool(this.config(this.names.migratorUser, this.migratorPassword, 2))
    await applyMigrations(this.migrator, 1, 5)
    this.app = createMySqlPool(this.config(this.names.appUser, this.appPassword, 12))
    const schema5 = await this.schemaFacts()
    if (schema5.version !== 5 || schema5.tableCount !== 15 || schema5.platformTableCount !== 0) throw safeError('SLICE5_SCHEMA5_FACT_REJECTED')
    let created = false; let listened = false; let logged = false
    try {
      await startApiMain(this.appEnvironment(), {
        createServer: () => { created = true; return http.createServer() },
        listen: async () => { listened = true },
        log: () => { logged = true },
      })
      throw safeError('SLICE5_SCHEMA5_STARTUP_UNEXPECTEDLY_ALLOWED')
    } catch (error) {
      if ((error as Error).message === 'SLICE5_SCHEMA5_STARTUP_UNEXPECTEDLY_ALLOWED') throw error
      if (created || listened || logged) throw safeError('SLICE5_SCHEMA5_REJECTED_AFTER_LISTEN_STEP')
    }
    await applyMigrations(this.migrator, 6, 6)
    const schema6 = await this.schemaFacts()
    if (schema6.version !== 6 || schema6.tableCount !== 17 || schema6.platformTableCount !== 2) throw safeError('SLICE5_SCHEMA6_FACT_REJECTED')
    created = false; listened = false; logged = false
    const fakeServer = http.createServer()
    await startApiMain(this.appEnvironment(), { createServer: () => { created = true; return fakeServer }, listen: async () => { listened = true }, log: () => { logged = true } })
    if (!created || !listened || !logged || fakeServer.listening) throw safeError('SLICE5_SCHEMA6_STARTUP_GATE_REJECTED')
    this.startupFacts = { schema5Rejected: true, schema6Allowed: true }

    this.normalApi = createApiServer(this.config(this.names.appUser, this.appPassword))
    this.faultApi = createApiServer(this.config(this.names.appUser, crypto.randomBytes(32).toString('base64url'), 1))
    this.normalApiPort = await listen(this.normalApi)
    this.faultApiPort = await listen(this.faultApi)
    this.h5 = this.createH5Proxy()
    this.h5Port = await listen(this.h5)
    this.browser = await chromium.launch({ headless: true })
    const normalHealth = await this.request('/health')
    const proxyHealth = await this.proxyRequest('/health')
    for (const health of [normalHealth, proxyHealth]) {
      if (health.status !== 200 || (health.body as any)?.status !== 'ready' || (health.body as any)?.database !== this.names.database || (health.body as any)?.schemaVersion !== 6) throw safeError('SLICE5_HEALTH_GATE_REJECTED')
    }
    writeFileSync(this.manifestPath, JSON.stringify({ database: this.names.database, appUser: this.names.appUser, migratorUser: this.names.migratorUser, ports: [this.normalApiPort, this.faultApiPort, this.h5Port], stage: 'ready' }))
  }

  async schemaFacts(): Promise<{ version: number; tableCount: number; platformTableCount: number }> {
    if (!this.app) throw safeError('SLICE5_APP_POOL_MISSING')
    const [versions] = await this.app.query<Array<RowDataPacket & { version: number | null }>>('SELECT MAX(version) version FROM schema_migrations')
    const [tables] = await this.app.query<Array<RowDataPacket & { tableCount: number; platformTableCount: number }>>(
      "SELECT COUNT(*) tableCount,SUM(table_name IN ('user_roles','security_audit_events')) platformTableCount FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE'",
    )
    return { version: Number(versions[0]?.version ?? 0), tableCount: Number(tables[0]?.tableCount ?? 0), platformTableCount: Number(tables[0]?.platformTableCount ?? 0) }
  }

  private consumeMode(): ProxyMode {
    const current = this.mode
    if (current !== 'normal') this.mode = 'normal'
    return current
  }

  setMode(mode: ProxyMode): void {
    if (this.mode !== 'normal' || this.delayedPromise) throw safeError('SLICE5_PROXY_MODE_ALREADY_ARMED')
    this.mode = mode
    if (mode === 'delay-next-read') this.delayedPromise = new Promise(resolveDelay => { this.delayedRelease = resolveDelay })
  }

  releaseDelayedRead(): void {
    this.delayedRelease?.()
    this.delayedRelease = undefined
    this.delayedPromise = undefined
  }

  distinctOperationIds(method: string, pathFragment: string): number {
    let count = 0
    for (const [route, values] of this.operationIdsByRoute) if (route.startsWith(`${method} `) && route.includes(pathFragment)) count += values.size
    return count
  }

  private createH5Proxy(): Server {
    return http.createServer((request, response) => {
      if (!this.acceptingProxy) { response.writeHead(503); response.end(); return }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
        const chunks: Buffer[] = []
        request.on('data', chunk => chunks.push(Buffer.from(chunk)))
        request.on('end', () => void this.forward(request.method ?? 'GET', url.pathname + url.search, request.headers, Buffer.concat(chunks), response).catch(() => {
          if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          if (!response.writableEnded) response.end(JSON.stringify({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'upstream unavailable', requestId: crypto.randomUUID() } }))
        }))
        return
      }
      const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '')
      const file = normalize(resolve(h5Root, relative))
      if (!file.startsWith(h5Root) || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404); response.end(); return }
      response.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' })
      createReadStream(file).pipe(response)
    })
  }

  private async forward(method: string, path: string, headers: IncomingHttpHeaders, body: Buffer, response: http.ServerResponse): Promise<void> {
    const mode = this.consumeMode()
    const port = mode === 'route-next-request-to-mysql-unavailable-api' ? this.faultApiPort : this.normalApiPort
    const operationId = (() => {
      try {
        const value = JSON.parse(body.toString()).operationId
        if (typeof value !== 'string') return 'absent' as const
        this.rememberSecret(value)
        const route = `${method} ${path.split('?')[0]}`
        const values = this.operationIdsByRoute.get(route) ?? new Set<string>()
        values.add(value); this.operationIdsByRoute.set(route, values)
        return '<redacted>' as const
      } catch { return 'absent' as const }
    })()
    const upstream = await new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolveUpstream, reject) => {
      const upstreamHeaders = { ...headers }
      delete upstreamHeaders.host
      delete upstreamHeaders.origin
      if (body.length) upstreamHeaders['content-length'] = String(body.length)
      else delete upstreamHeaders['content-length']
      const outgoing = http.request({ host: '127.0.0.1', port, method, path, headers: upstreamHeaders }, incoming => {
        const chunks: Buffer[] = []
        incoming.on('data', chunk => chunks.push(Buffer.from(chunk)))
        incoming.on('end', () => resolveUpstream({ status: incoming.statusCode ?? 502, headers: incoming.headers, body: Buffer.concat(chunks) }))
      })
      outgoing.on('error', reject)
      outgoing.end(body)
    })
    this.network.push({ method, path: path.replace(/([?&]query=)[^&]*/g, '$1<redacted>'), status: upstream.status, operationId, ...bodyErrorFacts(upstream.body) })
    if (mode === 'delay-next-read') await this.delayedPromise
    if (mode === 'drop-next-completed-write-response') {
      const route = path.split('?')[0]
      const isTargetWrite = (method === 'PUT' && /^\/api\/v1\/admin\/users\/[^/]+\/roles$/.test(route ?? ''))
        || (method === 'POST' && /^\/api\/v1\/admin\/users\/[^/]+\/revoke-sessions$/.test(route ?? ''))
      if (!isTargetWrite || upstream.status !== 200 || upstream.body.length < 2 || !response.socket) {
        throw safeError('SLICE5_DROP_RESPONSE_NOT_SAFELY_TRUNCATABLE')
      }
      try { JSON.parse(upstream.body.toString('utf8')) } catch { throw safeError('SLICE5_DROP_RESPONSE_NOT_SAFE_JSON') }
      const responseHeaders = { ...upstream.headers }
      delete responseHeaders['transfer-encoding']
      responseHeaders['content-length'] = String(upstream.body.length)
      const prefix = upstream.body.subarray(0, upstream.body.length - 1)
      response.writeHead(upstream.status, responseHeaders)
      response.flushHeaders()
      await new Promise<void>((resolveDrop, rejectDrop) => {
        response.write(prefix, error => {
          if (error) { rejectDrop(error); return }
          response.socket?.destroy()
          resolveDrop()
        })
      })
      return
    }
    response.writeHead(upstream.status, upstream.headers)
    response.end(upstream.body)
  }

  async context(): Promise<{ context: BrowserContext; page: Page }> {
    if (!this.browser) throw safeError('SLICE5_BROWSER_MISSING')
    const context = await this.browser.newContext()
    const page = await context.newPage()
    page.setDefaultTimeout(8_000)
    return { context, page }
  }

  async request<T = unknown>(path: string, init: { method?: string; cookie?: string; body?: unknown; port?: number } = {}): Promise<HttpResult<T>> {
    const rawBody = init.body === undefined ? undefined : JSON.stringify(init.body)
    return await new Promise((resolveRequest, reject) => {
      const outgoing = http.request({
        host: '127.0.0.1', port: init.port ?? this.normalApiPort, path, method: init.method ?? 'GET',
        headers: { ...(rawBody ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(rawBody) } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) },
      }, incoming => {
        const chunks: Buffer[] = []
        incoming.on('data', chunk => chunks.push(Buffer.from(chunk)))
        incoming.on('end', () => {
          const raw = Buffer.concat(chunks).toString()
          let body: unknown
          try { body = raw ? JSON.parse(raw) : undefined } catch { body = raw }
          resolveRequest({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: body as T })
        })
      })
      outgoing.on('error', reject)
      outgoing.end(rawBody)
    })
  }

  proxyRequest<T = unknown>(path: string, init: { method?: string; cookie?: string; body?: unknown } = {}): Promise<HttpResult<T>> {
    return this.request(path, { ...init, port: this.h5Port })
  }

  cookieOf(response: HttpResult): string {
    const header = response.headers['set-cookie']
    const first = Array.isArray(header) ? header[0] : header
    const cookie = first?.split(';')[0]
    if (!cookie) throw safeError('SLICE5_COOKIE_MISSING')
    this.rememberSecret(cookie.slice(cookie.indexOf('=') + 1))
    return cookie
  }

  async runInitialAdmin(userId: string): Promise<{ code: number; status?: string; database?: string; userId?: string }> {
    const stdout: string[] = []; const stderr: string[] = []
    const code = await runInitialPlatformAdminCli(
      [`--user-id=${userId}`, `--expected-database=${this.names.database}`, '--apply'],
      this.appEnvironment(),
      { stdout: value => stdout.push(value), stderr: value => stderr.push(value) },
    )
    if (stderr.some(value => this.containsSecret(value))) throw safeError('SLICE5_CLI_SECRET_LEAK')
    if (!stdout[0]) return { code }
    const parsed = JSON.parse(stdout[0]) as { status?: string; database?: string; userId?: string; operationId?: string }
    this.rememberSecret(parsed.operationId)
    return { code, status: parsed.status, database: parsed.database, userId: parsed.userId }
  }

  businessSnapshot(): Promise<Record<string, string>> {
    if (!this.app) throw safeError('SLICE5_APP_POOL_MISSING')
    return this.businessSnapshotInternal()
  }

  private async businessSnapshotInternal(): Promise<Record<string, string>> {
    const output: Record<string, string> = {}
    for (const table of businessTables) {
      const [rows] = await this.app!.query<RowDataPacket[]>(`SELECT * FROM \`${table}\` ORDER BY 1`)
      output[table] = crypto.createHash('sha256').update(JSON.stringify(normalizeValue(rows))).digest('hex')
    }
    return output
  }

  private containsSecret(value: string): boolean {
    for (const secret of this.secretValues) if (secret.length >= 8 && value.includes(secret)) return true
    return false
  }

  private scanDirectory(path: string): string[] {
    const findings: string[] = []
    const visit = (entry: string) => {
      const info = statSync(entry)
      if (info.isDirectory()) { for (const child of readdirSync(entry)) visit(join(entry, child)); return }
      const value = readFileSync(entry)
      for (const secret of this.secretValues) if (secret.length >= 8 && value.includes(Buffer.from(secret))) { findings.push(entry); break }
    }
    if (existsSync(path)) visit(path)
    return findings
  }

  sensitiveFindings(): string[] {
    const findings = [
      ...this.scanDirectory(join(process.cwd(), 'tests/platform-administration-v1-slice5.e2e.test.ts')),
      ...this.scanDirectory(join(process.cwd(), 'tests/helpers/platform-administration-v1-slice5-harness.ts')),
      ...this.scanDirectory(h5Root),
      ...this.scanDirectory(this.evidenceDirectory),
    ]
    const diff = execFileSync('git', ['diff', '--no-ext-diff'], { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    if (this.containsSecret(diff)) findings.push('git-diff')
    return [...new Set(findings)]
  }

  async cleanup(): Promise<void> {
    const failures: unknown[] = []
    this.mode = 'normal'; this.releaseDelayedRead(); this.acceptingProxy = false
    try { await this.browser?.close() } catch (error) { failures.push(error) }
    try { await closeServer(this.h5) } catch (error) { failures.push(error) }
    try { await closeServer(this.faultApi) } catch (error) { failures.push(error) }
    try { await closeServer(this.normalApi) } catch (error) { failures.push(error) }
    try { await this.app?.end() } catch (error) { failures.push(error) }
    try { await this.migrator?.end() } catch (error) { failures.push(error) }
    if (this.root) {
      try {
        if (!databasePattern.test(this.names.database) || !this.names.database.endsWith(this.names.runId)) throw safeError('SLICE5_CLEANUP_DATABASE_NAME_REJECTED')
        await this.root.query(`DROP DATABASE IF EXISTS \`${this.names.database}\``)
      } catch (error) { failures.push(error) }
      try { if (!appUserPattern.test(this.names.appUser)) throw safeError('SLICE5_CLEANUP_APP_USER_REJECTED'); await this.root.query(`DROP USER IF EXISTS '${this.names.appUser}'@'%'`) } catch (error) { failures.push(error) }
      try { if (!migratorUserPattern.test(this.names.migratorUser)) throw safeError('SLICE5_CLEANUP_MIGRATOR_USER_REJECTED'); await this.root.query(`DROP USER IF EXISTS '${this.names.migratorUser}'@'%'`) } catch (error) { failures.push(error) }
      try {
        const [databases] = await this.root.query<RowDataPacket[]>('SELECT schema_name FROM information_schema.schemata WHERE schema_name=?', [this.names.database])
        const [users] = await this.root.query<RowDataPacket[]>("SELECT user FROM mysql.user WHERE host='%' AND user IN (?,?)", [this.names.appUser, this.names.migratorUser])
        if (databases.length || users.length) throw safeError('SLICE5_RESOURCE_RESIDUE')
      } catch (error) { failures.push(error) }
      try {
        this.postSnapshots = await Promise.all([databaseSnapshot(this.root, 'knowledge_base'), databaseSnapshot(this.root, 'knowledge_base_uat')])
        if (!this.preSnapshots || JSON.stringify(this.preSnapshots) !== JSON.stringify(this.postSnapshots)) throw safeError('SLICE5_RUNTIME_SNAPSHOTS_CHANGED')
      } catch (error) { failures.push(error) }
      try { await this.root.end() } catch (error) { failures.push(error) }
    }
    try { if (this.sensitiveFindings().length) throw safeError('SLICE5_SENSITIVE_FINDINGS') } catch (error) { failures.push(error) }
    if (!failures.length) rmSync(this.evidenceDirectory, { recursive: true, force: false })
    if (failures.length) throw new AggregateError(failures, 'SLICE5_CLEANUP_FAILED')
  }
}

export function cookieAttributes(response: HttpResult): { httpOnly: boolean; sameSiteLax: boolean; pathRoot: boolean; expires: boolean; secure: boolean } {
  const header = response.headers['set-cookie']
  const value = Array.isArray(header) ? header[0] ?? '' : header ?? ''
  return {
    httpOnly: /;\s*HttpOnly/i.test(value), sameSiteLax: /;\s*SameSite=Lax/i.test(value), pathRoot: /;\s*Path=\//i.test(value),
    expires: /;\s*Expires=/i.test(value), secure: /;\s*Secure/i.test(value),
  }
}
