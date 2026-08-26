import type {
  ActivityAuditRecorder,
  HomeAiCard,
  HomeAiCardCache,
  HomeAiCardInput,
  HomeAiCardRepository,
} from '@knowledge-base/contracts'
import {
  HOME_AI_CARD_TITLE_MAX_LENGTH,
  HOME_AI_CARD_PROMPT_MAX_LENGTH,
  HOME_AI_CARD_OUTPUT_MAX_LENGTH,
  HOME_AI_CARD_MAX_PER_USER,
  homeAiCardSizes,
  homeAiCardThemes,
  homeAiCardRefreshModes,
} from '@knowledge-base/contracts'
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
  return new BusinessError('HOME_AI_CARD_INVALID', 'validation', message)
}

function invalidCache(message: string): BusinessError<string> {
  return new BusinessError('HOME_AI_CARD_CACHE_INVALID', 'validation', message)
}

export class HomeAiCardApplicationService {
  constructor(
    private readonly repository: HomeAiCardRepository,
    private readonly auditRecorder?: ActivityAuditRecorder,
  ) {}

  async list(): Promise<HomeAiCard[]> {
    return this.repository.list()
  }

  async get(id: string): Promise<HomeAiCard | undefined> {
    if (!id || !id.trim()) throw invalid('卡片 ID 无效')
    return this.repository.get(id)
  }

  async create(input: HomeAiCardInput): Promise<HomeAiCard> {
    const normalized = this.validateInput(input)
    const existing = await this.repository.list()
    if (existing.length >= HOME_AI_CARD_MAX_PER_USER) throw invalid(`首页自定义AI卡片数量已达上限（${HOME_AI_CARD_MAX_PER_USER}）`)
    const created = await this.repository.create(normalized)
    await safeAuditRecord(this.auditRecorder, { module: 'home_ai_card', action: 'create', entityId: created.id, snapshot: JSON.stringify({ cardTitle: created.cardTitle, cardTheme: created.cardTheme }) })
    return created
  }

  async update(id: string, input: HomeAiCardInput): Promise<HomeAiCard | undefined> {
    if (!id || !id.trim()) throw invalid('卡片 ID 无效')
    const updated = await this.repository.update(id, this.validateInput(input))
    if (updated) await safeAuditRecord(this.auditRecorder, { module: 'home_ai_card', action: 'update', entityId: updated.id, snapshot: JSON.stringify({ cardTitle: updated.cardTitle, cardTheme: updated.cardTheme }) })
    return updated
  }

  async delete(id: string): Promise<boolean> {
    if (!id || !id.trim()) throw invalid('卡片 ID 无效')
    const removed = await this.repository.delete(id)
    if (removed) await safeAuditRecord(this.auditRecorder, { module: 'home_ai_card', action: 'delete', entityId: id })
    return removed
  }

  async listCaches(cacheDate: string): Promise<HomeAiCardCache[]> {
    if (!isDateValid(cacheDate)) throw invalidCache('日期格式无效')
    return this.repository.listCaches(cacheDate)
  }

  async getCache(cardId: string, cacheDate: string): Promise<HomeAiCardCache | undefined> {
    if (!isDateValid(cacheDate)) throw invalidCache('日期格式无效')
    return this.repository.getCache(cardId, cacheDate)
  }

  async upsertCache(cardId: string, cacheDate: string, aiOutput: string): Promise<HomeAiCardCache> {
    if (!isDateValid(cacheDate)) throw invalidCache('日期格式无效')
    if (cacheDate > todayLocal()) throw invalidCache('缓存日期不能晚于今天')
    const content = typeof aiOutput === 'string' ? aiOutput.trim() : ''
    if (!content) throw invalidCache('AI 输出内容不能为空')
    if (content.length > HOME_AI_CARD_OUTPUT_MAX_LENGTH) throw invalidCache('AI 输出内容超出长度限制')
    const cached = await this.repository.upsertCache(cardId, { cacheDate, aiOutput: content })
    await safeAuditRecord(this.auditRecorder, { module: 'home_ai_card', action: 'update', entityId: cardId, snapshot: JSON.stringify({ cacheDate, cacheId: cached.id }) })
    return cached
  }

  private validateInput(input: HomeAiCardInput): HomeAiCardInput {
    if (!input) throw invalid('卡片配置不能为空')
    const cardTitle = typeof input.cardTitle === 'string' ? input.cardTitle.trim() : ''
    if (!cardTitle) throw invalid('卡片标题不能为空')
    if (cardTitle.length > HOME_AI_CARD_TITLE_MAX_LENGTH) throw invalid(`卡片标题超出长度限制（${HOME_AI_CARD_TITLE_MAX_LENGTH}）`)
    const aiPrompt = typeof input.aiPrompt === 'string' ? input.aiPrompt.trim() : ''
    if (!aiPrompt) throw invalid('AI 提示词不能为空')
    if (aiPrompt.length > HOME_AI_CARD_PROMPT_MAX_LENGTH) throw invalid(`AI 提示词超出长度限制（${HOME_AI_CARD_PROMPT_MAX_LENGTH}）`)
    if (!homeAiCardSizes.includes(input.cardSize)) throw invalid('卡片尺寸枚举无效')
    if (!homeAiCardThemes.includes(input.cardTheme)) throw invalid('卡片底色枚举无效')
    if (!homeAiCardRefreshModes.includes(input.refreshMode)) throw invalid('刷新模式枚举无效')
    return { cardTitle, aiPrompt, cardSize: input.cardSize, cardTheme: input.cardTheme, refreshMode: input.refreshMode }
  }
}
