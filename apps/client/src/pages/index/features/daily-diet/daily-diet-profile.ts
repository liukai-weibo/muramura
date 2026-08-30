/**
 * 今日饮食推荐 · 个人档案（前端本地配置）。
 * 身高/体重/年龄/性别/目标/日常活动量/健康状态为「可单独配置」字段，
 * 拼入今日饮食推荐提示词；仅注入已填项，未填不编造。
 */
export interface DailyDietProfile {
  /** 身高（cm） */
  heightCm?: number
  /** 体重（kg） */
  weightKg?: number
  /** 年龄（岁） */
  age?: number
  gender?: 'male' | 'female' | 'other'
  goal?: 'lose_fat' | 'gain_muscle' | 'maintain' | 'other'
  activity?: 'sedentary' | 'light' | 'moderate' | 'high'
  /** 健康状态 / 忌口 / 过敏 / 慢病（自由文本，可空） */
  healthNote?: string
}

export const DIET_PROFILE_STORAGE_KEY = 'mararumu.daily-diet.profile'

/** 当前硬编码身高/体重迁移为配置默认占位（用户可改）。 */
export const DEFAULT_DIET_PROFILE: DailyDietProfile = { heightCm: 178, weightKg: 81 }

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

function toOptionalNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : undefined
}

function normalizeProfile(raw: unknown): DailyDietProfile {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_DIET_PROFILE }
  const o = raw as Record<string, unknown>
  const profile: DailyDietProfile = {
    heightCm: toOptionalNumber(o.heightCm),
    weightKg: toOptionalNumber(o.weightKg),
    age: toOptionalNumber(o.age),
  }
  const gender = typeof o.gender === 'string' ? o.gender : ''
  if (gender && gender in GENDER_LABEL) profile.gender = gender as DailyDietProfile['gender']
  const goal = typeof o.goal === 'string' ? o.goal : ''
  if (goal && goal in GOAL_LABEL) profile.goal = goal as DailyDietProfile['goal']
  const activity = typeof o.activity === 'string' ? o.activity : ''
  if (activity && activity in ACTIVITY_LABEL) profile.activity = activity as DailyDietProfile['activity']
  const note = typeof o.healthNote === 'string' ? o.healthNote.trim() : ''
  if (note) profile.healthNote = note
  return profile
}

/** 读取档案；缺失或异常一律回退默认（身高/体重），其余为空。 */
export function loadDietProfile(): DailyDietProfile {
  try {
    const raw = localStorage.getItem(DIET_PROFILE_STORAGE_KEY)
    return raw ? normalizeProfile(JSON.parse(raw)) : { ...DEFAULT_DIET_PROFILE }
  } catch {
    return { ...DEFAULT_DIET_PROFILE }
  }
}

/** 保存档案；异常静默降级。 */
export function saveDietProfile(profile: DailyDietProfile): void {
  try { localStorage.setItem(DIET_PROFILE_STORAGE_KEY, JSON.stringify(normalizeProfile(profile))) } catch { /* ignore */ }
}

/** 把已填档案组装为提示词一段；全空返回空串（不注入）。纯函数、可测。 */
export function buildDietProfileSegment(profile: DailyDietProfile): string {
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
