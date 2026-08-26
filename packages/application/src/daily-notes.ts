import type { ActivityAuditRecorder, DailyNote, DailyNoteActionFact, DailyNoteRepository } from '@knowledge-base/contracts'
import { BusinessError } from '@knowledge-base/domain'
import { safeAuditRecord } from './audit'

const maxContentLength = 100_000

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
  listMine(): Promise<DailyNote[]> { return this.repository.listMine() }
  getMine(id: string): Promise<DailyNote | undefined> { return this.repository.getMine(id) }
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
}
