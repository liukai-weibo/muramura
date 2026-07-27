import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteStorageOpenError } from '../packages/storage-sqlite/src/errors'
import { createSqliteS4Repository } from '../packages/storage-sqlite/src/index'
import { createLocalApi, DATABASE_UNAVAILABLE, LOCAL_API_HOST, LOCAL_API_PORT } from '../apps/local-api/src/index'

const resources: Array<{ directory: string; stop: () => Promise<void> }> = []

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.stop()
    fs.rmSync(resource.directory, { recursive: true, force: true })
  }
})

function request(pathname: string): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: LOCAL_API_HOST, port: LOCAL_API_PORT, path: pathname, agent: false }, response => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { raw += chunk })
      response.on('end', () => {
        let body: unknown = raw
        try { body = JSON.parse(raw) }
        catch { /* Static resources are not JSON. */ }
        const result = { statusCode: response.statusCode ?? 0, body }
        Object.defineProperty(result, 'headers', { value: response.headers })
        resolve(result as { statusCode: number; headers: http.IncomingHttpHeaders; body: unknown })
      })
    })
    request.once('error', reject)
  })
}

function prepare(name: string, databasePath?: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `knowledge-base-local-api-${name}-`))
  const staticDirectory = path.join(directory, 'static')
  fs.mkdirSync(staticDirectory)
  fs.writeFileSync(path.join(staticDirectory, 'index.html'), '<main>Knowledge Base</main>')
  const api = createLocalApi({ databasePath: databasePath ?? path.join(directory, 'data', 'knowledge-base.db'), staticDirectory })
  resources.push({ directory, stop: () => api.stop() })
  return { api, directory }
}

describe('S6-A local API and SQLite runtime protection', () => {
  it('listens only on the fixed loopback address and reports ready after opening SQLite', async () => {
    const { api } = prepare('ready')
    expect(() => createLocalApi({ databasePath: api.databasePath, staticDirectory: '.', host: '0.0.0.0' as never })).toThrow('127.0.0.1')
    expect(() => createLocalApi({ databasePath: api.databasePath, staticDirectory: '.', port: 32146 as never })).toThrow('32145')

    await api.start()
    await expect(request('/api/health')).resolves.toEqual({
      statusCode: 200,
      body: { status: 'ready', databasePath: api.databasePath },
    })
  })

  it('returns a stable ready candidate environment DTO without business data', async () => {
    const { api } = prepare('candidate-ready')
    await api.start()

    await expect(request('/api/candidate-environment')).resolves.toEqual({
      statusCode: 200,
      body: {
        status: 'ready',
        diagnosticId: 'CANDIDATE_READY',
        databasePath: api.databasePath,
        checks: {
          apiReachable: true,
          databaseOpenable: true,
          databaseWritable: true,
          candidateSchemaReady: true,
          integrityPassed: true,
        },
      },
    })
  })

  it('maps unavailable SQLite startup failures to stable, sanitized candidate diagnostics', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-local-api-candidate-directory-'))
    const blockedParent = path.join(directory, 'blocked')
    fs.writeFileSync(blockedParent, 'not a directory')
    const databasePath = path.join(blockedParent, 'knowledge-base.db')
    const api = createLocalApi({ databasePath, staticDirectory: directory })
    resources.push({ directory, stop: () => api.stop() })

    await api.start()
    await expect(request('/api/candidate-environment')).resolves.toEqual({
      statusCode: 503,
      body: {
        status: DATABASE_UNAVAILABLE,
        failureCategory: 'database-directory-unavailable',
        diagnosticId: 'SQLITE_DIRECTORY_UNAVAILABLE',
        databasePath,
        message: '候选 SQLite 数据库当前不可用',
        checks: {
          apiReachable: true,
          databaseOpenable: false,
          databaseWritable: false,
          candidateSchemaReady: false,
          integrityPassed: false,
        },
      },
    })
  })

  it.each([
    ['database-open-failed', 'database-open-failed', 'SQLITE_UNAVAILABLE', { apiReachable: true, databaseOpenable: false, databaseWritable: false, candidateSchemaReady: false, integrityPassed: false }],
    ['schema-migration-failed', 'schema-migration-failed', 'SQLITE_SCHEMA_UNAVAILABLE', { apiReachable: true, databaseOpenable: true, databaseWritable: false, candidateSchemaReady: false, integrityPassed: false }],
    ['integrity-check-failed', 'integrity-check-failed', 'SQLITE_INTEGRITY_FAILED', { apiReachable: true, databaseOpenable: true, databaseWritable: false, candidateSchemaReady: true, integrityPassed: false }],
  ] as const)('maps %s to a stable, sanitized candidate failure DTO', async (code, failureCategory, diagnosticId, checks) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `knowledge-base-local-api-${code}-`))
    const databasePath = path.join(directory, 'preserved.db')
    const original = Buffer.from('preserve this existing database')
    fs.writeFileSync(databasePath, original)
    const api = createLocalApi(
      { databasePath, staticDirectory: directory },
      { openFailure: new SqliteStorageOpenError(code, databasePath, 'raw SQLite error SQL stack') },
    )
    resources.push({ directory, stop: () => api.stop() })

    await api.start()
    const response = await request('/api/candidate-environment')
    expect(response.statusCode).toBe(503)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({
      status: DATABASE_UNAVAILABLE,
      failureCategory,
      diagnosticId,
      databasePath,
      message: '候选 SQLite 数据库当前不可用',
      checks,
    })
    expect(JSON.stringify(response.body)).not.toMatch(/raw SQLite error|stack|Item|Review|Method|BackupData/)
    expect(fs.readFileSync(databasePath)).toEqual(original)
  })

  it('maps an unknown open failure to a stable sanitized candidate DTO', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-local-api-unknown-'))
    const databasePath = path.join(directory, 'preserved.db')
    const original = Buffer.from('preserve unknown failure database')
    fs.writeFileSync(databasePath, original)
    const api = createLocalApi({ databasePath, staticDirectory: directory }, { openFailure: new Error('raw SQL stack secret') })
    resources.push({ directory, stop: () => api.stop() })

    await api.start()
    const response = await request('/api/candidate-environment')
    expect(response.statusCode).toBe(503)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({
      status: DATABASE_UNAVAILABLE,
      failureCategory: 'unknown-database-error',
      diagnosticId: 'SQLITE_CANDIDATE_UNKNOWN',
      databasePath,
      message: '候选 SQLite 数据库当前不可用',
      checks: { apiReachable: true, databaseOpenable: false, databaseWritable: false, candidateSchemaReady: false, integrityPassed: false },
    })
    expect(JSON.stringify(response.body)).not.toMatch(/raw SQL|stack|secret|Item|Review|Method|BackupData/)
    expect(fs.readFileSync(databasePath)).toEqual(original)
  })

  it('reports write probe failure without changing BackupData or system metadata', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-local-api-write-'))
    const databasePath = path.join(directory, 'knowledge-base.db')
    const seed = createSqliteS4Repository(databasePath)
    const raw = (seed.database as unknown as { raw: { prepare: (sql: string) => { run: (...values: string[]) => void } } }).raw
    raw.prepare('INSERT INTO system_metadata VALUES(?, ?)').run('marker', 'preserved')
    await seed.itemRepository.create({ title: 'existing' })
    const baseline = await seed.backupRepository.exportData()
    seed.database.close()
    const api = createLocalApi({ databasePath, staticDirectory: directory, probeWritable: () => { throw new Error('raw SQLite failure must not leak') } })
    resources.push({ directory, stop: () => api.stop() })

    await api.start()
    await expect(request('/api/candidate-environment')).resolves.toEqual({
      statusCode: 503,
      body: {
        status: DATABASE_UNAVAILABLE,
        failureCategory: 'database-write-unavailable',
        diagnosticId: 'SQLITE_WRITE_UNAVAILABLE',
        databasePath,
        message: '候选 SQLite 数据库当前不可写入',
        checks: {
          apiReachable: true,
          databaseOpenable: true,
          databaseWritable: false,
          candidateSchemaReady: true,
          integrityPassed: true,
        },
      },
    })
    await api.stop()
    resources.splice(resources.findIndex(resource => resource.directory === directory), 1)
    const verified = createSqliteS4Repository(databasePath)
    expect(await verified.backupRepository.exportData()).toEqual(baseline)
    expect((verified.database as unknown as { raw: { prepare: (sql: string) => { get: () => unknown } } }).raw.prepare("SELECT value FROM system_metadata WHERE key = 'marker'").get()).toEqual({ value: 'preserved' })
    verified.database.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('serves known static files and rejects missing or encoded traversal paths', async () => {
    const { api, directory } = prepare('static')
    const staticDirectory = path.join(directory, 'static')
    fs.writeFileSync(path.join(staticDirectory, 'known-file.js'), 'console.log("known")')
    fs.writeFileSync(path.join(directory, 'secret.txt'), 'must not be served')

    await api.start()

    await expect(request('/')).resolves.toEqual({ statusCode: 200, body: '<main>Knowledge Base</main>' })
    await expect(request('/known-file.js')).resolves.toEqual({ statusCode: 200, body: 'console.log("known")' })
    await expect(request('/missing-file')).resolves.toEqual({ statusCode: 404, body: 'Not found' })
    await expect(request('/%2e%2e/secret.txt')).resolves.toEqual({ statusCode: 404, body: 'Not found' })
  })

  it('returns database-unavailable without creating a replacement database when its directory cannot be created', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-local-api-directory-'))
    const blockedParent = path.join(directory, 'blocked')
    fs.writeFileSync(blockedParent, 'not a directory')
    const databasePath = path.join(blockedParent, 'knowledge-base.db')
    const api = createLocalApi({ databasePath, staticDirectory: directory })
    resources.push({ directory, stop: () => api.stop() })

    expect(api.databaseAvailable).toBe(false)
    await api.start()
    await expect(request('/api/health')).resolves.toEqual({
      statusCode: 503,
      body: expect.objectContaining({ status: DATABASE_UNAVAILABLE, databasePath }),
    })
    expect(fs.readFileSync(blockedParent, 'utf8')).toBe('not a directory')
    expect(fs.existsSync(databasePath)).toBe(false)
  })

  it('returns database-unavailable and preserves an unreadable existing database file', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-local-api-corrupt-'))
    const databasePath = path.join(directory, 'knowledge-base.db')
    const original = Buffer.from('not a sqlite database')
    fs.writeFileSync(databasePath, original)
    const api = createLocalApi({ databasePath, staticDirectory: directory })
    resources.push({ directory, stop: () => api.stop() })

    expect(api.databaseAvailable).toBe(false)
    await api.start()
    await expect(request('/api/health')).resolves.toEqual({
      statusCode: 503,
      body: expect.objectContaining({ status: DATABASE_UNAVAILABLE, databasePath }),
    })
    expect(fs.readFileSync(databasePath)).toEqual(original)
  })
})
