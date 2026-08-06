import { describe, expect, it } from 'vitest'
import { getMascotCalendarContext, getMascotHolidayKeys, getMascotTimePeriod } from '../apps/client/src/pages/index/experimental-ai/mascot-calendar'
import { MASCOT_HOLIDAY_STORAGE_PREFIX, selectMascotBubble, type MascotBubbleStorage } from '../apps/client/src/pages/index/experimental-ai/mascot-copy'

function storage(): MascotBubbleStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('mascot calendar', () => {
  it('uses the documented time boundaries and local weekday', () => {
    expect(getMascotTimePeriod(5)).toBe('night')
    expect(getMascotTimePeriod(6)).toBe('morning')
    expect(getMascotTimePeriod(10)).toBe('morning')
    expect(getMascotTimePeriod(11)).toBe('noon')
    expect(getMascotTimePeriod(14)).toBe('afternoon')
    expect(getMascotTimePeriod(19)).toBe('night')
    expect(getMascotCalendarContext(new Date(2026, 7, 7, 9)).dayType).toBe('workday')
    expect(getMascotCalendarContext(new Date(2026, 7, 8, 9)).dayType).toBe('weekend')
  })

  it('recognizes fixed, lunar and solar-term holidays locally', () => {
    expect(getMascotHolidayKeys(new Date(2026, 0, 1))).toContain('newYear')
    expect(getMascotHolidayKeys(new Date(2026, 1, 17))).toContain('springFestival')
    expect(getMascotHolidayKeys(new Date(2026, 3, 5))).toContain('qingming')
    expect(getMascotHolidayKeys(new Date(2026, 5, 19))).toContain('dragonBoatFestival')
  })
})

describe('mascot bubble selection', () => {
  it('forces the first holiday bubble and allows holiday bubbles afterwards', () => {
    const day = getMascotCalendarContext(new Date(2026, 0, 1, 20))
    const store = storage()
    const first = selectMascotBubble(day, store)
    expect(first.isHolidayFirst).toBe(true)
    expect(first.text).toMatch(/新的一年|元旦|旧岁|岁岁|烦恼/)
    expect(store.getItem(`${MASCOT_HOLIDAY_STORAGE_PREFIX}${day.dateKey}`)).toBe('1')

    const later = selectMascotBubble(day, store)
    expect(later.isHolidayFirst).toBe(false)
    expect(later.text.length).toBeGreaterThan(0)
  })

  it('starts a new first-holiday window on a new date', () => {
    const store = storage()
    const firstDay = getMascotCalendarContext(new Date(2026, 0, 1, 9))
    const secondDay = getMascotCalendarContext(new Date(2028, 0, 1, 9))
    expect(selectMascotBubble(firstDay, store).isHolidayFirst).toBe(true)
    expect(selectMascotBubble(secondDay, store).isHolidayFirst).toBe(true)
  })

  it('keeps ordinary context pools available on non-holidays', () => {
    const context = getMascotCalendarContext(new Date(2026, 7, 7, 9))
    const result = selectMascotBubble({ ...context, sessionKind: 'existing', isListening: true }, storage())
    expect(result.text.length).toBeGreaterThan(0)
  })

  it('falls back to page memory when storage access is unavailable', () => {
    const unavailable: MascotBubbleStorage = {
      getItem: () => { throw new Error('storage blocked') },
      setItem: () => { throw new Error('storage blocked') },
    }
    const context = getMascotCalendarContext(new Date(2030, 0, 1, 9))
    expect(selectMascotBubble(context, unavailable).isHolidayFirst).toBe(true)
    expect(selectMascotBubble(context, unavailable).isHolidayFirst).toBe(false)
  })
})
