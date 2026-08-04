import type { Pool } from 'mysql2/promise'
import { describe, expect, it, vi } from 'vitest'
import { formatApiStartupFailure } from '../apps/api/src/main'
import { ApiListenConfigError } from '../apps/api/src/index'
import {
  assertMySqlPlatformSchemaReady,
  getMySqlHealth,
  MySqlConfigError,
  MySqlSchemaNotReadyError,
} from '../packages/storage-mysql/src/index'

function schemaError(
  details: ConstructorParameters<typeof MySqlSchemaNotReadyError>[0],
): MySqlSchemaNotReadyError {
  const error = new MySqlSchemaNotReadyError(details) as MySqlSchemaNotReadyError & Record<string, unknown>
  error.password = 'sentinel-password'
  error.host = 'sentinel-host'
  error.user = 'sentinel-user'
  error.sql = 'SELECT sentinel-secret'
  error.stack = 'sentinel-stack'
  return error
}

function fakePool(query: (sql: string) => Promise<unknown>): Pool {
  const connection = { query: vi.fn(query), release: vi.fn() }
  return { getConnection: vi.fn(async () => connection) } as unknown as Pool
}

describe('API startup diagnostics', () => {
  it.each([
    {
      reason: 'migration-table-missing' as const,
      error: schemaError({
        reason: 'migration-table-missing', database: 'knowledge_base', actualSchemaVersion: 0,
        requiredSchemaVersion: 9, requiredTable: 'schema_migrations',
      }),
      expected: 'API_STARTUP_FAILED code=MYSQL_SCHEMA_NOT_READY reason=migration-table-missing database="knowledge_base" actualSchemaVersion=0 requiredSchemaVersion=9 requiredTable=schema_migrations action="corepack pnpm db:migrate"',
    },
    {
      reason: 'schema-version-behind' as const,
      error: schemaError({
        reason: 'schema-version-behind', database: 'knowledge_base', actualSchemaVersion: 7,
        requiredSchemaVersion: 9,
      }),
      expected: 'API_STARTUP_FAILED code=MYSQL_SCHEMA_NOT_READY reason=schema-version-behind database="knowledge_base" actualSchemaVersion=7 requiredSchemaVersion=9 action="corepack pnpm db:migrate"',
    },
    {
      reason: 'required-table-missing' as const,
      error: schemaError({
        reason: 'required-table-missing', database: 'knowledge_base', actualSchemaVersion: 9,
        requiredSchemaVersion: 9, requiredTable: 'user_roles',
      }),
      expected: 'API_STARTUP_FAILED code=MYSQL_SCHEMA_NOT_READY reason=required-table-missing database="knowledge_base" actualSchemaVersion=9 requiredSchemaVersion=9 requiredTable=user_roles action="停止启动并检查 migration 状态，禁止手工修表"',
    },
  ])('formats $reason without leaking raw error fields', ({ error, expected }) => {
    const output = formatApiStartupFailure(error)
    expect(output).toBe(expected)
    expect(output).not.toContain('sentinel-password')
    expect(output).not.toContain('sentinel-host')
    expect(output).not.toContain('sentinel-user')
    expect(output).not.toContain('SELECT sentinel-secret')
    expect(output).not.toContain('sentinel-stack')
  })

  it('classifies port, MySQL and unknown failures without echoing raw messages', () => {
    const port = formatApiStartupFailure(Object.assign(new Error('sentinel-password'), { code: 'EADDRINUSE', port: 32146 }))
    const mysql = formatApiStartupFailure(Object.assign(new Error('sentinel-password'), { code: 'ER_ACCESS_DENIED_ERROR' }))
    const unknown = formatApiStartupFailure(Object.assign(new Error('sentinel-password'), { environment: 'sentinel-env' }))
    const missingEnv = formatApiStartupFailure(new MySqlConfigError({ reason: 'missing-env', envVar: 'MYSQL_PORT' }))
    const invalidEnv = formatApiStartupFailure(new MySqlConfigError({ reason: 'invalid-env', envVar: 'MYSQL_PORT' }))
    const listen = formatApiStartupFailure(new ApiListenConfigError())

    expect(port).toBe('API_STARTUP_FAILED code=API_PORT_IN_USE port=32146 action="检查并停止已确认归属的端口占用进程"')
    expect(mysql).toBe('API_STARTUP_FAILED code=MYSQL_UNAVAILABLE causeCode=ER_ACCESS_DENIED_ERROR action="检查 MySQL 状态与本机 .env 配置"')
    expect(unknown).toBe('API_STARTUP_FAILED code=INTERNAL_ERROR action="检查本机启动配置与安全日志"')
    expect(missingEnv).toBe('API_STARTUP_FAILED code=MYSQL_CONFIG_INVALID reason=missing-env envVar=MYSQL_PORT action="在当前 shell 执行 set -a && source .env && set +a 后再启动；UAT 使用 .env.uat"')
    expect(invalidEnv).toBe('API_STARTUP_FAILED code=MYSQL_CONFIG_INVALID reason=invalid-env envVar=MYSQL_PORT action="在当前 shell 执行 set -a && source .env && set +a 后再启动；UAT 使用 .env.uat"')
    expect(listen).toBe('API_STARTUP_FAILED code=API_CONFIG_INVALID reason=listen-not-allowed action="API 仅允许监听 127.0.0.1:32146"')
    expect(`${port}${mysql}${unknown}${missingEnv}${invalidEnv}${listen}`).not.toContain('sentinel-password')
    expect(`${port}${mysql}${unknown}${missingEnv}${invalidEnv}${listen}`).not.toContain('sentinel-env')
  })

  it('creates structured errors for a missing migration table and a behind version', async () => {
    const missingTablePool = fakePool(async sql => {
      if (sql === 'SELECT 1') return [[]]
      if (sql.includes('SELECT DATABASE()')) return [[{ current_database: 'knowledge_base' }]]
      if (sql.includes('SELECT MAX(version)')) throw { code: 'ER_NO_SUCH_TABLE' }
      throw new Error('unexpected query')
    })
    await expect(getMySqlHealth(missingTablePool, 'knowledge_base')).rejects.toMatchObject({
      details: {
        reason: 'migration-table-missing', database: 'knowledge_base', actualSchemaVersion: 0,
        requiredSchemaVersion: 9, requiredTable: 'schema_migrations',
      },
    })

    const behindPool = fakePool(async sql => {
      if (sql === 'SELECT 1') return [[]]
      if (sql.includes('SELECT DATABASE()')) return [[{ current_database: 'knowledge_base' }]]
      if (sql.includes('SELECT MAX(version)')) return [[{ version: 7 }]]
      throw new Error('unexpected query')
    })
    await expect(getMySqlHealth(behindPool, 'knowledge_base')).rejects.toMatchObject({
      details: {
        reason: 'schema-version-behind', database: 'knowledge_base', actualSchemaVersion: 7,
        requiredSchemaVersion: 9,
      },
    })
  })

  it.each(['user_roles', 'security_audit_events'] as const)('identifies a missing required table: %s', async missingTable => {
    const pool = fakePool(async sql => {
      if (sql === 'SELECT 1') return [[]]
      if (sql.includes('SELECT DATABASE()')) return [[{ current_database: 'knowledge_base' }]]
      if (sql.includes('SELECT MAX(version)')) return [[{ version: 9 }]]
      if (sql.includes(`FROM ${missingTable}`)) throw { code: 'ER_NO_SUCH_TABLE' }
      if (sql.includes('FROM user_roles') || sql.includes('FROM security_audit_events')) return [[]]
      throw new Error('unexpected query')
    })

    await expect(assertMySqlPlatformSchemaReady(pool, 'knowledge_base')).rejects.toMatchObject({
      details: {
        reason: 'required-table-missing', database: 'knowledge_base', actualSchemaVersion: 9,
        requiredSchemaVersion: 9, requiredTable: missingTable,
      },
    })
  })
})
