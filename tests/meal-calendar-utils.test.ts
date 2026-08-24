import { describe, expect, it } from 'vitest'
import { buildMonthDays, buildMonthGrid, daysInMonth, formatLocalDate, todayLocalDate } from '../apps/client/src/pages/index/features/calendar-utils'

describe('calendar-utils', () => {
  it('buildMonthGrid returns 42 cells and Monday start', () => {
    const grid = buildMonthGrid(2026, 8)
    expect(grid).toHaveLength(42)
    expect(grid.filter(c => c.isCurrentMonth)).toHaveLength(31)
    const first = grid.find(c => c.isCurrentMonth)
    expect(first!.day).toBe(1)
  })

  it('buildMonthDays placeholders precede current days', () => {
    const days = buildMonthDays(2026, 8)
    const placeholders = days.filter(c => c.isPlaceholder)
    const current = days.filter(c => !c.isPlaceholder)
    expect(placeholders).toHaveLength(5)
    expect(current).toHaveLength(31)
  })

  it('daysInMonth honours leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2026, 12)).toBe(31)
  })

  it('formatLocalDate and todayLocalDate shape', () => {
    expect(formatLocalDate(2026, 8, 5)).toBe('2026-08-05')
    expect(todayLocalDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
