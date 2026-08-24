import crypto from 'node:crypto'
import type { CurrentUserScope, DailySummary, DailySummaryInput, DailySummaryRepository, DailySummaryBackupStore } from '@knowledge-base/contracts'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { runInMySqlTransaction } from './index'

type DailySummaryRow = RowDataPacket & {
  id: string
  entry_date: string
  content: string
  created_at: string | Date
  updated_at: string | Date
}

const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : value.replace(' ', 'T') + 'Z'
const sqlDate = (value: string) => value.replace('T', ' ').replace('Z', '')

const map = (row: DailySummaryRow): DailySummary => ({
  id: row.id,
  entryDate: String(row.entry_date),
  content: row.content,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
})

const summaryColumns = "id, DATE_FORMAT(entry_date, '%Y-%m-%d') AS entry_date, content, created_at, updated_at"

export class MySqlDailySummaryRepository implements DailySummaryRepository, DailySummaryBackupStore {
  constructor(private readonly pool: Pool, private readonly scope: CurrentUserScope) {}

  async listRange(from?: string, to?: string): Promise<DailySummary[]> {
    const params: string[] = []
    let where = 'owner_user_id=?'
    params.push(this.scope.userId)
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { where += ' AND entry_date>=?'; params.push(from) }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { where += ' AND entry_date<=?'; params.push(to) }
    const [rows] = await this.pool.query<DailySummaryRow[]>(`SELECT ${summaryColumns} FROM daily_summaries WHERE ${where} ORDER BY entry_date ASC`, params)
    return rows.map(map)
  }

  async getByDate(entryDate: string): Promise<DailySummary | undefined> {
    const [rows] = await this.pool.query<DailySummaryRow[]>(`SELECT ${summaryColumns} FROM daily_summaries WHERE owner_user_id=? AND entry_date=?`, [this.scope.userId, entryDate])
    const first = rows[0]
    return first ? map(first) : undefined
  }

  async upsertForDate(input: DailySummaryInput): Promise<DailySummary> {
    return runInMySqlTransaction(this.pool, async connection => {
      await connection.execute(
        `INSERT INTO daily_summaries(id, owner_user_id, entry_date, content, created_at, updated_at)
         VALUES(?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE content=VALUES(content), updated_at=UTC_TIMESTAMP(3)`,
        [crypto.randomUUID(), this.scope.userId, input.entryDate, input.content],
      )
      const [rows] = await connection.query<DailySummaryRow[]>(`SELECT ${summaryColumns} FROM daily_summaries WHERE owner_user_id=? AND entry_date=?`, [this.scope.userId, input.entryDate])
      return map(rows[0]!)
    })
  }

  exportBackup(): Promise<DailySummary[]> { return this.listRange() }

  async replaceBackup(values: DailySummary[]): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      await connection.execute('DELETE FROM daily_summaries WHERE owner_user_id=?', [this.scope.userId])
      for (const value of values) {
        await connection.execute(
          'INSERT INTO daily_summaries(id, owner_user_id, entry_date, content, created_at, updated_at) VALUES(?,?,?,?,?,?)',
          [value.id || crypto.randomUUID(), this.scope.userId, value.entryDate, value.content, sqlDate(value.createdAt), sqlDate(value.updatedAt)],
        )
      }
    })
  }
}
