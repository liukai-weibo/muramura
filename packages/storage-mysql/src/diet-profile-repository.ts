import crypto from 'node:crypto'
import type { CurrentUserScope, DietProfile, DietProfileBackupStore, DietProfileInput, DietProfileRepository } from '@knowledge-base/contracts'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { runInMySqlTransaction } from './index'

type DietProfileRow = RowDataPacket & {
  owner_user_id: string
  height_cm: number | null
  weight_kg: number | null
  age: number | null
  gender: string | null
  goal: string | null
  activity: string | null
  health_note: string | null
  created_at: string | Date
  updated_at: string | Date
}

const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : value.replace(' ', 'T') + 'Z'

const map = (row: DietProfileRow): DietProfile => ({
  heightCm: row.height_cm == null ? undefined : row.height_cm,
  weightKg: row.weight_kg == null ? undefined : row.weight_kg,
  age: row.age == null ? undefined : row.age,
  gender: (row.gender as DietProfile['gender']) ?? undefined,
  goal: (row.goal as DietProfile['goal']) ?? undefined,
  activity: (row.activity as DietProfile['activity']) ?? undefined,
  healthNote: row.health_note ?? undefined,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
})

const columns = 'owner_user_id, height_cm, weight_kg, age, gender, goal, activity, health_note, created_at, updated_at'

export class MySqlDietProfileRepository implements DietProfileRepository, DietProfileBackupStore {
  constructor(private readonly pool: Pool, private readonly scope: CurrentUserScope) {}

  async getMine(): Promise<DietProfile | undefined> {
    const [rows] = await this.pool.query<DietProfileRow[]>('SELECT ' + columns + ' FROM user_diet_profiles WHERE owner_user_id=?', [this.scope.userId])
    return rows[0] ? map(rows[0]) : undefined
  }

  async upsertMine(input: DietProfileInput): Promise<DietProfile> {
    return runInMySqlTransaction(this.pool, async connection => {
      await connection.execute(
        'INSERT INTO user_diet_profiles(owner_user_id, height_cm, weight_kg, age, gender, goal, activity, health_note, created_at, updated_at)' +
        ' VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))' +
        ' ON DUPLICATE KEY UPDATE height_cm=VALUES(height_cm), weight_kg=VALUES(weight_kg), age=VALUES(age), gender=VALUES(gender), goal=VALUES(goal), activity=VALUES(activity), health_note=VALUES(health_note), updated_at=UTC_TIMESTAMP(3)',
        [this.scope.userId, input.heightCm ?? null, input.weightKg ?? null, input.age ?? null, input.gender ?? null, input.goal ?? null, input.activity ?? null, input.healthNote ?? null],
      )
      const [rows] = await connection.query<DietProfileRow[]>('SELECT ' + columns + ' FROM user_diet_profiles WHERE owner_user_id=?', [this.scope.userId])
      return map(rows[0]!)
    })
  }

  exportBackup(): Promise<DietProfile[]> {
    return this.pool.query<DietProfileRow[]>('SELECT ' + columns + ' FROM user_diet_profiles WHERE owner_user_id=?', [this.scope.userId]).then(([rows]) => rows.map(map))
  }

  async replaceBackup(values: DietProfile[]): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      await connection.execute('DELETE FROM user_diet_profiles WHERE owner_user_id=?', [this.scope.userId])
      for (const value of values) {
        await connection.execute(
          'INSERT INTO user_diet_profiles(owner_user_id, height_cm, weight_kg, age, gender, goal, activity, health_note, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
          [this.scope.userId, value.heightCm ?? null, value.weightKg ?? null, value.age ?? null, value.gender ?? null, value.goal ?? null, value.activity ?? null, value.healthNote ?? null, new Date(value.createdAt), new Date(value.updatedAt)],
        )
      }
    })
  }
}
