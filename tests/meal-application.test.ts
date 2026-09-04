import { describe, expect, it } from 'vitest'
import { MealEntryApplicationService } from '@knowledge-base/application'
import type { MealDayInput, MealEntry, MealEntryRepository } from '@knowledge-base/contracts'
import { utcDatePlusDays } from '../packages/application/src/date-utils'

function createRepository(): { repository: MealEntryRepository; saved: MealDayInput[] } {
  const saved: MealDayInput[] = []
  const repository: MealEntryRepository = {
    listRange: async () => [],
    saveDay: async input => { saved.push(input); return [] },
  }
  return { repository, saved }
}

describe('meal entry application', () => {
  it('normalizes content and requires a valid satiety value', async () => {
    const { repository, saved } = createRepository()
    const service = new MealEntryApplicationService(repository)
    await service.saveDay({ entryDate: '2026-08-20', meals: [{ mealType: 'breakfast', content: '  鸡蛋牛奶 ', feeling: 7 }] })
    expect(saved[0]!.meals[0]!.content).toBe('鸡蛋牛奶')
    expect(saved[0]!.meals[0]!.feeling).toBe(7)
  })

  it('accepts 0 (unset), 5 (五分饱), 7 (七分饱), 9 (九分饱)', async () => {
    const { repository, saved } = createRepository()
    const service = new MealEntryApplicationService(repository)
    await service.saveDay({ entryDate: '2026-08-20', meals: [
      { mealType: 'breakfast', content: '', feeling: 0 },
      { mealType: 'lunch', content: '饭', feeling: 5 },
      { mealType: 'dinner', content: '菜', feeling: 9 },
    ] })
    expect(saved[0]!.meals.map(slot => slot.feeling)).toEqual([0, 5, 9])
  })

  it('allows UTC-today+1 (local today across timezones) and still rejects UTC+2', async () => {
    const { repository, saved } = createRepository()
    const service = new MealEntryApplicationService(repository)
    await expect(service.saveDay({ entryDate: utcDatePlusDays(1), meals: [{ mealType: 'lunch', content: '饭', feeling: 7 }] })).resolves.toBeDefined()
    await expect(service.saveDay({ entryDate: utcDatePlusDays(2), meals: [{ mealType: 'lunch', content: '饭', feeling: 7 }] })).rejects.toMatchObject({ code: 'MEAL_ENTRY_INVALID' })
    expect(saved).toHaveLength(1)
  })

  it('rejects future dates', async () => {
    const { repository, saved } = createRepository()
    await expect(new MealEntryApplicationService(repository).saveDay({ entryDate: '2999-12-31', meals: [{ mealType: 'lunch', content: '饭', feeling: 7 }] }))
      .rejects.toMatchObject({ code: 'MEAL_ENTRY_INVALID' })
    expect(saved).toHaveLength(0)
  })

  it('rejects invalid meal type', async () => {
    const { repository, saved } = createRepository()
    const input = { entryDate: '2026-08-20', meals: [{ mealType: 'brunch', content: 'x', feeling: 7 }] } as unknown as MealDayInput
    await expect(new MealEntryApplicationService(repository).saveDay(input)).rejects.toMatchObject({ code: 'MEAL_ENTRY_INVALID' })
    expect(saved).toHaveLength(0)
  })

  it('rejects satiety outside {0,5,7,9}', async () => {
    const { repository, saved } = createRepository()
    const service = new MealEntryApplicationService(repository)
    for (const feeling of [1, 2, 3, 4, 6, 8, 10]) {
      const input = { entryDate: '2026-08-20', meals: [{ mealType: 'dinner', content: 'x', feeling }] } as unknown as MealDayInput
      await expect(service.saveDay(input)).rejects.toMatchObject({ code: 'MEAL_ENTRY_INVALID' })
    }
    expect(saved).toHaveLength(0)
  })

  it('rejects duplicate meal types', async () => {
    const { repository, saved } = createRepository()
    const input: MealDayInput = { entryDate: '2026-08-20', meals: [{ mealType: 'lunch', content: 'a', feeling: 5 }, { mealType: 'lunch', content: 'b', feeling: 7 }] }
    await expect(new MealEntryApplicationService(repository).saveDay(input)).rejects.toMatchObject({ code: 'MEAL_ENTRY_INVALID' })
    expect(saved).toHaveLength(0)
  })

  it('rejects content over length limit', async () => {
    const { repository, saved } = createRepository()
    const input: MealDayInput = { entryDate: '2026-08-20', meals: [{ mealType: 'lunch', content: 'x'.repeat(1001), feeling: 5 }] }
    await expect(new MealEntryApplicationService(repository).saveDay(input)).rejects.toMatchObject({ code: 'MEAL_ENTRY_INVALID' })
    expect(saved).toHaveLength(0)
  })

  it('allows empty-slots day (clear all) and defaults today when omitted', async () => {
    const { repository, saved } = createRepository()
    const service = new MealEntryApplicationService(repository)
    await service.saveDay({ entryDate: '', meals: [] } as unknown as MealDayInput)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.entryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})