import crypto from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMySqlPool, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
let database = ''; let appUser = ''; let migratorUser = ''; let appPassword = ''; let migratorPassword = ''; let root: ReturnType<typeof createMySqlPool>; let app: ReturnType<typeof createMySqlPool>; let migrator: ReturnType<typeof createMySqlPool>
const tables = ['items', 'reviews', 'methods', 'method_evidence', 'method_versions', 'method_applications', 'item_status_events', 'item_links', 'method_tombstones', 'exploration_tracks']

describe.runIf(enabled)('account ownership schema', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', ''); database = `kb_accounts_${suffix}`
    expect(database).not.toMatch(/knowledge_base(_uat)?/)
    appUser = `kb_account_app_${suffix.slice(0, 17)}`; migratorUser = `kb_account_migrator_${suffix.slice(0, 11)}`; appPassword = crypto.randomUUID(); migratorPassword = crypto.randomUUID()
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``)
    await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword]); await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT ON \`${database}\`.* TO '${appUser}'@'%'`); await root.query(`GRANT SELECT, INSERT, UPDATE, CREATE, ALTER, INDEX, REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`); await root.query('FLUSH PRIVILEGES')
    app = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user: appUser, password: appPassword, connectionLimit: 1 } as MySqlConnectionConfig)
    migrator = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user: migratorUser, password: migratorPassword, connectionLimit: 1 } as MySqlConnectionConfig)
    await runMySqlMigrations(migrator, `${process.cwd()}/migrations`)
    const [connection] = await app.query<Array<RowDataPacket & { database_name: string | null }>>('SELECT DATABASE() AS database_name')
    expect(connection).toEqual([{ database_name: database }])
  })
  afterAll(async () => { await app?.end(); await migrator?.end(); await root?.query(`DROP DATABASE IF EXISTS \`${database}\``); await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`); await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`); await root?.end() })

  it('creates the frozen account tables, hashed secret storage, and nullable owner columns', async () => {
    const [columns] = await app.query<Array<RowDataPacket & { table_name: string; column_name: string; column_type: string; is_nullable: string; column_default: string | null }>>(`SELECT table_name AS table_name,column_name AS column_name,column_type AS column_type,is_nullable AS is_nullable,column_default AS column_default FROM information_schema.columns WHERE table_schema=? AND (table_name IN ('users','user_sessions','initial_owner_claims') OR column_name='owner_user_id') ORDER BY table_name,ordinal_position`, [database])
    const accountColumns = (table: string) => columns.filter(column => column.table_name === table).map(({ column_name, column_type, is_nullable, column_default }) => ({ column_name, column_type, is_nullable, column_default }))
    expect(accountColumns('users')).toEqual([
      { column_name: 'id', column_type: 'varchar(128)', is_nullable: 'NO', column_default: null },
      { column_name: 'username', column_type: 'varchar(80)', is_nullable: 'NO', column_default: null },
      { column_name: 'password_hash', column_type: 'varchar(255)', is_nullable: 'NO', column_default: null },
      { column_name: 'created_at', column_type: 'datetime(3)', is_nullable: 'NO', column_default: null },
      { column_name: 'updated_at', column_type: 'datetime(3)', is_nullable: 'NO', column_default: null },
      { column_name: 'deleted_at', column_type: 'datetime(3)', is_nullable: 'YES', column_default: null },
    ])
    expect(accountColumns('user_sessions')).toEqual([
      { column_name: 'id', column_type: 'varchar(128)', is_nullable: 'NO', column_default: null },
      { column_name: 'user_id', column_type: 'varchar(128)', is_nullable: 'NO', column_default: null },
      { column_name: 'session_secret_hash', column_type: 'binary(32)', is_nullable: 'NO', column_default: null },
      { column_name: 'expires_at', column_type: 'datetime(3)', is_nullable: 'NO', column_default: null },
      { column_name: 'revoked_at', column_type: 'datetime(3)', is_nullable: 'YES', column_default: null },
      { column_name: 'created_at', column_type: 'datetime(3)', is_nullable: 'NO', column_default: null },
      { column_name: 'updated_at', column_type: 'datetime(3)', is_nullable: 'NO', column_default: null },
    ])
    expect(accountColumns('initial_owner_claims')).toEqual([
      { column_name: 'id', column_type: 'varchar(128)', is_nullable: 'NO', column_default: null },
      { column_name: 'user_id', column_type: 'varchar(128)', is_nullable: 'NO', column_default: null },
      { column_name: 'created_at', column_type: 'datetime(3)', is_nullable: 'NO', column_default: null },
      { column_name: 'updated_at', column_type: 'datetime(3)', is_nullable: 'NO', column_default: null },
    ])
    expect(columns.some(value => /password|secret|token/i.test(value.column_name) && !/hash/i.test(value.column_name))).toBe(false)
    for (const table of tables) expect(columns).toContainEqual(expect.objectContaining({ table_name: table, column_name: 'owner_user_id', is_nullable: 'YES', column_default: null }))
  })

  it('creates the frozen indexes, unique constraints, and RESTRICT foreign keys', async () => {
    const [indexRows] = await app.query<Array<RowDataPacket & { table_name: string; index_name: string; non_unique: number; column_name: string; seq_in_index: number }>>(`SELECT table_name AS table_name,index_name AS index_name,non_unique AS non_unique,column_name AS column_name,seq_in_index AS seq_in_index FROM information_schema.statistics WHERE table_schema=? ORDER BY table_name,index_name,seq_in_index`, [database])
    const index = (table: string, name: string) => indexRows.filter(row => row.table_name === table && row.index_name === name).map(({ non_unique, column_name }) => ({ non_unique, column_name }))
    expect(index('users', 'PRIMARY')).toEqual([{ non_unique: 0, column_name: 'id' }])
    expect(index('users', 'users_username_unique')).toEqual([{ non_unique: 0, column_name: 'username' }])
    expect(index('user_sessions', 'PRIMARY')).toEqual([{ non_unique: 0, column_name: 'id' }])
    expect(index('user_sessions', 'user_sessions_secret_hash_unique')).toEqual([{ non_unique: 0, column_name: 'session_secret_hash' }])
    expect(index('user_sessions', 'user_sessions_user_expires_idx')).toEqual([{ non_unique: 1, column_name: 'user_id' }, { non_unique: 1, column_name: 'expires_at' }])
    expect(index('initial_owner_claims', 'PRIMARY')).toEqual([{ non_unique: 0, column_name: 'id' }])
    expect(index('initial_owner_claims', 'initial_owner_claims_user_unique')).toEqual([{ non_unique: 0, column_name: 'user_id' }])
    expect(index('exploration_tracks', 'exploration_tracks_normalized_name_unique')).toEqual([{ non_unique: 0, column_name: 'normalized_name' }])

    const ownerIndexes: Record<string, [string, string[]]> = {
      items: ['items_owner_created_idx', ['owner_user_id', 'created_at']], reviews: ['reviews_owner_created_idx', ['owner_user_id', 'created_at']], methods: ['methods_owner_updated_idx', ['owner_user_id', 'updated_at']], method_evidence: ['method_evidence_owner_created_idx', ['owner_user_id', 'created_at']], method_versions: ['method_versions_owner_created_idx', ['owner_user_id', 'created_at']], method_applications: ['method_applications_owner_created_idx', ['owner_user_id', 'created_at']], item_status_events: ['item_status_events_owner_created_idx', ['owner_user_id', 'created_at']], item_links: ['item_links_owner_created_idx', ['owner_user_id', 'created_at']], method_tombstones: ['method_tombstones_owner_deleted_idx', ['owner_user_id', 'permanently_deleted_at']], exploration_tracks: ['exploration_tracks_owner_updated_idx', ['owner_user_id', 'updated_at']],
    }
    for (const [table, [name, columns]] of Object.entries(ownerIndexes)) expect(index(table, name)).toEqual(columns.map(column_name => ({ non_unique: 1, column_name })))

    const [foreignKeys] = await app.query<Array<RowDataPacket & { table_name: string; constraint_name: string; delete_rule: string; referenced_table_name: string }>>(`SELECT table_name AS table_name,constraint_name AS constraint_name,delete_rule AS delete_rule,referenced_table_name AS referenced_table_name FROM information_schema.referential_constraints WHERE constraint_schema=? ORDER BY table_name,constraint_name`, [database])
    expect(foreignKeys.filter(key => ['user_sessions_user_fk', 'initial_owner_claims_user_fk'].includes(key.constraint_name))).toEqual([
      { table_name: 'initial_owner_claims', constraint_name: 'initial_owner_claims_user_fk', delete_rule: 'RESTRICT', referenced_table_name: 'users' },
      { table_name: 'user_sessions', constraint_name: 'user_sessions_user_fk', delete_rule: 'RESTRICT', referenced_table_name: 'users' },
    ])
    const ownerForeignKeys = foreignKeys.filter(key => key.constraint_name.endsWith('_owner_user_fk'))
    expect(ownerForeignKeys).toHaveLength(10)
    expect(ownerForeignKeys).toEqual(expect.arrayContaining(tables.map(table => expect.objectContaining({ table_name: table, constraint_name: `${table}_owner_user_fk`, delete_rule: 'RESTRICT', referenced_table_name: 'users' }))))
  })
})
