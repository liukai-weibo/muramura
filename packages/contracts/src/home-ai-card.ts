/**
 * 首页自定义 AI 卡片契约：用户可新增自己的 AI 分析卡片，配置标题、AI 提示词、
 * 尺寸、底色与刷新模式；AI 结果按 (card_id, cache_date) 每日缓存，一日一次调用。
 * 系统内置卡（近期状态小结/今日饮食推荐）不存入本表，仍为硬编码渲染。
 */

export const HOME_AI_CARD_TITLE_MAX_LENGTH = 50
export const HOME_AI_CARD_PROMPT_MAX_LENGTH = 2000
export const HOME_AI_CARD_OUTPUT_MAX_LENGTH = 4000
export const HOME_AI_CARD_MAX_PER_USER = 12

export const homeAiCardSizes = ['small', 'medium', 'large'] as const
export type HomeAiCardSize = (typeof homeAiCardSizes)[number]

export const homeAiCardThemes = ['cream', 'green', 'beige'] as const
export type HomeAiCardTheme = (typeof homeAiCardThemes)[number]

export const homeAiCardRefreshModes = ['daily', 'manual'] as const
export type HomeAiCardRefreshMode = (typeof homeAiCardRefreshModes)[number]

export interface HomeAiCard {
  id: string
  cardTitle: string
  aiPrompt: string
  cardSize: HomeAiCardSize
  cardTheme: HomeAiCardTheme
  refreshMode: HomeAiCardRefreshMode
  sortIndex: number
  isHidden: boolean
  createdAt: string
  updatedAt: string
}

/** 不含服务端分配字段（sortIndex / isHidden / 时间戳）。 */
export interface HomeAiCardInput {
  cardTitle: string
  aiPrompt: string
  cardSize: HomeAiCardSize
  cardTheme: HomeAiCardTheme
  refreshMode: HomeAiCardRefreshMode
}

export interface HomeAiCardCache {
  id: string
  cardId: string
  cacheDate: string
  aiOutput: string
  createdAt: string
  updatedAt: string
}

export interface HomeAiCardCacheInput {
  cacheDate: string
  aiOutput: string
}

export interface HomeAiCardRepository {
  list(): Promise<HomeAiCard[]>
  get(id: string): Promise<HomeAiCard | undefined>
  create(input: HomeAiCardInput): Promise<HomeAiCard>
  update(id: string, input: HomeAiCardInput): Promise<HomeAiCard | undefined>
  delete(id: string): Promise<boolean>
  listCaches(cacheDate: string): Promise<HomeAiCardCache[]>
  getCache(cardId: string, cacheDate: string): Promise<HomeAiCardCache | undefined>
  upsertCache(cardId: string, cache: HomeAiCardCacheInput): Promise<HomeAiCardCache>
}

/** 单一 Store 同时管理两类表，恢复时在同一事务内按外键顺序写入。 */
export interface HomeAiCardBackupStore {
  exportBackup(): Promise<{ cards: HomeAiCard[]; caches: HomeAiCardCache[] }>
  replaceBackup(values: { cards: HomeAiCard[]; caches: HomeAiCardCache[] }): Promise<void>
}
