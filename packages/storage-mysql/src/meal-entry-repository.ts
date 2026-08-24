import crypto from 'node:crypto'
import type { CurrentUserScope, MealDayInput, MealEntry, MealEntryBackupStore, MealEntryRepository } from '@knowledge-base/contracts'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { runInMySqlTransaction } from './index'

type MealEntryRow = RowDataPacket & {
  id: string
  entry_date: string
  meal_type: string
  content: string
  feeling: number
  created_at: string | Date
  updated_at: string | Date
}

const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : value.replace(' ', 'T') + 'Z'
const sqlDate = (value: string) => value.replace('T', ' ').replace('Z', '')

const map = (row: MealEntryRow): MealEntry => ({
  id: row.id,
  entryDate: String(row.entry_date),
  mealType: row.meal_type as MealEntry['mealType'],
  content: row.content,
  feeling: row.feeling,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
})

const mealColumns = "id, DATE_FORMAT(entry_date, '%Y-%m-%d') AS entry_date, meal_type, content, feeling, created_at, updated_at"

export class MySqlMealEntryRepository implements MealEntryRepository, MealEntryBackupStore {
  constructor(private readonly pool: Pool, private readonly scope: CurrentUserScope) {}

  async listRange(from?: string, to?: string): Promise<MealEntry[]> {
    const params: string[] = []
    let where = 'owner_user_id=?'
    params.push(this.scope.userId)
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { where += ' AND entry_date>=?'; params.push(from) }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { where += ' AND entry_date<=?'; params.push(to) }
    const [rows] = await this.pool.query<MealEntryRow[]>(`SELECT ${mealColumns} FROM meal_entries WHERE ${where} ORDER BY entry_date ASC, FIELD(meal_type, 'breakfast', 'lunch', 'dinner')`, params)
    return rows.map(map)
  }

  async saveDay(input: MealDayInput): Promise<MealEntry[]> {
    return runInMySqlTransaction(this.pool, async (connection) => {
      await this.upsertSlots(connection, input)
      const [rows] = await connection.query<MealEntryRow[]>(
        `SELECT ${mealColumns} FROM meal_entries WHERE owner_user_id=? AND entry_date=? ORDER BY FIELD(meal_type, 'breakfast', 'lunch', 'dinner')`,
        [this.scope.userId, input.entryDate],
      )
      return rows.map(map)
    })
  }

  private async upsertSlots(connection: PoolConnection, input: MealDayInput): Promise<void> {
    // 缺失的餐删除，存在的餐按 (entry_date, meal_type) 幂等 upsert。
    if (input.meals.length === 0) return
    const keptTypes = input.meals.map(slot => slot.mealType)
    const placeholdersKept = keptTypes.map(() => '?').join(',')
    await connection.execute(
      `DELETE FROM meal_entries WHERE owner_user_id=? AND entry_date=? AND meal_type NOT IN (${placeholdersKept})`,
      [this.scope.userId, input.entryDate, ...keptTypes] as string[],
    )
    for (const slot of input.meals) {
      await connection.execute(
        `INSERT INTO meal_entries(id, owner_user_id, entry_date, meal_type, content, feeling, created_at, updated_at)
         VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE content=VALUES(content), feeling=VALUES(feeling), updated_at=UTC_TIMESTAMP(3)`,
        [crypto.randomUUID(), this.scope.userId, input.entryDate, slot.mealType, slot.content, slot.feeling],
      )
    }
  }

  exportBackup(): Promise<MealEntry[]> { return this.listRange() }

  async replaceBackup(values: MealEntry[]): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      await connection.execute('DELETE FROM meal_entries WHERE owner_user_id=?', [this.scope.userId])
      for (const value of values) {
        await connection.execute(
          'INSERT INTO meal_entries(id, owner_user_id, entry_date, meal_type, content, feeling, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)',
          [value.id || crypto.randomUUID(), this.scope.userId, value.entryDate, value.mealType, value.content, value.feeling, sqlDate(value.createdAt), sqlDate(value.updatedAt)],
        )
      }
    })
  }
}
