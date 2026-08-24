import { describe, expect, it } from 'vitest'
import { buildMonthDays, buildMonthGrid, formatLocalDate } from '../apps/client/src/pages/index/features/mood/mood-levels'

describe('buildMonthGrid', () => {
  it('returns 42 cells for any month', () => {
    expect(buildMonthGrid(2026, 8)).toHaveLength(42)
    expect(buildMonthGrid(2026, 2)).toHaveLength(42)
    expect(buildMonthGrid(2026, 12)).toHaveLength(42)
  })

  it('starts with Monday (index 0)', () => {
    // August 2026: 1st is Saturday -> 5 days offset (Mon=0, Tue=1, ..., Sat=5)
    const grid = buildMonthGrid(2026, 8)
    const firstDay = grid.find(cell => cell.isCurrentMonth)
    expect(firstDay).toBeDefined()
    expect(firstDay!.day).toBe(1)
    // There should be 5 padding cells before the 1st
    const padding = grid.filter(cell => !cell.isCurrentMonth)
    expect(padding.length).toBe(42 - 31)
    // The first padding cell is the last Monday of July
    expect(padding[0]!.day).toBe(27)
    expect(padding[0]!.month).toBe(7)
  })

  it('marks non-current-month cells correctly', () => {
    const grid = buildMonthGrid(2026, 8)
    const currentMonth = grid.filter(cell => cell.isCurrentMonth)
    expect(currentMonth).toHaveLength(31)
    const others = grid.filter(cell => !cell.isCurrentMonth)
    expect(others.length).toBeGreaterThan(0)
    expect(others.every(cell => !cell.isCurrentMonth)).toBe(true)
  })

  it('handles year boundary: December -> January', () => {
    const grid = buildMonthGrid(2026, 12)
    const lastCells = grid.slice(-7)
    const nextMonthCells = lastCells.filter(cell => !cell.isCurrentMonth)
    if (nextMonthCells.length > 0) {
      expect(nextMonthCells[0]!.year).toBe(2027)
      expect(nextMonthCells[0]!.month).toBe(1)
    }
  })
})

describe('buildMonthDays', () => {
  it('returns offset placeholders then current-month days only', () => {
    // August 2026: 1st is Saturday -> Monday-start offset = 5
    const days = buildMonthDays(2026, 8)
    const placeholders = days.filter(cell => cell.isPlaceholder)
    const current = days.filter(cell => !cell.isPlaceholder)
    expect(placeholders).toHaveLength(5)
    expect(current).toHaveLength(31)
    expect(current[0]!.day).toBe(1)
    expect(current[30]!.day).toBe(31)
    // no cross-month day numbers (e.g. no 30/31 from July, no 1 from September)
    expect(days.every(cell => cell.isPlaceholder || cell.day >= 1 && cell.day <= 31)).toBe(true)
  })

  it('February has no days 30 or 31', () => {
    const days = buildMonthDays(2026, 2)
    const current = days.filter(cell => !cell.isPlaceholder)
    expect(current.length).toBe(28)
    expect(current.every(cell => cell.day <= 28)).toBe(true)
  })

  it('all placeholders precede current-month days', () => {
    const days = buildMonthDays(2026, 12)
    const count = days.filter(cell => cell.isPlaceholder).length
    const prefix = days.slice(0, count)
    const rest = days.slice(count)
    expect(prefix.every(cell => cell.isPlaceholder)).toBe(true)
    expect(rest.length).toBeGreaterThan(0)
    expect(rest.every(cell => !cell.isPlaceholder)).toBe(true)
  })
})

describe('formatLocalDate', () => {
  it('formats year-month-day with zero-padding', () => {
    expect(formatLocalDate(2026, 8, 5)).toBe('2026-08-05')
    expect(formatLocalDate(2026, 12, 25)).toBe('2026-12-25')
    expect(formatLocalDate(2026, 1, 1)).toBe('2026-01-01')
  })
})
