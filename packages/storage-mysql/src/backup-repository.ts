import type { BackupData, BackupDataV3, BackupExplorationTrack, BackupRepository, CurrentUserScope, Item, ItemLink, ItemStatusEvent, Method, MethodApplication, MethodEvidence, MethodTombstone, MethodVersion, Review } from '@knowledge-base/contracts'
import { fail } from '@knowledge-base/domain'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { runInMySqlTransaction } from './index'

type DateValue = string | Date
const mysqlDateTime = (value: string) => value.replace('T', ' ').replace('Z', '')
const iso = (value: DateValue) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`

export interface MySqlBackupRepositoryTestHooks {
  beforeItemStatusEventInsert?: () => Promise<void> | void
  afterCommit?: () => Promise<void> | void
}

export class MySqlBackupRepository implements BackupRepository {
  constructor(private readonly pool: Pool, private readonly hooks?: MySqlBackupRepositoryTestHooks, private readonly scope?: CurrentUserScope) {}

  async exportData(): Promise<BackupDataV3> {
    const connection = await this.pool.getConnection()
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
      const [items, reviews, methods, methodEvidence, methodVersions, methodApplications, itemLinks, itemStatusEvents, methodTombstones, explorationTracks] = await Promise.all([
        connection.query(this.scope ? 'SELECT * FROM items WHERE owner_user_id=? ORDER BY id' : 'SELECT * FROM items ORDER BY id', this.scope ? [this.scope.userId] : []),
        connection.query(this.scope ? 'SELECT * FROM reviews WHERE owner_user_id=? ORDER BY id' : 'SELECT * FROM reviews ORDER BY id', this.scope ? [this.scope.userId] : []),
        connection.query(this.scope ? 'SELECT * FROM methods WHERE owner_user_id=? ORDER BY id' : 'SELECT * FROM methods ORDER BY id', this.scope ? [this.scope.userId] : []),
        connection.query(this.scope ? 'SELECT * FROM method_evidence WHERE owner_user_id=? ORDER BY id' : 'SELECT * FROM method_evidence ORDER BY id', this.scope ? [this.scope.userId] : []),
        connection.query(this.scope ? 'SELECT * FROM method_versions WHERE owner_user_id=? ORDER BY method_id, version, id' : 'SELECT * FROM method_versions ORDER BY method_id, version, id', this.scope ? [this.scope.userId] : []),
        connection.query(this.scope ? 'SELECT * FROM method_applications WHERE owner_user_id=? ORDER BY id' : 'SELECT * FROM method_applications ORDER BY id', this.scope ? [this.scope.userId] : []),
        connection.query(this.scope ? 'SELECT * FROM item_links WHERE owner_user_id=? ORDER BY id' : 'SELECT * FROM item_links ORDER BY id', this.scope ? [this.scope.userId] : []),
        connection.query(this.scope ? 'SELECT * FROM item_status_events WHERE owner_user_id=? ORDER BY item_id, created_at, id' : 'SELECT * FROM item_status_events ORDER BY item_id, created_at, id', this.scope ? [this.scope.userId] : []),
        connection.query(this.scope ? 'SELECT * FROM method_tombstones WHERE owner_user_id=? ORDER BY method_id' : 'SELECT * FROM method_tombstones ORDER BY method_id', this.scope ? [this.scope.userId] : []),
        connection.query(this.scope ? 'SELECT * FROM exploration_tracks WHERE owner_user_id=? ORDER BY id' : 'SELECT * FROM exploration_tracks ORDER BY id', this.scope ? [this.scope.userId] : []),
      ])
      await connection.commit()
      const data = {
        items: (items[0] as RowDataPacket[]).map(mapItem),
        reviews: (reviews[0] as RowDataPacket[]).map(mapReview),
        methods: (methods[0] as RowDataPacket[]).map(mapMethod),
        methodEvidence: (methodEvidence[0] as RowDataPacket[]).map(mapEvidence),
        methodVersions: (methodVersions[0] as RowDataPacket[]).map(mapVersion),
        methodApplications: (methodApplications[0] as RowDataPacket[]).map(mapApplication),
        itemLinks: (itemLinks[0] as RowDataPacket[]).map(mapLink),
        itemStatusEvents: (itemStatusEvents[0] as RowDataPacket[]).map(mapEvent),
        methodTombstones: (methodTombstones[0] as RowDataPacket[]).map(mapTombstone),
        explorationTracks: (explorationTracks[0] as RowDataPacket[]).map(mapExplorationTrack),
      }
      return data
    } catch (error) {
      await connection.rollback()
      throw error
    } finally { connection.release() }
  }

  async replaceData(data: BackupData | BackupDataV3): Promise<void> {
    const v3Data: BackupDataV3 = 'explorationTracks' in data ? data : { ...data, explorationTracks: [] }
    await runInMySqlTransaction(this.pool, async connection => {
      if (this.scope) await assertNoForeignOwnedIds(connection, v3Data, this.scope.userId)
      for (const table of ['item_links', 'item_status_events', 'method_applications', 'method_evidence', 'method_versions', 'method_tombstones', 'reviews', 'methods', 'items', 'exploration_tracks'] as const) {
        await connection.query(`DELETE FROM ${table}${this.scope ? ' WHERE owner_user_id=?' : ''}`, this.scope ? [this.scope.userId] : [])
      }
      const owner = this.scope?.userId
      await insertExplorationTracks(connection, v3Data.explorationTracks, owner)
      await insertItems(connection, v3Data.items, owner)
      await insertMethods(connection, v3Data.methods, owner)
      await insertReviews(connection, v3Data.reviews, owner)
      await insertVersions(connection, v3Data.methodVersions, owner)
      await insertEvidence(connection, v3Data.methodEvidence, owner)
      await insertApplications(connection, v3Data.methodApplications, owner)
      await insertTombstones(connection, v3Data.methodTombstones, owner)
      await insertLinks(connection, v3Data.itemLinks, owner)
      for (const event of v3Data.itemStatusEvents) {
        await this.hooks?.beforeItemStatusEventInsert?.()
        await connection.execute(owner ? 'INSERT INTO item_status_events(id,item_id,from_status,to_status,created_at,updated_at,owner_user_id) VALUES(?,?,?,?,?,?,?)' : 'INSERT INTO item_status_events(id,item_id,from_status,to_status,created_at,updated_at) VALUES(?,?,?,?,?,?)', owner ? [event.id, event.itemId, event.fromStatus ?? null, event.toStatus, mysqlDateTime(event.createdAt), mysqlDateTime(event.createdAt), owner] : [event.id, event.itemId, event.fromStatus ?? null, event.toStatus, mysqlDateTime(event.createdAt), mysqlDateTime(event.createdAt)])
      }
    })
    await this.hooks?.afterCommit?.()
  }
}

async function insertExplorationTracks(connection: PoolConnection, entries: BackupExplorationTrack[], owner?: string) {
  for (const entry of entries) await connection.execute(owner ? 'INSERT INTO exploration_tracks(id,name,description,normalized_name,created_at,updated_at,archived_at,deleted_at,owner_user_id) VALUES(?,?,?,?,?,?,?,?,?)' : 'INSERT INTO exploration_tracks(id,name,description,normalized_name,created_at,updated_at,archived_at,deleted_at) VALUES(?,?,?,?,?,?,?,?)', owner ? [entry.id, entry.name, entry.description ?? '', entry.normalizedName, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.updatedAt), entry.archivedAt ? mysqlDateTime(entry.archivedAt) : null, entry.deletedAt ? mysqlDateTime(entry.deletedAt) : null, owner] : [entry.id, entry.name, entry.description ?? '', entry.normalizedName, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.updatedAt), entry.archivedAt ? mysqlDateTime(entry.archivedAt) : null, entry.deletedAt ? mysqlDateTime(entry.deletedAt) : null])
}
async function insertItems(connection: PoolConnection, entries: Item[], owner?: string) {
  for (const entry of entries) await connection.execute(owner ? 'INSERT INTO items(id,title,content,status,start_action,exploration_track_id,created_at,updated_at,archived_at,deleted_at,exploration_track_cascade_deleted_at,owner_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)' : 'INSERT INTO items(id,title,content,status,start_action,exploration_track_id,created_at,updated_at,archived_at,deleted_at,exploration_track_cascade_deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', owner ? [entry.id, entry.title, entry.content, entry.status, entry.startAction ?? null, entry.explorationTrackId ?? null, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.updatedAt), entry.archivedAt ? mysqlDateTime(entry.archivedAt) : null, entry.deletedAt ? mysqlDateTime(entry.deletedAt) : null, entry.explorationTrackCascadeDeletedAt ? mysqlDateTime(entry.explorationTrackCascadeDeletedAt) : null, owner] : [entry.id, entry.title, entry.content, entry.status, entry.startAction ?? null, entry.explorationTrackId ?? null, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.updatedAt), entry.archivedAt ? mysqlDateTime(entry.archivedAt) : null, entry.deletedAt ? mysqlDateTime(entry.deletedAt) : null, entry.explorationTrackCascadeDeletedAt ? mysqlDateTime(entry.explorationTrackCascadeDeletedAt) : null])
}
async function insertMethods(connection: PoolConnection, entries: Method[], owner?: string) {
  for (const entry of entries) await connection.execute(owner ? 'INSERT INTO methods(id,title,applicable,unsuitable,steps,validation_count,version,created_at,updated_at,deleted_at,owner_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)' : 'INSERT INTO methods(id,title,applicable,unsuitable,steps,validation_count,version,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?)', owner ? [entry.id, entry.title, entry.applicable, entry.unsuitable, entry.steps, entry.validationCount, entry.version, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.updatedAt), entry.deletedAt ? mysqlDateTime(entry.deletedAt) : null, owner] : [entry.id, entry.title, entry.applicable, entry.unsuitable, entry.steps, entry.validationCount, entry.version, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.updatedAt), entry.deletedAt ? mysqlDateTime(entry.deletedAt) : null])
}
async function insertReviews(connection: PoolConnection, entries: Review[], owner?: string) {
  for (const entry of entries) await connection.execute(owner ? 'INSERT INTO reviews(id,item_id,actual_action,result,effective,incompatible,reason,adjustment,new_ideas,created_at,updated_at,owner_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)' : 'INSERT INTO reviews(id,item_id,actual_action,result,effective,incompatible,reason,adjustment,new_ideas,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', owner ? [entry.id, entry.itemId, entry.actualAction, entry.result, entry.effective, entry.incompatible, entry.reason, entry.adjustment, entry.newIdeas, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.updatedAt), owner] : [entry.id, entry.itemId, entry.actualAction, entry.result, entry.effective, entry.incompatible, entry.reason, entry.adjustment, entry.newIdeas, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.updatedAt)])
}
async function insertVersions(connection: PoolConnection, entries: MethodVersion[], owner?: string) {
  for (const entry of entries) await connection.execute(owner ? 'INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at,updated_at,owner_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)' : 'INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', owner ? [entry.id, entry.methodId, entry.version, entry.title, entry.applicable, entry.unsuitable, entry.steps, entry.sourceReviewId ?? null, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.createdAt), owner] : [entry.id, entry.methodId, entry.version, entry.title, entry.applicable, entry.unsuitable, entry.steps, entry.sourceReviewId ?? null, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.createdAt)])
}
async function insertEvidence(connection: PoolConnection, entries: MethodEvidence[], owner?: string) {
  for (const entry of entries) await connection.execute(owner ? 'INSERT INTO method_evidence(id,method_id,review_id,relation,method_version,created_at,updated_at,owner_user_id) VALUES(?,?,?,?,?,?,?,?)' : 'INSERT INTO method_evidence(id,method_id,review_id,relation,method_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', owner ? [entry.id, entry.methodId, entry.reviewId, entry.relation ?? 'unknown', entry.methodVersion ?? null, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.createdAt), owner] : [entry.id, entry.methodId, entry.reviewId, entry.relation ?? 'unknown', entry.methodVersion ?? null, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.createdAt)])
}
async function insertApplications(connection: PoolConnection, entries: MethodApplication[], owner?: string) {
  for (const entry of entries) await connection.execute(owner ? 'INSERT INTO method_applications(id,method_id,method_version,item_id,created_at,updated_at,owner_user_id) VALUES(?,?,?,?,?,?,?)' : 'INSERT INTO method_applications(id,method_id,method_version,item_id,created_at,updated_at) VALUES(?,?,?,?,?,?)', owner ? [entry.id, entry.methodId, entry.methodVersion, entry.itemId, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.createdAt), owner] : [entry.id, entry.methodId, entry.methodVersion, entry.itemId, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.createdAt)])
}
async function insertTombstones(connection: PoolConnection, entries: MethodTombstone[], owner?: string) {
  for (const entry of entries) await connection.execute(owner ? 'INSERT INTO method_tombstones(method_id,title,permanently_deleted_at,created_at,updated_at,versions,owner_user_id) VALUES(?,?,?,?,?,?,?)' : 'INSERT INTO method_tombstones(method_id,title,permanently_deleted_at,created_at,updated_at,versions) VALUES(?,?,?,?,?,?)', owner ? [entry.methodId, entry.title, mysqlDateTime(entry.permanentlyDeletedAt), mysqlDateTime(entry.permanentlyDeletedAt), mysqlDateTime(entry.permanentlyDeletedAt), JSON.stringify(entry.versions), owner] : [entry.methodId, entry.title, mysqlDateTime(entry.permanentlyDeletedAt), mysqlDateTime(entry.permanentlyDeletedAt), mysqlDateTime(entry.permanentlyDeletedAt), JSON.stringify(entry.versions)])
}
async function insertLinks(connection: PoolConnection, entries: ItemLink[], owner?: string) {
  for (const entry of entries) await connection.execute(owner ? 'INSERT INTO item_links(id,source_review_id,target_item_id,type,created_at,updated_at,owner_user_id) VALUES(?,?,?,?,?,?,?)' : 'INSERT INTO item_links(id,source_review_id,target_item_id,type,created_at,updated_at) VALUES(?,?,?,?,?,?)', owner ? [entry.id, entry.sourceReviewId, entry.targetItemId, entry.type, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.createdAt), owner] : [entry.id, entry.sourceReviewId, entry.targetItemId, entry.type, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.createdAt)])
}

async function assertNoForeignOwnedIds(connection: PoolConnection, data: BackupDataV3, owner: string): Promise<void> {
  const identities: Array<{ table: string; key: string; ids: string[] }> = [
    { table: 'items', key: 'id', ids: data.items.map(entry => entry.id) },
    { table: 'reviews', key: 'id', ids: data.reviews.map(entry => entry.id) },
    { table: 'methods', key: 'id', ids: data.methods.map(entry => entry.id) },
    { table: 'method_evidence', key: 'id', ids: data.methodEvidence.map(entry => entry.id) },
    { table: 'method_versions', key: 'id', ids: data.methodVersions.map(entry => entry.id) },
    { table: 'method_applications', key: 'id', ids: data.methodApplications.map(entry => entry.id) },
    { table: 'item_status_events', key: 'id', ids: data.itemStatusEvents.map(entry => entry.id) },
    { table: 'item_links', key: 'id', ids: data.itemLinks.map(entry => entry.id) },
    { table: 'method_tombstones', key: 'method_id', ids: data.methodTombstones.map(entry => entry.methodId) },
    { table: 'exploration_tracks', key: 'id', ids: data.explorationTracks.map(entry => entry.id) },
  ]
  for (const { table, key, ids } of identities) {
    const sorted = [...new Set(ids)].sort()
    for (let offset = 0; offset < sorted.length; offset += 500) {
      const chunk = sorted.slice(offset, offset + 500)
      const [rows] = await connection.query<Array<RowDataPacket & { owner_user_id: string | null }>>(`SELECT owner_user_id FROM ${table} WHERE ${key} IN (${chunk.map(() => '?').join(',')}) ORDER BY ${key} FOR UPDATE`, chunk)
      if (rows.some(row => row.owner_user_id !== null && row.owner_user_id !== owner)) fail('BACKUP_OWNERSHIP_CONFLICT', '备份包含属于其他用户的数据 ID')
    }
  }
}

const mapItem = (row: RowDataPacket): Item => ({ id: row.id, title: row.title, content: row.content, status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.deleted_at == null ? {} : { deletedAt: iso(row.deleted_at) }), ...(row.exploration_track_cascade_deleted_at == null ? {} : { explorationTrackCascadeDeletedAt: iso(row.exploration_track_cascade_deleted_at) }), ...(row.archived_at == null ? {} : { archivedAt: iso(row.archived_at) }), ...(row.start_action == null ? {} : { startAction: row.start_action }), ...(row.exploration_track_id == null ? {} : { explorationTrackId: row.exploration_track_id }) })
const mapExplorationTrack = (row: RowDataPacket): BackupExplorationTrack => ({ id: row.id, name: row.name, description: row.description ?? '', normalizedName: row.normalized_name, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.archived_at == null ? {} : { archivedAt: iso(row.archived_at) }), ...(row.deleted_at == null ? {} : { deletedAt: iso(row.deleted_at) }) })
const mapReview = (row: RowDataPacket): Review => ({ id: row.id, itemId: row.item_id, actualAction: row.actual_action, result: row.result, effective: row.effective, incompatible: row.incompatible, reason: row.reason, adjustment: row.adjustment, newIdeas: row.new_ideas, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) })
const mapMethod = (row: RowDataPacket): Method => ({ id: row.id, title: row.title, applicable: row.applicable, unsuitable: row.unsuitable, steps: row.steps, validationCount: row.validation_count, version: row.version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.deleted_at == null ? {} : { deletedAt: iso(row.deleted_at) }) })
const mapEvidence = (row: RowDataPacket): MethodEvidence => ({ id: row.id, methodId: row.method_id, reviewId: row.review_id, createdAt: iso(row.created_at), ...(row.relation == null ? {} : { relation: row.relation }), ...(row.method_version == null ? {} : { methodVersion: row.method_version }) })
const mapVersion = (row: RowDataPacket): MethodVersion => ({ id: row.id, methodId: row.method_id, version: row.version, title: row.title, applicable: row.applicable, unsuitable: row.unsuitable, steps: row.steps, createdAt: iso(row.created_at), ...(row.source_review_id == null ? {} : { sourceReviewId: row.source_review_id }) })
const mapApplication = (row: RowDataPacket): MethodApplication => ({ id: row.id, methodId: row.method_id, methodVersion: row.method_version, itemId: row.item_id, createdAt: iso(row.created_at) })
const mapLink = (row: RowDataPacket): ItemLink => ({ id: row.id, sourceReviewId: row.source_review_id, targetItemId: row.target_item_id, type: row.type, createdAt: iso(row.created_at) })
const mapEvent = (row: RowDataPacket): ItemStatusEvent => ({ id: row.id, itemId: row.item_id, toStatus: row.to_status, createdAt: iso(row.created_at), ...(row.from_status == null ? {} : { fromStatus: row.from_status }) })
const mapTombstone = (row: RowDataPacket): MethodTombstone => ({ methodId: row.method_id, title: row.title, permanentlyDeletedAt: iso(row.permanently_deleted_at), versions: typeof row.versions === 'string' ? JSON.parse(row.versions) : row.versions })
