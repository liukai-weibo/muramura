/**
 * 今日饮食推荐 · 个人档案契约（服务端存储 + 审计）。
 * 每用户单行（owner_user_id 主键），保存走后端 upsert 并记录审计（module=daily_diet, action=update），
 * 顺带具备多端同步与 JSON 备份能力。
 */

export const DIET_PROFILE_HEALTH_NOTE_MAX = 500
export const DIET_PROFILE_NUMERIC_MAX = 400

export type DietGender = 'male' | 'female' | 'other'
export type DietGoal = 'lose_fat' | 'gain_muscle' | 'maintain' | 'other'
export type DietActivity = 'sedentary' | 'light' | 'moderate' | 'high'

export interface DietProfileInput {
  heightCm?: number
  weightKg?: number
  age?: number
  gender?: DietGender
  goal?: DietGoal
  activity?: DietActivity
  healthNote?: string
}

export interface DietProfile {
  heightCm?: number
  weightKg?: number
  age?: number
  gender?: DietGender
  goal?: DietGoal
  activity?: DietActivity
  healthNote?: string
  createdAt: string
  updatedAt: string
}

export interface DietProfileRepository {
  getMine(): Promise<DietProfile | undefined>
  upsertMine(input: DietProfileInput): Promise<DietProfile>
}

export interface DietProfileBackupStore {
  exportBackup(): Promise<DietProfile[]>
  replaceBackup(values: DietProfile[]): Promise<void>
}
