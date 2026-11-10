import { describe, expect, it } from 'vitest'
import {
  detailMonthGrid,
  entryAxisMinutes,
  hourTicks,
  monthDateTicks,
  monthDates,
  monthLabel,
  shiftMonth,
  weekdayLabel,
  yearDates,
  yearMonthTicks,
} from '../apps/client/src/pages/index/features/daily-notes/sleep/sleep-detail-layout'

describe('sleep detail month', () => {
  it('lists natural-month days', () => {
    expect(monthDates(2026, 11)).toHaveLength(30)
    expect(monthDates(2026, 2)).toHaveLength(28)
    expect(monthDates(2024, 2)).toHaveLength(29)
    expect(monthDates(2026, 11)[0]).toBe('2026-11-01')
    expect(monthDates(2026, 11)[29]).toBe('2026-11-30')
    expect(monthLabel(2026, 11)).toBe('2026 年 11 月')
  })

  it('builds a 42-cell month grid with weekday labels', () => {
    expect(detailMonthGrid(2026, 11)).toHaveLength(42)
    expect(weekdayLabel('2026-11-09')).toBe('一')
    expect(weekdayLabel('2026-11-08')).toBe('日')
  })

  it('shifts months across a year boundary', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth(2027, 1, -1)).toEqual({ year: 2026, month: 12 })
  })

  it('labels only month start, middle and end', () => {
    const ticks = monthDateTicks(monthDates(2026, 11))
    expect(ticks.map(tick => tick.label)).toEqual(['11/01', '11/15', '11/30'])
    expect(ticks.map(tick => tick.index)).toEqual([0, 14, 29])
  })

  it('builds a full-year date list and monthly ticks', () => {
    const dates = yearDates(2026)
    expect(dates).toHaveLength(365)
    expect(dates[0]).toBe('2026-01-01')
    expect(dates[364]).toBe('2026-12-31')
    const ticks = yearMonthTicks(dates)
    expect(ticks).toHaveLength(12)
    expect(ticks[0]).toEqual({ index: 0, label: '1 月' })
    expect(ticks[11]!.label).toBe('12 月')
    expect(yearDates(2024)).toHaveLength(366)
  })
})

describe('sleep detail hour axis', () => {
  it('has 25 hourly ticks from 06 to next 06', () => {
    const ticks = hourTicks()
    expect(ticks).toHaveLength(25)
    expect(ticks[0]).toEqual({ minute: 0, label: '06' })
    expect(ticks[6]!.label).toBe('12')
    expect(ticks[18]!.label).toBe('00')
    expect(ticks[24]).toEqual({ minute: 1440, label: '06' })
  })

  it('maps a record to minutes on the 06-based axis', () => {
    const minutes = entryAxisMinutes({ wakeAt: '2026-11-09T04:00:00.000Z', bedAt: '2026-11-09T15:30:00.000Z' })
    expect(minutes.wake).toBe(360) // 12:00
    expect(minutes.bed).toBe(17 * 60 + 30) // 23:30 是 06:00 起算的 17.5 小时
    expect(entryAxisMinutes(undefined)).toEqual({})
  })

  it('keeps an after-midnight bedtime at the end of the axis', () => {
    const minutes = entryAxisMinutes({ bedAt: '2026-11-09T17:30:00.000Z' }) // 次日 01:30
    expect(minutes.bed).toBe(18 * 60 + 90)
  })
})
