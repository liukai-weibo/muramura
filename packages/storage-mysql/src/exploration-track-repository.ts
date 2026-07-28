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
} from '@knowledge-base/contracts'
import { assertItemTitleLength, createId, normalizeItemTitle } from '@knowledge-base/domain'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { runInMySqlTransaction } from './index'

type TrackRow = RowDataPacket & { id: string; name: string; normalized_name: string; created_at: string | Date; updated_at: string | Date; deleted_at: string | Date | null }
type ItemRow = RowDataPacket & { id: string; title: string; content: string; status: ItemStatus; start_action: string | null; created_at: string | Date; updated_at: string | Date; deleted_at: string | Date | null; exploration_track_id: string | null }
type ReviewRow = RowDataPacket & { item_id: string; actual_action: string; result: string }

const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`
const mysqlDateTime = (value: string) => value.replace('T', ' ').replace('Z', '')
const mapTrack = (row: TrackRow): ExplorationTrack => ({ id: row.id, name: row.name, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.deleted_at == null ? {} : { deletedAt: iso(row.deleted_at) }) })
const mapItem = (row: ItemRow): Item => ({ id: row.id, title: row.title, content: row.content, status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.start_action == null ? {} : { startAction: row.start_action }), ...(row.deleted_at == null ? {} : { deletedAt: iso(row.deleted_at) }), ...(row.exploration_track_id == null ? {} : { explorationTrackId: row.exploration_track_id }) })
const currentStatuses: readonly CurrentAssociatedStatus[] = ['doing', 'idea_to_try', 'idea_later', 'paused']

export class ExplorationTrackError extends Error {
  constructor(message: string, readonly code: 'not-found' | 'deleted' | 'conflict' | 'item-not-found' | 'unavailable' | 'invalid-status') { super(message); this.name = 'ExplorationTrackError' }
}

export interface MySqlExplorationTrackRepositoryTestHooks {
  beforeTrackInsert?: () => Promise<void> | void
  beforeItemInsert?: () => Promise<void> | void
  beforeStatusEventInsert?: () => Promise<void> | void
  beforeItemUpdate?: () => Promise<void> | void
  beforeCommit?: () => Promise<void> | void
}

export class MySqlExplorationTrackRepository implements ExplorationTrackRepository, ExplorationTrackWorkflowRepository {
  constructor(private readonly pool: Pool, private readonly hooks?: MySqlExplorationTrackRepositoryTestHooks) {}

  async create(input: { id: string; name: string; normalizedName: string; createdAt: string }): Promise<ExplorationTrack> {
    try {
      await this.pool.execute('INSERT INTO exploration_tracks(id,name,normalized_name,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,NULL)', [input.id, input.name, input.normalizedName, mysqlDateTime(input.createdAt), mysqlDateTime(input.createdAt)])
    } catch (error) { throw this.mapConflict(error) }
    return { id: input.id, name: input.name, createdAt: input.createdAt, updatedAt: input.createdAt }
  }

  async getById(id: string): Promise<ExplorationTrack | undefined> {
    const [rows] = await this.pool.query<TrackRow[]>('SELECT * FROM exploration_tracks WHERE id=?', [id])
    return rows[0] && mapTrack(rows[0])
  }

  async rename(id: string, input: { name: string; normalizedName: string; updatedAt: string }): Promise<ExplorationTrack> {
    return runInMySqlTransaction(this.pool, async connection => {
      const track = await this.lockTrack(connection, id)
      if (!track) throw new ExplorationTrackError('探索主线不存在', 'not-found')
      if (track.deletedAt) throw new ExplorationTrackError('探索主线已删除', 'deleted')
      try { await connection.execute('UPDATE exploration_tracks SET name=?,normalized_name=?,updated_at=? WHERE id=?', [input.name, input.normalizedName, mysqlDateTime(input.updatedAt), id]) }
      catch (error) { throw this.mapConflict(error) }
      return { ...track, name: input.name, updatedAt: input.updatedAt }
    })
  }

  async softDelete(id: string, deletedAt: string): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      const track = await this.lockTrack(connection, id)
      if (!track || track.deletedAt) throw new ExplorationTrackError('探索主线不存在', 'not-found')
      await connection.execute('UPDATE exploration_tracks SET deleted_at=?,updated_at=? WHERE id=?', [mysqlDateTime(deletedAt), mysqlDateTime(deletedAt), id])
    })
  }

  async restore(id: string, updatedAt: string): Promise<ExplorationTrack> {
    return runInMySqlTransaction(this.pool, async connection => {
      const track = await this.lockTrack(connection, id)
      if (!track || !track.deletedAt) throw new ExplorationTrackError('探索主线不存在', 'not-found')
      await connection.execute('UPDATE exploration_tracks SET deleted_at=NULL,updated_at=? WHERE id=?', [mysqlDateTime(updatedAt), id])
      const { deletedAt: _deletedAt, ...active } = track
      return { ...active, updatedAt }
    })
  }

  async listActive(): Promise<ExplorationTrackListEntry[]> {
    const [tracks] = await this.pool.query<TrackRow[]>('SELECT * FROM exploration_tracks WHERE deleted_at IS NULL ORDER BY updated_at DESC,id ASC')
    const result: ExplorationTrackListEntry[] = []
    for (const track of tracks) {
      const [items] = await this.pool.query<ItemRow[]>('SELECT * FROM items WHERE exploration_track_id=? AND deleted_at IS NULL ORDER BY created_at DESC,id ASC LIMIT 1', [track.id])
      result.push({ track: mapTrack(track), ...(items[0] ? { latestAssociatedItem: mapItem(items[0]) } : {}) })
    }
    return result
  }

  async listSelectable(): Promise<ExplorationTrack[]> {
    const [rows] = await this.pool.query<TrackRow[]>('SELECT * FROM exploration_tracks WHERE deleted_at IS NULL ORDER BY normalized_name ASC,id ASC')
    return rows.map(mapTrack)
  }

  async listDeleted(): Promise<DeletedExplorationTrackListEntry[]> {
    const [rows] = await this.pool.query<TrackRow[]>('SELECT * FROM exploration_tracks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC,id ASC')
    return rows.map(row => ({ track: mapTrack(row) as Required<ExplorationTrack> }))
  }

  async getHistory(id: string): Promise<ExplorationTrackHistory | undefined> {
    const track = await this.getById(id)
    if (!track) return undefined
    const [rows] = await this.pool.query<ItemRow[]>('SELECT * FROM items WHERE exploration_track_id=? AND deleted_at IS NULL ORDER BY created_at DESC,id ASC', [id])
    const entries = await this.historyEntries(rows)
    const currentAssociatedItems = currentStatuses.map(status => {
      const items = entries.filter(entry => entry.item.status === status)
      return items.length ? { status, items: items.slice(0, 3), hasMore: items.length > 3, ...(items.length > 3 ? { moreLocator: { status, explorationTrackId: id } } : {}) } : undefined
    }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    return { track, lifecycle: track.deletedAt ? 'deleted' : 'active', currentAssociatedItems, history: entries.filter(entry => entry.item.status !== 'abandoned'), abandonedHistory: entries.filter(entry => entry.item.status === 'abandoned') }
  }

  async getItemContext(itemId: string): Promise<ItemExplorationTrackContext | undefined> {
    const [items] = await this.pool.query<ItemRow[]>('SELECT * FROM items WHERE id=?', [itemId])
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
    if (!currentStatuses.includes(status)) throw new ExplorationTrackError('受限状态参数无效', 'invalid-status')
    const [rows] = await this.pool.query<ItemRow[]>('SELECT * FROM items WHERE exploration_track_id=? AND status=? AND deleted_at IS NULL ORDER BY updated_at DESC,id ASC', [trackId, status])
    return rows.map(mapItem)
  }

  async createItemWithExplorationTrack(input: CreateItemInput & { id: string; createdAt: string }, selection: PreparedExplorationTrackSelection): Promise<Item> {
    return runInMySqlTransaction(this.pool, async connection => {
      const title = normalizeItemTitle(input.title)
      if (!title) throw new Error('标题不能为空')
      assertItemTitleLength(title)
      let trackId: string
      if (selection.type === 'existing') {
        const track = await this.lockActiveTrack(connection, selection.trackId)
        if (!track) throw new ExplorationTrackError('探索主线不存在或已删除', 'not-found')
        trackId = track.id
      } else {
        const normalizedName = selection.normalizedName
        if (!normalizedName) throw new Error('缺少主线规范名')
        trackId = createId()
        try {
          await this.hooks?.beforeTrackInsert?.()
          await connection.execute('INSERT INTO exploration_tracks(id,name,normalized_name,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,NULL)', [trackId, selection.name, normalizedName, mysqlDateTime(input.createdAt), mysqlDateTime(input.createdAt)])
        }
        catch (error) { throw this.mapConflict(error) }
      }
      const item: Item = { id: input.id, title, content: input.content ?? '', status: input.status ?? 'idea_to_try', createdAt: input.createdAt, updatedAt: input.createdAt, explorationTrackId: trackId }
      await this.hooks?.beforeItemInsert?.()
      await connection.execute('INSERT INTO items(id,title,content,status,start_action,created_at,updated_at,deleted_at,exploration_track_id) VALUES(?,?,?,?,NULL,?,?,NULL,?)', [item.id, item.title, item.content, item.status, mysqlDateTime(item.createdAt), mysqlDateTime(item.updatedAt), trackId])
      await this.hooks?.beforeStatusEventInsert?.()
      await connection.execute('INSERT INTO item_status_events(id,item_id,from_status,to_status,created_at) VALUES(?,?,NULL,?,?)', [createId(), item.id, item.status, mysqlDateTime(item.createdAt)])
      await this.hooks?.beforeCommit?.()
      return item
    })
  }

  async assignItemToExplorationTrack(itemId: string, trackId: string): Promise<ItemExplorationTrackContext> {
    return runInMySqlTransaction(this.pool, async connection => {
      const item = await this.lockActiveItem(connection, itemId)
      if (!item) throw new ExplorationTrackError('事项不存在', 'item-not-found')
      if (item.status === 'abandoned') throw new ExplorationTrackError('已放弃事项的探索关联只读', 'invalid-status')
      const tracks = await this.lockTracksOrdered(connection, [item.exploration_track_id, trackId])
      const currentTrack = item.exploration_track_id ? tracks.get(item.exploration_track_id) : undefined
      if (item.exploration_track_id && !currentTrack) throw new ExplorationTrackError('关联不可用', 'unavailable')
      if (currentTrack?.deletedAt) throw new ExplorationTrackError('原关联探索主线已删除', 'deleted')
      const track = tracks.get(trackId)
      if (!track) throw new ExplorationTrackError('目标探索主线不存在', 'not-found')
      if (track.deletedAt) throw new ExplorationTrackError('目标探索主线已删除', 'deleted')
      await this.hooks?.beforeItemUpdate?.()
      await connection.execute('UPDATE items SET exploration_track_id=?,updated_at=? WHERE id=?', [trackId, mysqlDateTime(new Date().toISOString()), itemId])
      return { status: 'available', itemId, track: track as AvailableExplorationTrack }
    })
  }

  async removeItemFromExplorationTrack(itemId: string): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      const item = await this.lockActiveItem(connection, itemId)
      if (!item) throw new ExplorationTrackError('事项不存在', 'item-not-found')
      if (item.status === 'abandoned') throw new ExplorationTrackError('已放弃事项的探索关联只读', 'invalid-status')
      if (item.exploration_track_id) {
        const track = await this.lockTrack(connection, item.exploration_track_id)
        if (!track) throw new ExplorationTrackError('关联不可用', 'unavailable')
        if (track.deletedAt) throw new ExplorationTrackError('原关联探索主线已删除', 'deleted')
      }
      await this.hooks?.beforeItemUpdate?.()
      await connection.execute('UPDATE items SET exploration_track_id=NULL,updated_at=? WHERE id=?', [mysqlDateTime(new Date().toISOString()), itemId])
    })
  }

  private async historyEntries(rows: ItemRow[]): Promise<ExplorationTrackItem[]> {
    const entries: ExplorationTrackItem[] = []
    for (const row of rows) {
      const item = mapItem(row)
      const [reviews] = await this.pool.query<ReviewRow[]>('SELECT item_id,actual_action,result FROM reviews WHERE item_id=?', [item.id])
      const review = reviews[0]
      entries.push({ item, locator: { itemId: item.id, status: item.status }, ...(review ? { reviewSummary: { actualAction: review.actual_action, result: review.result }, reviewSummaryStatus: 'available' as const } : { reviewSummaryStatus: 'not-reviewed' as const }) })
    }
    return entries
  }

  private async lockTrack(connection: PoolConnection, id: string): Promise<ExplorationTrack | undefined> {
    const [rows] = await connection.query<TrackRow[]>('SELECT * FROM exploration_tracks WHERE id=? FOR UPDATE', [id])
    return rows[0] && mapTrack(rows[0])
  }
  private async lockActiveTrack(connection: PoolConnection, id: string): Promise<ExplorationTrack | undefined> {
    const [rows] = await connection.query<TrackRow[]>('SELECT * FROM exploration_tracks WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id])
    return rows[0] && mapTrack(rows[0])
  }
  private async lockActiveItem(connection: PoolConnection, id: string): Promise<ItemRow | undefined> {
    const [rows] = await connection.query<ItemRow[]>('SELECT * FROM items WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id])
    return rows[0]
  }
  private async lockTracksOrdered(connection: PoolConnection, ids: Array<string | null>): Promise<Map<string, ExplorationTrack>> {
    const uniqueIds = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort()
    if (uniqueIds.length === 0) return new Map()
    const placeholders = uniqueIds.map(() => '?').join(',')
    const [rows] = await connection.query<TrackRow[]>(`SELECT * FROM exploration_tracks WHERE id IN (${placeholders}) ORDER BY id ASC FOR UPDATE`, uniqueIds)
    return new Map(rows.map(row => {
      const track = mapTrack(row)
      return [track.id, track]
    }))
  }

  private mapConflict(error: unknown): Error {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY' ? new ExplorationTrackError('已存在同名探索主线', 'conflict') : error as Error
  }
}
