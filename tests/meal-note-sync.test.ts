import { describe, expect, it } from 'vitest'
import { DailyNoteApplicationService, MealNoteSyncService, parseMealKeywords } from '@knowledge-base/application'
import type { DailyNote, DailyNoteEntry, DailyNoteRepository, MealDayInput, MealEntry, MealSlotInput } from '@knowledge-base/contracts'

const note: DailyNote = { id: 'note-1', entryDate: '2026-11-23', content: '', createdAt: '2026-11-23T00:00:00.000Z', updatedAt: '2026-11-23T00:00:00.000Z' }
const entry: DailyNoteEntry = {
  id: 'entry-1', dailyNoteId: 'note-1', entryDate: '2026-11-23',
  recordedAt: '2026-11-23T04:00:00.000Z', timePrecision: 'minute', content: '午饭：凉菜',
  createdAt: '2026-11-23T04:00:00.000Z', updatedAt: '2026-11-23T04:00:00.000Z',
}

const meal = (mealType: MealEntry['mealType'], content: string): MealEntry => ({
  id: `meal-${mealType}`, entryDate: '2026-11-23', mealType, content,
  createdAt: '2026-11-23T00:00:00.000Z', updatedAt: '2026-11-23T00:00:00.000Z',
})

function repository(overrides: Partial<DailyNoteRepository> = {}): DailyNoteRepository {
  return {
    getToday: async () => undefined,
    getOrCreateToday: async () => note,
    getOrCreateByDate: async date => ({ ...note, entryDate: date }),
    listMine: async () => [],
    updateMine: async () => undefined,
    appendToday: async () => note,
    getMine: async () => note,
    setAiConversationId: async () => undefined,
    listActionFactsForDate: async () => [],
    listEntries: async () => [],
    getMineWithEntries: async () => undefined,
    createEntry: async () => entry,
    updateEntry: async () => entry,
    deleteEntry: async () => true,
    clearEntries: async () => true,
    exportEntryBackup: async () => [],
    materializeLegacyContent: async () => undefined,
    ...overrides,
  }
}

function mealStore(existing: MealEntry[] = []) {
  const saves: MealDayInput[] = []
  return {
    saves,
    store: {
      listRange: async () => existing,
      saveDay: async (input: MealDayInput) => {
        saves.push(input)
        return input.meals.map(slot => meal(slot.mealType, slot.content))
      },
    },
  }
}

describe('parseMealKeywords', () => {
  it('reads a meal from a keyword line with either colon', () => {
    expect(parseMealKeywords('午饭：凉菜')).toEqual({ lunch: '凉菜' })
    expect(parseMealKeywords('早餐: 牛奶')).toEqual({ breakfast: '牛奶' })
  })

  it('ignores lines without a colon', () => {
    expect(parseMealKeywords('早点 豆浆')).toEqual({})
    expect(parseMealKeywords('今天午饭：吃了面')).toEqual({})
  })

  it('handles several meals and keeps the last value for the same meal', () => {
    expect(parseMealKeywords('午饭：面\n晚饭：粥\n午饭：米饭')).toEqual({ lunch: '米饭', dinner: '粥' })
  })

  it('skips empty and oversized values', () => {
    expect(parseMealKeywords('午饭：')).toEqual({})
    expect(parseMealKeywords(`午饭：${'长'.repeat(1001)}`)).toEqual({})
  })
})

describe('MealNoteSyncService', () => {
  it('merges into the day and keeps the other meals', async () => {
    const { saves, store } = mealStore([meal('breakfast', '牛奶'), meal('dinner', '面条')])
    await new MealNoteSyncService(store).syncFromNote('2026-11-23', '午饭：凉菜')
    expect(saves).toHaveLength(1)
    expect(saves[0]!.meals).toEqual([
      { mealType: 'breakfast', content: '牛奶' },
      { mealType: 'lunch', content: '凉菜' },
      { mealType: 'dinner', content: '面条' },
    ])
  })

  it('does nothing when the note has no meal keyword', async () => {
    const { saves, store } = mealStore()
    await new MealNoteSyncService(store).syncFromNote('2026-11-23', '只是随手记一句')
    expect(saves).toHaveLength(0)
  })

  it('skips the write when nothing changes', async () => {
    const { saves, store } = mealStore([meal('lunch', '凉菜')])
    await new MealNoteSyncService(store).syncFromNote('2026-11-23', '午饭：凉菜')
    expect(saves).toHaveLength(0)
  })

  it('refreshes the same meal when the note changes', async () => {
    const { saves, store } = mealStore([meal('lunch', '凉菜')])
    await new MealNoteSyncService(store).syncFromNote('2026-11-23', '午饭：凉菜+米饭')
    expect(saves[0]!.meals).toEqual([{ mealType: 'lunch', content: '凉菜+米饭' }])
  })
})

describe('daily note entry → meals', () => {
  it('syncs on create and update with the note date', async () => {
    const calls: Array<[string, string]> = []
    const sync = { syncFromNote: async (date: string, content: string) => { calls.push([date, content]) } }
    const service = new DailyNoteApplicationService(repository({ updateEntry: async (_id, _entryId, input) => ({ ...entry, content: input.content }) }), undefined, sync)
    await service.createEntry('note-1', { content: '午饭：凉菜' })
    await service.updateEntry('note-1', 'entry-1', { content: '午饭：米饭' })
    expect(calls).toEqual([
      ['2026-11-23', '午饭：凉菜'],
      ['2026-11-23', '午饭：米饭'],
    ])
  })

  it('still saves the entry when the meal sync fails', async () => {
    let created = false
    const service = new DailyNoteApplicationService(
      repository({ createEntry: async () => { created = true; return entry } }),
      undefined,
      { syncFromNote: async () => { throw new Error('meal down') } },
    )
    await expect(service.createEntry('note-1', { content: '午饭：凉菜' })).resolves.toMatchObject({ id: 'entry-1' })
    expect(created).toBe(true)
  })

  it('syncs meals from the quick-record path as well', async () => {
    const calls: Array<[string, string]> = []
    const service = new DailyNoteApplicationService(
      repository({ appendToday: async () => note }),
      undefined,
      { syncFromNote: async (date: string, content: string) => { calls.push([date, content]) } },
    )
    await service.appendToday('早饭：豆浆油条')
    expect(calls).toEqual([['2026-11-23', '早饭：豆浆油条']])
  })

  it('keeps the quick record when meal sync fails', async () => {
    let appended = false
    const service = new DailyNoteApplicationService(
      repository({ appendToday: async () => { appended = true; return note } }),
      undefined,
      { syncFromNote: async () => { throw new Error('meal down') } },
    )
    await expect(service.appendToday('早饭：豆浆')).resolves.toMatchObject({ id: 'note-1' })
    expect(appended).toBe(true)
  })
})
