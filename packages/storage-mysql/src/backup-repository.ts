import type { BackupData, BackupDataV3, BackupExplorationTrack, BackupRepository, Item, ItemLink, ItemStatusEvent, Method, MethodApplication, MethodEvidence, MethodTombstone, MethodVersion, Review } from '@knowledge-base/contracts'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { runInMySqlTransaction } from './index'

type DateValue = string | Date
const mysqlDateTime = (value: string) => value.replace('T', ' ').replace('Z', '')
const iso = (value: DateValue) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`

export interface MySqlBackupRepositoryTestHooks {
  beforeItemStatusEventInsert?: () => Promise<void> | void
}

export class MySqlBackupRepository implements BackupRepository {
  constructor(private readonly pool: Pool, private readonly hooks?: MySqlBackupRepositoryTestHooks) {}

  async exportData(): Promise<BackupDataV3> {
    const connection = await this.pool.getConnection()
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
      const [items, reviews, methods, methodEvidence, methodVersions, methodApplications, itemLinks, itemStatusEvents, methodTombstones, explorationTracks] = await Promise.all([
        connection.query('SELECT * FROM items ORDER BY id'),
        connection.query('SELECT * FROM reviews ORDER BY id'),
        connection.query('SELECT * FROM methods ORDER BY id'),
        connection.query('SELECT * FROM method_evidence ORDER BY id'),
        connection.query('SELECT * FROM method_versions ORDER BY method_id, version, id'),
        connection.query('SELECT * FROM method_applications ORDER BY id'),
        connection.query('SELECT * FROM item_links ORDER BY id'),
        connection.query('SELECT * FROM item_status_events ORDER BY item_id, created_at, id'),
        connection.query('SELECT * FROM method_tombstones ORDER BY method_id'),
        connection.query('SELECT * FROM exploration_tracks ORDER BY id'),
      ])
      await connection.commit()
      return {
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
    } catch (error) {
      await connection.rollback()
      throw error
    } finally { connection.release() }
  }

  async replaceData(data: BackupData | BackupDataV3): Promise<void> {
    const v3Data: BackupDataV3 = 'explorationTracks' in data ? data : { ...data, explorationTracks: [] }
    await runInMySqlTransaction(this.pool, async connection => {
      for (const table of ['item_links', 'item_status_events', 'method_applications', 'method_evidence', 'method_versions', 'method_tombstones', 'reviews', 'methods', 'items', 'exploration_tracks'] as const) {
        await connection.query(`DELETE FROM ${table}`)
      }
      await insertExplorationTracks(connection, v3Data.explorationTracks)
      await insertItems(connection, v3Data.items)
      await insertMethods(connection, v3Data.methods)
      await insertReviews(connection, v3Data.reviews)
      await insertVersions(connection, v3Data.methodVersions)
      await insertEvidence(connection, v3Data.methodEvidence)
      await insertApplications(connection, v3Data.methodApplications)
      await insertTombstones(connection, v3Data.methodTombstones)
      await insertLinks(connection, v3Data.itemLinks)
      for (const event of v3Data.itemStatusEvents) {
        await this.hooks?.beforeItemStatusEventInsert?.()
        await connection.execute('INSERT INTO item_status_events(id,item_id,from_status,to_status,created_at) VALUES(?,?,?,?,?)', [event.id, event.itemId, event.fromStatus ?? null, event.toStatus, mysqlDateTime(event.createdAt)])
      }
    })
  }
}

async function insertExplorationTracks(connection: PoolConnection, entries: BackupExplorationTrack[]) {
  for (const entry of entries) await connection.execute('INSERT INTO exploration_tracks(id,name,normalized_name,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?)', [entry.id, entry.name, entry.normalizedName, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.updatedAt), entry.deletedAt ? mysqlDateTime(entry.deletedAt) : null])
}
async function insertItems(connection: PoolConnection, entries: Item[]) {
  for (const entry of entries) await connection.execute('INSERT INTO items(id,title,content,status,start_action,exploration_track_id,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?)', [entry.id, entry.title, entry.content, entry.status, entry.startAction ?? null, entry.explorationTrackId ?? null, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.updatedAt), entry.deletedAt ? mysqlDateTime(entry.deletedAt) : null])
}
async function insertMethods(connection: PoolConnection, entries: Method[]) {
  for (const entry of entries) await connection.execute('INSERT INTO methods(id,title,applicable,unsuitable,steps,validation_count,version,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [entry.id, entry.title, entry.applicable, entry.unsuitable, entry.steps, entry.validationCount, entry.version, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.updatedAt), entry.deletedAt ? mysqlDateTime(entry.deletedAt) : null])
}
async function insertReviews(connection: PoolConnection, entries: Review[]) {
  for (const entry of entries) await connection.execute('INSERT INTO reviews(id,item_id,actual_action,result,effective,incompatible,reason,adjustment,new_ideas,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', [entry.id, entry.itemId, entry.actualAction, entry.result, entry.effective, entry.incompatible, entry.reason, entry.adjustment, entry.newIdeas, mysqlDateTime(entry.createdAt), mysqlDateTime(entry.updatedAt)])
}
async function insertVersions(connection: PoolConnection, entries: MethodVersion[]) {
  for (const entry of entries) await connection.execute('INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)', [entry.id, entry.methodId, entry.version, entry.title, entry.applicable, entry.unsuitable, entry.steps, entry.sourceReviewId ?? null, mysqlDateTime(entry.createdAt)])
}
async function insertEvidence(connection: PoolConnection, entries: MethodEvidence[]) {
  for (const entry of entries) await connection.execute('INSERT INTO method_evidence(id,method_id,review_id,relation,method_version,created_at) VALUES(?,?,?,?,?,?)', [entry.id, entry.methodId, entry.reviewId, entry.relation ?? 'unknown', entry.methodVersion ?? null, mysqlDateTime(entry.createdAt)])
}
async function insertApplications(connection: PoolConnection, entries: MethodApplication[]) {
  for (const entry of entries) await connection.execute('INSERT INTO method_applications(id,method_id,method_version,item_id,created_at) VALUES(?,?,?,?,?)', [entry.id, entry.methodId, entry.methodVersion, entry.itemId, mysqlDateTime(entry.createdAt)])
}
async function insertTombstones(connection: PoolConnection, entries: MethodTombstone[]) {
  for (const entry of entries) await connection.execute('INSERT INTO method_tombstones(method_id,title,permanently_deleted_at,versions) VALUES(?,?,?,?)', [entry.methodId, entry.title, mysqlDateTime(entry.permanentlyDeletedAt), JSON.stringify(entry.versions)])
}
async function insertLinks(connection: PoolConnection, entries: ItemLink[]) {
  for (const entry of entries) await connection.execute('INSERT INTO item_links(id,source_review_id,target_item_id,type,created_at) VALUES(?,?,?,?,?)', [entry.id, entry.sourceReviewId, entry.targetItemId, entry.type, mysqlDateTime(entry.createdAt)])
}

const mapItem = (row: RowDataPacket): Item => ({ id: row.id, title: row.title, content: row.content, status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.deleted_at == null ? {} : { deletedAt: iso(row.deleted_at) }), ...(row.start_action == null ? {} : { startAction: row.start_action }), ...(row.exploration_track_id == null ? {} : { explorationTrackId: row.exploration_track_id }) })
const mapExplorationTrack = (row: RowDataPacket): BackupExplorationTrack => ({ id: row.id, name: row.name, normalizedName: row.normalized_name, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.deleted_at == null ? {} : { deletedAt: iso(row.deleted_at) }) })
const mapReview = (row: RowDataPacket): Review => ({ id: row.id, itemId: row.item_id, actualAction: row.actual_action, result: row.result, effective: row.effective, incompatible: row.incompatible, reason: row.reason, adjustment: row.adjustment, newIdeas: row.new_ideas, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) })
const mapMethod = (row: RowDataPacket): Method => ({ id: row.id, title: row.title, applicable: row.applicable, unsuitable: row.unsuitable, steps: row.steps, validationCount: row.validation_count, version: row.version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.deleted_at == null ? {} : { deletedAt: iso(row.deleted_at) }) })
const mapEvidence = (row: RowDataPacket): MethodEvidence => ({ id: row.id, methodId: row.method_id, reviewId: row.review_id, createdAt: iso(row.created_at), ...(row.relation == null ? {} : { relation: row.relation }), ...(row.method_version == null ? {} : { methodVersion: row.method_version }) })
const mapVersion = (row: RowDataPacket): MethodVersion => ({ id: row.id, methodId: row.method_id, version: row.version, title: row.title, applicable: row.applicable, unsuitable: row.unsuitable, steps: row.steps, createdAt: iso(row.created_at), ...(row.source_review_id == null ? {} : { sourceReviewId: row.source_review_id }) })
const mapApplication = (row: RowDataPacket): MethodApplication => ({ id: row.id, methodId: row.method_id, methodVersion: row.method_version, itemId: row.item_id, createdAt: iso(row.created_at) })
const mapLink = (row: RowDataPacket): ItemLink => ({ id: row.id, sourceReviewId: row.source_review_id, targetItemId: row.target_item_id, type: row.type, createdAt: iso(row.created_at) })
const mapEvent = (row: RowDataPacket): ItemStatusEvent => ({ id: row.id, itemId: row.item_id, toStatus: row.to_status, createdAt: iso(row.created_at), ...(row.from_status == null ? {} : { fromStatus: row.from_status }) })
const mapTombstone = (row: RowDataPacket): MethodTombstone => ({ methodId: row.method_id, title: row.title, permanentlyDeletedAt: iso(row.permanently_deleted_at), versions: typeof row.versions === 'string' ? JSON.parse(row.versions) : row.versions })
