import { pathToFileURL } from 'node:url'
import { InitialOwnerClaimApplicationService } from '@knowledge-base/application'
import type { InitialOwnerClaimErrorDetails, InitialOwnerClaimRepository, InitialOwnerClaimResult } from '@knowledge-base/contracts'
import { BusinessError } from '@knowledge-base/domain'
import { createMySqlPool, MySqlInitialOwnerClaimRepository, readMySqlConfig } from '@knowledge-base/storage-mysql'

export function parseInitialOwnerClaimTarget(args: string[]): string {
  const values = args.flatMap((value, index) => value === '--user-id' ? [args[index + 1] ?? ''] : value.startsWith('--user-id=') ? [value.slice('--user-id='.length)] : [])
  const consumed = args.length === 2 && args[0] === '--user-id' || args.length === 1 && args[0]?.startsWith('--user-id=')
  if (!consumed || values.length !== 1 || !values[0]?.trim()) throw new Error('usage: claim-initial-owner --user-id=<id>')
  return values[0].trim()
}

export function executeInitialOwnerClaim(args: string[], repository: InitialOwnerClaimRepository): Promise<InitialOwnerClaimResult> {
  return new InitialOwnerClaimApplicationService(repository).claim(parseInitialOwnerClaimTarget(args))
}

async function main(): Promise<void> {
  const pool = createMySqlPool(readMySqlConfig(process.env, 'app'))
  try {
    const result = await executeInitialOwnerClaim(process.argv.slice(2), new MySqlInitialOwnerClaimRepository(pool))
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    const body = error instanceof BusinessError
      ? {
          error: {
            code: error.code,
            ...((error.details ?? {}) as InitialOwnerClaimErrorDetails),
          },
        }
      : { error: { code: 'claim-failed' } }
    process.stderr.write(`${JSON.stringify(body)}\n`)
    process.exitCode = 1
  } finally { await pool.end() }
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) void main()
