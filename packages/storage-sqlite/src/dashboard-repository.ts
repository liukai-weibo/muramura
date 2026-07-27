import type { DashboardRepository, DashboardSnapshot, Item, ItemStatusEvent, Method, MethodApplication, MethodEvidence, MethodVersion, Review } from '@knowledge-base/contracts'
import { getRawDatabase, type SqliteKnowledgeDatabase } from './database'

type Row = Record<string, unknown>
const item = (row: Row): Item => ({ id: String(row.id), title: String(row.title), content: String(row.content), status: row.status as Item['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at), ...(row.start_action == null ? {} : { startAction: String(row.start_action) }) })
const review = (row: Row): Review => ({ id: String(row.id), itemId: String(row.item_id), actualAction: String(row.actual_action), result: String(row.result), effective: String(row.effective), incompatible: String(row.incompatible), reason: String(row.reason), adjustment: String(row.adjustment), newIdeas: String(row.new_ideas), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })
const method = (row: Row): Method => ({ id: String(row.id), title: String(row.title), applicable: String(row.applicable), unsuitable: String(row.unsuitable), steps: String(row.steps), validationCount: Number(row.validation_count), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })
const evidence = (row: Row): MethodEvidence => ({ id: String(row.id), methodId: String(row.method_id), reviewId: String(row.review_id), createdAt: String(row.created_at), ...(row.relation == null ? {} : { relation: row.relation as MethodEvidence['relation'] }), ...(row.method_version == null ? {} : { methodVersion: Number(row.method_version) }) })
const version = (row: Row): MethodVersion => ({ id: String(row.id), methodId: String(row.method_id), version: Number(row.version), title: String(row.title), applicable: String(row.applicable), unsuitable: String(row.unsuitable), steps: String(row.steps), ...(row.source_review_id == null ? {} : { sourceReviewId: String(row.source_review_id) }), createdAt: String(row.created_at) })
const application = (row: Row): MethodApplication => ({ id: String(row.id), methodId: String(row.method_id), methodVersion: Number(row.method_version), itemId: String(row.item_id), createdAt: String(row.created_at) })
const event = (row: Row): ItemStatusEvent => ({ id: String(row.id), itemId: String(row.item_id), ...(row.from_status == null ? {} : { fromStatus: row.from_status as ItemStatusEvent['fromStatus'] }), toStatus: row.to_status as ItemStatusEvent['toStatus'], createdAt: String(row.created_at) })

export class SqliteDashboardRepository implements DashboardRepository {
  constructor(private readonly database: SqliteKnowledgeDatabase) {}
  private get raw() { return getRawDatabase(this.database) }
  async getSnapshot(): Promise<DashboardSnapshot> {
    return this.database.runInReadTransaction(() => ({
      items: (this.raw.prepare('SELECT * FROM items WHERE deleted_at IS NULL').all() as Row[]).map(item),
      reviews: (this.raw.prepare('SELECT * FROM reviews').all() as Row[]).map(review),
      methods: (this.raw.prepare('SELECT * FROM methods WHERE deleted_at IS NULL').all() as Row[]).map(method),
      methodEvidence: (this.raw.prepare('SELECT * FROM method_evidence').all() as Row[]).map(evidence),
      methodVersions: (this.raw.prepare('SELECT * FROM method_versions').all() as Row[]).map(version),
      methodApplications: (this.raw.prepare('SELECT * FROM method_applications').all() as Row[]).map(application),
      itemStatusEvents: (this.raw.prepare('SELECT * FROM item_status_events').all() as Row[]).map(event),
    }))
  }
}
