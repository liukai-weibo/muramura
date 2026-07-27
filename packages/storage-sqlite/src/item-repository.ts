import type { CreateItemInput, Item, ItemRepository, ItemStatus, ItemStatusEvent, StartItemExecutionInput, UpdateItemContentInput } from '@knowledge-base/contracts'
import { assertTransition, createId } from '@knowledge-base/domain'
import { getRawDatabase, type SqliteKnowledgeDatabase } from './database'

type Row = Record<string, unknown>
const now = () => new Date().toISOString()
const mapItem = (row: Row): Item => ({ id: String(row.id), title: String(row.title), content: String(row.content), status: row.status as ItemStatus, createdAt: String(row.created_at), updatedAt: String(row.updated_at), ...(row.deleted_at == null ? {} : { deletedAt: String(row.deleted_at) }), ...(row.start_action == null ? {} : { startAction: String(row.start_action) }) })
const mapEvent = (row: Row): ItemStatusEvent => ({ id: String(row.id), itemId: String(row.item_id), ...(row.from_status == null ? {} : { fromStatus: row.from_status as ItemStatus }), toStatus: row.to_status as ItemStatus, createdAt: String(row.created_at) })

export class SqliteItemRepository implements ItemRepository {
  constructor(private readonly database: SqliteKnowledgeDatabase) {}
  private get raw() { return getRawDatabase(this.database) }
  private active(id: string): Item {
    const row = this.raw.prepare('SELECT * FROM items WHERE id=?').get(id) as Row | undefined
    if (!row || row.deleted_at != null) throw new Error('事项不存在')
    return mapItem(row)
  }

  async create(input: CreateItemInput): Promise<Item> {
    const title = input.title.trim()
    if (!title) throw new Error('标题不能为空')
    const createdAt = now()
    const result: Item = { id: createId(), title, content: input.content?.trim() ?? '', status: input.status ?? 'idea_to_try', createdAt, updatedAt: createdAt }
    return this.database.runInTransaction(() => {
      this.raw.prepare('INSERT INTO items VALUES(?,?,?,?,?,?,NULL,NULL)').run(result.id, result.title, result.content, result.status, createdAt, createdAt)
      this.raw.prepare('INSERT INTO item_status_events VALUES(?,?,?,?,?)').run(createId(), result.id, null, result.status, createdAt)
      return result
    })
  }

  async getById(id: string): Promise<Item | undefined> { const row = this.raw.prepare('SELECT * FROM items WHERE id=?').get(id) as Row | undefined; return row && mapItem(row) }
  async list(): Promise<Item[]> { return (this.raw.prepare('SELECT * FROM items WHERE deleted_at IS NULL ORDER BY created_at').all() as Row[]).map(mapItem) }
  async listDeleted(): Promise<Item[]> { return (this.raw.prepare('SELECT * FROM items WHERE deleted_at IS NOT NULL ORDER BY deleted_at').all() as Row[]).map(mapItem) }
  async listStatusEvents(itemId: string): Promise<ItemStatusEvent[]> { return (this.raw.prepare('SELECT * FROM item_status_events WHERE item_id=? ORDER BY created_at').all(itemId) as Row[]).map(mapEvent) }

  async changeStatus(id: string, status: ItemStatus): Promise<Item> {
    return this.database.runInTransaction(() => {
      const current = this.active(id)
      assertTransition(current.status, status)
      const updatedAt = now()
      this.raw.prepare('UPDATE items SET status=?, updated_at=? WHERE id=?').run(status, updatedAt, id)
      this.raw.prepare('INSERT INTO item_status_events VALUES(?,?,?,?,?)').run(createId(), id, current.status, status, updatedAt)
      return { ...current, status, updatedAt }
    })
  }

  async startExecution(id: string, input?: StartItemExecutionInput): Promise<Item> {
    return this.database.runInTransaction(() => {
      const current = this.active(id)
      assertTransition(current.status, 'doing')
      if (current.startAction !== undefined) throw new Error('启动动作已存在，不能重写')
      const startAction = input?.startAction?.trim() || undefined
      const updatedAt = now()
      this.raw.prepare('UPDATE items SET status=?, start_action=?, updated_at=? WHERE id=?').run('doing', startAction ?? null, updatedAt, id)
      this.raw.prepare('INSERT INTO item_status_events VALUES(?,?,?,?,?)').run(createId(), id, current.status, 'doing', updatedAt)
      return { ...current, status: 'doing', ...(startAction ? { startAction } : {}), updatedAt }
    })
  }

  async updateContent(id: string, input: UpdateItemContentInput): Promise<Item> {
    return this.database.runInTransaction(() => {
      const current = this.active(id)
      const content = input.content.trim()
      const updatedAt = now()
      this.raw.prepare('UPDATE items SET content=?, updated_at=? WHERE id=?').run(content, updatedAt, id)
      return { ...current, content, updatedAt }
    })
  }

  async delete(id: string): Promise<void> {
    this.database.runInTransaction(() => {
      const row = this.raw.prepare('SELECT deleted_at FROM items WHERE id=?').get(id) as Row | undefined
      if (row && row.deleted_at == null) { const timestamp = now(); this.raw.prepare('UPDATE items SET deleted_at=?,updated_at=? WHERE id=?').run(timestamp, timestamp, id) }
    })
  }

  async restore(id: string): Promise<Item> {
    return this.database.runInTransaction(() => {
      const row = this.raw.prepare('SELECT * FROM items WHERE id=?').get(id) as Row | undefined
      if (!row || row.deleted_at == null) throw new Error('回收站中不存在该事项')
      const current = mapItem(row)
      const updatedAt = now()
      this.raw.prepare('UPDATE items SET deleted_at=NULL,updated_at=? WHERE id=?').run(updatedAt, id)
      delete current.deletedAt
      return { ...current, updatedAt }
    })
  }

  async purgeDeletedBefore(cutoff: string): Promise<void> {
    this.database.runInTransaction(() => {
      const rows = this.raw.prepare('SELECT id FROM items WHERE deleted_at IS NOT NULL AND deleted_at<=?').all(cutoff) as Row[]
      for (const row of rows) {
        const itemId = String(row.id)
        const reviewIds = (this.raw.prepare('SELECT id FROM reviews WHERE item_id=?').all(itemId) as Row[]).map(review => String(review.id))
        const placeholders = reviewIds.map(() => '?').join(',')
        const affectedMethodIds = new Set<string>()
        if (reviewIds.length) {
          for (const evidence of this.raw.prepare(`SELECT method_id FROM method_evidence WHERE review_id IN (${placeholders})`).all(...reviewIds) as Row[]) affectedMethodIds.add(String(evidence.method_id))
          this.raw.prepare(`DELETE FROM item_links WHERE source_review_id IN (${placeholders})`).run(...reviewIds)
          this.raw.prepare(`DELETE FROM method_evidence WHERE review_id IN (${placeholders})`).run(...reviewIds)
          this.raw.prepare(`UPDATE method_versions SET source_review_id=NULL WHERE source_review_id IN (${placeholders})`).run(...reviewIds)
        }
        for (const application of this.raw.prepare('SELECT method_id FROM method_applications WHERE item_id=?').all(itemId) as Row[]) affectedMethodIds.add(String(application.method_id))
        this.raw.prepare('DELETE FROM item_links WHERE target_item_id=?').run(itemId)
        this.raw.prepare('DELETE FROM method_applications WHERE item_id=?').run(itemId)
        this.raw.prepare('DELETE FROM item_status_events WHERE item_id=?').run(itemId)
        this.raw.prepare('DELETE FROM reviews WHERE item_id=?').run(itemId)
        this.raw.prepare('DELETE FROM items WHERE id=?').run(itemId)
        for (const methodId of affectedMethodIds) {
          const hasEvidence = this.raw.prepare('SELECT 1 FROM method_evidence WHERE method_id=?').get(methodId)
          const hasApplication = this.raw.prepare('SELECT 1 FROM method_applications WHERE method_id=?').get(methodId)
          if (!hasEvidence && !hasApplication) this.raw.prepare('DELETE FROM method_tombstones WHERE method_id=?').run(methodId)
        }
      }
    })
  }
}
