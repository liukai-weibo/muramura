import type { ActivityAuditRecorder, DailyNote, DailyNoteActionFact, DailyNoteEntry, DailyNoteEntryWriteInput, DailyNoteRepository, DailyNoteWithEntries } from '@knowledge-base/contracts'
import { dailyNoteAtMinute, dailyNoteClock } from '@knowledge-base/contracts'
import { BusinessError } from '@knowledge-base/domain'
import { safeAuditRecord } from './audit'

const maxContentLength = 100_000
const entryTimePattern = /^([01]\d|2[0-3]):[0-5]\d$/
const dailyNoteDatePattern = /^\d{4}-\d{2}-\d{2}$/

export class DailyNoteApplicationService {
  constructor(private readonly repository: DailyNoteRepository, private readonly auditRecorder?: ActivityAuditRecorder) {}

  async getOrCreateToday(): Promise<DailyNote> {
    const existing = await this.repository.getToday()
    if (existing) return existing
    const created = await this.repository.getOrCreateToday()
    await safeAuditRecord(this.auditRecorder, { module: 'daily_note', action: 'create', entityId: created.id, snapshot: created.content })
    return created
  }
  getToday(): Promise<DailyNote | undefined> { return this.repository.getToday() }
  /**
   * 按日期取或建手记。补录一个还没有手记的日子靠它；
   * 不给未来日期建篇——手记是记录，不是计划，未来日期只会污染侧栏。
   * 这里不写审计：真正有价值的动作是随后写入的那条记录，那条自己会记。
   */
  async getOrCreateByDate(entryDate: string): Promise<DailyNote> {
    if (!dailyNoteDatePattern.test(entryDate) || !dailyNoteAtMinute(entryDate, 0)) {
      throw new BusinessError('DAILY_NOTE_INVALID', 'validation', '日期格式无效')
    }
    if (entryDate < '2000-01-01') throw new BusinessError('DAILY_NOTE_INVALID', 'validation', '日期超出可用范围')
    const today = dailyNoteClock(new Date().toISOString())?.date
    if (today && entryDate > today) throw new BusinessError('DAILY_NOTE_INVALID', 'validation', '不能为未来日期创建手记')
    return this.repository.getOrCreateByDate(entryDate)
  }
  listMine(): Promise<DailyNote[]> { return this.repository.listMine() }
  getMine(id: string): Promise<DailyNote | undefined> { return this.repository.getMine(id) }
  getMineWithEntries(id: string): Promise<DailyNoteWithEntries | undefined> { return this.repository.getMineWithEntries(id) }
  listEntries(id: string): Promise<DailyNoteEntry[]> { return this.repository.listEntries(id) }
  async setAiConversationId(id: string, conversationId?: string): Promise<DailyNote | undefined> {
    const updated = await this.repository.setAiConversationId(id, conversationId)
    if (updated) await safeAuditRecord(this.auditRecorder, { module: 'daily_note', action: 'update', entityId: updated.id, snapshot: JSON.stringify({ conversationId: updated.aiConversationId ?? null }) })
    return updated
  }
  listActionFactsForDate(entryDate: string): Promise<DailyNoteActionFact[]> { return this.repository.listActionFactsForDate(entryDate) }

  async updateMine(id: string, content: string): Promise<DailyNote> {
    if (!id.trim() || typeof content !== 'string' || content.length > maxContentLength) {
      throw new BusinessError('DAILY_NOTE_INVALID', 'validation', '日记内容无效或超出长度限制')
    }
    const updated = await this.repository.updateMine(id, content)
    if (!updated) throw new BusinessError('DAILY_NOTE_NOT_FOUND', 'not-found', '今日小记不存在')
    await safeAuditRecord(this.auditRecorder, { module: 'daily_note', action: 'update', entityId: updated.id, snapshot: updated.content })
    return updated
  }

  async appendToday(content: string): Promise<DailyNote> {
    const normalized = content.trim()
    if (!normalized || normalized.length > maxContentLength) {
      throw new BusinessError('DAILY_NOTE_INVALID', 'validation', '速记内容不能为空或超出长度限制')
    }
    const updated = await this.repository.appendToday(normalized)
    await safeAuditRecord(this.auditRecorder, { module: 'daily_note', action: 'update', entityId: updated.id, snapshot: updated.content })
    return updated
  }

  /** 在指定手记里新增一条记录；recordedAt 省略＝现在，传 'HH:MM' 表示该日期的这个时刻。 */
  async createEntry(id: string, input: DailyNoteEntryWriteInput): Promise<DailyNoteEntry> {
    const normalized = input.content.trim()
    if (!normalized || normalized.length > maxContentLength) {
      throw new BusinessError('DAILY_NOTE_INVALID', 'validation', '记录内容不能为空或超出长度限制')
    }
    const note = await this.repository.getMine(id)
    if (!note) throw new BusinessError('DAILY_NOTE_NOT_FOUND', 'not-found', '手记不存在')
    if (input.recordedAt !== undefined) {
      this.validateTimeFormat(input.recordedAt)
      // 新增只写本篇当天：要落到别的日期，先按日期取建手记再写，不给单个请求跨两天的权限。
      const clock = /^\d{2}:\d{2}$/.test(input.recordedAt) ? undefined : dailyNoteClock(input.recordedAt)
      if (clock && clock.date !== note.entryDate) {
        throw new BusinessError('DAILY_NOTE_INVALID', 'validation', '记录时间不属于该手记日期，请先按该日期创建手记')
      }
    }
    const created = await this.repository.createEntry(id, { content: normalized, ...(input.recordedAt === undefined ? {} : { recordedAt: input.recordedAt }) })
    if (!created) throw new BusinessError('DAILY_NOTE_NOT_FOUND', 'not-found', '手记不存在')
    await safeAuditRecord(this.auditRecorder, { module: 'daily_note', action: 'update', entityId: id, snapshot: JSON.stringify({ entryAdded: created.id, recordedAt: created.recordedAt, content: created.content }) })
    return created
  }

  /**
   * 更新一条记录。传完整 ISO 时允许跨天：时间落在别的东八区日期就把这条记录搬过去，
   * 这是「点时间标签改成 10-26，整条跳到那天」的实现路径。
   */
  async updateEntry(id: string, entryId: string, input: DailyNoteEntryWriteInput): Promise<DailyNoteEntry> {
    const normalized = input.content.trim()
    if (!normalized || normalized.length > maxContentLength) {
      throw new BusinessError('DAILY_NOTE_INVALID', 'validation', '记录内容不能为空或超出长度限制')
    }
    const note = await this.repository.getMine(id)
    if (!note) throw new BusinessError('DAILY_NOTE_NOT_FOUND', 'not-found', '手记不存在')
    if (input.recordedAt !== undefined) this.validateTimeFormat(input.recordedAt)
    const updated = await this.repository.updateEntry(id, entryId, { content: normalized, ...(input.recordedAt === undefined ? {} : { recordedAt: input.recordedAt }) })
    if (!updated) throw new BusinessError('DAILY_NOTE_ENTRY_NOT_FOUND', 'not-found', '记录不存在')
    await safeAuditRecord(this.auditRecorder, { module: 'daily_note', action: 'update', entityId: id, snapshot: JSON.stringify({ entryUpdated: updated.id, recordedAt: updated.recordedAt, content: updated.content }) })
    return updated
  }

  async deleteEntry(id: string, entryId: string): Promise<void> {
    const deleted = await this.repository.deleteEntry(id, entryId)
    if (!deleted) throw new BusinessError('DAILY_NOTE_ENTRY_NOT_FOUND', 'not-found', '记录不存在')
    await safeAuditRecord(this.auditRecorder, { module: 'daily_note', action: 'update', entityId: id, snapshot: JSON.stringify({ entryDeleted: entryId }) })
  }

  async clearEntries(id: string): Promise<void> {
    const note = await this.repository.getMine(id)
    if (!note) throw new BusinessError('DAILY_NOTE_NOT_FOUND', 'not-found', '手记不存在')
    await this.repository.clearEntries(id)
    await safeAuditRecord(this.auditRecorder, { module: 'daily_note', action: 'update', entityId: id, snapshot: JSON.stringify({ cleared: true }) })
  }

  /** 入参时间必须是 `'HH:MM'` 或不早于 2000 年、可解析的完整 ISO。 */
  private validateTimeFormat(recordedAt: string): void {
    if (/^\d{2}:\d{2}$/.test(recordedAt)) {
      if (!entryTimePattern.test(recordedAt)) throw new BusinessError('DAILY_NOTE_INVALID', 'validation', '时间格式无效')
      return
    }
    const clock = dailyNoteClock(recordedAt)
    if (!clock || clock.date < '2000-01-01') throw new BusinessError('DAILY_NOTE_INVALID', 'validation', '时间格式无效')
  }
}
