import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createMySqlPool,
  readMySqlConfig,
  runMySqlMigrations,
  MySqlMoodEntryRepository,
  type MySqlConnectionConfig,
} from '../packages/storage-mysql/src/index'
import { MoodEntryApplicationService } from '@knowledge-base/application'
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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-mood-'))
  for (const file of fs.readdirSync(migrationsDirectory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    fs.copyFileSync(path.join(migrationsDirectory, file), path.join(directory, file))
  }
  return directory
}

async function withTemporaryDatabase(work: (pools: { app: ReturnType<typeof createMySqlPool>; migrator: ReturnType<typeof createMySqlPool> }) => Promise<void>): Promise<void> {
  const suffix = crypto.randomUUID().replaceAll('-', '')
  const database = `kb_mood_${suffix}`
  const appUser = `kbmooda_${suffix.slice(0, 20)}`
  const migratorUser = `kbmoodm_${suffix.slice(0, 20)}`
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

function createScope(userId: string): CurrentUserScope {
  return { userId }
}

describe.runIf(mysqlIntegrationEnabled)('mood entries MySQL repository', () => {
  afterAll(() => undefined)

  it('creates, lists, updates and deletes entries scoped to the owner', async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES (?, ?, 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", ['owner-a', 'owner-a'])
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES (?, ?, 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", ['owner-b', 'owner-b'])

      const repoA = new MySqlMoodEntryRepository(app, createScope('owner-a'))
      const repoB = new MySqlMoodEntryRepository(app, createScope('owner-b'))

      const created = await repoA.create({ content: '状态不错的一天', moodLevel: 4, tags: ['散步', '阳光'], entryDate: '2026-08-20' })
      expect(created.id).toBeTruthy()
      expect(created.moodLevel).toBe(4)
      expect(created.tags).toEqual(['散步', '阳光'])

      const createdB = await repoB.create({ content: '他人记录不该出现', moodLevel: 1, entryDate: '2026-08-21' })
      expect(createdB.id).toBeTruthy()

      const ownerAList = await repoA.listRange('2026-08-01', '2026-08-31')
      expect(ownerAList.map(entry => entry.id)).toEqual([created.id])
      expect(ownerAList[0]!.tags).toEqual(['散步', '阳光'])

      const updated = await repoA.updateMine(created.id, { content: '状态不错的一天（已更新）', moodLevel: 5, tags: ['散步'], entryDate: '2026-08-20' })
      expect(updated!.content).toBe('状态不错的一天（已更新）')
      expect(updated!.moodLevel).toBe(5)

      const crossUpdate = await repoB.updateMine(created.id, { content: '越权修改', moodLevel: 1, entryDate: '2026-08-20' })
      expect(crossUpdate).toBeUndefined()

      // Range query excludes out-of-range dates
      const augustOnly = await repoA.listRange('2026-08-20', '2026-08-20')
      expect(augustOnly.map(entry => entry.id)).toEqual([created.id])

      const deleted = await repoA.deleteMine(created.id)
      expect(deleted).toBe(true)
      expect(await repoA.listRange()).toHaveLength(0)
      expect(await repoB.listRange()).toHaveLength(1)
    })
  })

  it('round-trips entries through the backup store without touching other owners', async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES (?, ?, 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", ['owner-a', 'owner-a'])
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES (?, ?, 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", ['owner-b', 'owner-b'])

      const repoA = new MySqlMoodEntryRepository(app, createScope('owner-a'))
      const repoB = new MySqlMoodEntryRepository(app, createScope('owner-b'))

      const first = await repoA.create({ content: '备份前记录', moodLevel: 2, tags: [], entryDate: '2026-08-01' })
      const second = await repoA.create({ content: '备份前记录二', moodLevel: 5, tags: ['喝奶茶'], entryDate: '2026-08-02' })
      await repoB.create({ content: '其他用户记录', moodLevel: 3, entryDate: '2026-08-03' })

      const exported = await repoA.exportBackup()
      expect(exported.map(entry => entry.id).sort()).toEqual([first.id, second.id].sort())

      const restored = exported.map(entry => ({ ...entry, content: `恢复=${entry.content}` }))
      await repoA.replaceBackup(restored)

      const after = await repoA.listRange()
      expect(after).toHaveLength(2)
      expect(after.some(entry => entry.content === '恢复=备份前记录')).toBe(true)
      expect(after.some(entry => entry.content === '恢复=备份前记录二')).toBe(true)
      // Other owner untouched
      expect(await repoB.listRange()).toHaveLength(1)
    })
  })

  it('validates input through the application service', async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES (?, ?, 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", ['owner-a', 'owner-a'])

      const repository = new MySqlMoodEntryRepository(app, createScope('owner-a'))
      const service = new MoodEntryApplicationService(repository)

      await expect(service.create({ content: '   ', moodLevel: 3 })).rejects.toMatchObject({ code: 'MOOD_ENTRY_INVALID' })
      await expect(service.create({ content: '事件', moodLevel: 9 as never })).rejects.toMatchObject({ code: 'MOOD_ENTRY_INVALID' })
      await expect(service.deleteMine('missing-id')).rejects.toMatchObject({ code: 'MOOD_ENTRY_NOT_FOUND' })

      const saved = await service.create({ content: '合法记录', moodLevel: 3, tags: ['日常'] })
      expect(saved.id).toBeTruthy()
      expect(saved.tags).toEqual(['日常'])
    })
  })

  it('degrades corrupt tag JSON to an empty list', async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES (?, ?, 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", ['owner-a', 'owner-a'])

      const repository = new MySqlMoodEntryRepository(app, createScope('owner-a'))
      const saved = await repository.create({ content: '脏标签', moodLevel: 3, tags: ['ok'], entryDate: '2026-08-20' })
      await app.query('UPDATE mood_entries SET tags = ? WHERE id = ?', ['{not-json', saved.id])
      const [rows] = await app.query<Array<RowDataPacket & { id: string }>>('SELECT id FROM mood_entries WHERE id = ?', [saved.id])
      expect(rows).toHaveLength(1)
      const listed = await repository.listRange('2026-08-01', '2026-08-31')
      expect(listed[0]!.tags).toEqual([])
    })
  })
})
