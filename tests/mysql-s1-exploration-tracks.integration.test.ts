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
  type MySqlConnectionConfig,
} from '../packages/storage-mysql/src/index'

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

type Conflict = {
  label: string
  setup: (pool: ReturnType<typeof createMySqlPool>) => Promise<void>
}

const conflicts: Conflict[] = [
  {
    label: '表 exploration_tracks',
    setup: pool => pool.query('CREATE TABLE exploration_tracks (id VARCHAR(128) NOT NULL PRIMARY KEY) ENGINE=InnoDB').then(() => undefined),
  },
  {
    label: '列 items.exploration_track_id',
    setup: pool => pool.query('ALTER TABLE items ADD COLUMN exploration_track_id VARCHAR(128) NULL').then(() => undefined),
  },
  ...[
    'exploration_tracks_normalized_name_unique',
    'exploration_tracks_active_updated_idx',
    'items_exploration_track_created_idx',
  ].map(indexName => ({
    label: `索引 ${indexName}`,
    setup: (pool: ReturnType<typeof createMySqlPool>) => pool.query(`CREATE INDEX \`${indexName}\` ON items (created_at)`).then(() => undefined),
  })),
  {
    label: '外键 items_exploration_track_fk',
    setup: pool => pool.query('ALTER TABLE items ADD CONSTRAINT items_exploration_track_fk FOREIGN KEY (id) REFERENCES methods(id)').then(() => undefined),
  },
]

function createMigrationDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-s1-004-'))
  for (const file of ['001_initial_schema.sql', '002_add_system_metadata.sql', '003_method_lifecycle_constraints.sql', '004_add_exploration_tracks.sql']) {
    fs.copyFileSync(path.join(migrationsDirectory, file), path.join(directory, file))
  }
  return directory
}

async function withTemporaryDatabase(work: (pools: { app: ReturnType<typeof createMySqlPool>; migrator: ReturnType<typeof createMySqlPool> }) => Promise<void>): Promise<void> {
  const suffix = crypto.randomUUID().replaceAll('-', '')
  const database = `kb_s1_004_${suffix}`
  const appUser = `kbs1a_${suffix.slice(0, 24)}`
  const migratorUser = `kbs1m_${suffix.slice(0, 24)}`
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

async function assertOnlyBaselineMigrations(pool: ReturnType<typeof createMySqlPool>): Promise<void> {
  const [records] = await pool.query<Array<RowDataPacket & { version: number }>>('SELECT version FROM schema_migrations ORDER BY version')
  expect(records.map(record => record.version)).toEqual([1, 2, 3])
}

async function assertMigration004Facts(pool: ReturnType<typeof createMySqlPool>): Promise<void> {
  const [columns] = await pool.query<Array<RowDataPacket & { columnType: string; isNullable: string; columnDefault: string | null }>>(`
    SELECT COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault
    FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'items' AND column_name = 'exploration_track_id'
  `)
  expect(columns).toEqual([{ columnType: 'varchar(128)', isNullable: 'YES', columnDefault: null }])

  const [trackColumns] = await pool.query<Array<RowDataPacket & { columnName: string; columnType: string; isNullable: string }>>(`
    SELECT COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable
    FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'exploration_tracks'
    ORDER BY ordinal_position
  `)
  expect(trackColumns).toEqual([
    { columnName: 'id', columnType: 'varchar(128)', isNullable: 'NO' },
    { columnName: 'name', columnType: 'varchar(80)', isNullable: 'NO' },
    { columnName: 'normalized_name', columnType: 'varchar(80)', isNullable: 'NO' },
    { columnName: 'created_at', columnType: 'datetime(3)', isNullable: 'NO' },
    { columnName: 'updated_at', columnType: 'datetime(3)', isNullable: 'NO' },
    { columnName: 'deleted_at', columnType: 'datetime(3)', isNullable: 'YES' },
  ])

  const [indexes] = await pool.query<Array<RowDataPacket & { tableName: string; indexName: string; nonUnique: number; sequence: number; columnName: string; ordering: string | null }>>(`
    SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
      SEQ_IN_INDEX AS sequence, COLUMN_NAME AS columnName, COLLATION AS ordering
    FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND index_name IN (
      'exploration_tracks_normalized_name_unique',
      'exploration_tracks_active_updated_idx',
      'items_exploration_track_created_idx'
    )
    ORDER BY indexName, sequence
  `)
  expect(indexes).toEqual([
    { tableName: 'exploration_tracks', indexName: 'exploration_tracks_active_updated_idx', nonUnique: 1, sequence: 1, columnName: 'deleted_at', ordering: 'A' },
    { tableName: 'exploration_tracks', indexName: 'exploration_tracks_active_updated_idx', nonUnique: 1, sequence: 2, columnName: 'updated_at', ordering: 'D' },
    { tableName: 'exploration_tracks', indexName: 'exploration_tracks_normalized_name_unique', nonUnique: 0, sequence: 1, columnName: 'normalized_name', ordering: 'A' },
    { tableName: 'items', indexName: 'items_exploration_track_created_idx', nonUnique: 1, sequence: 1, columnName: 'exploration_track_id', ordering: 'A' },
    { tableName: 'items', indexName: 'items_exploration_track_created_idx', nonUnique: 1, sequence: 2, columnName: 'created_at', ordering: 'D' },
  ])

  const [foreignKeys] = await pool.query<Array<RowDataPacket & { constraintName: string; tableName: string; columnName: string; referencedTableName: string; referencedColumnName: string }>>(`
    SELECT k.CONSTRAINT_NAME AS constraintName, k.TABLE_NAME AS tableName, k.COLUMN_NAME AS columnName,
      k.REFERENCED_TABLE_NAME AS referencedTableName, k.REFERENCED_COLUMN_NAME AS referencedColumnName
    FROM information_schema.key_column_usage k
    INNER JOIN information_schema.table_constraints c
      ON c.constraint_schema = k.constraint_schema AND c.table_name = k.table_name AND c.constraint_name = k.constraint_name
    WHERE k.constraint_schema = DATABASE() AND c.constraint_type = 'FOREIGN KEY' AND k.constraint_name = 'items_exploration_track_fk'
  `)
  expect(foreignKeys).toEqual([{
    constraintName: 'items_exploration_track_fk',
    tableName: 'items',
    columnName: 'exploration_track_id',
    referencedTableName: 'exploration_tracks',
    referencedColumnName: 'id',
  }])
}

describe.runIf(mysqlIntegrationEnabled)('Exploration track 004 migration preflight', () => {
  afterAll(() => undefined)

  it('applies formal 004 idempotently, records its checksum, and preserves app DML-only permissions', async () => {
    const directory = createMigrationDirectory()
    try {
      await withTemporaryDatabase(async ({ app, migrator }) => {
        await runMySqlMigrations(migrator, directory)
        const [records] = await migrator.query<Array<RowDataPacket & { version: number; name: string; checksum: string }>>(
          'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
        )
        expect(records).toEqual([
          { version: 1, name: '001_initial_schema.sql', checksum: expect.stringMatching(/^[a-f0-9]{64}$/) },
          { version: 2, name: '002_add_system_metadata.sql', checksum: expect.stringMatching(/^[a-f0-9]{64}$/) },
          { version: 3, name: '003_method_lifecycle_constraints.sql', checksum: expect.stringMatching(/^[a-f0-9]{64}$/) },
          { version: 4, name: '004_add_exploration_tracks.sql', checksum: expect.stringMatching(/^[a-f0-9]{64}$/) },
        ])
        await assertMigration004Facts(migrator)
        await runMySqlMigrations(migrator, directory)
        await assertMigration004Facts(migrator)
        fs.appendFileSync(path.join(directory, '004_add_exploration_tracks.sql'), '\n-- test-only checksum drift\n')
        await expect(runMySqlMigrations(migrator, directory)).rejects.toThrow('已执行的 migration 内容不一致：004_add_exploration_tracks.sql')
        await expect(app.query('CREATE TABLE s1_004_app_forbidden_success (id INT)')).rejects.toMatchObject({ code: 'ER_TABLEACCESS_DENIED_ERROR' })
      })
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  for (const conflict of conflicts) {
    it(`rejects before 004 DDL when ${conflict.label} already exists`, async () => {
      const directory = createMigrationDirectory()
      try {
        await withTemporaryDatabase(async ({ app, migrator }) => {
          const baselineDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-s1-baseline-'))
          try {
            for (const file of ['001_initial_schema.sql', '002_add_system_metadata.sql', '003_method_lifecycle_constraints.sql']) {
              fs.copyFileSync(path.join(migrationsDirectory, file), path.join(baselineDirectory, file))
            }
            await runMySqlMigrations(migrator, baselineDirectory)
            await conflict.setup(migrator)
            await expect(runMySqlMigrations(migrator, directory)).rejects.toThrow('004 migration 预检失败')
            await assertOnlyBaselineMigrations(migrator)

            const [targetObjects] = await migrator.query<Array<RowDataPacket & { count: number }>>(`
              SELECT COUNT(*) AS count FROM (
                SELECT table_name AS name FROM information_schema.tables
                  WHERE table_schema = DATABASE() AND table_name = 'exploration_tracks'
                UNION ALL
                SELECT column_name AS name FROM information_schema.columns
                  WHERE table_schema = DATABASE() AND table_name = 'items' AND column_name = 'exploration_track_id'
                UNION ALL
                SELECT index_name AS name FROM information_schema.statistics
                  WHERE table_schema = DATABASE() AND index_name IN (
                    'exploration_tracks_normalized_name_unique',
                    'exploration_tracks_active_updated_idx',
                    'items_exploration_track_created_idx'
                  )
                UNION ALL
                SELECT constraint_name AS name FROM information_schema.table_constraints
                  WHERE table_schema = DATABASE() AND table_name = 'items'
                    AND constraint_type = 'FOREIGN KEY' AND constraint_name = 'items_exploration_track_fk'
              ) AS targets
            `)
            expect(targetObjects[0]?.count).toBe(1)
            await expect(app.query('CREATE TABLE s1_004_app_forbidden (id INT)')).rejects.toMatchObject({ code: 'ER_TABLEACCESS_DENIED_ERROR' })
          } finally {
            fs.rmSync(baselineDirectory, { recursive: true, force: true })
          }
        })
      } finally {
        fs.rmSync(directory, { recursive: true, force: true })
      }
    })
  }
})
