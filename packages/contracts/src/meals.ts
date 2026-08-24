/**
 * 一日三餐记录契约：每天 breakfast/lunch/dinner 三个槽位，每餐一条记录（内容 + 5 档感受）。
 * entry_date 为本地 YYYY-MM-DD；同一天同一餐唯一（upsert 语义），以天为写入粒度。
 */

export const mealTypes = ['breakfast', 'lunch', 'dinner'] as const
export type MealType = (typeof mealTypes)[number]

export const MEAL_FEELING_MIN = 1
export const MEAL_FEELING_MAX = 5
export const MEAL_CONTENT_MAX_LENGTH = 1000

export interface MealEntry {
  id: string
  entryDate: string
  mealType: MealType
  content: string
  feeling: number
  createdAt: string
  updatedAt: string
}

export interface MealSlotInput {
  mealType: MealType
  content: string
  feeling: number
}

export interface MealDayInput {
  entryDate: string
  meals: MealSlotInput[]
}

export interface MealEntryRepository {
  listRange(from?: string, to?: string): Promise<MealEntry[]>
  saveDay(input: MealDayInput): Promise<MealEntry[]>
}

export interface MealEntryBackupStore {
  exportBackup(): Promise<MealEntry[]>
  replaceBackup(values: MealEntry[]): Promise<void>
}
