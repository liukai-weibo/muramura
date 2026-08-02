import { pathToFileURL } from 'node:url'
import { InitialPlatformAdminApplicationService } from '@knowledge-base/application'
import { BusinessError } from '@knowledge-base/domain'
import {
  assertMySqlPlatformSchemaReady,
  createMySqlPool,
  MySqlPlatformAdministrationRepository,
  readMySqlConfig,
} from '@knowledge-base/storage-mysql'
import type { RowDataPacket } from 'mysql2/promise'

const usage = 'USAGE: grant-initial-platform-admin --user-id=<id> --expected-database=<database> --apply'

export interface InitialPlatformAdminCliArguments { userId: string; expectedDatabase: string }

export function parseInitialPlatformAdminArguments(args: string[]): InitialPlatformAdminCliArguments {
  let userId: string | undefined
  let expectedDatabase: string | undefined
  let apply = false
  for (const argument of args) {
    if (argument.startsWith('--user-id=')) {
      if (userId !== undefined) throw new Error('usage')
      userId = argument.slice('--user-id='.length).trim()
    } else if (argument.startsWith('--expected-database=')) {
      if (expectedDatabase !== undefined) throw new Error('usage')
      expectedDatabase = argument.slice('--expected-database='.length).trim()
    } else if (argument === '--apply') {
      if (apply) throw new Error('usage')
      apply = true
    } else {
      throw new Error('usage')
    }
  }
  if (!apply || !userId || userId.length > 128 || !expectedDatabase || expectedDatabase.length > 64) throw new Error('usage')
  return { userId, expectedDatabase }
}

export async function runInitialPlatformAdminCli(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
  output: { stdout: (value: string) => void; stderr: (value: string) => void } = {
    stdout: value => process.stdout.write(`${value}\n`),
    stderr: value => process.stderr.write(`${value}\n`),
  },
): Promise<number> {
  let parsed: InitialPlatformAdminCliArguments
  const commandArguments = args[0] === '--' ? args.slice(1) : args
  try { parsed = parseInitialPlatformAdminArguments(commandArguments) } catch { output.stderr(usage); return 1 }
  let pool: ReturnType<typeof createMySqlPool> | undefined
  try {
    const config = readMySqlConfig(environment, 'app')
    pool = createMySqlPool({ ...config, connectionLimit: 1 })
    const [databaseRows] = await pool.query<Array<RowDataPacket & { database_name: string | null }>>('SELECT DATABASE() AS database_name')
    if (databaseRows[0]?.database_name !== parsed.expectedDatabase) { output.stderr('DATABASE_MISMATCH'); return 1 }
    try { await assertMySqlPlatformSchemaReady(pool, parsed.expectedDatabase) } catch { output.stderr('SCHEMA_NOT_READY'); return 1 }
    const result = await new InitialPlatformAdminApplicationService(new MySqlPlatformAdministrationRepository(pool)).initialize(parsed.userId)
    output.stdout(JSON.stringify({ status: result.status, database: parsed.expectedDatabase, userId: result.targetUserId, ...(result.operationId ? { operationId: result.operationId } : {}) }))
    return 0
  } catch (error) {
    if (error instanceof BusinessError) output.stderr(error.code)
    else output.stderr('INITIAL_PLATFORM_ADMIN_FAILED')
    return 1
  } finally { await pool?.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runInitialPlatformAdminCli(process.argv.slice(2)).then(code => { process.exitCode = code })
}
