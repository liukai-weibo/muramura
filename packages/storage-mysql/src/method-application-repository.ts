import type {
  CreateMethodApplicationInput,
  Item,
  ItemMethodSourceDisplay,
  Method,
  MethodApplication,
  MethodApplicationContext,
  MethodApplicationContextResult,
  MethodApplicationRepository,
  MethodTombstone,
  MethodVersion,
} from '@knowledge-base/contracts'
import { assertItemTitleLength, createId, normalizeItemTitle } from '@knowledge-base/domain'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { businessError, rethrowDuplicateAsBusinessError } from './errors'
import { runInMySqlTransaction } from './index'

type DateTime = string | Date
type MethodRow = RowDataPacket & { id: string; title: string; applicable: string; unsuitable: string; steps: string; validation_count: number; version: number; created_at: DateTime; updated_at: DateTime; deleted_at: DateTime | null }
type VersionRow = RowDataPacket & { id: string; method_id: string; version: number; title: string; applicable: string; unsuitable: string; steps: string; source_review_id: string | null; created_at: DateTime }
type ApplicationRow = RowDataPacket & { id: string; method_id: string; method_version: number; item_id: string; created_at: DateTime }
type TombstoneRow = RowDataPacket & { method_id: string; title: string; permanently_deleted_at: DateTime; versions: string | Array<{ version: number }> }

const mysqlDateTime = (value: string) => value.replace('T', ' ').replace('Z', '')
const iso = (value: DateTime) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`
const mapMethod = (row: MethodRow): Method => ({ id: row.id, title: row.title, applicable: row.applicable, unsuitable: row.unsuitable, steps: row.steps, validationCount: row.validation_count, version: row.version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.deleted_at ? { deletedAt: iso(row.deleted_at) } : {}) })
const mapVersion = (row: VersionRow): MethodVersion => ({ id: row.id, methodId: row.method_id, version: row.version, title: row.title, applicable: row.applicable, unsuitable: row.unsuitable, steps: row.steps, createdAt: iso(row.created_at), ...(row.source_review_id ? { sourceReviewId: row.source_review_id } : {}) })
const mapApplication = (row: ApplicationRow): MethodApplication => ({ id: row.id, methodId: row.method_id, methodVersion: row.method_version, itemId: row.item_id, createdAt: iso(row.created_at) })
const mapTombstone = (row: TombstoneRow): MethodTombstone => ({ methodId: row.method_id, title: row.title, permanentlyDeletedAt: iso(row.permanently_deleted_at), versions: typeof row.versions === 'string' ? JSON.parse(row.versions) : row.versions })

export interface MySqlMethodApplicationRepositoryTestHooks {
  beforeApplicationInsert?: () => Promise<void> | void
}

export class MySqlMethodApplicationRepository implements MethodApplicationRepository {
  constructor(private readonly pool: Pool, private readonly hooks?: MySqlMethodApplicationRepositoryTestHooks) {}

  async createItem(input: CreateMethodApplicationInput): Promise<Item> {
    const title = normalizeItemTitle(input.title)
    if (!title) throw businessError('ITEM_TITLE_REQUIRED', 'validation', '标题不能为空')
    return runInMySqlTransaction(this.pool, async connection => {
      assertItemTitleLength(title)
      const method = await this.lockMethod(connection, input.methodId)
      if (!method || method.deleted_at) {
        throw businessError('METHOD_NOT_FOUND', 'not-found', '选择的方法不存在')
      }
      const [versions] = await connection.query<VersionRow[]>('SELECT * FROM method_versions WHERE method_id=? AND version=? FOR UPDATE', [method.id, method.version])
      if (!versions[0]) {
        throw businessError('METHOD_NOT_FOUND', 'not-found', '选择的方法不存在')
      }
      const createdAt = new Date().toISOString()
      const item: Item = { id: createId(), title, content: input.content?.trim() ?? '', status: 'idea_to_try', createdAt, updatedAt: createdAt }
      await connection.execute('INSERT INTO items(id,title,content,status,start_action,created_at,updated_at,deleted_at) VALUES(?,?,?,?,NULL,?,?,NULL)', [item.id, item.title, item.content, item.status, mysqlDateTime(createdAt), mysqlDateTime(createdAt)])
      await connection.execute('INSERT INTO item_status_events(id,item_id,from_status,to_status,created_at) VALUES(?,?,NULL,?,?)', [createId(), item.id, item.status, mysqlDateTime(createdAt)])
      await this.hooks?.beforeApplicationInsert?.()
      try {
        await connection.execute('INSERT INTO method_applications(id,method_id,method_version,item_id,created_at) VALUES(?,?,?,?,?)', [createId(), method.id, method.version, item.id, mysqlDateTime(createdAt)])
      } catch (error) {
        rethrowDuplicateAsBusinessError(
          error,
          'ITEM_METHOD_ALREADY_ASSOCIATED',
          '事项已经关联方法',
        )
      }
      return item
    })
  }

  async getContextByItemId(itemId: string): Promise<MethodApplicationContext | undefined> {
    const result = await this.getContextResultByItemId(itemId)
    return result.status === 'available' ? { application: result.application, method: result.method, version: result.version } : undefined
  }

  async getContextResultByItemId(itemId: string): Promise<MethodApplicationContextResult> {
    const application = await this.getApplication(itemId)
    if (!application) return { status: 'no-association' }
    const [method, version, tombstone] = await Promise.all([this.getMethod(application.methodId), this.getVersion(application.methodId, application.methodVersion), this.getTombstone(application.methodId)])
    if (method && version) return method.deletedAt ? { status: 'method-in-trash', application, method, version } : { status: 'available', application, method, version }
    if (!method && tombstone && tombstone.versions.some(value => value.version === application.methodVersion)) return { status: 'method-purged', application, tombstone }
    if (!method && !version) return { status: 'unavailable', application, reason: 'method-and-version-missing' }
    return { status: 'unavailable', application, reason: method ? 'version-missing' : 'method-missing' }
  }

  async listSourceDisplaysForItems(itemIds: string[]): Promise<ItemMethodSourceDisplay[]> {
    const uniqueItemIds = [...new Set(itemIds.filter(Boolean))]
    return Promise.all(uniqueItemIds.map(async itemId => {
      const result = await this.getContextResultByItemId(itemId)
      if (result.status === 'available' || result.status === 'method-in-trash') return { status: result.status, itemId, title: result.method.title }
      if (result.status === 'method-purged') return { status: result.status, itemId, title: result.tombstone.title }
      if (result.status === 'no-association') return { status: result.status, itemId }
      const [method, version] = await Promise.all([this.getMethod(result.application.methodId), this.getVersion(result.application.methodId, result.application.methodVersion)])
      const title = method?.title ?? version?.title
      return title ? { status: 'unavailable', itemId, title } : { status: 'unavailable', itemId }
    }))
  }

  private async lockMethod(connection: PoolConnection, id: string): Promise<MethodRow | undefined> { const [rows] = await connection.query<MethodRow[]>('SELECT * FROM methods WHERE id=? FOR UPDATE', [id]); return rows[0] }
  private async getApplication(itemId: string): Promise<MethodApplication | undefined> { const [rows] = await this.pool.query<ApplicationRow[]>('SELECT * FROM method_applications WHERE item_id=?', [itemId]); return rows[0] && mapApplication(rows[0]) }
  private async getMethod(id: string): Promise<Method | undefined> { const [rows] = await this.pool.query<MethodRow[]>('SELECT * FROM methods WHERE id=?', [id]); return rows[0] && mapMethod(rows[0]) }
  private async getVersion(methodId: string, version: number): Promise<MethodVersion | undefined> { const [rows] = await this.pool.query<VersionRow[]>('SELECT * FROM method_versions WHERE method_id=? AND version=?', [methodId, version]); return rows[0] && mapVersion(rows[0]) }
  private async getTombstone(methodId: string): Promise<MethodTombstone | undefined> { const [rows] = await this.pool.query<TombstoneRow[]>('SELECT * FROM method_tombstones WHERE method_id=?', [methodId]); return rows[0] && mapTombstone(rows[0]) }
}
