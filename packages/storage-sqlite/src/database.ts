import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { SqliteStorageOpenError } from './errors'
import { applySchemaMigrations, SQLITE_SCHEMA_VERSION } from './schema'

export interface OpenKnowledgeDatabaseOptions { databasePath: string }

export interface SqliteKnowledgeDatabase {
  readonly databasePath: string
  readonly schemaVersion: number
  close(): void
  runInTransaction<T>(work: () => T): T
  runInReadTransaction<T>(work: () => T): T
}

export function getRawDatabase(database: SqliteKnowledgeDatabase): Database.Database {
  return (database as SqliteKnowledgeDatabase & { raw: Database.Database }).raw
}

export interface SqliteDatabaseTestHooks {
  applySchemaMigrations?: typeof applySchemaMigrations
  quickCheck?: (database: Database.Database) => void
}

function assertQuickCheck(database: Database.Database): void {
  const rows = database.prepare('PRAGMA quick_check').all() as Array<{ quick_check: string }>
  if (rows.length !== 1 || rows[0]?.quick_check !== 'ok') throw new Error('quick_check was not ok')
}

function rejectAsync<T>(work: () => T): T {
  const value = work()
  if (value && typeof (value as unknown as Promise<unknown>).then === 'function') {
    throw new Error('SQLite transaction callbacks must be synchronous')
  }
  return value
}

export function probeDatabaseWritable(database: SqliteKnowledgeDatabase): void {
  const raw = getRawDatabase(database)
  raw.exec('BEGIN IMMEDIATE')
  raw.exec('ROLLBACK')
}

export function openKnowledgeDatabase(options: OpenKnowledgeDatabaseOptions, hooks: SqliteDatabaseTestHooks = {}): SqliteKnowledgeDatabase {
  const { databasePath } = options
  try { fs.mkdirSync(path.dirname(databasePath), { recursive: true }) }
  catch (error) { throw new SqliteStorageOpenError('directory-unavailable', databasePath, '无法创建 SQLite 数据目录', error) }

  let database: Database.Database
  try { database = new Database(databasePath) }
  catch (error) { throw new SqliteStorageOpenError('database-open-failed', databasePath, '无法打开 SQLite 数据库', error) }

  try {
    database.pragma('foreign_keys = ON')
    database.pragma('journal_mode = WAL')
    database.pragma('synchronous = FULL')
    database.pragma('busy_timeout = 5000')
    try { (hooks.applySchemaMigrations ?? applySchemaMigrations)(database) }
    catch (error) { throw new SqliteStorageOpenError('schema-migration-failed', databasePath, 'SQLite Schema 迁移失败', error) }
    try { (hooks.quickCheck ?? assertQuickCheck)(database) }
    catch (error) { throw new SqliteStorageOpenError('integrity-check-failed', databasePath, 'SQLite 完整性检查失败', error) }
  } catch (error) {
    database.close()
    if (error instanceof SqliteStorageOpenError) throw error
    throw new SqliteStorageOpenError('database-open-failed', databasePath, '无法打开 SQLite 数据库', error)
  }

  const write = database.transaction((work: () => unknown) => rejectAsync(work))
  const read = database.transaction((work: () => unknown) => rejectAsync(work))
  return {
    databasePath,
    schemaVersion: SQLITE_SCHEMA_VERSION,
    close: () => database.close(),
    runInTransaction: <T>(work: () => T) => write.immediate(work) as T,
    runInReadTransaction: <T>(work: () => T) => read.deferred(work) as T,
    // Internal test seam; not part of the exported SqliteKnowledgeDatabase contract.
    raw: database,
  } as SqliteKnowledgeDatabase
}
