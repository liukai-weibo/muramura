/**
 * 一日三餐记录契约：每天 breakfast/lunch/dinner 三个槽位，每餐一条记录（内容 + 饱腹度）。
 * entry_date 为本地 YYYY-MM-DD；同一天同一餐唯一（upsert 语义），以天为写入粒度。
 * 饱腹度取值 {0, 5, 7, 9}：0=未填写（不是可选档位，默认值），5=五分饱，7=七分饱，9=九分饱。
 * 历史版本 1-5 档“餐后感受”数据由 Migration 032 阈值映射为饱腹度，备份恢复保留历史值兼容。
 */

export const mealTypes = ['breakfast', 'lunch', 'dinner'] as const
export type MealType = (typeof mealTypes)[number]

/** 未填写默认值（不在 UI 中作为可选档位展示，也不作为选项提交）。 */
export const MEAL_SATIETY_UNSET = 0
/** 可选档位：五分饱 / 七分饱 / 九分饱。 */
export const MEAL_SATIETY_LEVELS = [5, 7, 9] as const
export const MEAL_SATIETY_VALUES: ReadonlySet<number> = new Set([MEAL_SATIETY_UNSET, ...MEAL_SATIETY_LEVELS])
export const MEAL_SATIETY_LABELS: Record<number, string> = {
  0: '未记录',
  5: '五分饱',
  7: '七分饱',
  9: '九分饱',
}
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
