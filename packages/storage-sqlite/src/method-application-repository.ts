import type { CreateMethodApplicationInput, Item, ItemMethodSourceDisplay, Method, MethodApplication, MethodApplicationContext, MethodApplicationContextResult, MethodApplicationRepository, MethodTombstone, MethodVersion } from '@knowledge-base/contracts'
import { createId } from '@knowledge-base/domain'
import { getRawDatabase, type SqliteKnowledgeDatabase } from './database'

type Row = Record<string, unknown>
const now = () => new Date().toISOString()
const optional = (value: unknown) => value == null ? undefined : String(value)
const mapItem = (row: Row): Item => ({ id: String(row.id), title: String(row.title), content: String(row.content), status: row.status as Item['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at), ...(optional(row.deleted_at) ? { deletedAt: optional(row.deleted_at) } : {}), ...(optional(row.start_action) ? { startAction: optional(row.start_action) } : {}) })
const mapMethod = (row: Row): Method => ({ id: String(row.id), title: String(row.title), applicable: String(row.applicable), unsuitable: String(row.unsuitable), steps: String(row.steps), validationCount: Number(row.validation_count), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at), ...(optional(row.deleted_at) ? { deletedAt: optional(row.deleted_at) } : {}) })
const mapVersion = (row: Row): MethodVersion => ({ id: String(row.id), methodId: String(row.method_id), version: Number(row.version), title: String(row.title), applicable: String(row.applicable), unsuitable: String(row.unsuitable), steps: String(row.steps), ...(optional(row.source_review_id) ? { sourceReviewId: optional(row.source_review_id) } : {}), createdAt: String(row.created_at) })
const mapApplication = (row: Row): MethodApplication => ({ id: String(row.id), methodId: String(row.method_id), methodVersion: Number(row.method_version), itemId: String(row.item_id), createdAt: String(row.created_at) })
const mapTombstone = (row: Row): MethodTombstone => ({ methodId: String(row.method_id), title: String(row.title), permanentlyDeletedAt: String(row.permanently_deleted_at), versions: JSON.parse(String(row.versions_json)) })

export class SqliteMethodApplicationRepository implements MethodApplicationRepository {
  constructor(private readonly database: SqliteKnowledgeDatabase) {}
  private get raw() { return getRawDatabase(this.database) }

  async createItem(input: CreateMethodApplicationInput): Promise<Item> {
    return this.database.runInTransaction(() => {
      const methodRow = this.raw.prepare('SELECT * FROM methods WHERE id=?').get(input.methodId) as Row | undefined
      if (!methodRow || methodRow.deleted_at != null) throw new Error('选择的方法不存在')
      const title = input.title.trim()
      if (!title) throw new Error('标题不能为空')
      const createdAt = now()
      const item: Item = { id: createId(), title, content: input.content?.trim() ?? '', status: 'idea_to_try', createdAt, updatedAt: createdAt }
      const method = mapMethod(methodRow)
      this.raw.prepare('INSERT INTO items VALUES(?,?,?,?,?,?,NULL,NULL)').run(item.id, item.title, item.content, item.status, createdAt, createdAt)
      this.raw.prepare('INSERT INTO item_status_events VALUES(?,?,?,?,?)').run(createId(), item.id, null, item.status, createdAt)
      this.raw.prepare('INSERT INTO method_applications VALUES(?,?,?,?,?)').run(createId(), method.id, method.version, item.id, createdAt)
      return item
    })
  }

  async getContextByItemId(itemId: string): Promise<MethodApplicationContext | undefined> {
    const result = await this.getContextResultByItemId(itemId)
    return result.status === 'available' ? { application: result.application, method: result.method, version: result.version } : undefined
  }

  private context(itemId: string): MethodApplicationContextResult {
    const applicationRow = this.raw.prepare('SELECT * FROM method_applications WHERE item_id=?').get(itemId) as Row | undefined
    if (!applicationRow) return { status: 'no-association' }
    const application = mapApplication(applicationRow)
    const methodRow = this.raw.prepare('SELECT * FROM methods WHERE id=?').get(application.methodId) as Row | undefined
    const versionRow = this.raw.prepare('SELECT * FROM method_versions WHERE method_id=? AND version=?').get(application.methodId, application.methodVersion) as Row | undefined
    const tombstoneRow = this.raw.prepare('SELECT * FROM method_tombstones WHERE method_id=?').get(application.methodId) as Row | undefined
    const method = methodRow ? mapMethod(methodRow) : undefined
    const version = versionRow ? mapVersion(versionRow) : undefined
    if (method && version) return method.deletedAt ? { status: 'method-in-trash', application, method, version } : { status: 'available', application, method, version }
    if (!method && tombstoneRow) {
      const tombstone = mapTombstone(tombstoneRow)
      if (tombstone.versions.some(value => value.version === application.methodVersion)) return { status: 'method-purged', application, tombstone }
    }
    if (!method && !version) return { status: 'unavailable', application, reason: 'method-and-version-missing' }
    return { status: 'unavailable', application, reason: method ? 'version-missing' : 'method-missing' }
  }

  async getContextResultByItemId(itemId: string): Promise<MethodApplicationContextResult> { return this.database.runInReadTransaction(() => this.context(itemId)) }

  async listSourceDisplaysForItems(itemIds: string[]): Promise<ItemMethodSourceDisplay[]> {
    const ids = [...new Set(itemIds.filter(Boolean))]
    return this.database.runInReadTransaction(() => ids.map(itemId => {
      const context = this.context(itemId)
      switch (context.status) {
        case 'no-association': return { status: 'no-association', itemId }
        case 'available': return { status: 'available', itemId, title: context.method.title }
        case 'method-in-trash': return { status: 'method-in-trash', itemId, title: context.method.title }
        case 'method-purged': return { status: 'method-purged', itemId, title: context.tombstone.title }
        case 'unavailable': {
          const method = this.raw.prepare('SELECT title FROM methods WHERE id=?').get(context.application.methodId) as Row | undefined
          const version = this.raw.prepare('SELECT title FROM method_versions WHERE method_id=? AND version=?').get(context.application.methodId, context.application.methodVersion) as Row | undefined
          const title = method ? String(method.title) : version ? String(version.title) : undefined
          return title ? { status: 'unavailable', itemId, title } : { status: 'unavailable', itemId }
        }
      }
    }))
  }
}
