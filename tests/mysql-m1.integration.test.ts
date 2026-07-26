import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { RowDataPacket } from 'mysql2/promise'
import { describe, expect, it } from 'vitest'
import { createApiServer } from '../apps/api/src/index'
import {
  createMySqlPool,
  readMySqlConfig,
  runMySqlMigrations,
  type MySqlConnectionConfig,
} from '../packages/storage-mysql/src/index'

const requiredEnvironment = [
  'MYSQL_HOST',
  'MYSQL_PORT',
  'MYSQL_MIGRATOR_USER',
  'MYSQL_MIGRATOR_PASSWORD',
  'MYSQL_APP_USER',
  'MYSQL_APP_PASSWORD',
  'MYSQL_ROOT_PASSWORD',
]
const mysqlIntegrationEnabled = requiredEnvironment.every(name => Boolean(process.env[name]))
const baseConfig = mysqlIntegrationEnabled ? readMySqlConfig(process.env, 'app') : undefined
const repositoryRoot = path.resolve(__dirname, '..')
const migrationsDirectory = path.join(repositoryRoot, 'migrations')

type MigrationExpectation = { version: number; name: string; checksum: string }

function currentMigrationExpectations(directory = migrationsDirectory): MigrationExpectation[] {
  return fs.readdirSync(directory)
    .filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
    .sort()
    .map(name => ({
      version: Number(name.slice(0, 3)),
      name,
      checksum: crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name), 'utf8')).digest('hex'),
    }))
}

function createMigrationDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-mysql-m1-migrations-'))
  for (const migration of currentMigrationExpectations()) fs.copyFileSync(path.join(migrationsDirectory, migration.name), path.join(directory, migration.name))
  return directory
}

async function request(server: http.Server): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: unknown }> {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试 API 未监听 TCP 端口')
  return new Promise((resolve, reject) => {
    const probe = http.get({ host: '127.0.0.1', port: address.port, path: '/health', agent: false }, response => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { raw += chunk })
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: JSON.parse(raw) }))
    })
    probe.once('error', reject)
  })
}

async function withServer(server: http.Server, work: (server: http.Server) => Promise<void>): Promise<void> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try { await work(server) }
  finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}

async function withTemporaryDatabase(
  work: (resources: {
    database: string
    app: ReturnType<typeof createMySqlPool>
    migrator: ReturnType<typeof createMySqlPool>
    appConfig: MySqlConnectionConfig
    migrationDirectory: string
  }) => Promise<void>,
  options: { migrate: boolean } = { migrate: true },
): Promise<void> {
  const suffix = crypto.randomUUID().replaceAll('-', '')
  const database = `kb_m1_${suffix}`
  const appUser = `kbm1a_${suffix.slice(0, 24)}`
  const migratorUser = `kbm1m_${suffix.slice(0, 24)}`
  const appPassword = crypto.randomUUID()
  const migratorPassword = crypto.randomUUID()
  const migrationDirectory = createMigrationDirectory()
  const root = createMySqlPool({
    host: baseConfig!.host,
    port: baseConfig!.port,
    database: 'mysql',
    user: 'root',
    password: process.env.MYSQL_ROOT_PASSWORD!,
    connectionLimit: 1,
  })
  let app: ReturnType<typeof createMySqlPool> | undefined
  let migrator: ReturnType<typeof createMySqlPool> | undefined
  try {
    expect(database).toMatch(/^kb_m1_/)
    expect(database).not.toBe(process.env.MYSQL_DATABASE)
    expect(database).not.toBe('knowledge_base_uat')
    await root.query(`CREATE DATABASE \`${database}\``)
    await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword])
    await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${appUser}'@'%'`)
    await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`)
    await root.query('FLUSH PRIVILEGES')
    const appConfig = { ...baseConfig!, database, user: appUser, password: appPassword, connectionLimit: 1 }
    app = createMySqlPool(appConfig)
    migrator = createMySqlPool({ ...baseConfig!, database, user: migratorUser, password: migratorPassword, connectionLimit: 1 })
    if (options.migrate) await runMySqlMigrations(migrator, migrationDirectory)
    await work({ database, app, migrator, appConfig, migrationDirectory })
  } finally {
    await app?.end()
    await migrator?.end()
    await root.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await root.query(`DROP USER IF EXISTS '${appUser}'@'%'`)
    await root.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`)
    await root.end()
    fs.rmSync(migrationDirectory, { recursive: true, force: true })
  }
}

describe.runIf(mysqlIntegrationEnabled)('MySQL M1 repeatable integration verification', () => {
  it('replays current migrations idempotently and rejects checksum drift in a temporary database', async () => {
    await withTemporaryDatabase(async ({ migrator, migrationDirectory }) => {
      const expected = currentMigrationExpectations(migrationDirectory)
      await runMySqlMigrations(migrator, migrationDirectory)
      const [records] = await migrator.query<Array<RowDataPacket & MigrationExpectation>>(
        'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
      )
      expect(records).toEqual(expected)
      fs.appendFileSync(path.join(migrationDirectory, expected.at(-1)!.name), '\n-- test-only checksum drift\n')
      await expect(runMySqlMigrations(migrator, migrationDirectory)).rejects.toThrow(`已执行的 migration 内容不一致：${expected.at(-1)!.name}`)
    })
  })

  it('enforces app DML-only permissions in a temporary database', async () => {
    await withTemporaryDatabase(async ({ app }) => {
      const id = `mysql-m1-test-${crypto.randomUUID()}`
      try {
        await app.query('INSERT INTO items(id, title, content, status, start_action, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), NULL)', [id, 'synthetic M1 test item', '', 'idea_to_try'])
        const [items] = await app.query<Array<RowDataPacket & { id: string }>>('SELECT id FROM items WHERE id = ?', [id])
        expect(items).toEqual([{ id }])
        await app.query('DELETE FROM items WHERE id = ?', [id])
        await expect(app.query('CREATE TABLE mysql_m1_forbidden_create (id INT)')).rejects.toMatchObject({ code: 'ER_TABLEACCESS_DENIED_ERROR' })
        await expect(app.query('ALTER TABLE items ADD COLUMN mysql_m1_forbidden_column INT')).rejects.toMatchObject({ code: 'ER_TABLEACCESS_DENIED_ERROR' })
        await expect(app.query('DROP TABLE items')).rejects.toMatchObject({ code: 'ER_TABLEACCESS_DENIED_ERROR' })
        await expect(app.query('SELECT user FROM mysql.user LIMIT 1')).rejects.toMatchObject({ code: 'ER_TABLEACCESS_DENIED_ERROR' })
      } finally { await app.query('DELETE FROM items WHERE id = ?', [id]) }
    })
  })

  it('serves ready and sanitized unavailable health DTOs without using a running database', async () => {
    await withTemporaryDatabase(async ({ database, appConfig, migrationDirectory }) => {
      const expectedSchemaVersion = currentMigrationExpectations(migrationDirectory).at(-1)!.version
      await withServer(createApiServer(appConfig), async server => {
        await expect(request(server)).resolves.toEqual({
          status: 200,
          headers: expect.objectContaining({ 'cache-control': 'no-store' }),
          body: { status: 'ready', database, schemaVersion: expectedSchemaVersion },
        })
      })
      await withServer(createApiServer({ ...appConfig, port: 1 }), async server => {
        await expect(request(server)).resolves.toEqual({
          status: 503,
          headers: expect.objectContaining({ 'cache-control': 'no-store' }),
          body: { status: 'database-unavailable', message: '本地 MySQL 候选环境当前不可用' },
        })
      })
      await withServer(createApiServer({ ...appConfig, password: 'invalid-test-password' }), async server => {
        const response = await request(server)
        expect(response).toEqual({
          status: 503,
          headers: expect.objectContaining({ 'cache-control': 'no-store' }),
          body: { status: 'database-unavailable', message: '本地 MySQL 候选环境当前不可用' },
        })
        expect(JSON.stringify(response.body)).not.toMatch(/invalid-test-password|127\.0\.0\.1|3307|stack/i)
      })
    })

    await withTemporaryDatabase(async ({ appConfig }) => {
      await withServer(createApiServer(appConfig), async server => {
        const response = await request(server)
        expect(response).toEqual({
          status: 503,
          headers: expect.objectContaining({ 'cache-control': 'no-store' }),
          body: { status: 'database-unavailable', message: '本地 MySQL 候选环境当前不可用' },
        })
        expect(JSON.stringify(response.body)).not.toMatch(/password|127\.0\.0\.1|3307|stack|items|reviews|methods/i)
      })
    }, { migrate: false })
  })
})
