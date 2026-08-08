import type { TrashPurgeEntry, CurrentUserScope } from '@knowledge-base/contracts'
import { businessError } from './errors'
import { runInMySqlTransaction } from './index'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'

type CountRow = RowDataPacket & { count: number }

export class MySqlTrashPurgeRepository {
  constructor(private readonly pool: Pool, private readonly scope?: CurrentUserScope) {}

  async purge(entries: readonly TrashPurgeEntry[]): Promise<void> {
    if (!entries.length) throw businessError('TRASH_EMPTY_SELECTION', '至少选择一条回收站记录')
    const keys = entries.map((entry) => `${entry.type}:${entry.id}`)
    if (new Set(keys).size !== keys.length) throw businessError('TRASH_DUPLICATE_SELECTION', '回收站记录不能重复选择')
    await runInMySqlTransaction(this.pool, async (connection) => {
      for (const entry of [...entries].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`))) {
        if (entry.type === 'item') await this.purgeItem(connection, entry.id)
        else if (entry.type === 'method') await this.purgeMethod(connection, entry.id)
        else if (entry.type === 'exploration-track') await this.purgeTrack(connection, entry.id)
        else throw businessError('TRASH_EMPTY_SELECTION', '回收站记录类型无效')
      }
    })
  }

  private ownerClause(column = 'owner_user_id') { return this.scope ? ` AND ${column}=?` : '' }
  private ownerParams(values: Array<string | number | null>) { return this.scope ? [...values, this.scope.userId] : values }

  private async purgeItem(connection: PoolConnection, id: string) {
    const [items] = await connection.query<Array<RowDataPacket & { id: string }>>(`SELECT id FROM items WHERE id=? AND deleted_at IS NOT NULL${this.ownerClause() } FOR UPDATE`, this.ownerParams([id]))
    if (!items[0]) throw businessError('ITEM_NOT_IN_TRASH', '回收站中不存在该事项')
    const [reviews] = await connection.query<Array<RowDataPacket & { id: string }>>(`SELECT id FROM reviews WHERE item_id=?${this.ownerClause()} FOR UPDATE`, this.ownerParams([id]))
    const reviewIds = reviews.map((row) => row.id)
    const refs = reviewIds.length
      ? `SELECT method_id FROM method_evidence WHERE review_id IN (${reviewIds.map(() => '?').join(',')})${this.ownerClause()} UNION SELECT method_id FROM method_versions WHERE source_review_id IN (${reviewIds.map(() => '?').join(',')})${this.ownerClause()}`
      : ''
    const [applications] = await connection.query<Array<RowDataPacket & { method_id: string }>>(`SELECT method_id FROM method_applications WHERE item_id=?${this.ownerClause()}`, this.ownerParams([id]))
    const [reviewMethods] = refs
      ? await connection.query<Array<RowDataPacket & { method_id: string }>>(refs, this.scope ? [...reviewIds, this.scope.userId, ...reviewIds, this.scope.userId] : [...reviewIds, ...reviewIds])
      : [[]]
    const methodIds = [...new Set([...applications, ...reviewMethods].map((row) => row.method_id))]
    if (reviewIds.length) {
      await connection.query(`DELETE FROM item_links WHERE source_review_id IN (${reviewIds.map(() => '?').join(',')})${this.ownerClause()}`, this.ownerParams(reviewIds))
      await connection.query(`DELETE FROM method_evidence WHERE review_id IN (${reviewIds.map(() => '?').join(',')})${this.ownerClause()}`, this.ownerParams(reviewIds))
    }
    await connection.execute(`DELETE FROM item_links WHERE target_item_id=?${this.ownerClause()}`, this.ownerParams([id]))
    await connection.execute(`DELETE FROM item_status_events WHERE item_id=?${this.ownerClause()}`, this.ownerParams([id]))
    await connection.execute(`DELETE FROM method_applications WHERE item_id=?${this.ownerClause()}`, this.ownerParams([id]))
    if (reviewIds.length) await connection.query(`DELETE FROM reviews WHERE id IN (${reviewIds.map(() => '?').join(',')})${this.ownerClause()}`, this.ownerParams(reviewIds))
    for (const methodId of methodIds) {
      const [[evidence]] = await connection.query<CountRow[]>(`SELECT COUNT(*) count FROM method_evidence WHERE method_id=?${this.ownerClause()}`, this.ownerParams([methodId]))
      const [[apps]] = await connection.query<CountRow[]>(`SELECT COUNT(*) count FROM method_applications WHERE method_id=?${this.ownerClause()}`, this.ownerParams([methodId]))
      if (!evidence?.count && !apps?.count) {
        await connection.execute(`DELETE FROM method_versions WHERE method_id=?${this.ownerClause()}`, this.ownerParams([methodId]))
        await connection.execute(`DELETE FROM methods WHERE id=?${this.ownerClause()}`, this.ownerParams([methodId]))
        await connection.execute(`DELETE FROM method_tombstones WHERE method_id=?${this.ownerClause()}`, this.ownerParams([methodId]))
      } else if (reviewIds.length) {
        await connection.query(`UPDATE method_versions SET source_review_id=NULL WHERE source_review_id IN (${reviewIds.map(() => '?').join(',')}) AND method_id=?${this.ownerClause()}`, this.ownerParams([...reviewIds, methodId]))
      }
    }
    await connection.execute(`DELETE FROM items WHERE id=?${this.ownerClause()}`, this.ownerParams([id]))
  }

  private async purgeMethod(connection: PoolConnection, id: string) {
    const [methods] = await connection.query<Array<RowDataPacket & { id: string; title: string }>>(`SELECT id,title FROM methods WHERE id=? AND deleted_at IS NOT NULL${this.ownerClause()} FOR UPDATE`, this.ownerParams([id]))
    if (!methods[0]) throw businessError('METHOD_NOT_IN_TRASH', '回收站中不存在该方法')
    const [versions] = await connection.query<Array<RowDataPacket & { version: number }>>(`SELECT version FROM method_versions WHERE method_id=?${this.ownerClause()} ORDER BY version ASC FOR UPDATE`, this.ownerParams([id]))
    const [applications] = await connection.query<Array<RowDataPacket & { method_version: number }>>(`SELECT method_version FROM method_applications WHERE method_id=?${this.ownerClause()} FOR UPDATE`, this.ownerParams([id]))
    if (applications.some((app) => !versions.some((version) => version.version === app.method_version))) throw businessError('METHOD_VERSION_HISTORY_UNPROVABLE', '方法应用引用了无法证明的历史版本')
    const [tombstones] = await connection.query<Array<RowDataPacket & { method_id: string }>>(`SELECT method_id FROM method_tombstones WHERE method_id=?${this.ownerClause()} FOR UPDATE`, this.ownerParams([id]))
    if (tombstones[0]) throw businessError('METHOD_TOMBSTONE_ALREADY_EXISTS', '方法永久清理记录已存在')
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '')
    await connection.execute(`INSERT INTO method_tombstones(method_id,title,permanently_deleted_at,created_at,updated_at,versions${this.scope ? ',owner_user_id' : ''}) VALUES(?,?,?,?,?,?${this.scope ? ',?' : ''})`, this.ownerParams([id, methods[0].title, now, now, now, JSON.stringify(versions.map((version) => ({ version: version.version }))) ]))
    await connection.execute(`DELETE FROM method_versions WHERE method_id=?${this.ownerClause()}`, this.ownerParams([id]))
    await connection.execute(`DELETE FROM methods WHERE id=?${this.ownerClause()}`, this.ownerParams([id]))
  }

  private async purgeTrack(connection: PoolConnection, id: string) {
    const [tracks] = await connection.query<Array<RowDataPacket & { id: string }>>(`SELECT id FROM exploration_tracks WHERE id=? AND deleted_at IS NOT NULL${this.ownerClause()} FOR UPDATE`, this.ownerParams([id]))
    if (!tracks[0]) throw businessError('EXPLORATION_TRACK_NOT_FOUND', '回收站中不存在该探索主线')
    const [items] = await connection.query<Array<RowDataPacket & { id: string; deleted_at: string | Date | null }>>(`SELECT id,deleted_at FROM items WHERE exploration_track_id=?${this.ownerClause()} ORDER BY id ASC FOR UPDATE`, this.ownerParams([id]))
    for (const item of items) {
      if (item.deleted_at == null) {
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '')
        await connection.execute(`UPDATE items SET deleted_at=?,exploration_track_cascade_deleted_at=?,updated_at=? WHERE id=?${this.ownerClause()}`, this.ownerParams([timestamp, timestamp, timestamp, item.id]))
      }
      await this.purgeItem(connection, item.id)
    }
    await connection.execute(`DELETE FROM exploration_tracks WHERE id=?${this.ownerClause()}`, this.ownerParams([id]))
  }
}
