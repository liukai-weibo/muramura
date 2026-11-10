import { describe, expect, it } from 'vitest'
import {
  addDays,
  dayOfWeek,
  daysInMonth,
  isFutureDate,
  monthGrid,
  monthLabel,
  monthOf,
  parseDate,
  shiftMonth,
  shiftWeek,
  startOfWeek,
  weekDates,
  weekRangeLabel,
  weekdayLabel,
} from '../apps/client/src/pages/index/features/daily-notes/sleep/sleep-calendar'

describe('sleep calendar dates', () => {
  it('starts weeks on Monday', () => {
    // 2026-11-09 是周一，2026-11-08 是周日。
    expect(weekdayLabel('2026-11-09')).toBe('一')
    expect(startOfWeek('2026-11-09')).toBe('2026-11-09')
    expect(startOfWeek('2026-11-08')).toBe('2026-11-02')
    expect(dayOfWeek('2026-11-15')).toBe(0)
  })

  it('builds seven consecutive days', () => {
    const week = weekDates('2026-11-12')
    expect(week).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'])
    expect(weekRangeLabel('2026-11-12')).toBe('11/09 – 11/15')
  })

  it('shifts weeks and months across year boundaries', () => {
    expect(shiftWeek('2026-12-28', 1)).toBe('2027-01-04')
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth(2027, 1, -1)).toEqual({ year: 2026, month: 12 })
    expect(monthOf('2026-11-09')).toEqual({ year: 2026, month: 11 })
    expect(monthLabel(2026, 11)).toBe('2026 年 11 月')
  })

  it('builds a 42-cell month grid starting on Monday', () => {
    const grid = monthGrid(2026, 11)
    expect(grid).toHaveLength(42)
    // 2026-11-01 是周日，因此网格从 2026-10-26（周一）开始。
    expect(grid[0]!.date).toBe('2026-10-26')
    expect(grid[41]!.date).toBe('2026-12-06')
    expect(grid.filter(cell => cell.inMonth)).toHaveLength(30)
    expect(grid[0]!.inMonth).toBe(false)
    // 42 格日期连续无重复。
    const dates = grid.map(cell => cell.date)
    expect(new Set(dates).size).toBe(42)
    for (let index = 1; index < dates.length; index += 1) {
      expect(dates[index]).toBe(addDays(dates[index - 1]!, 1))
    }
  })

  it('handles leap years and rejects impossible dates', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(parseDate('2026-02-29')).toBeUndefined()
    expect(parseDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 })
    expect(parseDate('2026-13-01')).toBeUndefined()
  })

  it('compares future dates as strings', () => {
    expect(isFutureDate('2026-11-10', '2026-11-09')).toBe(true)
    expect(isFutureDate('2026-11-09', '2026-11-09')).toBe(false)
    expect(isFutureDate('2026-11-08', '2026-11-09')).toBe(false)
  })
})
