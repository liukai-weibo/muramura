import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMySqlPool, readMySqlConfig, runMySqlMigrations, MySqlActivityAuditRepository, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const requiredEnvironment = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_MIGRATOR_USER', 'MYSQL_MIGRATOR_PASSWORD', 'MYSQL_APP_USER', 'MYSQL_APP_PASSWORD', 'MYSQL_ROOT_PASSWORD']
const mysqlIntegrationEnabled = requiredEnvironment.every(name => Boolean(process.env[name]))
const baseConfig = mysqlIntegrationEnabled ? readMySqlConfig(process.env, 'app') : undefined
const repositoryRoot = path.resolve(__dirname, '..')
const migrationsDirectory = path.join(repositoryRoot, 'migrations')

function createMigrationDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-audit-'))
  for (const file of fs.readdirSync(migrationsDirectory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    fs.copyFileSync(path.join(migrationsDirectory, file), path.join(directory, file))
  }
  return directory
}

async function withTemporaryDatabase(work: (pools: { app: ReturnType<typeof createMySqlPool>; migrator: ReturnType<typeof createMySqlPool> }) => Promise<void>): Promise<void> {
  const suffix = crypto.randomUUID().replaceAll('-', '')
  const database = `kb_audit_${suffix}`
  const appUser = `kbaudita_${suffix.slice(0, 20)}`
  const migratorUser = `kbauditm_${suffix.slice(0, 20)}`
  const appPassword = crypto.randomUUID()
  const migratorPassword = crypto.randomUUID()
  const rootConfig: MySqlConnectionConfig = { host: baseConfig!.host, port: baseConfig!.port, database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 }
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
    await app?.end(); await migrator?.end()
    await root.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await root.query(`DROP USER IF EXISTS '${appUser}'@'%'`)
    await root.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`)
    await root.end()
  }
}

describe.runIf(mysqlIntegrationEnabled)('activity audit MySQL repository', () => {
  it('records events and pages them newest-first with combined filters', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('audit-owner', 'audit-owner', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [])

      const repository = new MySqlActivityAuditRepository(app)
      await repository.record({ actorUserId: 'audit-owner', actorUsername: 'audit-owner', module: 'item', action: 'create', entityId: 'item-1', snapshot: JSON.stringify({ title: '第一条' }) })
      await repository.record({ actorUserId: 'audit-owner', actorUsername: 'audit-owner', module: 'mood', action: 'update', entityId: 'mood-1', snapshot: JSON.stringify({ content: '心情不错' }) })
      await repository.record({ actorUserId: 'audit-owner', actorUsername: 'audit-owner', module: 'search', action: 'search', snapshot: JSON.stringify({ query: '方法' }) })
      await repository.record({ actorUserId: 'audit-owner', actorUsername: 'audit-owner', module: 'meal', action: 'create', entityId: 'meal-1', snapshot: JSON.stringify({ entryDate: '2026-08-26', meals: [{ mealType: 'breakfast', content: '喝粥', feeling: 3 }] }) })

      const page = await repository.list({ page: 1, pageSize: 2 })
      expect(page.total).toBe(4)
      expect(page.items).toHaveLength(2)
      expect(page.items[0]!.module).toBe('search')
      expect(page.items[0]!.actorUsername).toBe('audit-owner')
      expect(page.items[0]!.riskLevel).toBe('normal')
      expect(page.items[0]!.createdAt).toMatch(/Z$/)

      const filtered = await repository.list({ modules: ['item', 'mood'], actions: ['update'], page: 1, pageSize: 20 })
      expect(filtered.total).toBe(1)
      expect(filtered.items[0]).toMatchObject({ module: 'mood', action: 'update', entityId: 'mood-1' })

      const keyword = await repository.list({ keyword: '第一条', page: 1, pageSize: 20 })
      expect(keyword.total).toBe(1)
      expect(keyword.items[0]).toMatchObject({ module: 'item' })

      const actor = await repository.list({ actorQuery: 'audit-owner', page: 1, pageSize: 20 })
      expect(actor.total).toBe(3)

      // search 合并语义：用户名 OR 快照内容任一匹配
      const byActor = await repository.list({ search: 'audit-owner', page: 1, pageSize: 20 })
      expect(byActor.total).toBe(4)
      const bySnapshot = await repository.list({ search: '第一条', page: 1, pageSize: 20 })
      expect(bySnapshot.total).toBe(1)
      expect(bySnapshot.items[0]).toMatchObject({ entityId: 'item-1' })
      const byQuery = await repository.list({ search: '方法', page: 1, pageSize: 20 })
      expect(byQuery.total).toBe(1)
      expect(byQuery.items[0]).toMatchObject({ module: 'search' })

      // 中文枚举值展开：搜'早餐'命中 mealType=breakfast 的快照（存储值+中文标签均可命中）
      const byChineseBreakfast = await repository.list({ search: '早餐', page: 1, pageSize: 20 })
      expect(byChineseBreakfast.total).toBe(1)
      expect(byChineseBreakfast.items[0]).toMatchObject({ module: 'meal', entityId: 'meal-1' })
      const byRawBreakfast = await repository.list({ search: 'breakfast', page: 1, pageSize: 20 })
      expect(byRawBreakfast.total).toBe(1)
      // 中文字段名展开：搜'餐次类型'命中 mealType 键（值枚举 + 字段名均可命中）
      const byMealTypeKey = await repository.list({ search: '餐次类型', page: 1, pageSize: 20 })
      expect(byMealTypeKey.total).toBe(1)
      expect(byMealTypeKey.items[0]).toMatchObject({ module: 'meal', entityId: 'meal-1' })
      // 字段名展开对未知记录为 0 结果（不会误匹配）
      const byCardTitleKey = await repository.list({ search: '卡片标题', page: 1, pageSize: 20 })
      expect(byCardTitleKey.total).toBe(0)

      const all = await repository.listAllMatches({})
      expect(all).toHaveLength(4)
    })
  })

  it('filters by action and excludes non-matching modules', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('audit-owner', 'audit-owner', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [])
      const repository = new MySqlActivityAuditRepository(app)
      await repository.record({ actorUserId: 'audit-owner', module: 'daily_note', action: 'create', entityId: 'note-1', snapshot: JSON.stringify({ title: '今日' }) })
      await repository.record({ actorUserId: 'audit-owner', module: 'meal', action: 'delete', entityId: 'meal-1' })
      const onlyDelete = await repository.list({ actions: ['delete'], page: 1, pageSize: 20 })
      expect(onlyDelete.total).toBe(1)
      expect(onlyDelete.items[0]).toMatchObject({ module: 'meal', action: 'delete' })
    })
  })

  it('accepts the newly extended module/action enums after migration 027', { timeout: 30_000 }, async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      const directory = createMigrationDirectory()
      await runMySqlMigrations(migrator, directory)
      await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('audit-owner2', 'audit-owner2', 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [])
      const repository = new MySqlActivityAuditRepository(app)
      await repository.record({ actorUserId: 'audit-owner2', module: 'exploration_track', action: 'assign', entityId: 'item-1', snapshot: JSON.stringify({ trackId: 'track-1' }) })
      await repository.record({ actorUserId: 'audit-owner2', module: 'method', action: 'restore', entityId: 'method-1', snapshot: JSON.stringify({ title: '方法' }) })
      await repository.record({ actorUserId: 'audit-owner2', module: 'ai_config', action: 'update' })
      const all = await repository.listAllMatches({})
      expect(all).toHaveLength(3)
      const extendedModules = await repository.list({ modules: ['exploration_track', 'method', 'ai_config'], page: 1, pageSize: 20 })
      expect(extendedModules.total).toBe(3)
      const byAction = await repository.list({ actions: ['restore'], page: 1, pageSize: 20 })
      expect(byAction.items[0]).toMatchObject({ module: 'method', action: 'restore' })
    })
  })
})

