import type { AiStreamEvent, HomeAiCard } from '@knowledge-base/contracts'
import { apiClient, isApiClientAbort } from '../../api-client'
import { todayLocalDate } from '../mood/mood-levels'
import { startMidnightAutoGenerate } from '../daily-summary/daily-summary-auto'

/**
 * 首页自定义 AI 卡片自动生成：跨天检测 + 幂等保护。
 * - 遍历 daily 模式且当日无缓存的卡片，串行调用 AI 生成并落库；
 * - AI 未配置则静默降级（不调用）；
 * - 单卡生成失败不重试（避免重复消耗），返回 failed 供卡片显示重试按钮。
 * 提示词直接作为 user 消息发送，服务端自动注入知识上下文（与近期状态小结一致）。
 */

const LAST_SEEN_DATE_KEY = 'marumaru.home-ai-cards.last-seen-date'
let documentStartKey = todayLocalDate()
const generateStartedRef = { current: false }

function writeLastSeenDate(date: string): void {
  try { localStorage.setItem(LAST_SEEN_DATE_KEY, date) } catch { /* ignore */ }
}

export interface HomeAiCardsAutoResult {
  /** 是否至少有一张卡片真正调用并生成了内容 */
  generated: boolean
  /** 是否发现 AI 未配置（静默失败） */
  aiUnavailable: boolean
  /** 是否存在生成失败的卡片（不用于展示，仅卡片显示手动按钮） */
  failed: boolean
}

/** 内部：消费流式接口并在成功后把输出落库到该卡当天缓存。 */
async function collectStream(card: HomeAiCard, controller: AbortController): Promise<{ ok: boolean; aborted: boolean }> {
  let ok = false
  let aborted = false
  let output = ''
  const today = todayLocalDate()
  try {
    const messages = [{ role: 'user' as const, content: card.aiPrompt }]
    for await (const event of apiClient.streamExperimentalAiChatEphemeral(messages, controller.signal)) {
      if (controller.signal.aborted) { aborted = true; break }
      if (event.type === 'token') output += event.content
      if (event.type === 'incomplete' || event.type === 'error') { ok = false; break }
    }
    if (!aborted && output.trim()) {
      await apiClient.upsertHomeAiCardCache(card.id, today, output.trim())
      ok = true
    }
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') aborted = true
    else if (!isApiClientAbort(cause)) { ok = false }
  }
  return { ok, aborted }
}

/**
 * 检查当天无缓存且跨了新的一天 → 自动生成一次（daily 模式卡片）。
 * 首页卡片挂载与午夜定时器回调调用。
 */
export async function autoGenerateHomeAiCardsIfNeeded(): Promise<HomeAiCardsAutoResult> {
  const today = todayLocalDate()
  if (generateStartedRef.current && documentStartKey === today) return { generated: false, aiUnavailable: false, failed: false }
  let cards: HomeAiCard[] = []
  let caches: Array<{ cardId: string }> = []
  try {
    cards = await apiClient.listHomeAiCards()
    caches = await apiClient.listHomeAiCardCaches(today)
  } catch {
    return { generated: false, aiUnavailable: false, failed: true }
  }
  const pending = cards.filter(card => card.refreshMode === 'daily' && !card.isHidden && !caches.some(cache => cache.cardId === card.id))
  if (pending.length === 0) { writeLastSeenDate(today); return { generated: false, aiUnavailable: false, failed: false } }
  generateStartedRef.current = true
  documentStartKey = today
  try {
    const status = await apiClient.getAiConfigStatus()
    if (!status.configured) { writeLastSeenDate(today); return { generated: false, aiUnavailable: true, failed: false } }
  } catch {
    return { generated: false, aiUnavailable: true, failed: false }
  }
  let generatedAny = false
  let failedAny = false
  for (const card of pending) {
    const controller = new AbortController()
    const result = await collectStream(card, controller)
    if (result.ok) generatedAny = true
    if (!result.ok && !result.aborted) failedAny = true
  }
  writeLastSeenDate(today)
  return { generated: generatedAny, aiUnavailable: false, failed: failedAny }
}

export function resetHomeAiCardsAutoGenerateGuard(): void {
  generateStartedRef.current = false
}

export { startMidnightAutoGenerate }