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
  it('normalizes content and requires a valid feeling', async () => {
    const { repository, saved } = createRepository()
    const service = new MealEntryApplicationService(repository)
    await service.saveDay({ entryDate: '2026-08-20', meals: [{ mealType: 'breakfast', content: '  鸡蛋牛奶 ', feeling: 4 }] })
    expect(saved[0]!.meals[0]!.content).toBe('鸡蛋牛奶')
  })

  it('allows UTC-today+1 (local today across timezones) and still rejects UTC+2', async () => {
    const { repository, saved } = createRepository()
    const service = new MealEntryApplicationService(repository)
    await expect(service.saveDay({ entryDate: utcDatePlusDays(1), meals: [{ mealType: 'lunch', content: '饭', feeling: 3 }] })).resolves.toBeDefined()
    await expect(service.saveDay({ entryDate: utcDatePlusDays(2), meals: [{ mealType: 'lunch', content: '饭', feeling: 3 }] })).rejects.toMatchObject({ code: 'MEAL_ENTRY_INVALID' })
    expect(saved).toHaveLength(1)
  })

  it('rejects future dates', async () => {
    const { repository, saved } = createRepository()
    await expect(new MealEntryApplicationService(repository).saveDay({ entryDate: '2999-12-31', meals: [{ mealType: 'lunch', content: '饭', feeling: 3 }] }))
      .rejects.toMatchObject({ code: 'MEAL_ENTRY_INVALID' })
    expect(saved).toHaveLength(0)
  })

  it('rejects invalid meal type', async () => {
    const { repository, saved } = createRepository()
    const input = { entryDate: '2026-08-20', meals: [{ mealType: 'brunch', content: 'x', feeling: 3 }] } as unknown as MealDayInput
    await expect(new MealEntryApplicationService(repository).saveDay(input)).rejects.toMatchObject({ code: 'MEAL_ENTRY_INVALID' })
    expect(saved).toHaveLength(0)
  })

  it('rejects feeling out of range', async () => {
    const { repository, saved } = createRepository()
    const input = { entryDate: '2026-08-20', meals: [{ mealType: 'dinner', content: 'x', feeling: 6 }] } as unknown as MealDayInput
    await expect(new MealEntryApplicationService(repository).saveDay(input)).rejects.toMatchObject({ code: 'MEAL_ENTRY_INVALID' })
    expect(saved).toHaveLength(0)
  })

  it('rejects duplicate meal types', async () => {
    const { repository, saved } = createRepository()
    const input: MealDayInput = { entryDate: '2026-08-20', meals: [{ mealType: 'lunch', content: 'a', feeling: 3 }, { mealType: 'lunch', content: 'b', feeling: 4 }] }
    await expect(new MealEntryApplicationService(repository).saveDay(input)).rejects.toMatchObject({ code: 'MEAL_ENTRY_INVALID' })
    expect(saved).toHaveLength(0)
  })

  it('rejects content over length limit', async () => {
    const { repository, saved } = createRepository()
    const input: MealDayInput = { entryDate: '2026-08-20', meals: [{ mealType: 'lunch', content: 'x'.repeat(1001), feeling: 3 }] }
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
