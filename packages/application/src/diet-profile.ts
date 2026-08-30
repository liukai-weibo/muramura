import type { ActivityAuditRecorder, DietProfile, DietProfileInput, DietProfileRepository } from '@knowledge-base/contracts'
import { DIET_PROFILE_HEALTH_NOTE_MAX, DIET_PROFILE_NUMERIC_MAX } from '@knowledge-base/contracts'
import { BusinessError } from '@knowledge-base/domain'
import { safeAuditRecord } from './audit'

const GENDERS = new Set(['male', 'female', 'other'])
const GOALS = new Set(['lose_fat', 'gain_muscle', 'maintain', 'other'])
const ACTIVITIES = new Set(['sedentary', 'light', 'moderate', 'high'])

function invalid(message: string): BusinessError<string> {
  return new BusinessError('DIET_PROFILE_INVALID', 'validation', message)
}

function optionalNumeric(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0 || n > DIET_PROFILE_NUMERIC_MAX) return undefined
  return n
}

export class DietProfileApplicationService {
  constructor(
    private readonly repository: DietProfileRepository,
    private readonly auditRecorder?: ActivityAuditRecorder,
    private readonly ownerUserId?: string,
  ) {}

  async getMine(): Promise<DietProfile | undefined> {
    return this.repository.getMine()
  }

  async upsertMine(input: DietProfileInput): Promise<DietProfile> {
    if (!input || typeof input !== 'object') throw invalid('个人档案内容无效')
    const heightCm = optionalNumeric(input.heightCm)
    const weightKg = optionalNumeric(input.weightKg)
    const age = optionalNumeric(input.age)
    if (input.heightCm !== undefined && heightCm === undefined) throw invalid('身高需为有效数字（大于 0 且不大于 400）')
    if (input.weightKg !== undefined && weightKg === undefined) throw invalid('体重需为有效数字（大于 0 且不大于 400）')
    if (input.age !== undefined && age === undefined) throw invalid('年龄需为有效数字（大于 0 且不大于 400）')
    if (input.gender !== undefined && !GENDERS.has(input.gender)) throw invalid('性别选项无效')
    if (input.goal !== undefined && !GOALS.has(input.goal)) throw invalid('目标选项无效')
    if (input.activity !== undefined && !ACTIVITIES.has(input.activity)) throw invalid('活动量选项无效')
    const note = typeof input.healthNote === 'string' ? input.healthNote.trim() : undefined
    if (note && [...note].length > DIET_PROFILE_HEALTH_NOTE_MAX) throw invalid('健康状态说明不能超过 ' + DIET_PROFILE_HEALTH_NOTE_MAX + ' 个字符')
    const profile = await this.repository.upsertMine({
      heightCm,
      weightKg,
      age,
      gender: input.gender,
      goal: input.goal,
      activity: input.activity,
      healthNote: note || undefined,
    })
    await safeAuditRecord(this.auditRecorder, {
      module: 'daily_diet',
      action: 'update',
      entityId: this.ownerUserId,
      snapshot: JSON.stringify(this.toSnapshot(profile)),
    })
    return profile
  }

  private toSnapshot(profile: DietProfile): Record<string, string | number> {
    const out: Record<string, string | number> = {}
    if (profile.heightCm != null) out.heightCm = profile.heightCm
    if (profile.weightKg != null) out.weightKg = profile.weightKg
    if (profile.age != null) out.age = profile.age
    if (profile.gender) out.gender = profile.gender
    if (profile.goal) out.goal = profile.goal
    if (profile.activity) out.activity = profile.activity
    if (profile.healthNote) out.healthNote = profile.healthNote
    return out
  }
}
