import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import mysql, { type Pool, type PoolConnection, type PoolOptions, type RowDataPacket } from 'mysql2/promise'
export { MySqlAuthRepository } from './account-repository'
export {
  MySqlPlatformAdministrationRepository,
  type MySqlPlatformAdministrationRepositoryTestHooks,
} from './platform-administration-repository'
export { MySqlInitialOwnerClaimRepository, type MySqlInitialOwnerClaimRepositoryTestHooks } from './initial-owner-claim-repository'

export const MYSQL_REQUIRED_SCHEMA_VERSION = 23

export const MYSQL_SCHEMA_AUDIT_EXCLUDED_TABLES = ['schema_migrations'] as const

export type MySqlSchemaNotReadyReason =
  | 'migration-table-missing'
  | 'schema-version-behind'
  | 'required-table-missing'

export interface MySqlSchemaNotReadyDetails {
  reason: MySqlSchemaNotReadyReason
  database: string
  requiredSchemaVersion: number
  actualSchemaVersion?: number
  requiredTable?: 'schema_migrations' | 'user_roles' | 'security_audit_events' | 'ai_conversations' | 'ai_conversation_messages' | 'user_ai_preferences'
}

export interface MySqlConnectionConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
  connectionLimit: number
}

export type MySqlConfigInvalidReason = 'missing-env' | 'invalid-env'

export interface MySqlConfigInvalidDetails {
  reason: MySqlConfigInvalidReason
  envVar: string
}

export class MySqlConfigError extends Error {
  constructor(readonly details: Readonly<MySqlConfigInvalidDetails>) {
    super('MySQL 启动配置无效')
    this.name = 'MySqlConfigError'
  }
}

export function readMySqlConfig(environment: NodeJS.ProcessEnv, identity: 'app' | 'migrator'): MySqlConnectionConfig {
  const required = (name: string) => {
    const value = environment[name]
    if (!value) throw new MySqlConfigError({ reason: 'missing-env', envVar: name })
    return value
  }
  const port = Number(required('MYSQL_PORT'))
  const connectionLimit = Number(environment.MYSQL_POOL_CONNECTION_LIMIT ?? '10')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MySqlConfigError({ reason: 'invalid-env', envVar: 'MYSQL_PORT' })
  }
  if (!Number.isInteger(connectionLimit) || connectionLimit < 1) {
    throw new MySqlConfigError({ reason: 'invalid-env', envVar: 'MYSQL_POOL_CONNECTION_LIMIT' })
  }
  return {
    host: required('MYSQL_HOST'), port, database: required('MYSQL_DATABASE'),
    user: identity === 'app' ? required('MYSQL_APP_USER') : required('MYSQL_MIGRATOR_USER'),
    password: identity === 'app' ? required('MYSQL_APP_PASSWORD') : required('MYSQL_MIGRATOR_PASSWORD'),
    connectionLimit,
  }
}

export function createMySqlPool(config: MySqlConnectionConfig): Pool {
  const options: PoolOptions = { ...config, waitForConnections: true, queueLimit: 0, connectTimeout: 5000, timezone: 'Z' }
  return mysql.createPool(options)
}

export async function runInMySqlTransaction<T>(pool: Pool, work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection()
  try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result }
  catch (error) { await connection.rollback(); throw error }
  finally { connection.release() }
}

interface Migration { version: number; name: string; checksum: string; acceptedChecksums: readonly string[]; sql: string }
function splitStatements(sql: string): string[] {
  return sql.split(/;\s*(?:\r?\n|$)/).map(statement => statement.trim()).filter(Boolean)
}
function loadMigrations(directory: string): Migration[] {
  return fs.readdirSync(directory).filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file)).sort().map(file => {
    const rawSql = fs.readFileSync(path.join(directory, file), 'utf8')
    const sql = rawSql.replace(/\r\n?/g, '\n')
    const version = Number(file.slice(0, 3))
    const checksum = crypto.createHash('sha256').update(sql).digest('hex')
    const rawChecksum = crypto.createHash('sha256').update(rawSql).digest('hex')
    const crlfChecksum = crypto.createHash('sha256').update(sql.replace(/\n/g, '\r\n')).digest('hex')
    return { version, name: file, checksum, acceptedChecksums: [...new Set([checksum, rawChecksum, crlfChecksum])], sql }
  })
}

async function reconcileLegacyAiMigrationLineage(
  connection: PoolConnection,
  migrations: readonly Migration[],
): Promise<void> {
  const [rows] = await connection.query<Array<RowDataPacket & { version: number; name: string }>>('SELECT version, name FROM schema_migrations WHERE version BETWEEN 7 AND 11')
  const records = new Map(rows.map((row) => [row.version, row.name]))
  const legacyNames = new Map([
    [7, '007_add_ai_conversations.sql'],
    [8, '008_add_ai_conversation_summary.sql'],
    [9, '009_remove_legacy_item_statuses.sql'],
    [10, '010_add_user_ai_preferences.sql'],
    [11, '011_add_ai_conversation_lifecycle.sql'],
  ])
  if (![...legacyNames].every(([version, name]) => records.get(version) === name)) return

  const remap = [
    [11, 14],
    [10, 13],
    [9, 12],
    [8, 11],
    [7, 10],
  ] as const
  for (const [fromVersion, toVersion] of remap) {
    const migration = migrations.find((entry) => entry.version === toVersion)
    if (!migration) throw new Error(`缺少兼容迁移：${String(toVersion).padStart(3, '0')}`)
    const [existingTarget] = await connection.query<Array<RowDataPacket>>('SELECT version FROM schema_migrations WHERE version = ?', [toVersion])
    if (existingTarget.length > 0) throw new Error(`旧 AI migration 兼容映射目标已存在：${String(toVersion).padStart(3, '0')}`)
    await connection.query('UPDATE schema_migrations SET version = ?, name = ?, checksum = ? WHERE version = ?', [toVersion, migration.name, migration.checksum, fromVersion])
  }
}

async function preflightMigration004(connection: PoolConnection): Promise<void> {
  const [conflicts] = await connection.query<Array<RowDataPacket & { kind: string; name: string }>>(`
    SELECT '表' AS kind, table_name AS name
    FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'exploration_tracks'
    UNION ALL
    SELECT '列' AS kind, column_name AS name
    FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'items' AND column_name = 'exploration_track_id'
    UNION ALL
    SELECT '索引' AS kind, index_name AS name
    FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND index_name IN (
      'exploration_tracks_normalized_name_unique',
      'exploration_tracks_active_updated_idx',
      'items_exploration_track_created_idx'
    )
    UNION ALL
    SELECT '外键' AS kind, constraint_name AS name
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'items'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = 'items_exploration_track_fk'
  `)
  if (conflicts.length > 0) {
    throw new Error(`004 migration 预检失败：已存在${conflicts.map(conflict => `${conflict.kind} ${conflict.name}`).join('、')}`)
  }
}

async function runMigration007Statement(connection: PoolConnection, statement: string): Promise<void> {
  const addColumn = statement.match(/^ALTER TABLE ([a-z0-9_]+) ADD COLUMN ([a-z0-9_]+)\b/i)
  if (addColumn) {
    const [, tableName, columnName] = addColumn
    const [columns] = await connection.query<RowDataPacket[]>(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
      LIMIT 1
    `, [tableName, columnName])
    if (columns[0]) return
  }
  await connection.query(statement)
}

async function runCheckConstraintMigrationStatement(connection: PoolConnection, statement: string): Promise<boolean> {
  const checkConstraint = statement.match(/^ALTER TABLE ([a-z0-9_]+) (DROP CHECK|ADD CONSTRAINT) ([a-z0-9_]+)\b/i)
  if (!checkConstraint) return false
  const tableName = checkConstraint[1]!
  const operation = checkConstraint[2]!
  const constraintName = checkConstraint[3]!
  const [constraints] = await connection.query<RowDataPacket[]>(`
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = ? AND constraint_type = 'CHECK'
    LIMIT 1
  `, [tableName, constraintName])
  if (operation.toUpperCase() === 'DROP CHECK' && !constraints[0]) return true
  if (operation.toUpperCase() === 'ADD CONSTRAINT' && constraints[0]) return true
  await connection.query(statement)
  return true
}

async function runMigration008Statement(connection: PoolConnection, statement: string): Promise<void> {
  const addColumn = statement.match(/^ALTER TABLE ([a-z0-9_]+) ADD COLUMN ([a-z0-9_]+)\b/i)
  if (addColumn) {
    const [, tableName, columnName] = addColumn
    const [columns] = await connection.query<RowDataPacket[]>(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
      LIMIT 1
    `, [tableName, columnName])
    if (columns[0]) return
  }
  if (await runCheckConstraintMigrationStatement(connection, statement)) return
  await connection.query(statement)
}

async function runMigration009Statement(connection: PoolConnection, statement: string): Promise<void> {
  if (await runCheckConstraintMigrationStatement(connection, statement)) return
  await connection.query(statement)
}

export async function runMySqlMigrations(pool: Pool, directory: string): Promise<void> {
  const connection = await pool.getConnection()
  try {
    const [locks] = await connection.query<Array<RowDataPacket & { acquired: number }>>("SELECT GET_LOCK('knowledge_base_schema_migration', 30) AS acquired")
    if (locks[0]?.acquired !== 1) throw new Error('无法获得 MySQL Schema Migration 锁')
    await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, name VARCHAR(255) NOT NULL, checksum CHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL) ENGINE=InnoDB')
    const migrations = loadMigrations(directory)
    await reconcileLegacyAiMigrationLineage(connection, migrations)
    const [applied] = await connection.query<Array<RowDataPacket & { version: number; name: string; checksum: string }>>('SELECT version, name, checksum FROM schema_migrations')
    const records = new Map(applied.map(record => [record.version, record]))
    for (const migration of migrations) {
      const existing = records.get(migration.version)
      if (existing) {
        if (existing.name !== migration.name || !migration.acceptedChecksums.includes(existing.checksum)) throw new Error(`已执行的 migration 内容不一致：${migration.name}`)
        continue
      }
      if (migration.version === 3) {
        const checks: Array<[string, string]> = [
          ['存在重复方法证据', 'SELECT 1 FROM method_evidence GROUP BY method_id,review_id HAVING COUNT(*)>1 LIMIT 1'],
          ['存在重复方法应用事项', 'SELECT 1 FROM method_applications GROUP BY item_id HAVING COUNT(*)>1 LIMIT 1'],
          ['存在断裂方法证据复盘引用', 'SELECT 1 FROM method_evidence e LEFT JOIN reviews r ON r.id=e.review_id WHERE r.id IS NULL LIMIT 1'],
          ['存在断裂方法版本复盘引用', 'SELECT 1 FROM method_versions v LEFT JOIN reviews r ON r.id=v.source_review_id WHERE v.source_review_id IS NOT NULL AND r.id IS NULL LIMIT 1'],
        ]
        for (const [message, sql] of checks) {
          const [rows] = await connection.query<RowDataPacket[]>(sql)
          if (rows[0]) throw new Error(`003 migration 预检失败：${message}`)
        }
      }
      if (migration.version === 4) await preflightMigration004(connection)
      if (migration.version === 19) await connection.beginTransaction()
      try {
        for (const statement of splitStatements(migration.sql)) {
          if (migration.version === 7) await runMigration007Statement(connection, statement)
          else if (migration.version === 8) await runMigration008Statement(connection, statement)
          else if (migration.version === 9 || migration.version === 12) await runMigration009Statement(connection, statement)
          else await connection.query(statement)
        }
        if (migration.version === 19) await connection.commit()
      } catch (error) {
        if (migration.version === 19) await connection.rollback()
        throw error
      }
      await connection.query('INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, UTC_TIMESTAMP(3))', [migration.version, migration.name, migration.checksum])
    }
  } finally {
    try { await connection.query("SELECT RELEASE_LOCK('knowledge_base_schema_migration')") } catch { /* Connection failures need no release retry. */ }
    connection.release()
  }
}

export async function getMySqlHealth(pool: Pool, expectedDatabase: string): Promise<{ database: string; schemaVersion: number }> {
  const connection = await pool.getConnection()
  try {
    await connection.query('SELECT 1')
    const [databases] = await connection.query<Array<RowDataPacket & { current_database: string | null }>>('SELECT DATABASE() AS current_database')
    if (databases[0]?.current_database !== expectedDatabase) throw new Error('连接到了错误的数据库')
    let versions: Array<RowDataPacket & { version: number | null }>
    try {
      ;[versions] = await connection.query<Array<RowDataPacket & { version: number | null }>>('SELECT MAX(version) AS version FROM schema_migrations')
    } catch (error) {
      if (isMissingMySqlTable(error)) {
        throw new MySqlSchemaNotReadyError({
          reason: 'migration-table-missing',
          database: expectedDatabase,
          actualSchemaVersion: 0,
          requiredSchemaVersion: MYSQL_REQUIRED_SCHEMA_VERSION,
          requiredTable: 'schema_migrations',
        })
      }
      throw error
    }
    const schemaVersion = versions[0]?.version ?? 0
    if (schemaVersion < MYSQL_REQUIRED_SCHEMA_VERSION) {
      throw new MySqlSchemaNotReadyError({
        reason: 'schema-version-behind',
        database: expectedDatabase,
        actualSchemaVersion: schemaVersion,
        requiredSchemaVersion: MYSQL_REQUIRED_SCHEMA_VERSION,
      })
    }
    return { database: expectedDatabase, schemaVersion }
  } finally { connection.release() }
}

export async function assertMySqlPlatformSchemaReady(pool: Pool, expectedDatabase: string): Promise<{ database: string; schemaVersion: number }> {
  const health = await getMySqlHealth(pool, expectedDatabase)
  const connection = await pool.getConnection()
  try {
    const requiredTables = ['user_roles', 'security_audit_events', 'ai_conversations', 'ai_conversation_messages', 'user_ai_preferences'] as const
    for (const requiredTable of requiredTables) {
      try {
        await connection.query(`SELECT 1 FROM ${requiredTable} LIMIT 0`)
      } catch (error) {
        if (isMissingMySqlTable(error)) {
          throw new MySqlSchemaNotReadyError({
            reason: 'required-table-missing',
            database: expectedDatabase,
            actualSchemaVersion: health.schemaVersion,
            requiredSchemaVersion: MYSQL_REQUIRED_SCHEMA_VERSION,
            requiredTable,
          })
        }
        throw error
      }
    }
    return health
  } finally { connection.release() }
}

function isMissingMySqlTable(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ER_NO_SUCH_TABLE'
}

export class MySqlSchemaNotReadyError extends Error {
  constructor(readonly details: Readonly<MySqlSchemaNotReadyDetails>) {
    super('MySQL Schema 未达到最低版本')
    this.name = 'MySqlSchemaNotReadyError'
  }
}

export { MySqlItemRepository, type MySqlItemRepositoryTestHooks } from './item-repository'
export { MySqlReviewRepository } from './review-repository'
export { MySqlReviewWorkflowRepository, type MySqlReviewWorkflowRepositoryTestHooks } from './review-workflow-repository'
export { MySqlAiConversationRepository } from './ai-conversation-repository'
export { MySqlAiPreferenceRepository } from './ai-preference-repository'
export { MySqlDailyNoteRepository } from './daily-note-repository'
export { MySqlMealEntryRepository } from './meal-entry-repository'
export { MySqlMoodEntryRepository } from './mood-entry-repository'
export { MySqlDailySummaryRepository } from './daily-summary-repository'
export { MySqlMethodRepository, type MySqlMethodRepositoryTestHooks } from './method-repository'
export { MySqlTrashPurgeRepository } from './trash-purge-repository'
export { MySqlMethodApplicationRepository, type MySqlMethodApplicationRepositoryTestHooks } from './method-application-repository'
export { MySqlBackupRepository, type MySqlBackupRepositoryTestHooks } from './backup-repository'
export { MySqlDashboardRepository, MySqlSearchRepository, type MySqlSearchRepositoryTestHooks } from './read-model-repositories'
export {
  MySqlExplorationTrackRepository,
  type MySqlExplorationTrackRepositoryTestHooks,
} from './exploration-track-repository'
