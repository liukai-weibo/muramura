import crypto from 'node:crypto'
import type { CurrentUserScope, MoodEntry, MoodEntryBackupStore, MoodEntryInput, MoodEntryRepository } from '@knowledge-base/contracts'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { runInMySqlTransaction } from './index'

type MoodEntryRow = RowDataPacket & {
  id: string
  entry_date: string
  content: string
  mood_level: number
  tags: string
  response: string | null
  created_at: string | Date
  updated_at: string | Date
}

const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`
const sqlDate = (value: string) => value.replace('T', ' ').replace('Z', '')

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : []
  } catch {
    return []
  }
}

const map = (row: MoodEntryRow): MoodEntry => ({
  id: row.id,
  entryDate: String(row.entry_date),
  content: row.content,
  moodLevel: row.mood_level as MoodEntry['moodLevel'],
  tags: parseTags(row.tags),
  ...(row.response !== null && row.response !== undefined ? { response: row.response } : {}),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
})

const moodColumns = "id, DATE_FORMAT(entry_date, '%Y-%m-%d') AS entry_date, content, mood_level, tags, response, created_at, updated_at"

export class MySqlMoodEntryRepository implements MoodEntryRepository, MoodEntryBackupStore {
  constructor(private readonly pool: Pool, private readonly scope: CurrentUserScope) {}

  async listRange(from?: string, to?: string): Promise<MoodEntry[]> {
    const params: string[] = []
    let where = 'owner_user_id=?'
    params.push(this.scope.userId)
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { where += ' AND entry_date>=?'; params.push(from) }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { where += ' AND entry_date<=?'; params.push(to) }
    const [rows] = await this.pool.query<MoodEntryRow[]>(`SELECT ${moodColumns} FROM mood_entries WHERE ${where} ORDER BY entry_date DESC, created_at DESC`, params)
    return rows.map(map)
  }

  async create(input: MoodEntryInput & { entryDate: string }): Promise<MoodEntry> {
    const id = crypto.randomUUID()
    await this.pool.execute(
      'INSERT INTO mood_entries(id, owner_user_id, entry_date, content, mood_level, tags, response, created_at, updated_at) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))',
      [id, this.scope.userId, input.entryDate, input.content, input.moodLevel, JSON.stringify(input.tags ?? []), input.response ?? null],
    )
    const [rows] = await this.pool.query<MoodEntryRow[]>(`SELECT ${moodColumns} FROM mood_entries WHERE id=? AND owner_user_id=?`, [id, this.scope.userId])
    return map(rows[0]!)
  }

  async updateMine(id: string, input: MoodEntryInput & { entryDate: string }): Promise<MoodEntry | undefined> {
    const [result] = await this.pool.execute(
      'UPDATE mood_entries SET entry_date=?, content=?, mood_level=?, tags=?, response=?, updated_at=UTC_TIMESTAMP(3) WHERE id=? AND owner_user_id=?',
      [input.entryDate, input.content, input.moodLevel, JSON.stringify(input.tags ?? []), input.response ?? null, id, this.scope.userId],
    )
    if (!('affectedRows' in result) || result.affectedRows === 0) return undefined
    const [rows] = await this.pool.query<MoodEntryRow[]>(`SELECT ${moodColumns} FROM mood_entries WHERE id=? AND owner_user_id=?`, [id, this.scope.userId])
    return rows[0] ? map(rows[0]) : undefined
  }

  async deleteMine(id: string): Promise<boolean> {
    const [result] = await this.pool.execute('DELETE FROM mood_entries WHERE id=? AND owner_user_id=?', [id, this.scope.userId])
    return 'affectedRows' in result && result.affectedRows > 0
  }

  exportBackup(): Promise<MoodEntry[]> { return this.listRange() }

  async replaceBackup(values: MoodEntry[]): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      await connection.execute('DELETE FROM mood_entries WHERE owner_user_id=?', [this.scope.userId])
      for (const value of values) {
        await connection.execute(
          'INSERT INTO mood_entries(id, owner_user_id, entry_date, content, mood_level, tags, response, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
          [value.id || crypto.randomUUID(), this.scope.userId, value.entryDate, value.content, value.moodLevel, JSON.stringify(value.tags ?? []), value.response ?? null, sqlDate(value.createdAt), sqlDate(value.updatedAt)],
        )
      }
    })
  }
}
