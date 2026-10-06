import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiServer } from '../apps/api/src/index'
import { createMySqlPool, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
let database = ''; let appUser = ''; let migratorUser = ''
let root: ReturnType<typeof createMySqlPool>; let app: ReturnType<typeof createMySqlPool>; let server: http.Server

interface RawResponse { status: number; headers: http.IncomingHttpHeaders; raw: string }
function rawRequest(path: string, options: { cookie?: string; method?: string; body?: unknown } = {}): Promise<RawResponse> {
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body)
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      host: '127.0.0.1', port: (server.address() as { port: number }).port, path,
      method: options.method ?? 'GET',
      headers: { ...(options.cookie ? { cookie: options.cookie } : {}), ...(payload !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) },
    }, incoming => {
      const chunks: Buffer[] = []
      incoming.on('data', chunk => chunks.push(Buffer.from(chunk)))
      incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, raw: Buffer.concat(chunks).toString('utf8') }))
    })
    outgoing.on('error', reject)
    if (payload !== undefined) outgoing.write(payload)
    outgoing.end()
  })
}
function register(username: string, password: string): Promise<{ cookie: string; userId: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ username, password })
    const outgoing = http.request({ host: '127.0.0.1', port: (server.address() as { port: number }).port, path: '/api/v1/auth/register', method: 'POST', headers: { 'content-type': 'application/json' } }, incoming => {
      const chunks: Buffer[] = []
      incoming.on('data', chunk => chunks.push(Buffer.from(chunk)))
      incoming.on('end', () => {
        const raw = Buffer.concat(chunks).toString()
        const parsed = JSON.parse(raw) as { user: { id: string } }
        resolve({ cookie: String(incoming.headers['set-cookie']).split(';')[0]!, userId: parsed.user.id })
      })
    })
    outgoing.on('error', reject); outgoing.write(body); outgoing.end()
  })
}

const validConfig = {
  serviceName: 'qa-ai-service', modelName: 'qa-ai-model', baseUrl: 'https://api.example.com/v1', apiKey: 'qa-secret-key',
  temperature: 0.5, topP: 0.9, presencePenalty: 0, frequencyPenalty: 0,
}

describe.runIf(enabled)('ai configuration authorization', () => {
  let adminCookie = ''; let adminId = ''; let ordinaryAdminCookie = ''; let ordinaryAdminId = ''; let memberCookie = ''
  let secretDirectory = ''
  const previousSecretMode = process.env.AI_SECRET_STORE
  const previousSecretPath = process.env.AI_SECRET_STORE_PATH

  beforeAll(async () => {
    // AI 配置存放在 SecretStore（默认 keytar = Windows 凭据管理器全局共享，不随临时库隔离）。
    // 这里改用临时文件存储，确保测试绝不读写真实环境的 AI 配置。
    secretDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-aicfg-secrets-'))
    process.env.AI_SECRET_STORE = 'file'
    process.env.AI_SECRET_STORE_PATH = path.join(secretDirectory, 'ai-config.json')

    const suffix = crypto.randomUUID().replaceAll('-', '')
    database = `kb_aicfg_api_${suffix}`; appUser = `kb_aicfg_app_${suffix.slice(0, 15)}`; migratorUser = `kb_aicfg_mig_${suffix.slice(0, 15)}`
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

    const admin = await register('aicfg-admin', 'password-admin'); adminCookie = admin.cookie; adminId = admin.userId
    const ordinaryAdmin = await register('aicfg-ordinary-admin', 'password-ordinary-admin'); ordinaryAdminCookie = ordinaryAdmin.cookie; ordinaryAdminId = ordinaryAdmin.userId
    const member = await register('aicfg-member', 'password-member'); memberCookie = member.cookie
    await app.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES (?,'platform_admin',NULL,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [adminId])
    await app.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES (?,'ordinary_admin',NULL,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [ordinaryAdminId])
  }, 60_000)

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
    if (failures.length) throw new AggregateError(failures, 'temporary ai-config API resources were not fully cleaned')
    if (previousSecretMode === undefined) delete process.env.AI_SECRET_STORE
    else process.env.AI_SECRET_STORE = previousSecretMode
    if (previousSecretPath === undefined) delete process.env.AI_SECRET_STORE_PATH
    else process.env.AI_SECRET_STORE_PATH = previousSecretPath
    if (secretDirectory) fs.rmSync(secretDirectory, { recursive: true, force: true })
  }, 60_000)

  it('requires a session and rejects plain members on every ai-config verb', async () => {
    expect((await rawRequest('/api/v1/admin/experimental/ai-config')).status).toBe(401)
    expect((await rawRequest('/api/v1/admin/experimental/ai-config', { cookie: memberCookie })).status).toBe(403)
    expect((await rawRequest('/api/v1/admin/experimental/ai-config', { cookie: memberCookie, method: 'PUT', body: validConfig })).status).toBe(403)
    expect((await rawRequest('/api/v1/admin/experimental/ai-config', { cookie: memberCookie, method: 'DELETE' })).status).toBe(403)
  })

  it('grants ordinary_admin the full ai-config module (read, write, clear)', async () => {
    // 未配置时 GET 返回 503（AI configuration unavailable），这是既有语义；
    // 关键是不得为 403：普通管理员已通过授权。
    const read = await rawRequest('/api/v1/admin/experimental/ai-config', { cookie: ordinaryAdminCookie })
    expect(read.status).toBe(503)

    const written = await rawRequest('/api/v1/admin/experimental/ai-config', { cookie: ordinaryAdminCookie, method: 'PUT', body: validConfig })
    expect(written.status).toBe(200)
    expect(JSON.parse(written.raw)).toMatchObject({ serviceName: 'qa-ai-service', modelName: 'qa-ai-model', baseUrl: 'https://api.example.com/v1', apiKeyConfigured: true })
    // API Key 只写入 SecretStore，任何响应都不得回显
    expect(written.raw).not.toContain('qa-secret-key')

    const reread = await rawRequest('/api/v1/admin/experimental/ai-config', { cookie: ordinaryAdminCookie })
    expect(reread.status).toBe(200)
    expect(JSON.parse(reread.raw)).toMatchObject({ serviceName: 'qa-ai-service', apiKeyConfigured: true })
    expect(reread.raw).not.toContain('qa-secret-key')

    expect((await rawRequest('/api/v1/admin/experimental/ai-config', { cookie: ordinaryAdminCookie, method: 'DELETE' })).status).toBe(204)
    expect((await rawRequest('/api/v1/admin/experimental/ai-config', { cookie: ordinaryAdminCookie })).status).toBe(503)
  })

  it('keeps platform_admin on the same ai-config module', async () => {
    const written = await rawRequest('/api/v1/admin/experimental/ai-config', { cookie: adminCookie, method: 'PUT', body: { ...validConfig, serviceName: 'qa-admin-service' } })
    expect(written.status).toBe(200)
    expect(JSON.parse(written.raw)).toMatchObject({ serviceName: 'qa-admin-service' })
    expect((await rawRequest('/api/v1/admin/experimental/ai-config', { cookie: adminCookie })).status).toBe(200)
    expect((await rawRequest('/api/v1/admin/experimental/ai-config', { cookie: adminCookie, method: 'DELETE' })).status).toBe(204)
  })

  it('still reserves the audit center to platform_admin only', async () => {
    // AI 参数放权不得顺带放开安全审计
    expect((await rawRequest('/api/v1/admin/audit/events', { cookie: ordinaryAdminCookie })).status).toBe(403)
    expect((await rawRequest('/api/v1/admin/audit/events', { cookie: adminCookie })).status).toBe(200)
  })
})
