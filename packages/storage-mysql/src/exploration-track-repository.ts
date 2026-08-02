import type {
  AvailableExplorationTrack,
  CreateItemInput,
  CurrentAssociatedStatus,
  DeletedExplorationTrackListEntry,
  ExplorationTrack,
  ExplorationTrackHistory,
  ExplorationTrackItem,
  ExplorationTrackListEntry,
  ExplorationTrackRepository,
  ExplorationTrackWorkflowRepository,
  PreparedExplorationTrackSelection,
  Item,
  ItemExplorationTrackContext,
  ItemStatus,
  CurrentUserScope,
} from '@knowledge-base/contracts'
import { assertItemTitleLength, createId, normalizeItemTitle } from '@knowledge-base/domain'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { businessError, rethrowDuplicateAsBusinessError } from './errors'
import { runInMySqlTransaction } from './index'

type TrackRow = RowDataPacket & { id: string; name: string; normalized_name: string; created_at: string | Date; updated_at: string | Date; deleted_at: string | Date | null }
type ItemRow = RowDataPacket & { id: string; title: string; content: string; status: ItemStatus; start_action: string | null; created_at: string | Date; updated_at: string | Date; deleted_at: string | Date | null; exploration_track_id: string | null }
type ReviewRow = RowDataPacket & { item_id: string; actual_action: string; result: string }

const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`
const mysqlDateTime = (value: string) => value.replace('T', ' ').replace('Z', '')
const mapTrack = (row: TrackRow): ExplorationTrack => ({ id: row.id, name: row.name, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.deleted_at == null ? {} : { deletedAt: iso(row.deleted_at) }) })
const mapItem = (row: ItemRow): Item => ({ id: row.id, title: row.title, content: row.content, status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.start_action == null ? {} : { startAction: row.start_action }), ...(row.deleted_at == null ? {} : { deletedAt: iso(row.deleted_at) }), ...(row.exploration_track_id == null ? {} : { explorationTrackId: row.exploration_track_id }) })
const currentStatuses: readonly CurrentAssociatedStatus[] = ['doing', 'idea_to_try', 'idea_later', 'paused']
const trackColumns = 'id, name, normalized_name, created_at, updated_at, deleted_at'
const itemColumns = 'id, title, content, status, start_action, created_at, updated_at, deleted_at, exploration_track_id'

export interface MySqlExplorationTrackRepositoryTestHooks {
  beforeTrackInsert?: () => Promise<void> | void
  beforeItemInsert?: () => Promise<void> | void
  beforeStatusEventInsert?: () => Promise<void> | void
  beforeItemUpdate?: () => Promise<void> | void
  beforeCommit?: () => Promise<void> | void
}

export class MySqlExplorationTrackRepository implements ExplorationTrackRepository, ExplorationTrackWorkflowRepository {
  constructor(private readonly pool: Pool, private readonly hooks?: MySqlExplorationTrackRepositoryTestHooks, private readonly scope?: CurrentUserScope) {}

  async create(input: { id: string; name: string; normalizedName: string; createdAt: string }): Promise<ExplorationTrack> {
    try {
      await this.pool.execute(this.scope ? 'INSERT INTO exploration_tracks(id,name,normalized_name,created_at,updated_at,deleted_at,owner_user_id) VALUES(?,?,?,?,?,NULL,?)' : 'INSERT INTO exploration_tracks(id,name,normalized_name,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,NULL)', this.scope ? [input.id, input.name, input.normalizedName, mysqlDateTime(input.createdAt), mysqlDateTime(input.createdAt), this.scope.userId] : [input.id, input.name, input.normalizedName, mysqlDateTime(input.createdAt), mysqlDateTime(input.createdAt)])
    } catch (error) { this.rethrowNameConflict(error) }
    return { id: input.id, name: input.name, createdAt: input.createdAt, updatedAt: input.createdAt }
  }

  async getById(id: string): Promise<ExplorationTrack | undefined> {
    const [rows] = await this.pool.query<TrackRow[]>(this.scope ? `SELECT ${trackColumns} FROM exploration_tracks WHERE id=? AND owner_user_id=?` : `SELECT ${trackColumns} FROM exploration_tracks WHERE id=?`, this.scope ? [id, this.scope.userId] : [id])
    return rows[0] && mapTrack(rows[0])
  }

  async rename(id: string, input: { name: string; normalizedName: string; updatedAt: string }): Promise<ExplorationTrack> {
    return runInMySqlTransaction(this.pool, async connection => {
      const track = await this.lockTrack(connection, id)
      if (!track) {
        throw businessError('EXPLORATION_TRACK_NOT_FOUND', '探索主线不存在')
      }
      if (track.deletedAt) {
        throw businessError('EXPLORATION_TRACK_DELETED', '探索主线已删除')
      }
      try { await connection.execute(this.scope ? 'UPDATE exploration_tracks SET name=?,normalized_name=?,updated_at=? WHERE id=? AND owner_user_id=?' : 'UPDATE exploration_tracks SET name=?,normalized_name=?,updated_at=? WHERE id=?', this.scope ? [input.name, input.normalizedName, mysqlDateTime(input.updatedAt), id, this.scope.userId] : [input.name, input.normalizedName, mysqlDateTime(input.updatedAt), id]) }
      catch (error) { this.rethrowNameConflict(error) }
      return { ...track, name: input.name, updatedAt: input.updatedAt }
    })
  }

  async softDelete(id: string, deletedAt: string): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      const track = await this.lockTrack(connection, id)
      if (!track || track.deletedAt) {
        throw businessError('EXPLORATION_TRACK_NOT_FOUND', '探索主线不存在')
      }
      await connection.execute(this.scope ? 'UPDATE exploration_tracks SET deleted_at=?,updated_at=? WHERE id=? AND owner_user_id=?' : 'UPDATE exploration_tracks SET deleted_at=?,updated_at=? WHERE id=?', this.scope ? [mysqlDateTime(deletedAt), mysqlDateTime(deletedAt), id, this.scope.userId] : [mysqlDateTime(deletedAt), mysqlDateTime(deletedAt), id])
    })
  }

  async restore(id: string, updatedAt: string): Promise<ExplorationTrack> {
    return runInMySqlTransaction(this.pool, async connection => {
      const track = await this.lockTrack(connection, id)
      if (!track || !track.deletedAt) {
        throw businessError('EXPLORATION_TRACK_NOT_FOUND', '探索主线不存在')
      }
      await connection.execute(this.scope ? 'UPDATE exploration_tracks SET deleted_at=NULL,updated_at=? WHERE id=? AND owner_user_id=?' : 'UPDATE exploration_tracks SET deleted_at=NULL,updated_at=? WHERE id=?', this.scope ? [mysqlDateTime(updatedAt), id, this.scope.userId] : [mysqlDateTime(updatedAt), id])
      const { deletedAt: _deletedAt, ...active } = track
      return { ...active, updatedAt }
    })
  }

  async listActive(): Promise<ExplorationTrackListEntry[]> {
    const [tracks] = await this.pool.query<TrackRow[]>(this.scope ? `SELECT ${trackColumns} FROM exploration_tracks WHERE deleted_at IS NULL AND owner_user_id=? ORDER BY updated_at DESC,id ASC` : `SELECT ${trackColumns} FROM exploration_tracks WHERE deleted_at IS NULL ORDER BY updated_at DESC,id ASC`, this.scope ? [this.scope.userId] : [])
    if (tracks.length === 0) return []
    const trackIds = tracks.map(track => track.id)
    const trackPlaceholders = trackIds.map(() => '?').join(',')
    const [latestRows] = await this.pool.query<Array<RowDataPacket & { exploration_track_id: string; item_id: string | null }>>(
      this.scope
        ? `SELECT t.id AS exploration_track_id, (SELECT i.id FROM items i WHERE i.exploration_track_id = t.id AND i.deleted_at IS NULL AND i.owner_user_id=? ORDER BY i.created_at DESC, i.id ASC LIMIT 1) AS item_id FROM exploration_tracks t WHERE t.id IN (${trackPlaceholders}) AND t.owner_user_id=?`
        : `SELECT t.id AS exploration_track_id, (SELECT i.id FROM items i WHERE i.exploration_track_id = t.id AND i.deleted_at IS NULL ORDER BY i.created_at DESC, i.id ASC LIMIT 1) AS item_id FROM exploration_tracks t WHERE t.id IN (${trackPlaceholders})`,
      this.scope ? [this.scope.userId, ...trackIds, this.scope.userId] : trackIds,
    )
    const latestItemIdByTrackId = new Map<string, string>()
    const latestItemIds: string[] = []
    for (const row of latestRows) {
      if (row.item_id) {
        latestItemIdByTrackId.set(row.exploration_track_id, row.item_id)
        latestItemIds.push(row.item_id)
      }
    }
    const itemById = new Map<string, ItemRow>()
    if (latestItemIds.length > 0) {
      const itemPlaceholders = latestItemIds.map(() => '?').join(',')
      const [items] = await this.pool.query<ItemRow[]>(this.scope ? `SELECT ${itemColumns} FROM items WHERE id IN (${itemPlaceholders}) AND owner_user_id=?` : `SELECT ${itemColumns} FROM items WHERE id IN (${itemPlaceholders})`, this.scope ? [...latestItemIds, this.scope.userId] : latestItemIds)
      for (const item of items) itemById.set(item.id, item)
    }
    return tracks.map(track => {
      const latestItemId = latestItemIdByTrackId.get(track.id)
      const latestItem = latestItemId ? itemById.get(latestItemId) : undefined
      return { track: mapTrack(track), ...(latestItem ? { latestAssociatedItem: mapItem(latestItem) } : {}) }
    })
  }

  async listSelectable(): Promise<ExplorationTrack[]> {
    const [rows] = await this.pool.query<TrackRow[]>(this.scope ? `SELECT ${trackColumns} FROM exploration_tracks WHERE deleted_at IS NULL AND owner_user_id=? ORDER BY normalized_name ASC,id ASC` : `SELECT ${trackColumns} FROM exploration_tracks WHERE deleted_at IS NULL ORDER BY normalized_name ASC,id ASC`, this.scope ? [this.scope.userId] : [])
    return rows.map(mapTrack)
  }

  async listDeleted(): Promise<DeletedExplorationTrackListEntry[]> {
    const [rows] = await this.pool.query<TrackRow[]>(this.scope ? `SELECT ${trackColumns} FROM exploration_tracks WHERE deleted_at IS NOT NULL AND owner_user_id=? ORDER BY deleted_at DESC,id ASC` : `SELECT ${trackColumns} FROM exploration_tracks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC,id ASC`, this.scope ? [this.scope.userId] : [])
    return rows.map(row => ({ track: mapTrack(row) as Required<ExplorationTrack> }))
  }

  async getHistory(id: string): Promise<ExplorationTrackHistory | undefined> {
    const track = await this.getById(id)
    if (!track) return undefined
    const [rows] = await this.pool.query<ItemRow[]>(this.scope ? `SELECT ${itemColumns} FROM items WHERE exploration_track_id=? AND deleted_at IS NULL AND owner_user_id=? ORDER BY created_at DESC,id ASC` : `SELECT ${itemColumns} FROM items WHERE exploration_track_id=? AND deleted_at IS NULL ORDER BY created_at DESC,id ASC`, this.scope ? [id, this.scope.userId] : [id])
    const entries = await this.historyEntries(rows)
    const currentAssociatedItems = currentStatuses.map(status => {
      const items = entries.filter(entry => entry.item.status === status)
      return items.length ? { status, items: items.slice(0, 3), hasMore: items.length > 3, ...(items.length > 3 ? { moreLocator: { status, explorationTrackId: id } } : {}) } : undefined
    }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    return { track, lifecycle: track.deletedAt ? 'deleted' : 'active', currentAssociatedItems, history: entries.filter(entry => entry.item.status !== 'abandoned'), abandonedHistory: entries.filter(entry => entry.item.status === 'abandoned') }
  }

  async getItemContext(itemId: string): Promise<ItemExplorationTrackContext | undefined> {
    const [items] = await this.pool.query<ItemRow[]>(this.scope ? `SELECT ${itemColumns} FROM items WHERE id=? AND owner_user_id=?` : `SELECT ${itemColumns} FROM items WHERE id=?`, this.scope ? [itemId, this.scope.userId] : [itemId])
    const item = items[0]
    if (!item) return undefined
    if (item.exploration_track_id == null) return { status: 'no-association', itemId }
    const track = await this.getById(item.exploration_track_id)
    if (!track) return { status: 'unavailable', itemId, trackId: item.exploration_track_id }
    return track.deletedAt
      ? { status: 'track-deleted', itemId, track: { ...track, deletedAt: track.deletedAt } }
      : { status: 'available', itemId, track: track as AvailableExplorationTrack }
  }

  async listItemsByTrackAndStatus(trackId: string, status: CurrentAssociatedStatus): Promise<Item[]> {
    if (!currentStatuses.includes(status)) {
      throw businessError(
        'EXPLORATION_TRACK_STATUS_INVALID',
        '受限状态参数无效',
      )
    }
    if (this.scope && !(await this.getById(trackId))) throw businessError('EXPLORATION_TRACK_NOT_FOUND', '探索主线不存在')
    const [rows] = await this.pool.query<ItemRow[]>(this.scope ? `SELECT ${itemColumns} FROM items WHERE exploration_track_id=? AND status=? AND deleted_at IS NULL AND owner_user_id=? ORDER BY updated_at DESC,id ASC` : `SELECT ${itemColumns} FROM items WHERE exploration_track_id=? AND status=? AND deleted_at IS NULL ORDER BY updated_at DESC,id ASC`, this.scope ? [trackId, status, this.scope.userId] : [trackId, status])
    return rows.map(mapItem)
  }

  async createItemWithExplorationTrack(input: CreateItemInput & { id: string; createdAt: string }, selection: PreparedExplorationTrackSelection): Promise<Item> {
    return runInMySqlTransaction(this.pool, async connection => {
      const title = normalizeItemTitle(input.title)
      if (!title) throw businessError('ITEM_TITLE_REQUIRED', '标题不能为空')
      assertItemTitleLength(title)
      let trackId: string
      if (selection.type === 'existing') {
        const track = await this.lockActiveTrack(connection, selection.trackId)
        if (!track) {
          throw businessError(
            'EXPLORATION_TRACK_NOT_FOUND',
            '探索主线不存在或已删除',
          )
        }
        trackId = track.id
      } else {
        const normalizedName = selection.normalizedName
        if (!normalizedName) {
          throw businessError(
            'EXPLORATION_TRACK_NORMALIZED_NAME_MISSING',
            '缺少主线规范名',
          )
        }
        trackId = createId()
        try {
          await this.hooks?.beforeTrackInsert?.()
          await connection.execute(this.scope ? 'INSERT INTO exploration_tracks(id,name,normalized_name,created_at,updated_at,deleted_at,owner_user_id) VALUES(?,?,?,?,?,NULL,?)' : 'INSERT INTO exploration_tracks(id,name,normalized_name,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,NULL)', this.scope ? [trackId, selection.name, normalizedName, mysqlDateTime(input.createdAt), mysqlDateTime(input.createdAt), this.scope.userId] : [trackId, selection.name, normalizedName, mysqlDateTime(input.createdAt), mysqlDateTime(input.createdAt)])
        }
        catch (error) { this.rethrowNameConflict(error) }
      }
      const item: Item = { id: input.id, title, content: input.content ?? '', status: input.status ?? 'idea_to_try', createdAt: input.createdAt, updatedAt: input.createdAt, explorationTrackId: trackId }
      await this.hooks?.beforeItemInsert?.()
      await connection.execute(this.scope ? 'INSERT INTO items(id,title,content,status,start_action,created_at,updated_at,deleted_at,exploration_track_id,owner_user_id) VALUES(?,?,?,?,NULL,?,?,NULL,?,?)' : 'INSERT INTO items(id,title,content,status,start_action,created_at,updated_at,deleted_at,exploration_track_id) VALUES(?,?,?,?,NULL,?,?,NULL,?)', this.scope ? [item.id, item.title, item.content, item.status, mysqlDateTime(item.createdAt), mysqlDateTime(item.updatedAt), trackId, this.scope.userId] : [item.id, item.title, item.content, item.status, mysqlDateTime(item.createdAt), mysqlDateTime(item.updatedAt), trackId])
      await this.hooks?.beforeStatusEventInsert?.()
      await connection.execute(this.scope ? 'INSERT INTO item_status_events(id,item_id,from_status,to_status,created_at,owner_user_id) VALUES(?,?,NULL,?,?,?)' : 'INSERT INTO item_status_events(id,item_id,from_status,to_status,created_at) VALUES(?,?,NULL,?,?)', this.scope ? [createId(), item.id, item.status, mysqlDateTime(item.createdAt), this.scope.userId] : [createId(), item.id, item.status, mysqlDateTime(item.createdAt)])
      await this.hooks?.beforeCommit?.()
      return item
    })
  }

  async assignItemToExplorationTrack(itemId: string, trackId: string): Promise<ItemExplorationTrackContext> {
    return runInMySqlTransaction(this.pool, async connection => {
      const item = await this.lockActiveItem(connection, itemId)
      if (!item) throw businessError('ITEM_NOT_FOUND', '事项不存在')
      if (item.status === 'abandoned') {
        throw businessError(
          'EXPLORATION_TRACK_ASSOCIATION_READ_ONLY',
          '已放弃事项的探索关联只读',
        )
      }
      const tracks = await this.lockTracksOrdered(connection, [item.exploration_track_id, trackId])
      const currentTrack = item.exploration_track_id ? tracks.get(item.exploration_track_id) : undefined
      if (item.exploration_track_id && !currentTrack) {
        throw businessError(
          'EXPLORATION_TRACK_ASSOCIATION_UNAVAILABLE',
          '关联不可用',
        )
      }
      if (currentTrack?.deletedAt) {
        throw businessError(
          'EXPLORATION_TRACK_DELETED',
          '原关联探索主线已删除',
        )
      }
      const track = tracks.get(trackId)
      if (!track) {
        throw businessError(
          'EXPLORATION_TRACK_NOT_FOUND',
          '目标探索主线不存在',
        )
      }
      if (track.deletedAt) {
        throw businessError(
          'EXPLORATION_TRACK_DELETED',
          '目标探索主线已删除',
        )
      }
      await this.hooks?.beforeItemUpdate?.()
      await connection.execute(this.scope ? 'UPDATE items SET exploration_track_id=?,updated_at=? WHERE id=? AND owner_user_id=?' : 'UPDATE items SET exploration_track_id=?,updated_at=? WHERE id=?', this.scope ? [trackId, mysqlDateTime(new Date().toISOString()), itemId, this.scope.userId] : [trackId, mysqlDateTime(new Date().toISOString()), itemId])
      return { status: 'available', itemId, track: track as AvailableExplorationTrack }
    })
  }

  async removeItemFromExplorationTrack(itemId: string): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      const item = await this.lockActiveItem(connection, itemId)
      if (!item) throw businessError('ITEM_NOT_FOUND', '事项不存在')
      if (item.status === 'abandoned') {
        throw businessError(
          'EXPLORATION_TRACK_ASSOCIATION_READ_ONLY',
          '已放弃事项的探索关联只读',
        )
      }
      if (item.exploration_track_id) {
        const track = await this.lockTrack(connection, item.exploration_track_id)
        if (!track) {
          throw businessError(
            'EXPLORATION_TRACK_ASSOCIATION_UNAVAILABLE',
            '关联不可用',
          )
        }
        if (track.deletedAt) {
          throw businessError(
            'EXPLORATION_TRACK_DELETED',
            '原关联探索主线已删除',
          )
        }
      }
      await this.hooks?.beforeItemUpdate?.()
      await connection.execute(this.scope ? 'UPDATE items SET exploration_track_id=NULL,updated_at=? WHERE id=? AND owner_user_id=?' : 'UPDATE items SET exploration_track_id=NULL,updated_at=? WHERE id=?', this.scope ? [mysqlDateTime(new Date().toISOString()), itemId, this.scope.userId] : [mysqlDateTime(new Date().toISOString()), itemId])
    })
  }

  private async historyEntries(rows: ItemRow[]): Promise<ExplorationTrackItem[]> {
    if (rows.length === 0) return []
    const itemIds = rows.map(row => row.id)
    const placeholders = itemIds.map(() => '?').join(',')
    const [reviews] = await this.pool.query<ReviewRow[]>(this.scope ? `SELECT item_id,actual_action,result FROM reviews WHERE item_id IN (${placeholders}) AND owner_user_id=?` : `SELECT item_id,actual_action,result FROM reviews WHERE item_id IN (${placeholders})`, this.scope ? [...itemIds, this.scope.userId] : itemIds)
    const reviewByItemId = new Map<string, ReviewRow>()
    for (const review of reviews) reviewByItemId.set(review.item_id, review)
    return rows.map(row => {
      const item = mapItem(row)
      const review = reviewByItemId.get(item.id)
      return { item, locator: { itemId: item.id, status: item.status }, ...(review ? { reviewSummary: { actualAction: review.actual_action, result: review.result }, reviewSummaryStatus: 'available' as const } : { reviewSummaryStatus: 'not-reviewed' as const }) }
    })
  }

  private async lockTrack(connection: PoolConnection, id: string): Promise<ExplorationTrack | undefined> {
    const [rows] = await connection.query<TrackRow[]>(this.scope ? `SELECT ${trackColumns} FROM exploration_tracks WHERE id=? AND owner_user_id=? FOR UPDATE` : `SELECT ${trackColumns} FROM exploration_tracks WHERE id=? FOR UPDATE`, this.scope ? [id, this.scope.userId] : [id])
    return rows[0] && mapTrack(rows[0])
  }
  private async lockActiveTrack(connection: PoolConnection, id: string): Promise<ExplorationTrack | undefined> {
    const [rows] = await connection.query<TrackRow[]>(this.scope ? `SELECT ${trackColumns} FROM exploration_tracks WHERE id=? AND deleted_at IS NULL AND owner_user_id=? FOR UPDATE` : `SELECT ${trackColumns} FROM exploration_tracks WHERE id=? AND deleted_at IS NULL FOR UPDATE`, this.scope ? [id, this.scope.userId] : [id])
    return rows[0] && mapTrack(rows[0])
  }
  private async lockActiveItem(connection: PoolConnection, id: string): Promise<ItemRow | undefined> {
    const [rows] = await connection.query<ItemRow[]>(this.scope ? `SELECT ${itemColumns} FROM items WHERE id=? AND deleted_at IS NULL AND owner_user_id=? FOR UPDATE` : `SELECT ${itemColumns} FROM items WHERE id=? AND deleted_at IS NULL FOR UPDATE`, this.scope ? [id, this.scope.userId] : [id])
    return rows[0]
  }
  private async lockTracksOrdered(connection: PoolConnection, ids: Array<string | null>): Promise<Map<string, ExplorationTrack>> {
    const uniqueIds = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort()
    if (uniqueIds.length === 0) return new Map()
    const placeholders = uniqueIds.map(() => '?').join(',')
    const [rows] = await connection.query<TrackRow[]>(this.scope ? `SELECT ${trackColumns} FROM exploration_tracks WHERE id IN (${placeholders}) AND owner_user_id=? ORDER BY id ASC FOR UPDATE` : `SELECT ${trackColumns} FROM exploration_tracks WHERE id IN (${placeholders}) ORDER BY id ASC FOR UPDATE`, this.scope ? [...uniqueIds, this.scope.userId] : uniqueIds)
    return new Map(rows.map(row => {
      const track = mapTrack(row)
      return [track.id, track]
    }))
  }

  private rethrowNameConflict(error: unknown): never {
    return rethrowDuplicateAsBusinessError(
      error,
      'EXPLORATION_TRACK_NAME_CONFLICT',
      '已存在同名探索主线',
    )
  }
}
