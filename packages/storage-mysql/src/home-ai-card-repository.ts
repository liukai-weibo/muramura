import crypto from 'node:crypto'
import type {
  CurrentUserScope,
  HomeAiCard,
  HomeAiCardCache,
  HomeAiCardCacheInput,
  HomeAiCardInput,
  HomeAiCardRepository,
  HomeAiCardBackupStore,
} from '@knowledge-base/contracts'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { runInMySqlTransaction } from './index'

type HomeAiCardRow = RowDataPacket & {
  id: string
  card_title: string
  ai_prompt: string
  card_size: string
  card_theme: string
  refresh_mode: string
  sort_index: number
  is_hidden: number
  created_at: string | Date
  updated_at: string | Date
}

type HomeAiCardCacheRow = RowDataPacket & {
  id: string
  card_id: string
  cache_date: string
  ai_output: string
  created_at: string | Date
  updated_at: string | Date
}

const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : value.replace(' ', 'T') + 'Z'
const sqlDate = (value: string) => value.replace('T', ' ').replace('Z', '')

const mapCard = (row: HomeAiCardRow): HomeAiCard => ({
  id: row.id,
  cardTitle: row.card_title,
  aiPrompt: row.ai_prompt,
  cardSize: row.card_size as HomeAiCard['cardSize'],
  cardTheme: row.card_theme as HomeAiCard['cardTheme'],
  refreshMode: row.refresh_mode as HomeAiCard['refreshMode'],
  sortIndex: row.sort_index,
  isHidden: row.is_hidden === 1,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
})

const mapCache = (row: HomeAiCardCacheRow): HomeAiCardCache => ({
  id: row.id,
  cardId: row.card_id,
  cacheDate: String(row.cache_date),
  aiOutput: row.ai_output,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
})

const cardColumns = "id, card_title, ai_prompt, card_size, card_theme, refresh_mode, sort_index, is_hidden, created_at, updated_at"
const cacheColumns = "id, owner_user_id, card_id, DATE_FORMAT(cache_date, '%Y-%m-%d') AS cache_date, ai_output, created_at, updated_at"

export class MySqlHomeAiCardRepository implements HomeAiCardRepository, HomeAiCardBackupStore {
  constructor(private readonly pool: Pool, private readonly scope: CurrentUserScope) {}

  async list(): Promise<HomeAiCard[]> {
    const [rows] = await this.pool.query<HomeAiCardRow[]>(
      `SELECT ${cardColumns} FROM user_home_ai_cards WHERE owner_user_id=? ORDER BY sort_index ASC, created_at ASC`,
      [this.scope.userId],
    )
    return rows.map(mapCard)
  }

  async get(id: string): Promise<HomeAiCard | undefined> {
    const [rows] = await this.pool.query<HomeAiCardRow[]>(
      `SELECT ${cardColumns} FROM user_home_ai_cards WHERE owner_user_id=? AND id=?`,
      [this.scope.userId, id],
    )
    const first = rows[0]
    return first ? mapCard(first) : undefined
  }

  async create(input: HomeAiCardInput): Promise<HomeAiCard> {
    return runInMySqlTransaction(this.pool, async connection => {
      const [maxRows] = await connection.query<Array<RowDataPacket & { m: number | null }>>(
        'SELECT MAX(sort_index) AS m FROM user_home_ai_cards WHERE owner_user_id=?',
        [this.scope.userId],
      )
      const sortIndex = (maxRows[0]?.m ?? -1) + 1
      const id = crypto.randomUUID()
      await connection.execute(
        `INSERT INTO user_home_ai_cards(id, owner_user_id, card_title, ai_prompt, card_size, card_theme, refresh_mode, sort_index, is_hidden, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [id, this.scope.userId, input.cardTitle, input.aiPrompt, input.cardSize, input.cardTheme, input.refreshMode, sortIndex],
      )
      const [rows] = await connection.query<HomeAiCardRow[]>(`SELECT ${cardColumns} FROM user_home_ai_cards WHERE owner_user_id=? AND id=?`, [this.scope.userId, id])
      return mapCard(rows[0]!)
    })
  }

  async update(id: string, input: HomeAiCardInput): Promise<HomeAiCard | undefined> {
    return runInMySqlTransaction(this.pool, async connection => {
      const result = await connection.execute(
        `UPDATE user_home_ai_cards SET card_title=?, ai_prompt=?, card_size=?, card_theme=?, refresh_mode=?, updated_at=UTC_TIMESTAMP(3) WHERE owner_user_id=? AND id=?`,
        [input.cardTitle, input.aiPrompt, input.cardSize, input.cardTheme, input.refreshMode, this.scope.userId, id],
      )
      if (!('affectedRows' in result[0]) || result[0].affectedRows === 0) return undefined
      const [rows] = await connection.query<HomeAiCardRow[]>(`SELECT ${cardColumns} FROM user_home_ai_cards WHERE owner_user_id=? AND id=?`, [this.scope.userId, id])
      return rows[0] ? mapCard(rows[0]) : undefined
    })
  }

  async delete(id: string): Promise<boolean> {
    return runInMySqlTransaction(this.pool, async connection => {
      await connection.execute('DELETE FROM user_home_ai_card_caches WHERE owner_user_id=? AND card_id=?', [this.scope.userId, id])
      const result = await connection.execute('DELETE FROM user_home_ai_cards WHERE owner_user_id=? AND id=?', [this.scope.userId, id])
      return 'affectedRows' in result[0] && result[0].affectedRows > 0
    })
  }

  async listCaches(cacheDate: string): Promise<HomeAiCardCache[]> {
    const [rows] = await this.pool.query<HomeAiCardCacheRow[]>(
      `SELECT ${cacheColumns} FROM user_home_ai_card_caches WHERE owner_user_id=? AND cache_date=? ORDER BY card_id ASC`,
      [this.scope.userId, cacheDate],
    )
    return rows.map(mapCache)
  }

  async getCache(cardId: string, cacheDate: string): Promise<HomeAiCardCache | undefined> {
    const [rows] = await this.pool.query<HomeAiCardCacheRow[]>(
      `SELECT ${cacheColumns} FROM user_home_ai_card_caches WHERE owner_user_id=? AND card_id=? AND cache_date=?`,
      [this.scope.userId, cardId, cacheDate],
    )
    const first = rows[0]
    return first ? mapCache(first) : undefined
  }

  async upsertCache(cardId: string, cache: HomeAiCardCacheInput): Promise<HomeAiCardCache> {
    return runInMySqlTransaction(this.pool, async connection => {
      await connection.execute(
        `INSERT INTO user_home_ai_card_caches(id, owner_user_id, card_id, cache_date, ai_output, created_at, updated_at)
         VALUES(?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE ai_output=VALUES(ai_output), updated_at=UTC_TIMESTAMP(3)`,
        [crypto.randomUUID(), this.scope.userId, cardId, cache.cacheDate, cache.aiOutput],
      )
      const [rows] = await connection.query<HomeAiCardCacheRow[]>(
        `SELECT ${cacheColumns} FROM user_home_ai_card_caches WHERE owner_user_id=? AND card_id=? AND cache_date=?`,
        [this.scope.userId, cardId, cache.cacheDate],
      )
      return mapCache(rows[0]!)
    })
  }

  async exportBackup(): Promise<{ cards: HomeAiCard[]; caches: HomeAiCardCache[] }> {
    const [cardRows] = await this.pool.query<HomeAiCardRow[]>(`SELECT ${cardColumns} FROM user_home_ai_cards WHERE owner_user_id=? ORDER BY sort_index ASC`, [this.scope.userId])
    const [cacheRows] = await this.pool.query<HomeAiCardCacheRow[]>(`SELECT ${cacheColumns} FROM user_home_ai_card_caches WHERE owner_user_id=? ORDER BY card_id ASC, cache_date ASC`, [this.scope.userId])
    return { cards: cardRows.map(mapCard), caches: cacheRows.map(mapCache) }
  }

  async replaceBackup(values: { cards: HomeAiCard[]; caches: HomeAiCardCache[] }): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      await connection.execute('DELETE FROM user_home_ai_card_caches WHERE owner_user_id=?', [this.scope.userId])
      await connection.execute('DELETE FROM user_home_ai_cards WHERE owner_user_id=?', [this.scope.userId])
      for (const card of values.cards) {
        await connection.execute(
          `INSERT INTO user_home_ai_cards(id, owner_user_id, card_title, ai_prompt, card_size, card_theme, refresh_mode, sort_index, is_hidden, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          [card.id || crypto.randomUUID(), this.scope.userId, card.cardTitle, card.aiPrompt, card.cardSize, card.cardTheme, card.refreshMode, card.sortIndex, card.isHidden ? 1 : 0, sqlDate(card.createdAt), sqlDate(card.updatedAt)],
        )
      }
      for (const cache of values.caches) {
        await connection.execute(
          `INSERT INTO user_home_ai_card_caches(id, owner_user_id, card_id, cache_date, ai_output, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?)`,
          [cache.id || crypto.randomUUID(), this.scope.userId, cache.cardId, cache.cacheDate, cache.aiOutput, sqlDate(cache.createdAt), sqlDate(cache.updatedAt)],
        )
      }
    })
  }
}
