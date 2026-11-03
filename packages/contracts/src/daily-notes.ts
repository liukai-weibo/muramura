export interface DailyNote {
  id: string
  entryDate: string
  /** 合成字段：由当天的条目实时拼接，保持旧的「HH:MM\n内容」文本形态，不再作为写入源。 */
  content: string
  aiConversationId?: string
  createdAt: string
  updatedAt: string
}

/** 旧数据整体迁移产生的条目，不落具体时刻，时间只到「日」。 */
export const DAILY_NOTE_TIME_PRECISION_DAY = 'day' as const
export const DAILY_NOTE_TIME_PRECISION_MINUTE = 'minute' as const
export type DailyNoteTimePrecision = typeof DAILY_NOTE_TIME_PRECISION_DAY | typeof DAILY_NOTE_TIME_PRECISION_MINUTE

export const MINUTES_PER_DAY = 24 * 60

export interface DailyNoteEntry {
  id: string
  dailyNoteId: string
  /** 东八区日期，必须与所属手记一致。 */
  entryDate: string
  /** UTC ISO 时间，分钟精度。 */
  recordedAt: string
  timePrecision: DailyNoteTimePrecision
  content: string
  createdAt: string
  updatedAt: string
}

export interface DailyNoteWithEntries extends DailyNote {
  entries: DailyNoteEntry[]
}

export interface DailyNoteEntryWriteInput {
  content: string
  /**
   * 省略＝现在。`'HH:MM'` 表示本篇当天的这个时刻；
   * 完整 ISO 表示绝对时刻，东八区日期与本篇不同时会把这条件记录搬到目标日期。
   */
  recordedAt?: string
}

const dailyNoteTimeZone = 'Asia/Shanghai'

/** 取东八区的日期与时钟。用 Intl 而非 Date 偏移，避免运行环境时区影响。 */
export function dailyNoteClock(iso: string): { date: string; hour: number; minute: number; label: string } | undefined {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return undefined
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: dailyNoteTimeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at)
  const pick = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  const hour = Number(pick('hour'))
  const minute = Number(pick('minute'))
  const date = `${pick('year')}-${pick('month')}-${pick('day')}`
  if (!date || Number.isNaN(hour) || Number.isNaN(minute)) return undefined
  return { date, hour, minute, label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` }
}

/** 东八区的当天分钟数 0..1439，供时间轴按真实时间定位。 */
export function dailyNoteMinuteOfDay(iso: string): number | undefined {
  const clock = dailyNoteClock(iso)
  return clock ? clock.hour * 60 + clock.minute : undefined
}

const shanghaiOffsetMs = 8 * 60 * 60 * 1000

/** 东八区「某天的某一分钟」→ UTC ISO；越界分钟夹到 0..1439。 */
export function dailyNoteAtMinute(entryDate: string, minute: number): string | undefined {
  const [year, month, day] = entryDate.split('-').map(Number)
  if ([year, month, day].some(value => value === undefined || Number.isNaN(value))) return undefined
  if (month! < 1 || month! > 12 || day! < 1 || day! > daysInMonth(year!, month!)) return undefined
  const clamped = Math.min(MINUTES_PER_DAY - 1, Math.max(0, Math.round(minute)))
  const hour = Math.floor(clamped / 60)
  return new Date(Date.UTC(year!, month! - 1, day!, hour, clamped % 60) - shanghaiOffsetMs).toISOString()
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** 时间顺序：recordedAt → createdAt → id，保证同刻条目稳定相邻。 */
export function dailyNoteSortEntries(entries: DailyNoteEntry[]): DailyNoteEntry[] {
  return [...entries].sort((left, right) =>
    left.recordedAt.localeCompare(right.recordedAt)
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id))
}

export interface QuickTimePrefix {
  /** 解析后的东八区日期，年份已按参考日期补齐。 */
  date: string
  time: string
  rest: string
}

const quickTimePattern = /^\s*@(?:(\d{4})-)?(\d{1,2})-(\d{1,2})[ T]+(\d{1,2}):(\d{2})(?=\s|$)|^\s*@(\d{1,2}):(\d{2})(?=\s|$)/

/**
 * 识别行首的 `@10-26 15:30 内容` / `@2025-10-26 15:30 内容` / `@15:30 内容`。
 * 只认行首，正文中间的 @ 不动；缺省年份取参考日期的年份，
 * 若因此落到参考日期之后，则回退一年（跨年补录 12-31 不会跑到未来）。
 * 没有剩余正文时不算快捷补录，返回 undefined，避免把纯标记当内容吞掉。
 */
export function parseQuickTimePrefix(content: string, referenceDate: string): QuickTimePrefix | undefined {
  const match = quickTimePattern.exec(content)
  if (!match) return undefined
  // 标记末尾的分隔空白属于标记，不该带进正文。
  const rest = content.slice(match[0].length).replace(/^\s+/, '')
  if (!rest.trim()) return undefined
  const referenceYear = Number(referenceDate.slice(0, 4))
  if (Number.isNaN(referenceYear)) return undefined

  const hasDate = match[3] !== undefined
  const month = Number(hasDate ? match[2] : '0')
  const day = Number(hasDate ? match[3] : '0')
  const hour = Number(hasDate ? match[4] : match[6])
  const minute = Number(hasDate ? match[5] : match[7])
  if (hour > 23 || minute > 59) return undefined

  if (!hasDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) return undefined
    return { date: referenceDate, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, rest }
  }
  if (month < 1 || month > 12) return undefined
  if (day < 1 || day > daysInMonth(referenceYear, month)) return undefined

  const explicitYear = match[1] ? Number(match[1]) : undefined
  let year = explicitYear ?? referenceYear
  if (explicitYear === undefined) {
    const candidate = `${year}-${pad2(month)}-${pad2(day)}`
    if (candidate > referenceDate) year -= 1
  }
  return { date: `${year}-${pad2(month)}-${pad2(day)}`, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, rest }
}

function pad2(value: number): string { return String(value).padStart(2, '0') }

/**
 * 合成旧的整篇文本：块间用 `\n\n`，每块为 `HH:MM\n内容`。
 * 单条 day 精度条目（纯历史手记）必须逐字还原原文，旧客户端才无感；
 * 一旦当天混入新条目，day 条目也带上时间标记，避免被相邻块吸收。
 */
export function serializeDailyNoteEntries(entries: DailyNoteEntry[]): string {
  const ordered = dailyNoteSortEntries(entries)
  if (ordered.length === 1 && ordered[0]!.timePrecision === DAILY_NOTE_TIME_PRECISION_DAY) return ordered[0]!.content
  return ordered.map(entry => {
    const clock = dailyNoteClock(entry.recordedAt)
    return clock ? `${clock.label}\n${entry.content}` : entry.content
  }).join('\n\n')
}

/**
 * 兼容层：把旧客户端提交的整篇文本拆回条目。
 * 只有在 `\n\n` 之后紧跟 `HH:MM` 行处才切块，正文内的空行不会被误拆；
 * 首个时间标记之前的文本作为 day 精度条目保留，确保不丢文本。
 */
export function parseSerializedDailyNote(text: string): Array<{ time?: string; content: string }> {
  if (!text.trim()) return []
  const blocks: Array<{ time?: string; content: string }> = []
  const marker = /(^|\n\n)(\d{2}:\d{2})\n/g
  let cursor = 0
  let pending: string | undefined
  for (let match = marker.exec(text); match; match = marker.exec(text)) {
    const markerStart = match.index + match[1]!.length
    const bodyStart = markerStart + match[2]!.length + 1
    if (markerStart > cursor) {
      const leading = text.slice(cursor, markerStart).replace(/\n+$/, '')
      if (leading.trim()) blocks.push({ ...(pending ? { time: pending } : {}), content: leading })
    }
    pending = match[2]!
    cursor = bodyStart
  }
  const tail = text.slice(cursor).replace(/\n+$/, '')
  if (pending) {
    if (tail.trim()) blocks.push({ time: pending, content: tail })
  } else if (tail.trim()) {
    blocks.push({ content: tail })
  }
  return blocks
}

/** 'emotion'（梳理今日情绪）已下线：状态信息不再采集，也不再注入 AI 上下文。 */
export const dailyNoteAiCommands = ['daily_actions', 'improve_writing', 'extract_todos', 'resistance'] as const
export type DailyNoteAiCommand = (typeof dailyNoteAiCommands)[number]
export interface DailyNoteTodoCandidate { id: string; title: string; content?: string }
export interface DailyNoteActionFact { id: string; title: string; content: string; createdAt: string; statusEvents: Array<{ toStatus: string; createdAt: string }> }

export interface DailyNoteRepository {
  getToday(): Promise<DailyNote | undefined>
  getOrCreateToday(): Promise<DailyNote>
  /** 按东八区日期取或建手记：补录一个还没有手记的日子靠它。 */
  getOrCreateByDate(entryDate: string): Promise<DailyNote>
  listMine(): Promise<DailyNote[]>
  updateMine(id: string, content: string): Promise<DailyNote | undefined>
  appendToday(content: string): Promise<DailyNote>
  getMine(id: string): Promise<DailyNote | undefined>
  setAiConversationId(id: string, conversationId?: string): Promise<DailyNote | undefined>
  listActionFactsForDate(entryDate: string): Promise<DailyNoteActionFact[]>
  listEntries(id: string): Promise<DailyNoteEntry[]>
  getMineWithEntries(id: string): Promise<DailyNoteWithEntries | undefined>
  createEntry(id: string, input: DailyNoteEntryWriteInput): Promise<DailyNoteEntry | undefined>
  updateEntry(id: string, entryId: string, input: DailyNoteEntryWriteInput): Promise<DailyNoteEntry | undefined>
  deleteEntry(id: string, entryId: string): Promise<boolean>
  clearEntries(id: string): Promise<boolean>
  /** 全部日期的条目，供 AI 上下文与备份导出使用。 */
  exportEntryBackup(): Promise<DailyNoteEntry[]>
  /** 旧备份（V4–V10）只有整篇文本时，按同一规则转为 day 精度条目。 */
  materializeLegacyContent(): Promise<void>
}

export interface DailyNoteBackupStore {
  exportBackup(): Promise<DailyNote[]>
  exportEntryBackup(): Promise<DailyNoteEntry[]>
  replaceBackup(values: DailyNote[]): Promise<void>
  replaceEntryBackup(values: DailyNoteEntry[]): Promise<void>
  materializeLegacyContent(): Promise<void>
}
