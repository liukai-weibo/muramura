import type { CurrentUserScope, DashboardRepository, DashboardSnapshot, Item, ItemStatus, ItemStatusEvent, Method, MethodApplication, MethodEvidence, MethodVersion, Review, SearchRepository, SearchResult } from '@knowledge-base/contracts'
import type { Pool, RowDataPacket } from 'mysql2/promise'

type DateTime = string | Date
type ItemRow = RowDataPacket & { id: string; title: string; content: string; status: ItemStatus; start_action: string | null; created_at: DateTime; updated_at: DateTime; deleted_at: DateTime | null; exploration_track_id: string | null }
type ReviewRow = RowDataPacket & { id: string; item_id: string; actual_action: string; result: string; effective: string; incompatible: string; reason: string; adjustment: string; new_ideas: string; created_at: DateTime; updated_at: DateTime }
type MethodRow = RowDataPacket & { id: string; title: string; applicable: string; unsuitable: string; steps: string; validation_count: number; version: number; created_at: DateTime; updated_at: DateTime; deleted_at: DateTime | null }
type VersionRow = RowDataPacket & { id: string; method_id: string; version: number; title: string; applicable: string; unsuitable: string; steps: string; source_review_id: string | null; created_at: DateTime }
type EvidenceRow = RowDataPacket & { id: string; method_id: string; review_id: string; relation: MethodEvidence['relation'] | null; method_version: number | null; created_at: DateTime }
type ApplicationRow = RowDataPacket & { id: string; method_id: string; method_version: number; item_id: string; created_at: DateTime }
type EventRow = RowDataPacket & { id: string; item_id: string; from_status: ItemStatus | null; to_status: ItemStatus; created_at: DateTime }
type DailyNoteSearchRow = RowDataPacket & { id: string; entry_date: string | Date; content: string; updated_at: DateTime }
type TrackSearchRow = RowDataPacket & { id: string; name: string; description: string; deleted_at: DateTime | null }

const iso = (value: DateTime) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`
const mapItem = (row: ItemRow): Item => ({ id: row.id, title: row.title, content: row.content, status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.deleted_at ? { deletedAt: iso(row.deleted_at) } : {}), ...(row.start_action ? { startAction: row.start_action } : {}), ...(row.exploration_track_id ? { explorationTrackId: row.exploration_track_id } : {}) })
const mapReview = (row: ReviewRow): Review => ({ id: row.id, itemId: row.item_id, actualAction: row.actual_action, result: row.result, effective: row.effective, incompatible: row.incompatible, reason: row.reason, adjustment: row.adjustment, newIdeas: row.new_ideas, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) })
const mapMethod = (row: MethodRow): Method => ({ id: row.id, title: row.title, applicable: row.applicable, unsuitable: row.unsuitable, steps: row.steps, validationCount: row.validation_count, version: row.version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.deleted_at ? { deletedAt: iso(row.deleted_at) } : {}) })
const mapVersion = (row: VersionRow): MethodVersion => ({ id: row.id, methodId: row.method_id, version: row.version, title: row.title, applicable: row.applicable, unsuitable: row.unsuitable, steps: row.steps, createdAt: iso(row.created_at), ...(row.source_review_id ? { sourceReviewId: row.source_review_id } : {}) })
const mapEvidence = (row: EvidenceRow): MethodEvidence => ({ id: row.id, methodId: row.method_id, reviewId: row.review_id, createdAt: iso(row.created_at), ...(row.relation ? { relation: row.relation } : {}), ...(row.method_version === null ? {} : { methodVersion: row.method_version }) })
const mapApplication = (row: ApplicationRow): MethodApplication => ({ id: row.id, methodId: row.method_id, methodVersion: row.method_version, itemId: row.item_id, createdAt: iso(row.created_at) })
const mapEvent = (row: EventRow): ItemStatusEvent => ({ id: row.id, itemId: row.item_id, toStatus: row.to_status, createdAt: iso(row.created_at), ...(row.from_status ? { fromStatus: row.from_status } : {}) })

export class MySqlDashboardRepository implements DashboardRepository {
  constructor(private readonly pool: Pool, private readonly scope?: CurrentUserScope) {}

  async getSnapshot(): Promise<DashboardSnapshot> {
    const connection = await this.pool.getConnection()
    try {
      await connection.query('SET TRANSACTION READ ONLY')
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')
      const [items, reviews, methods, methodEvidence, methodVersions, methodApplications, itemStatusEvents] = await Promise.all([
        connection.query<ItemRow[]>(this.scope ? 'SELECT * FROM items WHERE deleted_at IS NULL AND owner_user_id=? ORDER BY id ASC' : 'SELECT * FROM items WHERE deleted_at IS NULL ORDER BY id ASC', this.scope ? [this.scope.userId] : []),
        connection.query<ReviewRow[]>(this.scope ? 'SELECT * FROM reviews WHERE owner_user_id=? ORDER BY id ASC' : 'SELECT * FROM reviews ORDER BY id ASC', this.scope ? [this.scope.userId] : []),
        connection.query<MethodRow[]>(this.scope ? 'SELECT * FROM methods WHERE deleted_at IS NULL AND owner_user_id=? ORDER BY id ASC' : 'SELECT * FROM methods WHERE deleted_at IS NULL ORDER BY id ASC', this.scope ? [this.scope.userId] : []),
        connection.query<EvidenceRow[]>(this.scope ? 'SELECT * FROM method_evidence WHERE owner_user_id=? ORDER BY id ASC' : 'SELECT * FROM method_evidence ORDER BY id ASC', this.scope ? [this.scope.userId] : []),
        connection.query<VersionRow[]>(this.scope ? 'SELECT * FROM method_versions WHERE owner_user_id=? ORDER BY method_id ASC,version ASC,id ASC' : 'SELECT * FROM method_versions ORDER BY method_id ASC,version ASC,id ASC', this.scope ? [this.scope.userId] : []),
        connection.query<ApplicationRow[]>(this.scope ? 'SELECT * FROM method_applications WHERE owner_user_id=? ORDER BY id ASC' : 'SELECT * FROM method_applications ORDER BY id ASC', this.scope ? [this.scope.userId] : []),
        connection.query<EventRow[]>(this.scope ? 'SELECT * FROM item_status_events WHERE owner_user_id=? ORDER BY item_id ASC,created_at ASC,id ASC' : 'SELECT * FROM item_status_events ORDER BY item_id ASC,created_at ASC,id ASC', this.scope ? [this.scope.userId] : []),
      ])
      await connection.commit()
      return { items: items[0].map(mapItem), reviews: reviews[0].map(mapReview), methods: methods[0].map(mapMethod), methodEvidence: methodEvidence[0].map(mapEvidence), methodVersions: methodVersions[0].map(mapVersion), methodApplications: methodApplications[0].map(mapApplication), itemStatusEvents: itemStatusEvents[0].map(mapEvent) }
    } catch (error) {
      await connection.rollback()
      throw error
    } finally { connection.release() }
  }
}

export interface MySqlSearchRepositoryTestHooks {
  afterItemsRead?: () => Promise<void> | void
}

export class MySqlSearchRepository implements SearchRepository {
  constructor(private readonly pool: Pool, private readonly hooks?: MySqlSearchRepositoryTestHooks, private readonly scope?: CurrentUserScope) {}

  async search(query: string): Promise<SearchResult[]> {
    const normalized = query.trim().toLocaleLowerCase('zh-CN')
    if (!normalized) return []
    const contains = (...values: string[]) => values.some(value => value.toLocaleLowerCase('zh-CN').includes(normalized))
    const connection = await this.pool.getConnection()
    let started = false
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
      await connection.query('SET TRANSACTION READ ONLY')
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')
      started = true
      const [items] = await connection.query<ItemRow[]>(this.scope ? 'SELECT * FROM items WHERE owner_user_id=? ORDER BY id ASC' : 'SELECT * FROM items ORDER BY id ASC', this.scope ? [this.scope.userId] : [])
      await this.hooks?.afterItemsRead?.()
      const [reviews] = await connection.query<ReviewRow[]>(this.scope ? 'SELECT * FROM reviews WHERE owner_user_id=? ORDER BY id ASC' : 'SELECT * FROM reviews ORDER BY id ASC', this.scope ? [this.scope.userId] : [])
      const [methods] = await connection.query<MethodRow[]>(this.scope ? 'SELECT * FROM methods WHERE owner_user_id=? ORDER BY id ASC' : 'SELECT * FROM methods ORDER BY id ASC', this.scope ? [this.scope.userId] : [])
      const [versions] = await connection.query<VersionRow[]>(this.scope ? 'SELECT * FROM method_versions WHERE owner_user_id=? ORDER BY method_id ASC,version ASC,id ASC' : 'SELECT * FROM method_versions ORDER BY method_id ASC,version ASC,id ASC', this.scope ? [this.scope.userId] : [])
      const [notes] = await connection.query<DailyNoteSearchRow[]>(this.scope ? 'SELECT id,entry_date,content,updated_at FROM daily_notes WHERE owner_user_id=? ORDER BY entry_date DESC' : 'SELECT id,entry_date,content,updated_at FROM daily_notes ORDER BY entry_date DESC', this.scope ? [this.scope.userId] : [])
      const [tracks] = await connection.query<TrackSearchRow[]>(this.scope ? 'SELECT id,name,description,deleted_at FROM exploration_tracks WHERE owner_user_id=? ORDER BY id ASC' : 'SELECT id,name,description,deleted_at FROM exploration_tracks ORDER BY id ASC', this.scope ? [this.scope.userId] : [])
      await connection.commit()
      started = false
    const currentItems = items.map(mapItem); const currentMethods = methods.map(mapMethod)
    const itemById = new Map(currentItems.map(item => [item.id, item]))
    const itemResults: SearchResult[] = currentItems.filter(item => contains(item.title, item.content)).map(item => ({ id: `item:${item.id}`, type: 'item', title: item.title, excerpt: item.content, itemId: item.id, itemStatus: item.status, ...(item.deletedAt ? { deletedAt: item.deletedAt } : {}) }))
    const reviewResults: SearchResult[] = reviews.map(mapReview).filter(review => itemById.has(review.itemId) && contains(review.actualAction, review.result, review.effective, review.incompatible, review.reason, review.adjustment, review.newIdeas)).map(review => ({ id: `review:${review.id}`, type: 'review', title: itemById.get(review.itemId)?.title ?? '复盘', excerpt: [review.actualAction, review.result].filter(Boolean).join(' · '), itemId: review.itemId }))
    const methodResults: SearchResult[] = currentMethods.filter(method => contains(method.title, method.applicable, method.unsuitable, method.steps)).map(method => ({ id: `method:${method.id}`, type: 'method', title: method.title, excerpt: method.steps, methodId: method.id, ...(method.deletedAt ? { deletedAt: method.deletedAt } : {}) }))
    const historicalResults: SearchResult[] = versions.map(mapVersion).filter(version => {
      const current = currentMethods.find(method => method.id === version.methodId)
      return contains(version.title, version.applicable, version.unsuitable, version.steps) && !(current?.version === version.version && methodResults.some(result => result.methodId === version.methodId))
    }).map(version => ({ id: `method-version:${version.id}`, type: 'method', title: `${version.title} v${version.version}`, excerpt: version.steps, methodId: version.methodId, methodVersion: version.version }))
    const dailyNoteResults: SearchResult[] = notes.map(note => {
      const entryDate = note.entry_date instanceof Date ? note.entry_date.toISOString().slice(0, 10) : String(note.entry_date).slice(0, 10)
      return { entryDate, note }
    }).filter(({ note }) => contains(note.content)).map(({ entryDate, note }) => ({ id: `daily-note:${entryDate}`, type: 'daily-note', title: `手记 ${entryDate}`, excerpt: note.content, entryDate }))
    const trackRows = tracks.map(track => {
      const linked = currentItems.filter(item => item.explorationTrackId === track.id)
      const historyText = linked.flatMap(item => [item.title, item.content]).join(' ')
      return { track, searchText: `${track.name} ${track.description} ${historyText}` }
    })
    const explorationResults: SearchResult[] = trackRows.filter(({ searchText }) => contains(searchText)).map(({ track, searchText }) => ({ id: `exploration-track:${track.id}`, type: 'exploration-track', title: track.name, excerpt: searchText.replace(track.name, '').trim() || '长期探索', explorationTrackId: track.id, ...(track.deleted_at ? { deletedAt: iso(track.deleted_at) } : {}) }))
    return [...itemResults, ...reviewResults, ...methodResults, ...historicalResults, ...dailyNoteResults, ...explorationResults]
    } catch (error) {
      if (started) await connection.rollback()
      throw error
    } finally { connection.release() }
  }
}
