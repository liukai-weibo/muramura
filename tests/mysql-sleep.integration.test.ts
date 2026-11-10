import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createMySqlPool,
  readMySqlConfig,
  runMySqlMigrations,
  MySqlSleepRepository,
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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-sleep-'))
  for (const file of fs.readdirSync(migrationsDirectory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    fs.copyFileSync(path.join(migrationsDirectory, file), path.join(directory, file))
  }
  return directory
}

async function withTemporaryDatabase(work: (pools: { app: ReturnType<typeof createMySqlPool>; migrator: ReturnType<typeof createMySqlPool> }) => Promise<void>): Promise<void> {
  const suffix = crypto.randomUUID().replaceAll('-', '')
  const database = `kb_sleep_${suffix}`
  const appUser = `kbsleepa_${suffix.slice(0, 20)}`
  const migratorUser = `kbsleepm_${suffix.slice(0, 20)}`
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
    await root.query(`CREATE DATABASE \`${database}\``)
    await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword])
    await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${appUser}'@'%'`)
    await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`)
    await root.query('FLUSH PRIVILEGES')
    app = createMySqlPool({ ...baseConfig!, database, user: appUser, password: appPassword, connectionLimit: 1 })
    migrator = createMySqlPool({ ...baseConfig!, database, user: migratorUser, password: migratorPassword, connectionLimit: 1 })
    await work({ app, migrator })
  } finally {
    await app?.end()
    await migrator?.end()
    await root.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await root.query(`DROP USER IF EXISTS '${appUser}'@'%'`)
    await root.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`)
    await root.end()
  }
}

function createScope(userId: string): CurrentUserScope { return { userId } }

const insertUser = (pool: ReturnType<typeof createMySqlPool>, id: string) =>
  pool.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES (?, ?, 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [id, id])

describe.runIf(mysqlIntegrationEnabled)('sleep MySQL repository', () => {
  afterAll(() => undefined)

  it('stores a wake-only day and can fill the bedtime later', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      await runMySqlMigrations(migrator, createMigrationDirectory())
      await insertUser(migrator, 'sleep-owner')

      const repository = new MySqlSleepRepository(app, createScope('sleep-owner'))
      const wakeOnly = await repository.write('2026-11-09', { wakeAt: '2026-11-08T23:10:00.000Z' })
      expect(wakeOnly.bedAt).toBeUndefined()
      expect((await repository.getByDate('2026-11-09'))?.wakeAt).toBe('2026-11-08T23:10:00.000Z')

      const withBed = await repository.write('2026-11-09', { wakeAt: '2026-11-08T23:10:00.000Z', bedAt: '2026-11-09T15:40:00.000Z', note: '睡得还行' })
      expect(withBed.id).toBe(wakeOnly.id)
      expect(withBed.bedAt).toBe('2026-11-09T15:40:00.000Z')
      expect(withBed.note).toBe('睡得还行')

      const listed = await repository.listRange('2026-11-09', '2026-11-09')
      expect(listed).toHaveLength(1)
    })
  })

  it('scopes reads and deletes to the owner', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      await runMySqlMigrations(migrator, createMigrationDirectory())
      await insertUser(migrator, 'owner-a')
      await insertUser(migrator, 'owner-b')

      const mine = new MySqlSleepRepository(app, createScope('owner-a'))
      const other = new MySqlSleepRepository(app, createScope('owner-b'))
      await mine.write('2026-11-09', { wakeAt: '2026-11-08T23:00:00.000Z' })

      expect(await other.listRange()).toEqual([])
      expect(await other.remove('2026-11-09')).toBe(false)
      expect(await mine.listRange()).toHaveLength(1)
      expect(await mine.remove('2026-11-09')).toBe(true)
      expect(await mine.listRange()).toEqual([])
    })
  })

  it('returns defaults, persists settings, and records the daily acknowledgement', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      await runMySqlMigrations(migrator, createMigrationDirectory())
      await insertUser(migrator, 'settings-owner')

      const repository = new MySqlSleepRepository(app, createScope('settings-owner'))
      const defaults = await repository.getSettings()
      expect(defaults).toEqual({ remindEnabled: true, remindStartMinute: 720, remindEndMinute: 1410, inputPrecision: 'hour' })

      const saved = await repository.saveSettings({ remindEnabled: false, remindStartMinute: 540, remindEndMinute: 1020, inputPrecision: 'minute' })
      expect(saved.remindEnabled).toBe(false)
      expect(saved.inputPrecision).toBe('minute')

      const acknowledged = await repository.ackReminder('2026-11-09')
      expect(acknowledged.lastPromptedDate).toBe('2026-11-09')
      expect(acknowledged.remindEnabled).toBe(false)
      expect(acknowledged.remindStartMinute).toBe(540)
    })
  })

  it('roundtrips through backup replace/export', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      await runMySqlMigrations(migrator, createMigrationDirectory())
      await insertUser(migrator, 'backup-owner')

      const repository = new MySqlSleepRepository(app, createScope('backup-owner'))
      await repository.replaceBackup([
        {
          id: 'sleep-1', sleepDate: '2026-11-07',
          wakeAt: '2026-11-06T23:10:00.000Z', bedAt: '2026-11-07T15:30:00.000Z',
          createdAt: '2026-11-08T01:00:00.000Z', updatedAt: '2026-11-08T01:00:00.000Z',
        },
        {
          id: 'sleep-2', sleepDate: '2026-11-08',
          bedAt: '2026-11-08T16:00:00.000Z',
          createdAt: '2026-11-09T01:00:00.000Z', updatedAt: '2026-11-09T01:00:00.000Z',
        },
      ])
      const exported = await repository.exportBackup()
      expect(exported).toHaveLength(2)
      expect(exported[1]!.wakeAt).toBeUndefined()
      expect(exported[0]!.sleepDate).toBe('2026-11-07')
    })
  })
})
