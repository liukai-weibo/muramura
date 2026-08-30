import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createMySqlPool,
  readMySqlConfig,
  runMySqlMigrations,
  MySqlDietProfileRepository,
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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-dietprofile-'))
  for (const file of fs.readdirSync(migrationsDirectory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    fs.copyFileSync(path.join(migrationsDirectory, file), path.join(directory, file))
  }
  return directory
}

async function withTemporaryDatabase(work: (pools: { app: ReturnType<typeof createMySqlPool>; migrator: ReturnType<typeof createMySqlPool> }) => Promise<void>): Promise<void> {
  const suffix = crypto.randomUUID().replaceAll('-', '')
  const database = 'kb_dietprofile_' + suffix
  const appUser = 'kbdp_' + suffix.slice(0, 20)
  const migratorUser = 'kb_dp_' + suffix.slice(0, 20)
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

describe.runIf(mysqlIntegrationEnabled)('diet profile MySQL repository', () => {
  afterAll(() => undefined)

  it('upserts one row per owner and round-trips fields', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('owner-a', 'owner-a', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))")
      const repository = new MySqlDietProfileRepository(app, createScope('owner-a'))
      expect(await repository.getMine()).toBeUndefined()
      const saved = await repository.upsertMine({ heightCm: 178, weightKg: 81, age: 30, gender: 'male', goal: 'lose_fat', activity: 'sedentary', healthNote: '乳糖不耐受' })
      expect(saved).toMatchObject({ heightCm: 178, weightKg: 81, age: 30, gender: 'male', goal: 'lose_fat', activity: 'sedentary', healthNote: '乳糖不耐受' })
      const updated = await repository.upsertMine({ heightCm: 180, weightKg: 82, gender: 'male', goal: 'lose_fat', activity: 'sedentary', healthNote: '乳糖不耐受' })
      expect(updated.heightCm).toBe(180)
      const mine = await repository.getMine()
      expect(mine).toMatchObject({ heightCm: 180, weightKg: 82, gender: 'male' })
      expect(mine!.createdAt).toBeTruthy()
      expect(mine!.updatedAt).toBeTruthy()
      expect(mine!.goal).toBe('lose_fat')
      expect(mine!.healthNote).toBe('乳糖不耐受')
    })
  })

  it('keeps owners isolated (default for untouched owner)', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('owner-a', 'owner-a', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))")
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('owner-b', 'owner-b', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))")
      const repositoryA = new MySqlDietProfileRepository(app, createScope('owner-a'))
      const repositoryB = new MySqlDietProfileRepository(app, createScope('owner-b'))
      await repositoryA.upsertMine({ heightCm: 170, weightKg: 65 })
      expect(await repositoryA.getMine()).toMatchObject({ heightCm: 170 })
      expect(await repositoryB.getMine()).toBeUndefined()
    })
  })

  it('replaces profile from backup and clears on empty', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('owner-a', 'owner-a', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))")
      const repository = new MySqlDietProfileRepository(app, createScope('owner-a'))
      await repository.upsertMine({ heightCm: 178, weightKg: 81 })
      expect((await repository.exportBackup())).toHaveLength(1)
      await repository.replaceBackup([{ heightCm: 165, weightKg: 50, age: 25, gender: 'female', goal: 'maintain', activity: 'moderate', createdAt: '2026-08-20T08:00:00.000Z', updatedAt: '2026-08-20T09:00:00.000Z' }])
      const mine = await repository.getMine()
      expect(mine).toMatchObject({ heightCm: 165, weightKg: 50, age: 25, gender: 'female', goal: 'maintain', activity: 'moderate' })
      await repository.replaceBackup([])
      expect(await repository.getMine()).toBeUndefined()
    })
  })
})
