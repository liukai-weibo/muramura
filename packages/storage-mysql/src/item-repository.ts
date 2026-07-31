import type { CreateItemInput, CurrentUserScope, Item, ItemRepository, ItemStatus, ItemStatusEvent, StartItemExecutionInput, UpdateItemContentInput } from '@knowledge-base/contracts'
import { assertItemTitleLength, assertTransition, createId, normalizeItemTitle } from '@knowledge-base/domain'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { businessError } from './errors'
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
  constructor(private readonly pool: Pool, private readonly hooks?: MySqlItemRepositoryTestHooks, private readonly scope?: CurrentUserScope) {}
  private get owner(): string | undefined { return this.scope?.userId }

  async create(input: CreateItemInput): Promise<Item> {
    const createdAt = now()
    const item: Item = { id: createId(), title: normalizeItemTitle(input.title), content: input.content?.trim() ?? '', status: input.status ?? 'idea_to_try', createdAt, updatedAt: createdAt }
    if (!item.title) throw businessError('ITEM_TITLE_REQUIRED', 'validation', '标题不能为空')
    await runInMySqlTransaction(this.pool, async connection => {
      assertItemTitleLength(item.title)
      await connection.execute(
        this.owner ? 'INSERT INTO items(id,title,content,status,start_action,created_at,updated_at,deleted_at,owner_user_id) VALUES(?,?,?,?,NULL,?,?,NULL,?)' : 'INSERT INTO items(id,title,content,status,start_action,created_at,updated_at,deleted_at) VALUES(?,?,?,?,NULL,?,?,NULL)',
        this.owner ? [item.id, item.title, item.content, item.status, mysqlDateTime(createdAt), mysqlDateTime(createdAt), this.owner] : [item.id, item.title, item.content, item.status, mysqlDateTime(createdAt), mysqlDateTime(createdAt)],
      )
      await this.insertEvent(connection, item.id, undefined, item.status, createdAt)
    })
    return item
  }

  async getById(id: string): Promise<Item | undefined> {
    const [rows] = await this.pool.query<ItemRow[]>(this.owner ? 'SELECT * FROM items WHERE id=? AND owner_user_id=?' : 'SELECT * FROM items WHERE id=?', this.owner ? [id, this.owner] : [id])
    return rows[0] ? mapItem(rows[0]) : undefined
  }

  async list(): Promise<Item[]> {
    const [rows] = await this.pool.query<ItemRow[]>(this.owner ? 'SELECT * FROM items WHERE deleted_at IS NULL AND owner_user_id=? ORDER BY created_at ASC,id ASC' : 'SELECT * FROM items WHERE deleted_at IS NULL ORDER BY created_at ASC,id ASC', this.owner ? [this.owner] : [])
    return rows.map(mapItem)
  }

  async listDeleted(): Promise<Item[]> {
    const [rows] = await this.pool.query<ItemRow[]>(this.owner ? 'SELECT * FROM items WHERE deleted_at IS NOT NULL AND owner_user_id=? ORDER BY deleted_at ASC,id ASC' : 'SELECT * FROM items WHERE deleted_at IS NOT NULL ORDER BY deleted_at ASC,id ASC', this.owner ? [this.owner] : [])
    return rows.map(mapItem)
  }

  async listStatusEvents(itemId: string): Promise<ItemStatusEvent[]> {
    if (this.owner && !(await this.getById(itemId))) throw new Error('事项不存在')
    const [rows] = await this.pool.query<EventRow[]>(this.owner ? 'SELECT e.* FROM item_status_events e JOIN items i ON i.id=e.item_id WHERE e.item_id=? AND i.owner_user_id=? ORDER BY e.created_at ASC,e.id ASC' : 'SELECT * FROM item_status_events WHERE item_id=? ORDER BY created_at ASC,id ASC', this.owner ? [itemId, this.owner] : [itemId])
    return rows.map(mapEvent)
  }

  async changeStatus(id: string, status: ItemStatus): Promise<Item> {
    return runInMySqlTransaction(this.pool, async connection => {
      const current = await this.lockActive(connection, id)
      assertTransition(current.status, status)
      const updatedAt = now()
      await connection.execute(this.owner ? 'UPDATE items SET status=?,updated_at=? WHERE id=? AND owner_user_id=?' : 'UPDATE items SET status=?,updated_at=? WHERE id=?', this.owner ? [status, mysqlDateTime(updatedAt), id, this.owner] : [status, mysqlDateTime(updatedAt), id])
      await this.insertEvent(connection, id, current.status, status, updatedAt)
      return { ...current, status, updatedAt }
    })
  }

  async startExecution(id: string, input?: StartItemExecutionInput): Promise<Item> {
    return runInMySqlTransaction(this.pool, async connection => {
      const current = await this.lockActive(connection, id)
      assertTransition(current.status, 'doing')
      const startAction = input?.startAction?.trim() || undefined
      const overwrite = current.startAction !== undefined && startAction !== undefined && startAction !== current.startAction
      if (current.startAction !== undefined && (!overwrite || input?.overwriteExistingStartAction !== true)) {
        throw businessError(
          'ITEM_START_ACTION_ALREADY_EXISTS',
          'conflict',
          '启动动作已存在，不能重写',
        )
      }
      const updatedAt = now()
      await connection.execute(this.owner ? 'UPDATE items SET status=?,start_action=?,updated_at=? WHERE id=? AND owner_user_id=?' : 'UPDATE items SET status=?,start_action=?,updated_at=? WHERE id=?', this.owner ? ['doing', startAction ?? null, mysqlDateTime(updatedAt), id, this.owner] : ['doing', startAction ?? null, mysqlDateTime(updatedAt), id])
      await this.insertEvent(connection, id, current.status, 'doing', updatedAt)
      return { ...current, status: 'doing', ...(startAction === undefined ? {} : { startAction }), updatedAt }
    })
  }

  async updateContent(id: string, input: UpdateItemContentInput): Promise<Item> {
    return runInMySqlTransaction(this.pool, async connection => {
      const current = await this.lockActive(connection, id)
      const content = input.content.trim()
      const updatedAt = now()
      await connection.execute(this.owner ? 'UPDATE items SET content=?,updated_at=? WHERE id=? AND owner_user_id=?' : 'UPDATE items SET content=?,updated_at=? WHERE id=?', this.owner ? [content, mysqlDateTime(updatedAt), id, this.owner] : [content, mysqlDateTime(updatedAt), id])
      return { ...current, content, updatedAt }
    })
  }

  async delete(id: string): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      const current = await this.lock(connection, id)
      if (!current) throw new Error('事项不存在')
      if (current.deletedAt) return
      const updatedAt = now()
      await connection.execute(this.owner ? 'UPDATE items SET deleted_at=?,updated_at=? WHERE id=? AND owner_user_id=?' : 'UPDATE items SET deleted_at=?,updated_at=? WHERE id=?', this.owner ? [mysqlDateTime(updatedAt),mysqlDateTime(updatedAt),id,this.owner] : [mysqlDateTime(updatedAt),mysqlDateTime(updatedAt),id])
    })
  }

  async restore(id: string): Promise<Item> {
    return runInMySqlTransaction(this.pool, async connection => {
      const current = await this.lock(connection, id)
      if (!current?.deletedAt) {
        throw businessError('ITEM_NOT_IN_TRASH', 'not-found', '回收站中不存在该事项')
      }
      const updatedAt = now()
      await connection.execute(this.owner ? 'UPDATE items SET deleted_at=NULL,updated_at=? WHERE id=? AND owner_user_id=?' : 'UPDATE items SET deleted_at=NULL,updated_at=? WHERE id=?', this.owner ? [mysqlDateTime(updatedAt),id,this.owner] : [mysqlDateTime(updatedAt),id])
      const { deletedAt: _deletedAt, ...restored } = current
      return { ...restored, updatedAt }
    })
  }

  async purgeDeletedBefore(cutoff: string): Promise<void> {
    await this.hooks?.beforePurgeTransaction?.()
    await runInMySqlTransaction(this.pool, async connection => {
      const [candidates] = await connection.query<Array<RowDataPacket & { id: string }>>(this.owner ? 'SELECT id FROM items WHERE deleted_at IS NOT NULL AND deleted_at<=? AND owner_user_id=? FOR UPDATE' : 'SELECT id FROM items WHERE deleted_at IS NOT NULL AND deleted_at<=? FOR UPDATE', this.owner ? [mysqlDateTime(cutoff),this.owner] : [mysqlDateTime(cutoff)])
      if (!candidates.length) return
      for (const { id } of candidates) await this.purgeLockedItem(connection, id)
    })
  }

  private async purgeLockedItem(connection: PoolConnection, itemId: string): Promise<void> {
    const [reviews] = await connection.query<Array<RowDataPacket & { id: string }>>(this.owner ? 'SELECT id FROM reviews WHERE item_id=? AND owner_user_id=? FOR UPDATE' : 'SELECT id FROM reviews WHERE item_id=? FOR UPDATE', this.owner ? [itemId, this.owner] : [itemId])
    const reviewIds = reviews.map(review => review.id)
    const [applicationReferences] = await connection.query<Array<RowDataPacket & { method_id: string }>>(this.owner ? 'SELECT method_id FROM method_applications WHERE item_id=? AND owner_user_id=?' : 'SELECT method_id FROM method_applications WHERE item_id=?', this.owner ? [itemId, this.owner] : [itemId])
    const evidenceReferences = await this.rowsByReviewIds(connection, 'method_evidence', 'review_id', reviewIds, false)
    const versionReferences = await this.rowsByReviewIds(connection, 'method_versions', 'source_review_id', reviewIds, false)
    const affectedMethodIds = [...new Set([
      ...applicationReferences.map(application => application.method_id),
      ...evidenceReferences.map(row => row.method_id),
      ...versionReferences.map(row => row.method_id),
    ])]

    if (affectedMethodIds.length) {
      await connection.query(`SELECT id FROM methods WHERE id IN (${affectedMethodIds.map(() => '?').join(',')})${this.owner ? ' AND owner_user_id=?' : ''} ORDER BY id ASC FOR UPDATE`, this.owner ? [...affectedMethodIds, this.owner] : affectedMethodIds)
    }
    const [applications] = await connection.query<Array<RowDataPacket & { id: string; method_id: string }>>(this.owner ? 'SELECT id,method_id FROM method_applications WHERE item_id=? AND owner_user_id=? FOR UPDATE' : 'SELECT id,method_id FROM method_applications WHERE item_id=? FOR UPDATE', this.owner ? [itemId, this.owner] : [itemId])
    const evidence = await this.rowsByReviewIds(connection, 'method_evidence', 'review_id', reviewIds, true)
    const versionsWithDeletedSource = await this.rowsByReviewIds(connection, 'method_versions', 'source_review_id', reviewIds, true)
    if (affectedMethodIds.length) {
      await connection.query(`SELECT method_id FROM method_tombstones WHERE method_id IN (${affectedMethodIds.map(() => '?').join(',')})${this.owner ? ' AND owner_user_id=?' : ''} ORDER BY method_id ASC FOR UPDATE`, this.owner ? [...affectedMethodIds, this.owner] : affectedMethodIds)
    }
    if (reviewIds.length) await connection.query(`DELETE FROM item_links WHERE source_review_id IN (${reviewIds.map(() => '?').join(',')})${this.owner ? ' AND owner_user_id=?' : ''}`, this.owner ? [...reviewIds, this.owner] : reviewIds)
    await connection.execute(this.owner ? 'DELETE FROM item_links WHERE target_item_id=? AND owner_user_id=?' : 'DELETE FROM item_links WHERE target_item_id=?', this.owner ? [itemId, this.owner] : [itemId])
    await connection.execute(this.owner ? 'DELETE FROM item_status_events WHERE item_id=? AND owner_user_id=?' : 'DELETE FROM item_status_events WHERE item_id=?', this.owner ? [itemId, this.owner] : [itemId])
    await connection.execute(this.owner ? 'DELETE FROM method_applications WHERE item_id=? AND owner_user_id=?' : 'DELETE FROM method_applications WHERE item_id=?', this.owner ? [itemId, this.owner] : [itemId])
    if (reviewIds.length) await connection.query(`DELETE FROM method_evidence WHERE review_id IN (${reviewIds.map(() => '?').join(',')})${this.owner ? ' AND owner_user_id=?' : ''}`, this.owner ? [...reviewIds, this.owner] : reviewIds)

    for (const methodId of affectedMethodIds) {
      const [[evidenceCount]] = await connection.query<Array<RowDataPacket & { count: number }>>(this.owner ? 'SELECT COUNT(*) AS count FROM method_evidence WHERE method_id=? AND owner_user_id=? FOR UPDATE' : 'SELECT COUNT(*) AS count FROM method_evidence WHERE method_id=? FOR UPDATE', this.owner ? [methodId, this.owner] : [methodId])
      const [[applicationCount]] = await connection.query<Array<RowDataPacket & { count: number }>>(this.owner ? 'SELECT COUNT(*) AS count FROM method_applications WHERE method_id=? AND owner_user_id=? FOR UPDATE' : 'SELECT COUNT(*) AS count FROM method_applications WHERE method_id=? FOR UPDATE', this.owner ? [methodId, this.owner] : [methodId])
      if ((evidenceCount?.count ?? 0) === 0 && (applicationCount?.count ?? 0) === 0) {
        await connection.execute(this.owner ? 'DELETE FROM method_versions WHERE method_id=? AND owner_user_id=?' : 'DELETE FROM method_versions WHERE method_id=?', this.owner ? [methodId, this.owner] : [methodId])
        await connection.execute(this.owner ? 'DELETE FROM methods WHERE id=? AND owner_user_id=?' : 'DELETE FROM methods WHERE id=?', this.owner ? [methodId, this.owner] : [methodId])
      } else if (reviewIds.length) {
        await connection.query(`UPDATE method_versions SET source_review_id=NULL WHERE source_review_id IN (${reviewIds.map(() => '?').join(',')}) AND method_id=?${this.owner ? ' AND owner_user_id=?' : ''}`, this.owner ? [...reviewIds, methodId, this.owner] : [...reviewIds, methodId])
      }
    }

    if (affectedMethodIds.length) {
      const [tombstones] = await connection.query<Array<RowDataPacket & { method_id: string }>>(`SELECT method_id FROM method_tombstones WHERE method_id IN (${affectedMethodIds.map(() => '?').join(',')})${this.owner ? ' AND owner_user_id=?' : ''} FOR UPDATE`, this.owner ? [...affectedMethodIds, this.owner] : affectedMethodIds)
      for (const tombstone of tombstones) {
        const [[evidenceCount]] = await connection.query<Array<RowDataPacket & { count: number }>>(this.owner ? 'SELECT COUNT(*) AS count FROM method_evidence WHERE method_id=? AND owner_user_id=? FOR UPDATE' : 'SELECT COUNT(*) AS count FROM method_evidence WHERE method_id=? FOR UPDATE', this.owner ? [tombstone.method_id, this.owner] : [tombstone.method_id])
        const [[applicationCount]] = await connection.query<Array<RowDataPacket & { count: number }>>(this.owner ? 'SELECT COUNT(*) AS count FROM method_applications WHERE method_id=? AND owner_user_id=? FOR UPDATE' : 'SELECT COUNT(*) AS count FROM method_applications WHERE method_id=? FOR UPDATE', this.owner ? [tombstone.method_id, this.owner] : [tombstone.method_id])
        if ((evidenceCount?.count ?? 0) === 0 && (applicationCount?.count ?? 0) === 0) await connection.execute(this.owner ? 'DELETE FROM method_tombstones WHERE method_id=? AND owner_user_id=?' : 'DELETE FROM method_tombstones WHERE method_id=?', this.owner ? [tombstone.method_id, this.owner] : [tombstone.method_id])
      }
    }
    if (reviewIds.length) await connection.query(`DELETE FROM reviews WHERE id IN (${reviewIds.map(() => '?').join(',')})${this.owner ? ' AND owner_user_id=?' : ''}`, this.owner ? [...reviewIds, this.owner] : reviewIds)
    await this.hooks?.beforePurgeDeleteItem?.()
    await connection.execute(this.owner ? 'DELETE FROM items WHERE id=? AND owner_user_id=?' : 'DELETE FROM items WHERE id=?', this.owner ? [itemId, this.owner] : [itemId])
  }

  private async rowsByReviewIds(connection: PoolConnection, table: 'method_evidence' | 'method_versions', column: 'review_id' | 'source_review_id', reviewIds: string[], lock: boolean): Promise<Array<RowDataPacket & { method_id: string }>> {
    if (!reviewIds.length) return []
    const [rows] = await connection.query<Array<RowDataPacket & { method_id: string }>>(`SELECT method_id FROM ${table} WHERE ${column} IN (${reviewIds.map(() => '?').join(',')})${this.owner ? ' AND owner_user_id=?' : ''}${lock ? ' FOR UPDATE' : ''}`, this.owner ? [...reviewIds, this.owner] : reviewIds)
    return rows
  }

  private async lockActive(connection: PoolConnection, id: string): Promise<Item> {
    const item = await this.lock(connection, id)
    if (!item || item.deletedAt) {
      throw businessError('ITEM_NOT_FOUND', 'not-found', '事项不存在')
    }
    return item
  }

  private async lock(connection: PoolConnection, id: string): Promise<Item | undefined> {
    const [rows] = await connection.query<ItemRow[]>(this.owner ? 'SELECT * FROM items WHERE id=? AND owner_user_id=? FOR UPDATE' : 'SELECT * FROM items WHERE id=? FOR UPDATE', this.owner ? [id, this.owner] : [id])
    return rows[0] ? mapItem(rows[0]) : undefined
  }

  private async insertEvent(connection: PoolConnection, itemId: string, fromStatus: ItemStatus | undefined, toStatus: ItemStatus, createdAt: string): Promise<void> {
    await this.hooks?.beforeStatusEventInsert?.()
    await connection.execute(
      this.owner ? 'INSERT INTO item_status_events(id,item_id,from_status,to_status,created_at,owner_user_id) VALUES(?,?,?,?,?,?)' : 'INSERT INTO item_status_events(id,item_id,from_status,to_status,created_at) VALUES(?,?,?,?,?)',
      this.owner ? [createId(), itemId, fromStatus ?? null, toStatus, mysqlDateTime(createdAt), this.owner] : [createId(), itemId, fromStatus ?? null, toStatus, mysqlDateTime(createdAt)],
    )
  }
}
