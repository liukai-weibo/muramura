import type { DietProfile, DietProfileInput } from '@knowledge-base/contracts'
import { apiClient } from '../../api-client'

/**
 * 今日饮食推荐 · 个人档案（前端适配器）。
 * 数据以服务端为准（每用户单行，多端同步），保存走 PUT /daily-diet/profile 并由后端记录审计。
 */
export const DEFAULT_DIET_PROFILE: DietProfileInput = { heightCm: 178, weightKg: 81 }

export const GENDER_OPTIONS = [
  { value: 'male' as const, label: '男' },
  { value: 'female' as const, label: '女' },
  { value: 'other' as const, label: '其他' },
]

export const GOAL_OPTIONS = [
  { value: 'lose_fat' as const, label: '减脂' },
  { value: 'gain_muscle' as const, label: '增肌' },
  { value: 'maintain' as const, label: '维持健康' },
  { value: 'other' as const, label: '其他' },
]

export const ACTIVITY_OPTIONS = [
  { value: 'sedentary' as const, label: '久坐' },
  { value: 'light' as const, label: '轻度活动' },
  { value: 'moderate' as const, label: '中度活动' },
  { value: 'high' as const, label: '高强度' },
]

const GENDER_LABEL: Record<string, string> = { male: '男', female: '女', other: '其他' }
const GOAL_LABEL: Record<string, string> = { lose_fat: '减脂', gain_muscle: '增肌', maintain: '维持健康', other: '其他' }
const ACTIVITY_LABEL: Record<string, string> = { sedentary: '久坐', light: '轻度活动', moderate: '中度活动', high: '高强度' }

/** 读取个人档案（服务端）；无记录或异常一律回退默认（身高/体重）。 */
export async function loadDietProfile(): Promise<DietProfileInput> {
  try {
    const profile = await apiClient.getDietProfile()
    return profile || { ...DEFAULT_DIET_PROFILE }
  } catch {
    return { ...DEFAULT_DIET_PROFILE }
  }
}

/** 保存个人档案（服务端，后端记录审计）；异常抛出由调用方处理。 */
export async function saveDietProfile(input: DietProfileInput): Promise<DietProfile> {
  return apiClient.upsertDietProfile(input)
}

/** 把已填个人档案组装为提示词一段；全空返回空串（不注入）。纯函数、可测。 */
export function buildDietProfileSegment(profile: Pick<DietProfile, 'heightCm' | 'weightKg' | 'age' | 'gender' | 'goal' | 'activity' | 'healthNote'>): string {
  const parts: string[] = []
  if (profile.heightCm != null) parts.push('身高' + profile.heightCm + 'cm')
  if (profile.weightKg != null) parts.push('体重' + profile.weightKg + 'kg')
  if (profile.age != null) parts.push('年龄' + profile.age + '岁')
  if (profile.gender) parts.push('性别' + GENDER_LABEL[profile.gender])
  if (profile.goal) parts.push('目标' + GOAL_LABEL[profile.goal])
  if (profile.activity) parts.push('日常活动量' + ACTIVITY_LABEL[profile.activity])
  if (profile.healthNote?.trim()) parts.push('健康注意：' + profile.healthNote.trim())
  if (parts.length === 0) return ''
  return '[个人档案]：' + parts.join('、') + '。请结合此档案针对今日剩余时间的饮食给出建议。'
}
