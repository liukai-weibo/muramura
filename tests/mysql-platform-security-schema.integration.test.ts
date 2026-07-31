import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMySqlPool } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
let database = ''
let appUser = ''
let migratorUser = ''
let root: Pool
let app: Pool
let migrator: Pool

function statements(file: string): string[] {
  return fs.readFileSync(path.join(process.cwd(), 'migrations', file), 'utf8')
    .split(/;\s*(?:\r?\n|$)/)
    .map(statement => statement.trim())
    .filter(Boolean)
}

async function executeMigration(connection: Pool, file: string): Promise<void> {
  for (const statement of statements(file)) await connection.query(statement)
}

describe.runIf(enabled)('platform security schema', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '')
    database = `kb_platform_schema_${suffix}`
    appUser = `kb_platform_app_${suffix.slice(0, 15)}`
    migratorUser = `kb_platform_mig_${suffix.slice(0, 15)}`
    const appPassword = crypto.randomUUID()
    const migratorPassword = crypto.randomUUID()
    expect(database).not.toMatch(/^knowledge_base(?:_uat)?$/)
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``)
    await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword])
    await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    const [credentials] = await root.query<Array<RowDataPacket & { User: string }>>('SELECT User FROM mysql.user WHERE User IN (?,?)', [appUser, migratorUser])
    expect(credentials.map(row => row.User).sort()).toEqual([appUser, migratorUser].sort())
    await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${database}\`.* TO '${appUser}'@'%'`)
    await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,DROP,INDEX,REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`)
    app = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user: appUser, password: appPassword, connectionLimit: 1 })
    migrator = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user: migratorUser, password: migratorPassword, connectionLimit: 1 })
    for (const file of ['001_initial_schema.sql', '002_add_system_metadata.sql', '003_method_lifecycle_constraints.sql', '004_add_exploration_tracks.sql', '005_add_accounts_sessions_and_owner_columns.sql']) await executeMigration(migrator, file)
    await app.query('INSERT INTO users(id,username,password_hash,created_at) VALUES (?,?,?,?)', ['legacy-user', 'legacy', 'scrypt$redacted', new Date('2026-01-01T00:00:00.000Z')])
    await executeMigration(migrator, '006_add_platform_roles_and_security_audit.sql')
  })

  afterAll(async () => {
    await app?.end()
    await migrator?.end()
    await root?.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`)
    await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`)
    await root?.end()
  })

  it('creates the exact frozen columns, codes, backfill, and no automatic administrator', async () => {
    const [columns] = await app.query<Array<RowDataPacket & { table_name: string; column_name: string; column_type: string; is_nullable: string; column_default: string | null }>>(
      "SELECT table_name AS table_name,column_name AS column_name,column_type AS column_type,is_nullable AS is_nullable,column_default AS column_default FROM information_schema.columns WHERE table_schema=? AND table_name IN ('user_roles','security_audit_events') ORDER BY table_name,ordinal_position",
      [database],
    )
    const shape = (table: string) => columns.filter(row => row.table_name === table).map(({ column_name, column_type, is_nullable, column_default }) => ({ column_name, column_type, is_nullable, column_default }))
    expect(shape('user_roles')).toEqual([
      { column_name: 'user_id', column_type: 'varchar(128)', is_nullable: 'NO', column_default: null },
      { column_name: 'role_code', column_type: 'varchar(32)', is_nullable: 'NO', column_default: null },
      { column_name: 'granted_by_user_id', column_type: 'varchar(128)', is_nullable: 'YES', column_default: null },
      { column_name: 'created_at', column_type: 'datetime(3)', is_nullable: 'NO', column_default: null },
    ])
    expect(shape('security_audit_events')).toEqual([
      { column_name: 'id', column_type: 'varchar(128)', is_nullable: 'NO', column_default: null },
      { column_name: 'actor_user_id', column_type: 'varchar(128)', is_nullable: 'YES', column_default: null },
      { column_name: 'target_user_id', column_type: 'varchar(128)', is_nullable: 'NO', column_default: null },
      { column_name: 'action_code', column_type: 'varchar(64)', is_nullable: 'NO', column_default: null },
      { column_name: 'operation_id', column_type: 'varchar(128)', is_nullable: 'NO', column_default: null },
      { column_name: 'created_at', column_type: 'datetime(3)', is_nullable: 'NO', column_default: null },
    ])
    const [checks] = await app.query<Array<RowDataPacket & { constraint_name: string; check_clause: string }>>('SELECT constraint_name AS constraint_name,check_clause AS check_clause FROM information_schema.check_constraints WHERE constraint_schema=? ORDER BY constraint_name', [database])
    expect(checks.find(row => row.constraint_name === 'user_roles_role_code_check')?.check_clause).toContain('member')
    expect(checks.find(row => row.constraint_name === 'user_roles_role_code_check')?.check_clause).toContain('platform_admin')
    const auditCheck = checks.find(row => row.constraint_name === 'security_audit_events_action_code_check')?.check_clause ?? ''
    for (const action of ['platform_admin_granted', 'platform_admin_revoked', 'user_sessions_revoked']) expect(auditCheck).toContain(action)
    const [roles] = await app.query<RowDataPacket[]>('SELECT user_id,role_code,granted_by_user_id,created_at FROM user_roles ORDER BY user_id,role_code')
    expect(roles).toEqual([{ user_id: 'legacy-user', role_code: 'member', granted_by_user_id: null, created_at: new Date('2026-01-01T00:00:00.000Z') }])
    expect(roles.some(row => row.role_code === 'platform_admin')).toBe(false)
  })

  it('creates exact primary, unique, ordered indexes and RESTRICT foreign keys', async () => {
    const [rows] = await app.query<Array<RowDataPacket & { table_name: string; index_name: string; non_unique: number; column_name: string }>>('SELECT table_name AS table_name,index_name AS index_name,non_unique AS non_unique,column_name AS column_name FROM information_schema.statistics WHERE table_schema=? AND table_name IN (?,?) ORDER BY table_name,index_name,seq_in_index', [database, 'user_roles', 'security_audit_events'])
    const index = (table: string, name: string) => rows.filter(row => row.table_name === table && row.index_name === name).map(({ non_unique, column_name }) => ({ non_unique, column_name }))
    expect(index('user_roles', 'PRIMARY')).toEqual([{ non_unique: 0, column_name: 'user_id' }, { non_unique: 0, column_name: 'role_code' }])
    expect(index('user_roles', 'user_roles_role_user_idx')).toEqual([{ non_unique: 1, column_name: 'role_code' }, { non_unique: 1, column_name: 'user_id' }])
    expect(index('user_roles', 'user_roles_granted_by_created_idx')).toEqual([{ non_unique: 1, column_name: 'granted_by_user_id' }, { non_unique: 1, column_name: 'created_at' }])
    expect(index('security_audit_events', 'PRIMARY')).toEqual([{ non_unique: 0, column_name: 'id' }])
    expect(index('security_audit_events', 'security_audit_events_operation_unique')).toEqual([{ non_unique: 0, column_name: 'operation_id' }])
    expect(index('security_audit_events', 'security_audit_events_target_created_idx')).toEqual([{ non_unique: 1, column_name: 'target_user_id' }, { non_unique: 1, column_name: 'created_at' }, { non_unique: 1, column_name: 'id' }])
    expect(index('security_audit_events', 'security_audit_events_actor_created_idx')).toEqual([{ non_unique: 1, column_name: 'actor_user_id' }, { non_unique: 1, column_name: 'created_at' }, { non_unique: 1, column_name: 'id' }])
    const [foreignKeys] = await app.query<Array<RowDataPacket & { table_name: string; constraint_name: string; column_name: string; referenced_table_name: string; referenced_column_name: string; delete_rule: string }>>(`
      SELECT k.table_name AS table_name,k.constraint_name AS constraint_name,k.column_name AS column_name,k.referenced_table_name AS referenced_table_name,k.referenced_column_name AS referenced_column_name,r.delete_rule AS delete_rule
      FROM information_schema.key_column_usage k
      JOIN information_schema.referential_constraints r ON r.constraint_schema=k.constraint_schema AND r.constraint_name=k.constraint_name
      WHERE k.constraint_schema=? AND k.table_name IN ('user_roles','security_audit_events')
      ORDER BY k.table_name,k.constraint_name,k.ordinal_position
    `, [database])
    expect(foreignKeys).toEqual([
      { table_name: 'security_audit_events', constraint_name: 'security_audit_events_actor_user_fk', column_name: 'actor_user_id', referenced_table_name: 'users', referenced_column_name: 'id', delete_rule: 'RESTRICT' },
      { table_name: 'security_audit_events', constraint_name: 'security_audit_events_target_user_fk', column_name: 'target_user_id', referenced_table_name: 'users', referenced_column_name: 'id', delete_rule: 'RESTRICT' },
      { table_name: 'user_roles', constraint_name: 'user_roles_granted_by_user_fk', column_name: 'granted_by_user_id', referenced_table_name: 'users', referenced_column_name: 'id', delete_rule: 'RESTRICT' },
      { table_name: 'user_roles', constraint_name: 'user_roles_user_fk', column_name: 'user_id', referenced_table_name: 'users', referenced_column_name: 'id', delete_rule: 'RESTRICT' },
    ])
  })
})
