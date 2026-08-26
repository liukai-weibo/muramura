import crypto from 'node:crypto'
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createMySqlPool,
  MYSQL_REQUIRED_SCHEMA_VERSION,
  MYSQL_SCHEMA_AUDIT_EXCLUDED_TABLES,
  runMySqlMigrations,
} from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
const migrationsRoot = join(process.cwd(), 'migrations')
let database = ''
let migratorUser = ''
let root: Pool
let migrator: Pool
let schema6Directory = ''

describe.runIf(enabled)('MySQL common audit fields', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '')
    database = `kb_audit_fields_${suffix}`
    migratorUser = `kb_audit_mig_${suffix.slice(0, 16)}`
    expect(database).not.toBe('knowledge_base')
    expect(database).not.toBe('knowledge_base_uat')

    root = createMySqlPool({
      host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql',
      user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1,
    })
    const migratorPassword = crypto.randomUUID()
    await root.query(`CREATE DATABASE \`${database}\``)
    await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,DROP,INDEX,REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`)
    migrator = createMySqlPool({
      host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database,
      user: migratorUser, password: migratorPassword, connectionLimit: 1,
    })

    schema6Directory = mkdtempSync(join(tmpdir(), 'kb-schema6-'))
    for (const file of readdirSync(migrationsRoot).filter(file => /^00[1-6]_.*\.sql$/.test(file))) {
      copyFileSync(join(migrationsRoot, file), join(schema6Directory, file))
    }
    await runMySqlMigrations(migrator, schema6Directory)

    const legacyAt = '2026-01-02 03:04:05.006'
    await migrator.query('INSERT INTO users(id,username,password_hash,created_at) VALUES (?,?,?,?)', ['legacy-user', 'legacy-user', 'scrypt$redacted', legacyAt])
    await migrator.query('INSERT INTO system_metadata(`key`,value,updated_at) VALUES (?,?,?)', ['legacy-key', 'legacy-value', legacyAt])
    await migrator.query('INSERT INTO method_tombstones(method_id,title,permanently_deleted_at,versions) VALUES (?,?,?,?)', ['legacy-method', 'legacy-method', legacyAt, JSON.stringify([{ version: 1 }])])

    // Simulate a retry after one ADD COLUMN already committed but migration 007 was not recorded.
    await migrator.query('ALTER TABLE users ADD COLUMN updated_at DATETIME(3) NULL AFTER created_at')
    await runMySqlMigrations(migrator, migrationsRoot)
  })

  afterAll(async () => {
    await migrator?.end()
    await root?.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`)
    await root?.end()
    if (schema6Directory) rmSync(schema6Directory, { recursive: true, force: true })
  })

  it('requires a stable primary key and real DATETIME(3) audit columns on every business table', async () => {
    const [tables] = await migrator.query<Array<RowDataPacket & { tableName: string }>>(
      "SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' ORDER BY table_name",
    )
    const excluded = new Set<string>(MYSQL_SCHEMA_AUDIT_EXCLUDED_TABLES)
    const businessTables = tables.map(row => row.tableName).filter(table => !excluded.has(table))
    expect(businessTables.length).toBeGreaterThanOrEqual(16)

    for (const table of businessTables) {
      const [columns] = await migrator.query<Array<RowDataPacket & { columnName: string; columnType: string; isNullable: string }>>(
        'SELECT column_name AS columnName,column_type AS columnType,is_nullable AS isNullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position',
        [table],
      )
      const byName = new Map(columns.map(column => [column.columnName, column]))
      for (const name of ['created_at', 'updated_at'] as const) {
        expect(byName.get(name), `${table}.${name}`).toMatchObject({ columnType: 'datetime(3)', isNullable: 'NO' })
      }
      const [primaryKey] = await migrator.query<RowDataPacket[]>(
        "SELECT column_name FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name=? AND constraint_name='PRIMARY' ORDER BY ordinal_position",
        [table],
      )
      expect(primaryKey.length, `${table} stable primary key`).toBeGreaterThan(0)
    }
  })

  it('backfills legacy and partially applied Schema 6 rows with the frozen source timestamps', async () => {
    const [[user]] = await migrator.query<Array<RowDataPacket & { created_at: Date; updated_at: Date }>>('SELECT created_at,updated_at FROM users WHERE id=?', ['legacy-user'])
    const [[metadata]] = await migrator.query<Array<RowDataPacket & { created_at: Date; updated_at: Date }>>('SELECT created_at,updated_at FROM system_metadata WHERE `key`=?', ['legacy-key'])
    const [[tombstone]] = await migrator.query<Array<RowDataPacket & { permanently_deleted_at: Date; created_at: Date; updated_at: Date }>>('SELECT permanently_deleted_at,created_at,updated_at FROM method_tombstones WHERE method_id=?', ['legacy-method'])
    expect(user!.updated_at).toEqual(user!.created_at)
    expect(metadata!.created_at).toEqual(metadata!.updated_at)
    expect(tombstone!.created_at).toEqual(tombstone!.permanently_deleted_at)
    expect(tombstone!.updated_at).toEqual(tombstone!.permanently_deleted_at)
  })

  it('finishes Migration 008/009 safely after non-transactional CHECK DDL was only partially applied', async () => {
    await migrator.query('DELETE FROM schema_migrations WHERE version IN (8, 9)')
    await migrator.query('ALTER TABLE security_audit_events DROP CHECK security_audit_events_action_code_check')
    await runMySqlMigrations(migrator, migrationsRoot)
    const [[column]] = await migrator.query<RowDataPacket[]>('SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?', ['users', 'deleted_at'])
    const [[constraint]] = await migrator.query<RowDataPacket[]>('SELECT 1 FROM information_schema.table_constraints WHERE table_schema=DATABASE() AND table_name=? AND constraint_name=? AND constraint_type=?', ['security_audit_events', 'security_audit_events_action_code_check', 'CHECK'])
    expect(column).toBeDefined()
    expect(constraint).toBeDefined()
    await migrator.query(
      "INSERT INTO security_audit_events(id,actor_user_id,target_user_id,action_code,operation_id,created_at,updated_at) VALUES ('audit-username',NULL,'legacy-user','user_username_changed','op-username',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    )
    await migrator.query(
      "INSERT INTO security_audit_events(id,actor_user_id,target_user_id,action_code,operation_id,created_at,updated_at) VALUES ('audit-password',NULL,'legacy-user','user_password_reset','op-password',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    )
  })

  it('keeps the audit fields intact through the latest Schema migration', async () => {
    const [[row]] = await migrator.query<Array<RowDataPacket & { version: number }>>('SELECT MAX(version) AS version FROM schema_migrations')
    expect(row!.version).toBe(25)
    expect(MYSQL_REQUIRED_SCHEMA_VERSION).toBe(25)
  })
})
