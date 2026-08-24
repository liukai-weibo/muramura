import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createMySqlPool,
  readMySqlConfig,
  runMySqlMigrations,
  MySqlDailySummaryRepository,
  type MySqlConnectionConfig,
} from '../packages/storage-mysql/src/index'
import { DailySummaryApplicationService } from '@knowledge-base/application'
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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-summaries-'))
  for (const file of fs.readdirSync(migrationsDirectory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    fs.copyFileSync(path.join(migrationsDirectory, file), path.join(directory, file))
  }
  return directory
}

async function withTemporaryDatabase(work: (pools: { app: ReturnType<typeof createMySqlPool>; migrator: ReturnType<typeof createMySqlPool> }) => Promise<void>): Promise<void> {
  const suffix = crypto.randomUUID().replaceAll('-', '')
  const database = 'kb_summ_' + suffix
  const appUser = 'kbsumma_' + suffix.slice(0, 20)
  const migratorUser = 'kbsummm_' + suffix.slice(0, 20)
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

describe.runIf(mysqlIntegrationEnabled)('daily summary MySQL repository', () => {
  afterAll(() => undefined)

  it('upserts one row per date and scopes to owner', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('owner-a', 'owner-a', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))")
      const repository = new MySqlDailySummaryRepository(app, createScope('owner-a'))
      const first = await repository.upsertForDate({ entryDate: '2026-08-24', content: '第一条' })
      const second = await repository.upsertForDate({ entryDate: '2026-08-24', content: '更新' })
      expect(second.id).toBe(first.id)
      expect(second.content).toBe('更新')
      const today = await repository.getByDate('2026-08-24')
      expect(today).toMatchObject({ entryDate: '2026-08-24', content: '更新' })
      const list = await repository.listRange('2026-08-24', '2026-08-24')
      expect(list).toHaveLength(1)
    })
  })

  it('lists by date range and keeps other owners isolated', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('owner-a', 'owner-a', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))")
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('owner-b', 'owner-b', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))")
      const repositoryA = new MySqlDailySummaryRepository(app, createScope('owner-a'))
      const repositoryB = new MySqlDailySummaryRepository(app, createScope('owner-b'))
      await repositoryA.upsertForDate({ entryDate: '2026-08-23', content: 'a1' })
      await repositoryA.upsertForDate({ entryDate: '2026-08-25', content: 'a2' })
      await repositoryB.upsertForDate({ entryDate: '2026-08-24', content: 'b1' })
      const rangeA = await repositoryA.listRange('2026-08-23', '2026-08-25')
      expect(rangeA.map(entry => entry.entryDate)).toEqual(['2026-08-23', '2026-08-25'])
      expect(await repositoryB.listRange()).toHaveLength(1)
    })
  })

  it('replaces all rows from backup and clears on empty', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('owner-a', 'owner-a', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))")
      const repository = new MySqlDailySummaryRepository(app, createScope('owner-a'))
      await repository.upsertForDate({ entryDate: '2026-08-24', content: '旧内容' })
      await repository.replaceBackup([
        { id: 's1', entryDate: '2026-08-20', content: '备份内容', createdAt: '2026-08-20T08:00:00.000Z', updatedAt: '2026-08-20T08:00:00.000Z' },
      ])
      const list = await repository.listRange()
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({ entryDate: '2026-08-20', content: '备份内容' })
      await repository.replaceBackup([])
      expect(await repository.listRange()).toHaveLength(0)
    })
  })
})
