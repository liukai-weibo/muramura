import type { CreateItemInput, Item, ItemRepository, ItemStatus, ItemStatusEvent, StartItemExecutionInput, UpdateItemContentInput } from '@knowledge-base/contracts'
import { assertTransition, createId } from '@knowledge-base/domain'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { runInMySqlTransaction } from './index'

type ItemRow = RowDataPacket & {
  id: string; title: string; content: string; status: ItemStatus; start_action: string | null
  created_at: string | Date; updated_at: string | Date; deleted_at: string | Date | null
}
type EventRow = RowDataPacket & { id: string; item_id: string; from_status: ItemStatus | null; to_status: ItemStatus; created_at: string | Date }

const now = () => new Date().toISOString()
const mysqlDateTime = (value: string) => value.replace('T', ' ').replace('Z', '')
const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`
const mapItem = (row: ItemRow): Item => ({
  id: row.id, title: row.title, content: row.content, status: row.status,
  createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  ...(row.deleted_at == null ? {} : { deletedAt: iso(row.deleted_at) }),
  ...(row.start_action == null ? {} : { startAction: row.start_action }),
})
const mapEvent = (row: EventRow): ItemStatusEvent => ({
  id: row.id, itemId: row.item_id, ...(row.from_status == null ? {} : { fromStatus: row.from_status }), toStatus: row.to_status, createdAt: iso(row.created_at),
})

export interface MySqlItemRepositoryTestHooks {
  beforeStatusEventInsert?: () => Promise<void> | void
  beforePurgeTransaction?: () => Promise<void> | void
  beforePurgeDeleteItem?: () => Promise<void> | void
}

export class MySqlItemRepository implements ItemRepository {
  constructor(private readonly pool: Pool, private readonly hooks?: MySqlItemRepositoryTestHooks) {}

  async create(input: CreateItemInput): Promise<Item> {
    const createdAt = now()
    const item: Item = { id: createId(), title: input.title.trim(), content: input.content?.trim() ?? '', status: input.status ?? 'idea_to_try', createdAt, updatedAt: createdAt }
    if (!item.title) throw new Error('标题不能为空')
    await runInMySqlTransaction(this.pool, async connection => {
      await connection.execute('INSERT INTO items(id,title,content,status,start_action,created_at,updated_at,deleted_at) VALUES(?,?,?,?,NULL,?,?,NULL)', [item.id, item.title, item.content, item.status, mysqlDateTime(createdAt), mysqlDateTime(createdAt)])
      await this.insertEvent(connection, item.id, undefined, item.status, createdAt)
    })
    return item
  }

  async getById(id: string): Promise<Item | undefined> {
    const [rows] = await this.pool.query<ItemRow[]>('SELECT * FROM items WHERE id=?', [id])
    return rows[0] ? mapItem(rows[0]) : undefined
  }

  async list(): Promise<Item[]> {
    const [rows] = await this.pool.query<ItemRow[]>('SELECT * FROM items WHERE deleted_at IS NULL ORDER BY created_at ASC,id ASC')
    return rows.map(mapItem)
  }

  async listDeleted(): Promise<Item[]> {
    const [rows] = await this.pool.query<ItemRow[]>('SELECT * FROM items WHERE deleted_at IS NOT NULL ORDER BY deleted_at ASC,id ASC')
    return rows.map(mapItem)
  }

  async listStatusEvents(itemId: string): Promise<ItemStatusEvent[]> {
    const [rows] = await this.pool.query<EventRow[]>('SELECT * FROM item_status_events WHERE item_id=? ORDER BY created_at ASC,id ASC', [itemId])
    return rows.map(mapEvent)
  }

  async changeStatus(id: string, status: ItemStatus): Promise<Item> {
    return runInMySqlTransaction(this.pool, async connection => {
      const current = await this.lockActive(connection, id)
      assertTransition(current.status, status)
      const updatedAt = now()
      await connection.execute('UPDATE items SET status=?,updated_at=? WHERE id=?', [status, mysqlDateTime(updatedAt), id])
      await this.insertEvent(connection, id, current.status, status, updatedAt)
      return { ...current, status, updatedAt }
    })
  }

  async startExecution(id: string, input?: StartItemExecutionInput): Promise<Item> {
    return runInMySqlTransaction(this.pool, async connection => {
      const current = await this.lockActive(connection, id)
      assertTransition(current.status, 'doing')
      if (current.startAction !== undefined) throw new Error('启动动作已存在，不能重写')
      const startAction = input?.startAction?.trim() || undefined
      const updatedAt = now()
      await connection.execute('UPDATE items SET status=?,start_action=?,updated_at=? WHERE id=?', ['doing', startAction ?? null, mysqlDateTime(updatedAt), id])
      await this.insertEvent(connection, id, current.status, 'doing', updatedAt)
      return { ...current, status: 'doing', ...(startAction === undefined ? {} : { startAction }), updatedAt }
    })
  }

  async updateContent(id: string, input: UpdateItemContentInput): Promise<Item> {
    return runInMySqlTransaction(this.pool, async connection => {
      const current = await this.lockActive(connection, id)
      const content = input.content.trim()
      const updatedAt = now()
      await connection.execute('UPDATE items SET content=?,updated_at=? WHERE id=?', [content, mysqlDateTime(updatedAt), id])
      return { ...current, content, updatedAt }
    })
  }

  async delete(id: string): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      const current = await this.lock(connection, id)
      if (!current || current.deletedAt) return
      const updatedAt = now()
      await connection.execute('UPDATE items SET deleted_at=?,updated_at=? WHERE id=?', [mysqlDateTime(updatedAt), mysqlDateTime(updatedAt), id])
    })
  }

  async restore(id: string): Promise<Item> {
    return runInMySqlTransaction(this.pool, async connection => {
      const current = await this.lock(connection, id)
      if (!current?.deletedAt) throw new Error('回收站中不存在该事项')
      const updatedAt = now()
      await connection.execute('UPDATE items SET deleted_at=NULL,updated_at=? WHERE id=?', [mysqlDateTime(updatedAt), id])
      const { deletedAt: _deletedAt, ...restored } = current
      return { ...restored, updatedAt }
    })
  }

  async purgeDeletedBefore(cutoff: string): Promise<void> {
    await this.hooks?.beforePurgeTransaction?.()
    await runInMySqlTransaction(this.pool, async connection => {
      const [candidates] = await connection.query<Array<RowDataPacket & { id: string }>>('SELECT id FROM items WHERE deleted_at IS NOT NULL AND deleted_at<=? FOR UPDATE', [mysqlDateTime(cutoff)])
      if (!candidates.length) return
      for (const { id } of candidates) await this.purgeLockedItem(connection, id)
    })
  }

  private async purgeLockedItem(connection: PoolConnection, itemId: string): Promise<void> {
    const [reviews] = await connection.query<Array<RowDataPacket & { id: string }>>('SELECT id FROM reviews WHERE item_id=? FOR UPDATE', [itemId])
    const reviewIds = reviews.map(review => review.id)
    const [applicationReferences] = await connection.query<Array<RowDataPacket & { method_id: string }>>('SELECT method_id FROM method_applications WHERE item_id=?', [itemId])
    const evidenceReferences = await this.rowsByReviewIds(connection, 'method_evidence', 'review_id', reviewIds, false)
    const versionReferences = await this.rowsByReviewIds(connection, 'method_versions', 'source_review_id', reviewIds, false)
    const affectedMethodIds = [...new Set([
      ...applicationReferences.map(application => application.method_id),
      ...evidenceReferences.map(row => row.method_id),
      ...versionReferences.map(row => row.method_id),
    ])]

    if (affectedMethodIds.length) {
      await connection.query(`SELECT id FROM methods WHERE id IN (${affectedMethodIds.map(() => '?').join(',')}) ORDER BY id ASC FOR UPDATE`, affectedMethodIds)
    }
    const [applications] = await connection.query<Array<RowDataPacket & { id: string; method_id: string }>>('SELECT id,method_id FROM method_applications WHERE item_id=? FOR UPDATE', [itemId])
    const evidence = await this.rowsByReviewIds(connection, 'method_evidence', 'review_id', reviewIds, true)
    const versionsWithDeletedSource = await this.rowsByReviewIds(connection, 'method_versions', 'source_review_id', reviewIds, true)
    if (affectedMethodIds.length) {
      await connection.query(`SELECT method_id FROM method_tombstones WHERE method_id IN (${affectedMethodIds.map(() => '?').join(',')}) ORDER BY method_id ASC FOR UPDATE`, affectedMethodIds)
    }
    if (reviewIds.length) await connection.query(`DELETE FROM item_links WHERE source_review_id IN (${reviewIds.map(() => '?').join(',')})`, reviewIds)
    await connection.execute('DELETE FROM item_links WHERE target_item_id=?', [itemId])
    await connection.execute('DELETE FROM item_status_events WHERE item_id=?', [itemId])
    await connection.execute('DELETE FROM method_applications WHERE item_id=?', [itemId])
    if (reviewIds.length) await connection.query(`DELETE FROM method_evidence WHERE review_id IN (${reviewIds.map(() => '?').join(',')})`, reviewIds)

    for (const methodId of affectedMethodIds) {
      const [[evidenceCount]] = await connection.query<Array<RowDataPacket & { count: number }>>('SELECT COUNT(*) AS count FROM method_evidence WHERE method_id=? FOR UPDATE', [methodId])
      const [[applicationCount]] = await connection.query<Array<RowDataPacket & { count: number }>>('SELECT COUNT(*) AS count FROM method_applications WHERE method_id=? FOR UPDATE', [methodId])
      if ((evidenceCount?.count ?? 0) === 0 && (applicationCount?.count ?? 0) === 0) {
        await connection.execute('DELETE FROM method_versions WHERE method_id=?', [methodId])
        await connection.execute('DELETE FROM methods WHERE id=?', [methodId])
      } else if (reviewIds.length) {
        await connection.query(`UPDATE method_versions SET source_review_id=NULL WHERE source_review_id IN (${reviewIds.map(() => '?').join(',')}) AND method_id=?`, [...reviewIds, methodId])
      }
    }

    if (affectedMethodIds.length) {
      const [tombstones] = await connection.query<Array<RowDataPacket & { method_id: string }>>(`SELECT method_id FROM method_tombstones WHERE method_id IN (${affectedMethodIds.map(() => '?').join(',')}) FOR UPDATE`, affectedMethodIds)
      for (const tombstone of tombstones) {
        const [[evidenceCount]] = await connection.query<Array<RowDataPacket & { count: number }>>('SELECT COUNT(*) AS count FROM method_evidence WHERE method_id=? FOR UPDATE', [tombstone.method_id])
        const [[applicationCount]] = await connection.query<Array<RowDataPacket & { count: number }>>('SELECT COUNT(*) AS count FROM method_applications WHERE method_id=? FOR UPDATE', [tombstone.method_id])
        if ((evidenceCount?.count ?? 0) === 0 && (applicationCount?.count ?? 0) === 0) await connection.execute('DELETE FROM method_tombstones WHERE method_id=?', [tombstone.method_id])
      }
    }
    if (reviewIds.length) await connection.query(`DELETE FROM reviews WHERE id IN (${reviewIds.map(() => '?').join(',')})`, reviewIds)
    await this.hooks?.beforePurgeDeleteItem?.()
    await connection.execute('DELETE FROM items WHERE id=?', [itemId])
  }

  private async rowsByReviewIds(connection: PoolConnection, table: 'method_evidence' | 'method_versions', column: 'review_id' | 'source_review_id', reviewIds: string[], lock: boolean): Promise<Array<RowDataPacket & { method_id: string }>> {
    if (!reviewIds.length) return []
    const [rows] = await connection.query<Array<RowDataPacket & { method_id: string }>>(`SELECT method_id FROM ${table} WHERE ${column} IN (${reviewIds.map(() => '?').join(',')})${lock ? ' FOR UPDATE' : ''}`, reviewIds)
    return rows
  }

  private async lockActive(connection: PoolConnection, id: string): Promise<Item> {
    const item = await this.lock(connection, id)
    if (!item || item.deletedAt) throw new Error('事项不存在')
    return item
  }

  private async lock(connection: PoolConnection, id: string): Promise<Item | undefined> {
    const [rows] = await connection.query<ItemRow[]>('SELECT * FROM items WHERE id=? FOR UPDATE', [id])
    return rows[0] ? mapItem(rows[0]) : undefined
  }

  private async insertEvent(connection: PoolConnection, itemId: string, fromStatus: ItemStatus | undefined, toStatus: ItemStatus, createdAt: string): Promise<void> {
    await this.hooks?.beforeStatusEventInsert?.()
    await connection.execute('INSERT INTO item_status_events(id,item_id,from_status,to_status,created_at) VALUES(?,?,?,?,?)', [createId(), itemId, fromStatus ?? null, toStatus, mysqlDateTime(createdAt)])
  }
}
