import type { ActivityAuditRecorder, DailyDietRecommendation, DailyDietRecommendationInput, DailyDietRecommendationRepository } from '@knowledge-base/contracts'
import { DAILY_DIET_CONTENT_MAX_LENGTH } from '@knowledge-base/contracts'
import { BusinessError } from '@knowledge-base/domain'
import { safeAuditRecord } from './audit'

function todayLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + day
}

function isDateValid(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
}

function invalid(message: string): BusinessError<string> {
  return new BusinessError('DIET_RECOMMENDATION_INVALID', 'validation', message)
}

export class DailyDietRecommendationApplicationService {
  constructor(
    private readonly repository: DailyDietRecommendationRepository,
    private readonly auditRecorder?: ActivityAuditRecorder,
  ) {}

  async listRange(from?: string, to?: string): Promise<DailyDietRecommendation[]> {
    if (from !== undefined && !isDateValid(from)) throw invalid('起始日期格式无效')
    if (to !== undefined && !isDateValid(to)) throw invalid('结束日期格式无效')
    return this.repository.listRange(from, to)
  }

  async getByDate(entryDate: string): Promise<DailyDietRecommendation | undefined> {
    if (!isDateValid(entryDate)) throw invalid('日期格式无效')
    return this.repository.getByDate(entryDate)
  }

  async upsertForDate(input: DailyDietRecommendationInput): Promise<DailyDietRecommendation> {
    if (!input || !isDateValid(input.entryDate)) throw invalid('日期格式无效')
    if (input.entryDate > todayLocal()) throw invalid('饮食推荐日期不能晚于今天')
    const content = typeof input.content === 'string' ? input.content.trim() : ''
    if (!content) throw invalid('饮食推荐内容不能为空')
    if (content.length > DAILY_DIET_CONTENT_MAX_LENGTH) throw invalid('饮食推荐内容超出长度限制')
    const saved = await this.repository.upsertForDate({ entryDate: input.entryDate, content })
    await safeAuditRecord(this.auditRecorder, { module: 'daily_diet', action: 'update', entityId: saved.id, snapshot: JSON.stringify({ entryDate: saved.entryDate, content: saved.content }) })
    return saved
  }
}
