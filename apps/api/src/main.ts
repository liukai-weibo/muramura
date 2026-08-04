import { ApiListenConfigError, createApiServer, readApiListenConfig } from './index'
import { pathToFileURL } from 'node:url'
import type { Server } from 'node:http'
import {
  assertMySqlPlatformSchemaReady,
  createMySqlPool,
  MySqlConfigError,
  MySqlSchemaNotReadyError,
  readMySqlConfig,
} from '@knowledge-base/storage-mysql'

const MYSQL_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_DBACCESS_DENIED_ERROR',
])

export interface ApiMainDependencies {
  createServer?: (config: ReturnType<typeof readMySqlConfig>) => Server
  listen?: (server: Server, port: number, host: string) => Promise<void>
  log?: (message: string) => void
}

function readErrorCode(value: unknown): string | undefined {
  return typeof value === 'object'
    && value !== null
    && 'code' in value
    && typeof value.code === 'string'
    ? value.code
    : undefined
}

export function formatApiStartupFailure(value: unknown): string {
  if (value instanceof MySqlSchemaNotReadyError) {
    const { details } = value
    const fields = [
      'API_STARTUP_FAILED',
      'code=MYSQL_SCHEMA_NOT_READY',
      `reason=${details.reason}`,
      `database=${JSON.stringify(details.database)}`,
      ...(details.actualSchemaVersion === undefined ? [] : [`actualSchemaVersion=${details.actualSchemaVersion}`]),
      `requiredSchemaVersion=${details.requiredSchemaVersion}`,
      ...(details.requiredTable === undefined ? [] : [`requiredTable=${details.requiredTable}`]),
      `action=${JSON.stringify(details.reason === 'required-table-missing'
        ? '停止启动并检查 migration 状态，禁止手工修表'
        : 'corepack pnpm db:migrate')}`,
    ]
    return fields.join(' ')
  }

  if (value instanceof MySqlConfigError) {
    const { details } = value
    return [
      'API_STARTUP_FAILED',
      'code=MYSQL_CONFIG_INVALID',
      `reason=${details.reason}`,
      `envVar=${details.envVar}`,
      'action="在当前 shell 执行 set -a && source .env && set +a 后再启动；UAT 使用 .env.uat"',
    ].join(' ')
  }

  if (value instanceof ApiListenConfigError) {
    return 'API_STARTUP_FAILED code=API_CONFIG_INVALID reason=listen-not-allowed action="API 仅允许监听 127.0.0.1:32146"'
  }

  const code = readErrorCode(value)
  if (code === 'EADDRINUSE') {
    const port = typeof value === 'object'
      && value !== null
      && 'port' in value
      && typeof value.port === 'number'
      && Number.isInteger(value.port)
      ? Number(value.port)
      : undefined
    return [
      'API_STARTUP_FAILED',
      'code=API_PORT_IN_USE',
      ...(port === undefined ? [] : [`port=${port}`]),
      'action="检查并停止已确认归属的端口占用进程"',
    ].join(' ')
  }

  if (code && MYSQL_UNAVAILABLE_CODES.has(code)) {
    return `API_STARTUP_FAILED code=MYSQL_UNAVAILABLE causeCode=${code} action="检查 MySQL 状态与本机 .env 配置"`
  }

  return 'API_STARTUP_FAILED code=INTERNAL_ERROR action="检查本机启动配置与安全日志"'
}

export async function startApiMain(environment: NodeJS.ProcessEnv = process.env, dependencies: ApiMainDependencies = {}) {
  const config = readMySqlConfig(environment, 'app')
  const probe = createMySqlPool({ ...config, connectionLimit: 1 })
  try { await assertMySqlPlatformSchemaReady(probe, config.database) } finally { await probe.end() }
  const server = (dependencies.createServer ?? createApiServer)(config)
  const { host, port } = readApiListenConfig(environment)
  await (dependencies.listen ?? listen)(server, port, host)
  ;(dependencies.log ?? console.log)(`Knowledge_Base MySQL API listening at http://${host}:${port}`)
  return server
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => { server.off('error', reject); resolve() })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startApiMain().catch(error => {
    console.error(formatApiStartupFailure(error))
    process.exitCode = 1
  })
}
