/**
 * 事件记录契约：条目内容为主体，兼容保留 5 档分级字段。
 * entry_date 为本地 YYYY-MM-DD；tags 为自由标签（一期只记录不筛选）。
 */

export const moodLevels = [1, 2, 3, 4, 5] as const
export type MoodLevel = (typeof moodLevels)[number]

export const MOOD_LEVEL_MIN = 1
export const MOOD_LEVEL_MAX = 5
/**
 * 状态档位已停止采集：界面不再询问「今天状态怎么样」，
 * 新记录统一写入该中性值。列与历史值保留，旧记录与备份仍可读。
 */
export const MOOD_LEVEL_UNSET: MoodLevel = 3
export const MOOD_CONTENT_MAX_LENGTH = 2000
export const MOOD_RESPONSE_MAX_LENGTH = 1000
export const MOOD_TAG_MAX_COUNT = 10
export const MOOD_TAG_MAX_LENGTH = 20

export interface MoodEntry {
  id: string
  entryDate: string
  content: string
  moodLevel: MoodLevel
  tags: string[]
  response?: string
  createdAt: string
  updatedAt: string
}

export interface MoodEntryInput {
  content: string
  /** 已停止采集：调用方通常省略，由 Application 层填充 MOOD_LEVEL_UNSET。 */
  moodLevel?: MoodLevel
  tags?: string[]
  response?: string
  entryDate?: string
}

/** Repository 入参：moodLevel 必填（Application 层已把省略的档位填充为 MOOD_LEVEL_UNSET）。 */
export type MoodEntryWriteInput = Omit<MoodEntryInput, 'moodLevel' | 'entryDate'> & {
  entryDate: string
  moodLevel: MoodLevel
}

export interface MoodEntryRepository {
  listRange(from?: string, to?: string): Promise<MoodEntry[]>
  create(input: MoodEntryWriteInput): Promise<MoodEntry>
  updateMine(id: string, input: MoodEntryWriteInput): Promise<MoodEntry | undefined>
  deleteMine(id: string): Promise<boolean>
}

export interface MoodEntryBackupStore {
  exportBackup(): Promise<MoodEntry[]>
  replaceBackup(values: MoodEntry[]): Promise<void>
}
