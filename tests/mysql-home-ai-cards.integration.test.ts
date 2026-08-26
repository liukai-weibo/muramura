import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createMySqlPool,
  readMySqlConfig,
  runMySqlMigrations,
  MySqlHomeAiCardRepository,
  type MySqlConnectionConfig,
} from '../packages/storage-mysql/src/index'
import type { CurrentUserScope } from '@knowledge-base/contracts'

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

function createMigrationDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-homecard-'))
  for (const file of fs.readdirSync(migrationsDirectory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    fs.copyFileSync(path.join(migrationsDirectory, file), path.join(directory, file))
  }
  return directory
}

async function withTemporaryDatabase(work: (pools: { app: ReturnType<typeof createMySqlPool>; migrator: ReturnType<typeof createMySqlPool> }) => Promise<void>): Promise<void> {
  const suffix = crypto.randomUUID().replaceAll('-', '')
  const database = 'kb_homecard_' + suffix
  const appUser = 'kbhome_' + suffix.slice(0, 20)
  const migratorUser = 'kbhome_m_' + suffix.slice(0, 19)
  const appPassword = crypto.randomUUID()
  const migratorPassword = crypto.randomUUID()
  const rootConfig: MySqlConnectionConfig = {
    host: baseConfig!.host,
    port: baseConfig!.port,
    database: 'mysql',
    user: 'root',
    password: process.env.MYSQL_ROOT_PASSWORD!,
    connectionLimit: 1,
  }
  const root = createMySqlPool(rootConfig)
  let app: ReturnType<typeof createMySqlPool> | undefined
  let migrator: ReturnType<typeof createMySqlPool> | undefined
  try {
    await root.query('CREATE DATABASE `' + database + '`')
    await root.query("CREATE USER '" + appUser + "'@'%' IDENTIFIED BY ?", [appPassword])
    await root.query("CREATE USER '" + migratorUser + "'@'%' IDENTIFIED BY ?", [migratorPassword])
    await root.query('GRANT SELECT, INSERT, UPDATE, DELETE ON `' + database + '`.* TO \'' + appUser + "'@'%'")
    await root.query('GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON `' + database + '`.* TO \'' + migratorUser + "'@'%'")
    await root.query('FLUSH PRIVILEGES')
    app = createMySqlPool({ ...baseConfig!, database, user: appUser, password: appPassword, connectionLimit: 1 })
    migrator = createMySqlPool({ ...baseConfig!, database, user: migratorUser, password: migratorPassword, connectionLimit: 1 })
    await work({ app, migrator })
  } finally {
    await app?.end()
    await migrator?.end()
    await root.query('DROP DATABASE IF EXISTS `' + database + '`')
    await root.query("DROP USER IF EXISTS '" + appUser + "'@'%'")
    await root.query("DROP USER IF EXISTS '" + migratorUser + "'@'%'")
    await root.end()
  }
}

function createScope(userId: string): CurrentUserScope { return { userId } }

const sampleInput = { cardTitle: '本周复盘', aiPrompt: '总结我这一周的状态', cardSize: 'medium' as const, cardTheme: 'cream' as const, refreshMode: 'daily' as const }

describe.runIf(mysqlIntegrationEnabled)('home ai card MySQL repository', () => {
  afterAll(() => undefined)

  it('creates cards with sort index and upserts caches idempotently', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('owner-a', 'owner-a', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))")
      const repository = new MySqlHomeAiCardRepository(app, createScope('owner-a'))
      const first = await repository.create(sampleInput)
      const second = await repository.create({ ...sampleInput, cardTitle: '睡眠分析', cardSize: 'small' })
      expect(first.sortIndex).toBe(0)
      expect(second.sortIndex).toBe(1)
      const list = await repository.list()
      expect(list.map(card => card.cardTitle)).toEqual(['本周复盘', '睡眠分析'])
      const cache = await repository.upsertCache(first.id, { cacheDate: '2026-08-25', aiOutput: '第一条' })
      const updated = await repository.upsertCache(first.id, { cacheDate: '2026-08-25', aiOutput: '更新' })
      expect(updated.id).toBe(cache.id)
      expect(updated.aiOutput).toBe('更新')
      const dayCaches = await repository.listCaches('2026-08-25')
      expect(dayCaches).toHaveLength(1)
      expect(dayCaches[0]).toMatchObject({ cardId: first.id, cacheDate: '2026-08-25', aiOutput: '更新' })
    })
  })

  it('keeps cards and caches isolated per owner and deletes caches with the card', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('owner-a', 'owner-a', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))")
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('owner-b', 'owner-b', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))")
      const repositoryA = new MySqlHomeAiCardRepository(app, createScope('owner-a'))
      const repositoryB = new MySqlHomeAiCardRepository(app, createScope('owner-b'))
      const cardA = await repositoryA.create(sampleInput)
      await repositoryB.create(sampleInput)
      await repositoryA.upsertCache(cardA.id, { cacheDate: '2026-08-25', aiOutput: 'a 的内容' })
      expect(await repositoryA.list()).toHaveLength(1)
      expect(await repositoryB.list()).toHaveLength(1)
      expect(await repositoryB.listCaches('2026-08-25')).toHaveLength(0)
      expect(await repositoryA.delete(cardA.id)).toBe(true)
      expect(await repositoryA.listCaches('2026-08-25')).toHaveLength(0)
      expect(await repositoryA.get(cardA.id)).toBeUndefined()
    })
  })

  it('replaces all cards and caches from backup and clears on empty', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('owner-a', 'owner-a', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))")
      const repository = new MySqlHomeAiCardRepository(app, createScope('owner-a'))
      const card = await repository.create(sampleInput)
      await repository.upsertCache(card.id, { cacheDate: '2026-08-25', aiOutput: '旧内容' })
      const cardId = 'backup-card'
      await repository.replaceBackup({
        cards: [{ id: cardId, cardTitle: '备份卡', aiPrompt: '备份提示', cardSize: 'large', cardTheme: 'green', refreshMode: 'manual', sortIndex: 3, isHidden: true, createdAt: '2026-08-20T08:00:00.000Z', updatedAt: '2026-08-20T08:00:00.000Z' }],
        caches: [{ id: 'backup-cache', cardId, cacheDate: '2026-08-20', aiOutput: '备份输出', createdAt: '2026-08-20T08:00:00.000Z', updatedAt: '2026-08-20T08:00:00.000Z' }],
      })
      const list = await repository.list()
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({ cardTitle: '备份卡', cardSize: 'large', cardTheme: 'green', refreshMode: 'manual', sortIndex: 3, isHidden: true })
      expect(await repository.listCaches('2026-08-20')).toHaveLength(1)
      await repository.replaceBackup({ cards: [], caches: [] })
      expect(await repository.list()).toHaveLength(0)
      expect(await repository.listCaches('2026-08-20')).toHaveLength(0)
    })
  })
})