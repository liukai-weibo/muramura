import fs from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { createSqliteS4Repository, probeDatabaseWritable, SqliteStorageOpenError } from '@knowledge-base/storage-sqlite'

export const LOCAL_API_HOST = '127.0.0.1'
export const LOCAL_API_PORT = 32145
export const DATABASE_UNAVAILABLE = 'database-unavailable'

export interface LocalApiPaths {
  databasePath: string
  staticDirectory: string
}

export interface LocalApiOptions extends LocalApiPaths {
  host?: typeof LOCAL_API_HOST
  port?: typeof LOCAL_API_PORT
  probeWritable?: (database: ReturnType<typeof createSqliteS4Repository>['database']) => void
}

export interface LocalApiRuntime {
  readonly server: http.Server
  readonly databasePath: string
  readonly databaseAvailable: boolean
  start(): Promise<void>
  stop(): Promise<void>
}

type Checks = {
  apiReachable: true
  databaseOpenable: boolean
  databaseWritable: boolean
  candidateSchemaReady: boolean
  integrityPassed: boolean
}

type DatabaseState =
  | { status: 'ready'; database: ReturnType<typeof createSqliteS4Repository> }
  | { status: typeof DATABASE_UNAVAILABLE; category: FailureCategory; diagnosticId: DiagnosticId; message: string; checks: Checks }

type FailureCategory =
  | 'database-directory-unavailable'
  | 'database-open-failed'
  | 'database-write-unavailable'
  | 'schema-migration-failed'
  | 'integrity-check-failed'
  | 'unknown-database-error'

type DiagnosticId =
  | 'SQLITE_DIRECTORY_UNAVAILABLE'
  | 'SQLITE_UNAVAILABLE'
  | 'SQLITE_WRITE_UNAVAILABLE'
  | 'SQLITE_SCHEMA_UNAVAILABLE'
  | 'SQLITE_INTEGRITY_FAILED'
  | 'SQLITE_CANDIDATE_UNKNOWN'

export function defaultLocalApiPaths(localAppData = process.env.LOCALAPPDATA): LocalApiPaths {
  if (!localAppData) throw new Error('LOCALAPPDATA 未设置，无法确定本地数据库路径')
  const root = path.join(localAppData, 'Knowledge_Base')
  return { databasePath: path.join(root, 'knowledge-base.db'), staticDirectory: path.join(process.cwd(), 'apps', 'client', 'dist') }
}

function unavailable(code?: SqliteStorageOpenError['code']): Omit<Extract<DatabaseState, { status: typeof DATABASE_UNAVAILABLE }>, 'status'> {
  const mapping: Record<string, [FailureCategory, DiagnosticId, Checks]> = {
    'directory-unavailable': ['database-directory-unavailable', 'SQLITE_DIRECTORY_UNAVAILABLE', { apiReachable: true, databaseOpenable: false, databaseWritable: false, candidateSchemaReady: false, integrityPassed: false }],
    'database-open-failed': ['database-open-failed', 'SQLITE_UNAVAILABLE', { apiReachable: true, databaseOpenable: false, databaseWritable: false, candidateSchemaReady: false, integrityPassed: false }],
    'schema-migration-failed': ['schema-migration-failed', 'SQLITE_SCHEMA_UNAVAILABLE', { apiReachable: true, databaseOpenable: true, databaseWritable: false, candidateSchemaReady: false, integrityPassed: false }],
    'integrity-check-failed': ['integrity-check-failed', 'SQLITE_INTEGRITY_FAILED', { apiReachable: true, databaseOpenable: true, databaseWritable: false, candidateSchemaReady: true, integrityPassed: false }],
  }
  const [category, diagnosticId, checks] = mapping[code ?? ''] ?? ['unknown-database-error', 'SQLITE_CANDIDATE_UNKNOWN', { apiReachable: true, databaseOpenable: false, databaseWritable: false, candidateSchemaReady: false, integrityPassed: false }]
  return { category, diagnosticId, message: '候选 SQLite 数据库当前不可用', checks }
}

function openDatabase(databasePath: string): DatabaseState {
  try { return { status: 'ready', database: createSqliteS4Repository(databasePath) } }
  catch (error) {
    const result = unavailable(error instanceof SqliteStorageOpenError ? error.code : undefined)
    return { status: DATABASE_UNAVAILABLE, ...result }
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: object): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

function staticFilePath(staticDirectory: string, requestPath: string): string | undefined {
  const requested = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '')
  const root = path.resolve(staticDirectory)
  const resolved = path.resolve(root, requested)
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : undefined
}

function serveStatic(response: ServerResponse, staticDirectory: string, requestPath: string): void {
  const filePath = staticFilePath(staticDirectory, requestPath)
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { response.writeHead(404); response.end('Not found'); return }
  response.writeHead(200)
  fs.createReadStream(filePath).pipe(response)
}

interface LocalApiTestHooks {
  openFailure?: unknown
}

export function createLocalApi(options: LocalApiOptions, testHooks: LocalApiTestHooks = {}): LocalApiRuntime {
  const host = options.host ?? LOCAL_API_HOST
  const port = options.port ?? LOCAL_API_PORT
  if (host !== LOCAL_API_HOST) throw new Error(`Local API 只能监听 ${LOCAL_API_HOST}`)
  if (port !== LOCAL_API_PORT) throw new Error(`Local API 只能监听端口 ${LOCAL_API_PORT}`)

  const state = testHooks.openFailure === undefined
    ? openDatabase(options.databasePath)
    : (() => {
      const error = testHooks.openFailure
      const result = unavailable(error instanceof SqliteStorageOpenError ? error.code : undefined)
      return { status: DATABASE_UNAVAILABLE, ...result } as DatabaseState
    })()
  const candidateEnvironment = () => {
    if (state.status !== 'ready') return { httpStatus: 503, body: { status: DATABASE_UNAVAILABLE, failureCategory: state.category, diagnosticId: state.diagnosticId, databasePath: options.databasePath, message: state.message, checks: state.checks } }
    try {
      ;(options.probeWritable ?? probeDatabaseWritable)(state.database.database)
      return { httpStatus: 200, body: { status: 'ready', diagnosticId: 'CANDIDATE_READY', databasePath: options.databasePath, checks: { apiReachable: true, databaseOpenable: true, databaseWritable: true, candidateSchemaReady: true, integrityPassed: true } } }
    } catch {
      return { httpStatus: 503, body: { status: DATABASE_UNAVAILABLE, failureCategory: 'database-write-unavailable', diagnosticId: 'SQLITE_WRITE_UNAVAILABLE', databasePath: options.databasePath, message: '候选 SQLite 数据库当前不可写入', checks: { apiReachable: true, databaseOpenable: true, databaseWritable: false, candidateSchemaReady: true, integrityPassed: true } } }
    }
  }
  const server = http.createServer((request: IncomingMessage, response: ServerResponse) => {
    const requestUrl = new URL(request.url ?? '/', `http://${LOCAL_API_HOST}:${LOCAL_API_PORT}`)
    if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
      if (state.status === 'ready') sendJson(response, 200, { status: 'ready', databasePath: options.databasePath })
      else sendJson(response, 503, { status: DATABASE_UNAVAILABLE, databasePath: options.databasePath, error: state.message })
      return
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/candidate-environment') {
      const result = candidateEnvironment()
      sendJson(response, result.httpStatus, result.body)
      return
    }
    if (requestUrl.pathname.startsWith('/api/')) { sendJson(response, 404, { error: 'not-found' }); return }
    serveStatic(response, options.staticDirectory, requestUrl.pathname)
  })
  return {
    server, databasePath: options.databasePath, databaseAvailable: state.status === 'ready',
    start: () => new Promise((resolve, reject) => server.listen(port, host, () => resolve()).once('error', reject)),
    stop: () => new Promise((resolve, reject) => server.close(error => { if (state.status === 'ready') state.database.database.close(); if (error) reject(error); else resolve() })),
  }
}
