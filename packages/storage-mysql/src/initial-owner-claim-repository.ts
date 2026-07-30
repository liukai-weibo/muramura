import type { InitialOwnerClaimRepository, InitialOwnerClaimResult, OwnedBusinessCollection, OwnerClaimCollectionSummary, OwnerClaimSummary } from '@knowledge-base/contracts'
import { createId } from '@knowledge-base/domain'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { runInMySqlTransaction } from './index'

const collections: ReadonlyArray<{ collection: OwnedBusinessCollection; table: string }> = [
  { collection: 'items', table: 'items' },
  { collection: 'reviews', table: 'reviews' },
  { collection: 'methods', table: 'methods' },
  { collection: 'methodEvidence', table: 'method_evidence' },
  { collection: 'methodVersions', table: 'method_versions' },
  { collection: 'methodApplications', table: 'method_applications' },
  { collection: 'itemStatusEvents', table: 'item_status_events' },
  { collection: 'itemLinks', table: 'item_links' },
  { collection: 'methodTombstones', table: 'method_tombstones' },
  { collection: 'explorationTracks', table: 'exploration_tracks' },
]

export class InitialOwnerClaimError extends Error {
  constructor(readonly code: 'target-user-not-found' | 'mixed-ownership', readonly userId: string, readonly before?: OwnerClaimSummary) {
    super(code)
  }
}

export interface MySqlInitialOwnerClaimRepositoryTestHooks {
  beforeCommit?: () => Promise<void> | void
  afterCommit?: () => Promise<void> | void
}

export class MySqlInitialOwnerClaimRepository implements InitialOwnerClaimRepository {
  constructor(private readonly pool: Pool, private readonly hooks?: MySqlInitialOwnerClaimRepositoryTestHooks) {}

  async claimInitialOwner(userId: string): Promise<InitialOwnerClaimResult> {
    const result = await runInMySqlTransaction(this.pool, async connection => {
      const [users] = await connection.query<Array<RowDataPacket & { id: string }>>('SELECT id FROM users WHERE id=? FOR UPDATE', [userId])
      if (!users[0]) throw new InitialOwnerClaimError('target-user-not-found', userId)

      const [claims] = await connection.query<Array<RowDataPacket & { user_id: string }>>('SELECT user_id FROM initial_owner_claims ORDER BY id FOR UPDATE')
      const rows = new Map<OwnedBusinessCollection, Array<string | null>>()
      for (const { collection, table } of collections) {
        const [ownedRows] = await connection.query<Array<RowDataPacket & { owner_user_id: string | null }>>(`SELECT owner_user_id FROM ${table} FOR UPDATE`)
        rows.set(collection, ownedRows.map(row => row.owner_user_id))
      }
      const before = summarize(rows, userId)
      const totals = Object.values(before)
      const hasUnowned = totals.some(value => value.unowned > 0)
      const hasTargetOwned = totals.some(value => value.targetOwned > 0)
      const hasOtherOwned = totals.some(value => value.otherOwned > 0)
      const targetClaimExists = claims.some(claim => claim.user_id === userId)
      const otherClaimExists = claims.some(claim => claim.user_id !== userId)
      if (otherClaimExists || hasOtherOwned || (hasUnowned && hasTargetOwned) || (targetClaimExists && hasUnowned)) {
        throw new InitialOwnerClaimError('mixed-ownership', userId, before)
      }
      if (targetClaimExists) return { status: 'already-claimed' as const, userId, before, after: before }

      if (hasUnowned) {
        for (const { table } of collections) await connection.execute(`UPDATE ${table} SET owner_user_id=? WHERE owner_user_id IS NULL`, [userId])
      }
      await connection.execute('INSERT INTO initial_owner_claims(id,user_id,created_at) VALUES(?,?,UTC_TIMESTAMP(3))', [createId(), userId])
      await this.hooks?.beforeCommit?.()
      const after = await readSummary(connection, userId)
      return { status: 'claimed' as const, userId, before, after }
    })
    await this.hooks?.afterCommit?.()
    return result
  }
}

function collectionSummary(values: Array<string | null>, userId: string): OwnerClaimCollectionSummary {
  return {
    total: values.length,
    unowned: values.filter(value => value === null).length,
    targetOwned: values.filter(value => value === userId).length,
    otherOwned: values.filter(value => value !== null && value !== userId).length,
  }
}

function summarize(rows: Map<OwnedBusinessCollection, Array<string | null>>, userId: string): OwnerClaimSummary {
  return Object.fromEntries(collections.map(({ collection }) => [collection, collectionSummary(rows.get(collection) ?? [], userId)])) as OwnerClaimSummary
}

async function readSummary(connection: PoolConnection, userId: string): Promise<OwnerClaimSummary> {
  const rows = new Map<OwnedBusinessCollection, Array<string | null>>()
  for (const { collection, table } of collections) {
    const [ownedRows] = await connection.query<Array<RowDataPacket & { owner_user_id: string | null }>>(`SELECT owner_user_id FROM ${table}`)
    rows.set(collection, ownedRows.map(row => row.owner_user_id))
  }
  return summarize(rows, userId)
}
