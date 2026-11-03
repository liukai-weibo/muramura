import crypto from 'node:crypto'
import type { CurrentUserScope, DailyNote, DailyNoteActionFact, DailyNoteBackupStore, DailyNoteEntry, DailyNoteEntryWriteInput, DailyNoteRepository, DailyNoteWithEntries, DailyNoteTimePrecision } from '@knowledge-base/contracts'
import { DAILY_NOTE_TIME_PRECISION_DAY, DAILY_NOTE_TIME_PRECISION_MINUTE, dailyNoteClock, dailyNoteSortEntries, parseSerializedDailyNote, serializeDailyNoteEntries } from '@knowledge-base/contracts'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { runInMySqlTransaction } from './index'

type DailyNoteRow = RowDataPacket & { id: string; entry_date: string; content: string; ai_conversation_id: string | null; created_at: string | Date; updated_at: string | Date }
type EntryRow = RowDataPacket & { id: string; daily_note_id: string; entry_date: string; recorded_at: string | Date; time_precision: string; content: string; created_at: string | Date; updated_at: string | Date }
const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`
const sqlDate = (value: string) => value.replace('T', ' ').replace('Z', '')
const map = (row: DailyNoteRow): DailyNote => ({ id: row.id, entryDate: String(row.entry_date), content: row.content, ...(row.ai_conversation_id ? { aiConversationId: row.ai_conversation_id } : {}), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) })
const noteColumns = 'id, DATE_FORMAT(entry_date, \'%Y-%m-%d\') AS entry_date, content, ai_conversation_id, created_at, updated_at'
const entryColumns = 'id, daily_note_id, DATE_FORMAT(entry_date, \'%Y-%m-%d\') AS entry_date, recorded_at, time_precision, content, created_at, updated_at'
const mapEntry = (row: EntryRow): DailyNoteEntry => ({
  id: row.id,
  dailyNoteId: row.daily_note_id,
  entryDate: String(row.entry_date),
  recordedAt: iso(row.recorded_at),
  timePrecision: row.time_precision as DailyNoteTimePrecision,
  content: row.content,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
})

/** 东八区无夏令时，与既有 SQL 里的 CONVERT_TZ(..., '+08:00') 保持一致。 */
const shanghaiOffsetMs = 8 * 60 * 60 * 1000

/** 把「东八区日期 + HH:MM」换成 UTC ISO；未给时间则用当前时刻。 */
function resolveRecordedAt(entryDate: string, time?: string): string {
  if (!time) return new Date().toISOString()
  const [hour, minute] = time.split(':').map(Number)
  const [year, month, day] = entryDate.split('-').map(Number)
  if ([hour, minute, year, month, day].some(value => value === undefined || Number.isNaN(value))) return new Date().toISOString()
  return new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!) - shanghaiOffsetMs).toISOString()
}

/**
 * 入参既可能是 `'HH:MM'`（写在本篇当天这个时刻），也可能是完整 ISO。
 * 完整 ISO 表示**绝对时刻**：它可能落在另一天，那是跨天搬移的依据。
 */
function resolveInputInstant(entryDate: string, recordedAt?: string): string | undefined {
  if (!recordedAt) return new Date().toISOString()
  if (/^\d{2}:\d{2}$/.test(recordedAt)) return resolveRecordedAt(entryDate, recordedAt)
  const at = new Date(recordedAt)
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString()
}

export class MySqlDailyNoteRepository implements DailyNoteRepository, DailyNoteBackupStore {
  constructor(private readonly pool: Pool, private readonly scope: CurrentUserScope) {}

  async getOrCreateToday(): Promise<DailyNote> {
    const today = shanghaiToday()
    const [rows] = await this.pool.query<DailyNoteRow[]>(`SELECT ${noteColumns} FROM daily_notes WHERE owner_user_id=? AND entry_date=?`, [this.scope.userId, today])
    if (rows[0]) return (await this.synthesize([map(rows[0])], this.pool))[0]!
    return this.getOrCreateByDate(today)
  }

  /** 按东八区日期取或建手记：补录一个还没有手记的日子靠它。 */
  async getOrCreateByDate(entryDate: string): Promise<DailyNote> {
    await this.ensureNoteByDate(this.pool, entryDate)
    const [rows] = await this.pool.query<DailyNoteRow[]>(`SELECT ${noteColumns} FROM daily_notes WHERE owner_user_id=? AND entry_date=?`, [this.scope.userId, entryDate])
    return (await this.synthesize([map(rows[0]!)], this.pool))[0]!
  }

  async getToday(): Promise<DailyNote | undefined> {
    const [rows] = await this.pool.query<DailyNoteRow[]>(`SELECT ${noteColumns} FROM daily_notes
      WHERE owner_user_id=? AND entry_date=DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`, [this.scope.userId])
    if (!rows[0]) return undefined
    return (await this.synthesize([map(rows[0])], this.pool))[0]
  }

  async listMine(): Promise<DailyNote[]> {
    const [rows] = await this.pool.query<DailyNoteRow[]>(`SELECT ${noteColumns} FROM daily_notes WHERE owner_user_id=? ORDER BY entry_date DESC`, [this.scope.userId])
    return this.synthesize(rows.map(map), this.pool)
  }

  /** 兼容旧客户端：整篇文本 → 条目整体替换。旧版桌面端仍用该路径自动保存。 */
  async updateMine(id: string, content: string): Promise<DailyNote | undefined> {
    const note = await this.getMine(id)
    if (!note) return undefined
    await runInMySqlTransaction(this.pool, async connection => {
      await connection.execute('DELETE FROM daily_note_entries WHERE daily_note_id=? AND owner_user_id=?', [id, this.scope.userId])
      const blocks = parseSerializedDailyNote(content)
      // 没有时间标记的块锚在手记的创建时刻（与 Migration 034 搬运旧数据的口径一致），
      // 不能锚在「现在」，否则一条 day 精度记录会看起来属于今天。
      for (const block of blocks) await this.insertEntry(connection, id, note.entryDate, block.content, block.time ? resolveRecordedAt(note.entryDate, block.time) : note.createdAt, block.time ? DAILY_NOTE_TIME_PRECISION_MINUTE : DAILY_NOTE_TIME_PRECISION_DAY)
      await connection.execute('UPDATE daily_notes SET updated_at=UTC_TIMESTAMP(3) WHERE id=? AND owner_user_id=?', [id, this.scope.userId])
    })
    return this.getMine(id)
  }

  async getMine(id: string): Promise<DailyNote | undefined> {
    const [rows] = await this.pool.query<DailyNoteRow[]>(`SELECT ${noteColumns} FROM daily_notes WHERE id=? AND owner_user_id=?`, [id, this.scope.userId])
    if (!rows[0]) return undefined
    return (await this.synthesize([map(rows[0])], this.pool))[0]
  }

  async getMineWithEntries(id: string): Promise<DailyNoteWithEntries | undefined> {
    const [rows] = await this.pool.query<DailyNoteRow[]>(`SELECT ${noteColumns} FROM daily_notes WHERE id=? AND owner_user_id=?`, [id, this.scope.userId])
    if (!rows[0]) return undefined
    const entries = await this.listEntries(id)
    const note = map(rows[0])
    return { ...note, content: serializeDailyNoteEntries(entries), entries }
  }

  async setAiConversationId(id: string, conversationId?: string): Promise<DailyNote | undefined> {
    const [result] = await this.pool.execute('UPDATE daily_notes SET ai_conversation_id=?, updated_at=UTC_TIMESTAMP(3) WHERE id=? AND owner_user_id=?', [conversationId ?? null, id, this.scope.userId])
    if (!('affectedRows' in result) || result.affectedRows === 0) return undefined
    return this.getMine(id)
  }

  async listEntries(id: string): Promise<DailyNoteEntry[]> {
    const [rows] = await this.pool.query<EntryRow[]>(`SELECT ${entryColumns} FROM daily_note_entries
      WHERE daily_note_id=? AND owner_user_id=? ORDER BY recorded_at ASC, created_at ASC, id ASC`, [id, this.scope.userId])
    return dailyNoteSortEntries(rows.map(mapEntry))
  }

  async createEntry(id: string, input: DailyNoteEntryWriteInput): Promise<DailyNoteEntry | undefined> {
    const note = await this.getMine(id)
    if (!note) return undefined
    // 创建永远落在本篇当天：跨天由客户端先取建目标日再写，单个请求不改两天的数据。
    const instant = resolveInputInstant(note.entryDate, input.recordedAt)
    const clock = instant ? dailyNoteClock(instant) : undefined
    const recordedAt = clock && clock.date === note.entryDate ? instant! : resolveRecordedAt(note.entryDate, clock?.label)
    const created = await runInMySqlTransaction(this.pool, async connection => {
      const entryId = await this.insertEntry(connection, id, note.entryDate, input.content, recordedAt, DAILY_NOTE_TIME_PRECISION_MINUTE)
      await connection.execute('UPDATE daily_notes SET updated_at=UTC_TIMESTAMP(3) WHERE id=? AND owner_user_id=?', [id, this.scope.userId])
      return entryId
    })
    const [rows] = await this.pool.query<EntryRow[]>(`SELECT ${entryColumns} FROM daily_note_entries WHERE id=? AND owner_user_id=?`, [created, this.scope.userId])
    return rows[0] ? mapEntry(rows[0]) : undefined
  }

  /**
   * 更新一条记录。
   * - 不带时间：只改正文，绝不动 recorded_at / time_precision / 所属篇。旧数据的
   *   recorded_at 是迁移时的锚点，若在这里重算，一条 day 精度记录会被误判成跨天。
   * - 带时间：时间落在别的东八区日期就把这条记录整体搬过去（目标日没手记就建一篇），
   *   并在同一事务里 touch 源篇与目标篇。
   */
  async updateEntry(id: string, entryId: string, input: DailyNoteEntryWriteInput): Promise<DailyNoteEntry | undefined> {
    const note = await this.getMine(id)
    if (!note) return undefined
    const [existing] = await this.pool.query<EntryRow[]>(`SELECT ${entryColumns} FROM daily_note_entries WHERE id=? AND daily_note_id=? AND owner_user_id=?`, [entryId, id, this.scope.userId])
    if (!existing[0]) return undefined
    const entryDate = String(existing[0].entry_date)

    if (input.recordedAt === undefined) {
      await this.pool.execute('UPDATE daily_note_entries SET content=?, updated_at=UTC_TIMESTAMP(3) WHERE id=? AND owner_user_id=?', [input.content, entryId, this.scope.userId])
      await this.pool.execute('UPDATE daily_notes SET updated_at=UTC_TIMESTAMP(3) WHERE id=? AND owner_user_id=?', [id, this.scope.userId])
      const [rows] = await this.pool.query<EntryRow[]>(`SELECT ${entryColumns} FROM daily_note_entries WHERE id=? AND owner_user_id=?`, [entryId, this.scope.userId])
      return rows[0] ? mapEntry(rows[0]) : undefined
    }

    const instant = resolveInputInstant(entryDate, input.recordedAt)
    if (!instant) return undefined
    const clock = dailyNoteClock(instant)
    const targetDate = clock?.date ?? entryDate
    const precision: DailyNoteTimePrecision = DAILY_NOTE_TIME_PRECISION_MINUTE

    if (targetDate === entryDate) {
      await this.pool.execute('UPDATE daily_note_entries SET content=?, recorded_at=?, time_precision=?, updated_at=UTC_TIMESTAMP(3) WHERE id=? AND owner_user_id=?',
        [input.content, sqlDate(instant), precision, entryId, this.scope.userId])
      await this.pool.execute('UPDATE daily_notes SET updated_at=UTC_TIMESTAMP(3) WHERE id=? AND owner_user_id=?', [id, this.scope.userId])
      const [rows] = await this.pool.query<EntryRow[]>(`SELECT ${entryColumns} FROM daily_note_entries WHERE id=? AND owner_user_id=?`, [entryId, this.scope.userId])
      return rows[0] ? mapEntry(rows[0]) : undefined
    }

    await runInMySqlTransaction(this.pool, async connection => {
      const targetId = await this.ensureNoteByDate(connection, targetDate)
      await connection.execute('UPDATE daily_note_entries SET daily_note_id=?, entry_date=?, content=?, recorded_at=?, time_precision=?, updated_at=UTC_TIMESTAMP(3) WHERE id=? AND owner_user_id=?',
        [targetId, targetDate, input.content, sqlDate(instant), precision, entryId, this.scope.userId])
      await connection.execute('UPDATE daily_notes SET updated_at=UTC_TIMESTAMP(3) WHERE id IN (?,?) AND owner_user_id=?', [id, targetId, this.scope.userId])
    })
    const [rows] = await this.pool.query<EntryRow[]>(`SELECT ${entryColumns} FROM daily_note_entries WHERE id=? AND owner_user_id=?`, [entryId, this.scope.userId])
    return rows[0] ? mapEntry(rows[0]) : undefined
  }

  async deleteEntry(id: string, entryId: string): Promise<boolean> {
    const [result] = await this.pool.execute('DELETE FROM daily_note_entries WHERE id=? AND daily_note_id=? AND owner_user_id=?', [entryId, id, this.scope.userId])
    return 'affectedRows' in result && result.affectedRows > 0
  }

  async clearEntries(id: string): Promise<boolean> {
    const [result] = await this.pool.execute('DELETE FROM daily_note_entries WHERE daily_note_id=? AND owner_user_id=?', [id, this.scope.userId])
    return 'affectedRows' in result && result.affectedRows > 0
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
    const note = await this.getOrCreateToday()
    await this.createEntry(note.id, { content })
    return this.getOrCreateToday()
  }

  exportBackup(): Promise<DailyNote[]> { return this.listMine() }

  async exportEntryBackup(): Promise<DailyNoteEntry[]> {
    const [rows] = await this.pool.query<EntryRow[]>(`SELECT ${entryColumns} FROM daily_note_entries WHERE owner_user_id=? ORDER BY entry_date ASC, recorded_at ASC`, [this.scope.userId])
    return rows.map(mapEntry)
  }

  async replaceBackup(values: DailyNote[]): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      await connection.execute('DELETE FROM daily_notes WHERE owner_user_id=?', [this.scope.userId])
      for (const value of values) await connection.execute('INSERT INTO daily_notes(id, owner_user_id, entry_date, content, ai_conversation_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?)', [value.id || crypto.randomUUID(), this.scope.userId, value.entryDate, value.content, value.aiConversationId ?? null, sqlDate(value.createdAt), sqlDate(value.updatedAt)])
    })
  }

  async replaceEntryBackup(values: DailyNoteEntry[]): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      await connection.execute('DELETE FROM daily_note_entries WHERE owner_user_id=?', [this.scope.userId])
      const [notes] = await connection.query<DailyNoteRow[]>(`SELECT ${noteColumns} FROM daily_notes WHERE owner_user_id=?`, [this.scope.userId])
      const noteByDate = new Map(notes.map(note => [String(note.entry_date), note.id]))
      for (const value of values) {
        const noteId = noteByDate.get(value.entryDate)
        if (!noteId) continue
        const recordedAt = value.recordedAt || new Date().toISOString()
        await connection.execute('INSERT INTO daily_note_entries(id, owner_user_id, daily_note_id, entry_date, recorded_at, time_precision, content, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
          [value.id || crypto.randomUUID(), this.scope.userId, noteId, value.entryDate, sqlDate(recordedAt), value.timePrecision === DAILY_NOTE_TIME_PRECISION_DAY ? DAILY_NOTE_TIME_PRECISION_DAY : DAILY_NOTE_TIME_PRECISION_MINUTE, value.content, sqlDate(value.createdAt || recordedAt), sqlDate(value.updatedAt || recordedAt)])
      }
    })
  }

  /** 旧备份（V4–V10）只有整篇文本：为尚无条目的手记补一条 day 精度条目，文本逐字保留。 */
  async materializeLegacyContent(): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      const [rows] = await connection.query<DailyNoteRow[]>(`SELECT ${noteColumns} FROM daily_notes AS note
        WHERE note.owner_user_id=? AND CHAR_LENGTH(TRIM(note.content)) > 0
          AND NOT EXISTS (SELECT 1 FROM daily_note_entries AS entry WHERE entry.daily_note_id = note.id)`, [this.scope.userId])
      for (const row of rows) await this.insertEntry(connection, row.id, String(row.entry_date), row.content, iso(row.created_at), DAILY_NOTE_TIME_PRECISION_DAY, iso(row.created_at))
    })
  }

  /** 幂等取建某天的手记，返回其 id；连接与事务连接都可用。 */
  private async ensureNoteByDate(executor: Pool | PoolConnection, entryDate: string): Promise<string> {
    await executor.execute(`INSERT INTO daily_notes(id, owner_user_id, entry_date, content, created_at, updated_at)
      VALUES(UUID(), ?, ?, '', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE id=id`, [this.scope.userId, entryDate])
    const [rows] = await executor.query<Array<RowDataPacket & { id: string }>>('SELECT id FROM daily_notes WHERE owner_user_id=? AND entry_date=?', [this.scope.userId, entryDate])
    return String(rows[0]!.id)
  }

  private async insertEntry(connection: PoolConnection, noteId: string, entryDate: string, content: string, recordedAt: string, precision: DailyNoteTimePrecision, createdAt?: string): Promise<string> {
    const id = crypto.randomUUID()
    const now = 'UTC_TIMESTAMP(3)'
    await connection.execute(`INSERT INTO daily_note_entries(id, owner_user_id, daily_note_id, entry_date, recorded_at, time_precision, content, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,${createdAt ? '?' : now},${now})`,
      [id, this.scope.userId, noteId, entryDate, sqlDate(recordedAt), precision, content, ...(createdAt ? [sqlDate(createdAt)] : [])])
    return id
  }

  /** 把一批手记的 content 换成条目合成值；条目一次性取回后内存分组，避免逐篇查询。 */
  private async synthesize(notes: DailyNote[], pool: Pool): Promise<DailyNote[]> {
    if (notes.length === 0) return notes
    const ids = notes.map(note => note.id)
    const [rows] = await pool.query<EntryRow[]>(`SELECT ${entryColumns} FROM daily_note_entries
      WHERE owner_user_id=? AND daily_note_id IN (${ids.map(() => '?').join(',')}) ORDER BY recorded_at ASC`, [this.scope.userId, ...ids])
    const byNote = new Map<string, DailyNoteEntry[]>()
    for (const row of rows) {
      const entry = mapEntry(row)
      const list = byNote.get(entry.dailyNoteId)
      if (list) list.push(entry)
      else byNote.set(entry.dailyNoteId, [entry])
    }
    return notes.map(note => ({ ...note, content: serializeDailyNoteEntries(byNote.get(note.id) ?? []) }))
  }
}

/** 东八区当天日期。 */
function shanghaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
