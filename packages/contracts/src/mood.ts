/**
 * 情绪记录契约：5 档中性情绪分级 + 月度情绪日历/卡片网格。
 * entry_date 为本地 YYYY-MM-DD；tags 为自由标签（一期只记录不筛选）。
 */

export const moodLevels = [1, 2, 3, 4, 5] as const
export type MoodLevel = (typeof moodLevels)[number]

export const MOOD_LEVEL_MIN = 1
export const MOOD_LEVEL_MAX = 5
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
  moodLevel: MoodLevel
  tags?: string[]
  response?: string
  entryDate?: string
}

export interface MoodEntryRepository {
  listRange(from?: string, to?: string): Promise<MoodEntry[]>
  create(input: MoodEntryInput & { entryDate: string }): Promise<MoodEntry>
  updateMine(id: string, input: MoodEntryInput & { entryDate: string }): Promise<MoodEntry | undefined>
  deleteMine(id: string): Promise<boolean>
}

export interface MoodEntryBackupStore {
  exportBackup(): Promise<MoodEntry[]>
  replaceBackup(values: MoodEntry[]): Promise<void>
}
