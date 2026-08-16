import crypto from 'node:crypto'
import type { CurrentUserScope, DailyNote, DailyNoteActionFact, DailyNoteBackupStore, DailyNoteRepository } from '@knowledge-base/contracts'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { runInMySqlTransaction } from './index'

type DailyNoteRow = RowDataPacket & { id: string; entry_date: string; content: string; ai_conversation_id: string | null; created_at: string | Date; updated_at: string | Date }
const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`
const sqlDate = (value: string) => value.replace('T', ' ').replace('Z', '')
const map = (row: DailyNoteRow): DailyNote => ({ id: row.id, entryDate: String(row.entry_date), content: row.content, ...(row.ai_conversation_id ? { aiConversationId: row.ai_conversation_id } : {}), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) })
const noteColumns = 'id, DATE_FORMAT(entry_date, \'%Y-%m-%d\') AS entry_date, content, ai_conversation_id, created_at, updated_at'

export class MySqlDailyNoteRepository implements DailyNoteRepository, DailyNoteBackupStore {
  constructor(private readonly pool: Pool, private readonly scope: CurrentUserScope) {}

  async getOrCreateToday(): Promise<DailyNote> {
    await this.pool.execute(`INSERT INTO daily_notes(id, owner_user_id, entry_date, content, created_at, updated_at)
      VALUES(UUID(), ?, DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')), '', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE id=id`, [this.scope.userId])
    const [rows] = await this.pool.query<DailyNoteRow[]>(`SELECT ${noteColumns} FROM daily_notes WHERE owner_user_id=? AND entry_date=DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`, [this.scope.userId])
    return map(rows[0]!)
  }

  async getToday(): Promise<DailyNote | undefined> {
    const [rows] = await this.pool.query<DailyNoteRow[]>(`SELECT ${noteColumns} FROM daily_notes
      WHERE owner_user_id=? AND entry_date=DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`, [this.scope.userId])
    return rows[0] ? map(rows[0]) : undefined
  }

  async listMine(): Promise<DailyNote[]> {
    const [rows] = await this.pool.query<DailyNoteRow[]>(`SELECT ${noteColumns} FROM daily_notes WHERE owner_user_id=? ORDER BY entry_date DESC`, [this.scope.userId])
    return rows.map(map)
  }

  async updateMine(id: string, content: string): Promise<DailyNote | undefined> {
    const [result] = await this.pool.execute('UPDATE daily_notes SET content=?, updated_at=UTC_TIMESTAMP(3) WHERE id=? AND owner_user_id=?', [content, id, this.scope.userId])
    if (!('affectedRows' in result) || result.affectedRows === 0) return undefined
    const [rows] = await this.pool.query<DailyNoteRow[]>(`SELECT ${noteColumns} FROM daily_notes WHERE id=? AND owner_user_id=?`, [id, this.scope.userId])
    return rows[0] ? map(rows[0]) : undefined
  }

  async getMine(id: string): Promise<DailyNote | undefined> {
    const [rows] = await this.pool.query<DailyNoteRow[]>(`SELECT ${noteColumns} FROM daily_notes WHERE id=? AND owner_user_id=?`, [id, this.scope.userId])
    return rows[0] ? map(rows[0]) : undefined
  }

  async setAiConversationId(id: string, conversationId?: string): Promise<DailyNote | undefined> {
    const [result] = await this.pool.execute('UPDATE daily_notes SET ai_conversation_id=?, updated_at=UTC_TIMESTAMP(3) WHERE id=? AND owner_user_id=?', [conversationId ?? null, id, this.scope.userId])
    if (!('affectedRows' in result) || result.affectedRows === 0) return undefined
    return this.getMine(id)
  }

  async listActionFactsForDate(entryDate: string): Promise<DailyNoteActionFact[]> {
    const [items] = await this.pool.query<Array<RowDataPacket & { id: string; title: string; content: string; created_at: string | Date }>>(
      `SELECT id, title, content, created_at FROM items WHERE owner_user_id=? AND DATE(CONVERT_TZ(created_at, '+00:00', '+08:00'))=? AND deleted_at IS NULL ORDER BY created_at ASC`,
      [this.scope.userId, entryDate],
    )
    if (items.length === 0) return []
    const ids = items.map(item => item.id)
    const placeholders = ids.map(() => '?').join(',')
    const [events] = await this.pool.query<Array<RowDataPacket & { item_id: string; to_status: string; created_at: string | Date }>>(
      `SELECT item_id, to_status, created_at FROM item_status_events WHERE owner_user_id=? AND item_id IN (${placeholders}) AND DATE(CONVERT_TZ(created_at, '+00:00', '+08:00'))=? ORDER BY created_at ASC`,
      [this.scope.userId, ...ids, entryDate],
    )
    return items.map(item => ({ id: item.id, title: item.title, content: item.content, createdAt: iso(item.created_at), statusEvents: events.filter(event => event.item_id === item.id).map(event => ({ toStatus: event.to_status, createdAt: iso(event.created_at) })) }))
  }

  async appendToday(content: string): Promise<DailyNote> {
    return runInMySqlTransaction(this.pool, async connection => {
      await connection.execute(`INSERT INTO daily_notes(id, owner_user_id, entry_date, content, created_at, updated_at)
        VALUES(UUID(), ?, DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')), '', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE id=id`, [this.scope.userId])
      const [rows] = await connection.query<DailyNoteRow[]>(`SELECT ${noteColumns} FROM daily_notes
        WHERE owner_user_id=? AND entry_date=DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')) FOR UPDATE`, [this.scope.userId])
      const current = rows[0]!
      const [times] = await connection.query<Array<RowDataPacket & { time_label: string }>>("SELECT DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), '%H:%i') AS time_label")
      const nextContent = current.content.trim() ? `${current.content}\n\n${times[0]!.time_label}\n${content}` : `${times[0]!.time_label}\n${content}`
      await connection.execute('UPDATE daily_notes SET content=?, updated_at=UTC_TIMESTAMP(3) WHERE id=? AND owner_user_id=?', [nextContent, current.id, this.scope.userId])
      const [saved] = await connection.query<DailyNoteRow[]>(`SELECT ${noteColumns} FROM daily_notes WHERE id=? AND owner_user_id=?`, [current.id, this.scope.userId])
      return map(saved[0]!)
    })
  }

  exportBackup(): Promise<DailyNote[]> { return this.listMine() }

  async replaceBackup(values: DailyNote[]): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      await connection.execute('DELETE FROM daily_notes WHERE owner_user_id=?', [this.scope.userId])
      for (const value of values) await connection.execute('INSERT INTO daily_notes(id, owner_user_id, entry_date, content, ai_conversation_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?)', [value.id || crypto.randomUUID(), this.scope.userId, value.entryDate, value.content, value.aiConversationId ?? null, sqlDate(value.createdAt), sqlDate(value.updatedAt)])
    })
  }
}
