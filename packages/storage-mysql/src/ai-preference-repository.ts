import crypto from 'node:crypto'
import type { AiPreference, AiPreferenceBackupStore, AiPreferenceKey, AiPreferenceRepository, CurrentUserScope } from '@knowledge-base/contracts'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { runInMySqlTransaction } from './index'

type PreferenceRow = RowDataPacket & { id: string; owner_user_id: string; preference_key: AiPreferenceKey; preference_value: string; source_code: 'user_confirmed'; created_at: string | Date; updated_at: string | Date }
const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`
const sqlDate = (value: string) => value.replace('T', ' ').replace('Z', '')
const map = (row: PreferenceRow): AiPreference => ({ id: row.id, key: row.preference_key, value: row.preference_value, source: row.source_code, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) })

export class MySqlAiPreferenceRepository implements AiPreferenceRepository, AiPreferenceBackupStore {
  constructor(private readonly pool: Pool, private readonly scope: CurrentUserScope) {}

  async listMine(): Promise<AiPreference[]> {
    const [rows] = await this.pool.query<PreferenceRow[]>('SELECT * FROM user_ai_preferences WHERE owner_user_id=? ORDER BY updated_at ASC, id ASC', [this.scope.userId])
    return rows.map(map)
  }

  async create(input: { id: string; key: AiPreferenceKey; value: string; source: 'user_confirmed'; createdAt: string; updatedAt: string }): Promise<AiPreference> {
    await this.pool.execute('INSERT INTO user_ai_preferences(id,owner_user_id,preference_key,preference_value,source_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', [input.id, this.scope.userId, input.key, input.value, input.source, sqlDate(input.createdAt), sqlDate(input.updatedAt)])
    return { id: input.id, key: input.key, value: input.value, source: input.source, createdAt: input.createdAt, updatedAt: input.updatedAt }
  }

  async updateMine(id: string, input: { key: AiPreferenceKey; value: string; updatedAt: string }): Promise<AiPreference | undefined> {
    const [result] = await this.pool.execute('UPDATE user_ai_preferences SET preference_key=?, preference_value=?, updated_at=? WHERE id=? AND owner_user_id=?', [input.key, input.value, sqlDate(input.updatedAt), id, this.scope.userId])
    if (!('affectedRows' in result) || result.affectedRows === 0) return undefined
    const [rows] = await this.pool.query<PreferenceRow[]>('SELECT * FROM user_ai_preferences WHERE id=? AND owner_user_id=?', [id, this.scope.userId])
    return rows[0] ? map(rows[0]) : undefined
  }

  async deleteMine(id: string): Promise<boolean> {
    const [result] = await this.pool.execute('DELETE FROM user_ai_preferences WHERE id=? AND owner_user_id=?', [id, this.scope.userId])
    return 'affectedRows' in result && result.affectedRows > 0
  }

  async exportBackup(): Promise<AiPreference[]> { return this.listMine() }

  async replaceBackup(values: AiPreference[]): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      await connection.execute('DELETE FROM user_ai_preferences WHERE owner_user_id=?', [this.scope.userId])
      for (const value of values) await connection.execute('INSERT INTO user_ai_preferences(id,owner_user_id,preference_key,preference_value,source_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', [value.id || crypto.randomUUID(), this.scope.userId, value.key, value.value, value.source, sqlDate(value.createdAt), sqlDate(value.updatedAt)])
    })
  }
}
