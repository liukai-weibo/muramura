import type { ActivityAuditRecorder, MoodEntry, MoodEntryInput, MoodEntryRepository, MoodLevel } from '@knowledge-base/contracts'
import { BusinessError } from '@knowledge-base/domain'
import { safeAuditRecord } from './audit'
import { utcDatePlusDays } from './date-utils'

const MOOD_LEVEL_SET = new Set<number>([1, 2, 3, 4, 5])
const MAX_CONTENT = 2000
const MAX_RESPONSE = 1000
const MAX_TAGS = 10
const MAX_TAG_LENGTH = 20

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((t: unknown) => (typeof t === 'string' ? t.trim() : ''))
    .filter(Boolean)
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, MAX_TAGS)
    .map(t => t.slice(0, MAX_TAG_LENGTH))
}

function todayLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isDateValid(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
}

export class MoodEntryApplicationService {
  constructor(private readonly repository: MoodEntryRepository, private readonly auditRecorder?: ActivityAuditRecorder) {}

  listRange(from?: string, to?: string): Promise<MoodEntry[]> {
    return this.repository.listRange(from, to)
  }

  async create(input: MoodEntryInput): Promise<MoodEntry> {
    this.validateInput(input)
    const entryDate = input.entryDate && isDateValid(input.entryDate) ? input.entryDate : todayLocal()
    // 上界 = UTC 今天 + 1 天：覆盖任意时区“本地今天”，凌晨窗口（东八区 00:00~07:59 = UTC 前一天）不被误判为未来；本地明天及以上仍拒绝。
    if (entryDate > utcDatePlusDays(1)) {
      throw new BusinessError('MOOD_ENTRY_INVALID', 'validation', '情绪记录日期不能晚于今天')
    }
    const created = await this.repository.create({ ...input, entryDate, tags: normalizeTags(input.tags) })
    await safeAuditRecord(this.auditRecorder, { module: 'mood', action: 'create', entityId: created.id, snapshot: JSON.stringify({ content: created.content, moodLevel: created.moodLevel, tags: created.tags }) })
    return created
  }

  async updateMine(id: string, input: MoodEntryInput): Promise<MoodEntry> {
    this.validateInput(input)
    const entryDate = input.entryDate && isDateValid(input.entryDate) ? input.entryDate : todayLocal()
    if (entryDate > utcDatePlusDays(1)) {
      throw new BusinessError('MOOD_ENTRY_INVALID', 'validation', '情绪记录日期不能晚于今天')
    }
    const updated = await this.repository.updateMine(id, { ...input, entryDate, tags: normalizeTags(input.tags) })
    if (!updated) throw new BusinessError('MOOD_ENTRY_NOT_FOUND', 'not-found', '情绪记录不存在')
    await safeAuditRecord(this.auditRecorder, { module: 'mood', action: 'update', entityId: updated.id, snapshot: JSON.stringify({ content: updated.content, moodLevel: updated.moodLevel, tags: updated.tags }) })
    return updated
  }

  async deleteMine(id: string): Promise<void> {
    const before = (await this.repository.listRange()).find((entry) => entry.id === id)
    const deleted = await this.repository.deleteMine(id)
    if (!deleted) throw new BusinessError('MOOD_ENTRY_NOT_FOUND', 'not-found', '情绪记录不存在')
    if (before) {
      await safeAuditRecord(this.auditRecorder, { module: 'mood', action: 'delete', entityId: before.id, snapshot: JSON.stringify({ content: before.content, moodLevel: before.moodLevel, tags: before.tags }) })
    }
  }

  private validateInput(input: MoodEntryInput): void {
    if (!input.content || typeof input.content !== 'string' || !input.content.trim()) {
      throw new BusinessError('MOOD_ENTRY_INVALID', 'validation', '情绪记录内容不能为空')
    }
    if (input.content.length > MAX_CONTENT) {
      throw new BusinessError('MOOD_ENTRY_INVALID', 'validation', '情绪记录内容超出长度限制')
    }
    if (typeof input.moodLevel !== 'number' || !MOOD_LEVEL_SET.has(input.moodLevel)) {
      throw new BusinessError('MOOD_ENTRY_INVALID', 'validation', '情绪等级无效')
    }
    if (input.tags !== undefined) {
      if (!Array.isArray(input.tags)) throw new BusinessError('MOOD_ENTRY_INVALID', 'validation', '标签格式无效')
      if (input.tags.length > MAX_TAGS) throw new BusinessError('MOOD_ENTRY_INVALID', 'validation', '标签数量超出限制')
      for (const tag of input.tags) {
        if (typeof tag !== 'string' || tag.trim().length > MAX_TAG_LENGTH) {
          throw new BusinessError('MOOD_ENTRY_INVALID', 'validation', '标签内容无效')
        }
      }
    }
    if (input.response !== undefined && typeof input.response === 'string' && input.response.length > MAX_RESPONSE) {
      throw new BusinessError('MOOD_ENTRY_INVALID', 'validation', '感受对策超出长度限制')
    }
    if (input.entryDate !== undefined && !isDateValid(input.entryDate)) {
      throw new BusinessError('MOOD_ENTRY_INVALID', 'validation', '日期格式无效')
    }
  }
}
