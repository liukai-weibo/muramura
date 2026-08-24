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
  MySqlMealEntryRepository,
  type MySqlConnectionConfig,
} from '../packages/storage-mysql/src/index'
import { MealEntryApplicationService } from '@knowledge-base/application'
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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-meals-'))
  for (const file of fs.readdirSync(migrationsDirectory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    fs.copyFileSync(path.join(migrationsDirectory, file), path.join(directory, file))
  }
  return directory
}

async function withTemporaryDatabase(work: (pools: { app: ReturnType<typeof createMySqlPool>; migrator: ReturnType<typeof createMySqlPool> }) => Promise<void>): Promise<void> {
  const suffix = crypto.randomUUID().replaceAll('-', '')
  const database = `kb_meals_${suffix}`
  const appUser = `kbmeala_${suffix.slice(0, 20)}`
  const migratorUser = `kbmealm_${suffix.slice(0, 20)}`
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

describe.runIf(mysqlIntegrationEnabled)('meal entries MySQL repository', () => {
  afterAll(() => undefined)

  it('saves a day with upsert semantics and scopes to owner', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('owner-a', 'owner-a', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [])

      const repository = new MySqlMealEntryRepository(app, createScope('owner-a'))
      const saved = await repository.saveDay({ entryDate: '2026-08-20', meals: [{ mealType: 'breakfast', content: '牛奶', feeling: 4 }, { mealType: 'lunch', content: '米饭', feeling: 3 }] })
      expect(saved).toHaveLength(2)

      // Upsert same meal type, add dinner, drop breakfast
      const updated = await repository.saveDay({ entryDate: '2026-08-20', meals: [{ mealType: 'lunch', content: '面条', feeling: 5 }, { mealType: 'dinner', content: '沙拉', feeling: 2 }] })
      expect(updated).toHaveLength(2)
      expect(updated.map(e => e.mealType).sort()).toEqual(['dinner', 'lunch'])
      expect(updated.find(e => e.mealType === 'lunch')!.content).toBe('面条')
      expect(updated.find(e => e.mealType === 'lunch')!.feeling).toBe(5)
    })
  })

  it('replaceBackup then exportBackup roundtrips', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('owner-b', 'owner-b', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [])

      const repository = new MySqlMealEntryRepository(app, createScope('owner-b'))
      await repository.replaceBackup([{
        id: 'meal-1', entryDate: '2026-08-19', mealType: 'dinner', content: '汤', feeling: 4,
        createdAt: '2026-08-19T12:00:00.000Z', updatedAt: '2026-08-19T12:00:00.000Z',
      }])
      const exported = await repository.exportBackup()
      expect(exported).toHaveLength(1)
      expect(exported[0]!.id).toBe('meal-1')
      expect(exported[0]!.content).toBe('汤')
    })
  })
})
