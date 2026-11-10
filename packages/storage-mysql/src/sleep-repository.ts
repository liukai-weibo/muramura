import crypto from 'node:crypto'
import type {
  CurrentUserScope,
  SleepBackupStore,
  SleepEntry,
  SleepRepository,
  SleepSettings,
  SleepSettingsWriteInput,
} from '@knowledge-base/contracts'
import { SLEEP_DEFAULT_SETTINGS } from '@knowledge-base/contracts'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { runInMySqlTransaction } from './index'

type SleepEntryRow = RowDataPacket & {
  id: string
  sleep_date: string
  bed_at: string | Date | null
  wake_at: string | Date | null
  note: string | null
  created_at: string | Date
  updated_at: string | Date
}

type SleepSettingsRow = RowDataPacket & {
  remind_enabled: number
  remind_start_minute: number
  remind_end_minute: number
  input_precision: string
  last_prompted_date: string | null
}

const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : value.replace(' ', 'T') + 'Z'
const sqlDate = (value: string) => value.replace('T', ' ').replace('Z', '')

const sleepColumns = "id, DATE_FORMAT(sleep_date, '%Y-%m-%d') AS sleep_date, bed_at, wake_at, note, created_at, updated_at"

const mapEntry = (row: SleepEntryRow): SleepEntry => ({
  id: row.id,
  sleepDate: String(row.sleep_date),
  ...(row.wake_at ? { wakeAt: iso(row.wake_at) } : {}),
  ...(row.bed_at ? { bedAt: iso(row.bed_at) } : {}),
  ...(row.note ? { note: row.note } : {}),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
})

const mapSettings = (row: SleepSettingsRow | undefined): SleepSettings => {
  if (!row) return { ...SLEEP_DEFAULT_SETTINGS }
  return {
    remindEnabled: Boolean(row.remind_enabled),
    remindStartMinute: Number(row.remind_start_minute),
    remindEndMinute: Number(row.remind_end_minute),
    inputPrecision: row.input_precision === 'minute' ? 'minute' : 'hour',
    ...(row.last_prompted_date ? { lastPromptedDate: String(row.last_prompted_date) } : {}),
  }
}

export class MySqlSleepRepository implements SleepRepository, SleepBackupStore {
  constructor(private readonly pool: Pool, private readonly scope: CurrentUserScope) {}

  async listRange(from?: string, to?: string): Promise<SleepEntry[]> {
    const params: string[] = [this.scope.userId]
    let where = 'owner_user_id=?'
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { where += ' AND sleep_date>=?'; params.push(from) }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { where += ' AND sleep_date<=?'; params.push(to) }
    const [rows] = await this.pool.query<SleepEntryRow[]>(
      `SELECT ${sleepColumns} FROM sleep_entries WHERE ${where} ORDER BY sleep_date ASC`,
      params,
    )
    return rows.map(mapEntry)
  }

  async getByDate(sleepDate: string): Promise<SleepEntry | undefined> {
    const [rows] = await this.pool.query<SleepEntryRow[]>(
      `SELECT ${sleepColumns} FROM sleep_entries WHERE owner_user_id=? AND sleep_date=?`,
      [this.scope.userId, sleepDate],
    )
    return rows[0] ? mapEntry(rows[0]) : undefined
  }

  async write(sleepDate: string, values: { wakeAt?: string; bedAt?: string; note?: string }): Promise<SleepEntry> {
    await this.pool.execute(
      `INSERT INTO sleep_entries(id, owner_user_id, sleep_date, bed_at, wake_at, note, created_at, updated_at)
       VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE bed_at=VALUES(bed_at), wake_at=VALUES(wake_at), note=VALUES(note), updated_at=UTC_TIMESTAMP(3)`,
      [
        crypto.randomUUID(), this.scope.userId, sleepDate,
        values.bedAt ? sqlDate(values.bedAt) : null,
        values.wakeAt ? sqlDate(values.wakeAt) : null,
        values.note?.trim() ? values.note.trim() : null,
      ],
    )
    const saved = await this.getByDate(sleepDate)
    if (!saved) throw new Error('sleep entry missing after write')
    return saved
  }

  async remove(sleepDate: string): Promise<boolean> {
    const [result] = await this.pool.execute(
      'DELETE FROM sleep_entries WHERE owner_user_id=? AND sleep_date=?',
      [this.scope.userId, sleepDate],
    )
    return (result as { affectedRows?: number }).affectedRows ? true : false
  }

  async getSettings(): Promise<SleepSettings> {
    const [rows] = await this.pool.query<SleepSettingsRow[]>(
      'SELECT remind_enabled, remind_start_minute, remind_end_minute, input_precision, DATE_FORMAT(last_prompted_date, \'%Y-%m-%d\') AS last_prompted_date FROM user_sleep_settings WHERE owner_user_id=?',
      [this.scope.userId],
    )
    return mapSettings(rows[0])
  }

  async saveSettings(input: SleepSettingsWriteInput): Promise<SleepSettings> {
    await this.pool.execute(
      `INSERT INTO user_sleep_settings(owner_user_id, remind_enabled, remind_start_minute, remind_end_minute, input_precision, created_at, updated_at)
       VALUES(?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE remind_enabled=VALUES(remind_enabled), remind_start_minute=VALUES(remind_start_minute),
         remind_end_minute=VALUES(remind_end_minute), input_precision=VALUES(input_precision), updated_at=UTC_TIMESTAMP(3)`,
      [this.scope.userId, input.remindEnabled ? 1 : 0, input.remindStartMinute, input.remindEndMinute, input.inputPrecision],
    )
    return this.getSettings()
  }

  async ackReminder(date: string): Promise<SleepSettings> {
    await this.pool.execute(
      `INSERT INTO user_sleep_settings(owner_user_id, remind_enabled, remind_start_minute, remind_end_minute, input_precision, last_prompted_date, created_at, updated_at)
       VALUES(?,1,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE last_prompted_date=VALUES(last_prompted_date), updated_at=UTC_TIMESTAMP(3)`,
      [this.scope.userId, SLEEP_DEFAULT_SETTINGS.remindStartMinute, SLEEP_DEFAULT_SETTINGS.remindEndMinute, SLEEP_DEFAULT_SETTINGS.inputPrecision, date],
    )
    return this.getSettings()
  }

  exportBackup(): Promise<SleepEntry[]> { return this.listRange() }

  async replaceBackup(values: SleepEntry[]): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      await connection.execute('DELETE FROM sleep_entries WHERE owner_user_id=?', [this.scope.userId])
      for (const value of values) {
        if (!value.bedAt && !value.wakeAt) continue
        await connection.execute(
          `INSERT INTO sleep_entries(id, owner_user_id, sleep_date, bed_at, wake_at, note, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,?)`,
          [
            value.id || crypto.randomUUID(), this.scope.userId, value.sleepDate,
            value.bedAt ? sqlDate(value.bedAt) : null, value.wakeAt ? sqlDate(value.wakeAt) : null, value.note ?? null,
            sqlDate(value.createdAt), sqlDate(value.updatedAt),
          ],
        )
      }
    })
  }
}
