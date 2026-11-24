import type { MealEntry, MealSlotInput, MealType } from '@knowledge-base/contracts'
import { MEAL_CONTENT_MAX_LENGTH, mealTypes } from '@knowledge-base/contracts'
import type { MealEntryApplicationService } from './meals'

/**
 * 手记里写「午饭：凉菜」这类行时，自动同步到当天三餐。
 * 只认行首关键词 + 冒号，避免正文里随口提到的"午饭"被误当成记录。
 */
export const MEAL_NOTE_KEYWORDS: Readonly<Record<string, MealType>> = {
  早餐: 'breakfast',
  早点: 'breakfast',
  早饭: 'breakfast',
  午餐: 'lunch',
  午饭: 'lunch',
  晚餐: 'dinner',
  晚饭: 'dinner',
}

const KEYWORD_PATTERN = new RegExp(`^\\s*(${Object.keys(MEAL_NOTE_KEYWORDS).join('|')})\\s*[：:]\\s*(.+)$`)

/** 按行解析；同一餐出现多次时以最后一行为准，空值或超长的行忽略。 */
export function parseMealKeywords(content: string): Partial<Record<MealType, string>> {
  const parsed: Partial<Record<MealType, string>> = {}
  for (const line of content.split(/\r?\n/)) {
    const matched = KEYWORD_PATTERN.exec(line)
    if (!matched) continue
    const mealType = MEAL_NOTE_KEYWORDS[matched[1]!]
    const value = (matched[2] ?? '').trim()
    if (!mealType || !value || value.length > MEAL_CONTENT_MAX_LENGTH) continue
    parsed[mealType] = value
  }
  return parsed
}

type MealStore = Pick<MealEntryApplicationService, 'listRange' | 'saveDay'>

/**
 * 合并语义：只覆盖解析到的餐别，其它餐别与其饱腹度保持原样；
 * 不提交空餐别，避免三餐页出现空记录（save 采用整天替换，漏传等于删除）。
 */
export class MealNoteSyncService {
  constructor(private readonly meals: MealStore) {}

  async syncFromNote(entryDate: string, content: string): Promise<void> {
    const parsed = parseMealKeywords(content)
    if (Object.keys(parsed).length === 0) return

    const existing = await this.meals.listRange(entryDate, entryDate)
    const byType = new Map<MealType, MealEntry>(existing.map(meal => [meal.mealType, meal]))

    const slots: MealSlotInput[] = []
    for (const mealType of mealTypes) {
      const next = parsed[mealType] ?? byType.get(mealType)?.content ?? ''
      if (!next) continue
      slots.push({ mealType, content: next })
    }
    if (slots.length === 0) return

    const unchanged = slots.every(slot => {
      const current = byType.get(slot.mealType)
      return Boolean(current) && current!.content === slot.content
    }) && existing.length === slots.length
    if (unchanged) return

    await this.meals.saveDay({ entryDate, meals: slots })
  }
}
