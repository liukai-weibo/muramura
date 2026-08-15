import type { DailyNote, DailyNoteActionFact, DailyNoteRepository } from '@knowledge-base/contracts'
import { BusinessError } from '@knowledge-base/domain'

const maxContentLength = 100_000

export class DailyNoteApplicationService {
  constructor(private readonly repository: DailyNoteRepository) {}

  getOrCreateToday(): Promise<DailyNote> { return this.repository.getOrCreateToday() }
  getToday(): Promise<DailyNote | undefined> { return this.repository.getToday() }
  listMine(): Promise<DailyNote[]> { return this.repository.listMine() }
  getMine(id: string): Promise<DailyNote | undefined> { return this.repository.getMine(id) }
  setAiConversationId(id: string, conversationId?: string): Promise<DailyNote | undefined> { return this.repository.setAiConversationId(id, conversationId) }
  listActionFactsForDate(entryDate: string): Promise<DailyNoteActionFact[]> { return this.repository.listActionFactsForDate(entryDate) }

  async updateMine(id: string, content: string): Promise<DailyNote> {
    if (!id.trim() || typeof content !== 'string' || content.length > maxContentLength) {
      throw new BusinessError('DAILY_NOTE_INVALID', 'validation', '日记内容无效或超出长度限制')
    }
    const updated = await this.repository.updateMine(id, content)
    if (!updated) throw new BusinessError('DAILY_NOTE_NOT_FOUND', 'not-found', '今日小记不存在')
    return updated
  }

  async appendToday(content: string): Promise<DailyNote> {
    const normalized = content.trim()
    if (!normalized || normalized.length > maxContentLength) {
      throw new BusinessError('DAILY_NOTE_INVALID', 'validation', '速记内容不能为空或超出长度限制')
    }
    return this.repository.appendToday(normalized)
  }
}
