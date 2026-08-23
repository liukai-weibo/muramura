import { describe, expect, it } from 'vitest'
import { buildMonthGrid, formatLocalDate } from '../apps/client/src/pages/index/features/mood/mood-levels'

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

describe('formatLocalDate', () => {
  it('formats year-month-day with zero-padding', () => {
    expect(formatLocalDate(2026, 8, 5)).toBe('2026-08-05')
    expect(formatLocalDate(2026, 12, 25)).toBe('2026-12-25')
    expect(formatLocalDate(2026, 1, 1)).toBe('2026-01-01')
  })
})
