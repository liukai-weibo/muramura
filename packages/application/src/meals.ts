import type { ActivityAuditRecorder, MealDayInput, MealEntry, MealEntryRepository, MealType } from '@knowledge-base/contracts'
import { MEAL_SATIETY_VALUES } from '@knowledge-base/contracts'
import { BusinessError } from '@knowledge-base/domain'
import { safeAuditRecord } from './audit'
import { utcDatePlusDays } from './date-utils'

const MEAL_TYPE_SET: ReadonlySet<string> = new Set(['breakfast', 'lunch', 'dinner'])
const MAX_CONTENT = 1000
const MAX_SLOTS = 3

function todayLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + day
}

function isDateValid(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
}

function invalid(message: string): BusinessError<string> {
  return new BusinessError('MEAL_ENTRY_INVALID', 'validation', message)
}

export class MealEntryApplicationService {
  constructor(private readonly repository: MealEntryRepository, private readonly auditRecorder?: ActivityAuditRecorder) {}

  listRange(from?: string, to?: string): Promise<MealEntry[]> {
    return this.repository.listRange(from, to)
  }

  async saveDay(input: MealDayInput): Promise<MealEntry[]> {
    if (!input || !Array.isArray(input.meals)) throw invalid('三餐记录格式无效')
    const entryDate = isDateValid(input.entryDate) ? input.entryDate : todayLocal()
    if (entryDate > utcDatePlusDays(1)) throw invalid('三餐记录日期不能晚于今天')
    if (input.meals.length > MAX_SLOTS) throw invalid('一天最多记录三餐')
    const seen = new Set<string>()
    const meals = input.meals.map(slot => {
      if (!MEAL_TYPE_SET.has(slot.mealType)) throw invalid('餐别无效')
      if (seen.has(slot.mealType)) throw invalid('同一餐别不能重复记录')
      seen.add(slot.mealType)
      const content = typeof slot.content === 'string' ? slot.content.trim() : ''
      if (content.length > MAX_CONTENT) throw invalid('单餐内容超出长度限制')
      const feeling = slot.feeling
      if (typeof feeling !== 'number' || !Number.isFinite(feeling) || !MEAL_SATIETY_VALUES.has(feeling)) throw invalid('饱腹度须为 0、5、7 或 9（0=未填写）')
      return { mealType: slot.mealType as MealType, content, feeling }
    })
    const saved = await this.repository.saveDay({ entryDate, meals })
    await safeAuditRecord(this.auditRecorder, {
      module: 'meal',
      action: 'update',
      snapshot: JSON.stringify({ entryDate, meals: saved.map((meal) => ({ mealType: meal.mealType, content: meal.content, feeling: meal.feeling })) }),
    })
    return saved
  }
}
