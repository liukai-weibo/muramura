import { describe, expect, it } from 'vitest'
import type { SleepEntry } from '@knowledge-base/contracts'
import { sleepIsoAt } from '@knowledge-base/contracts'
import {
  axisClockLabel,
  buildSleepSeries,
  columnAtX,
  latestCompleteNight,
  sleepChartLayout,
  smoothSegmentPath,
} from '../apps/client/src/pages/index/features/daily-notes/sleep/sleep-chart'

const at = (date: string, hour: number, minute: number): string => sleepIsoAt(date, hour, minute)!

const entry = (sleepDate: string, fields: { wakeAt?: string; bedAt?: string }): SleepEntry => ({
  id: `sleep-${sleepDate}`,
  sleepDate,
  ...fields,
  createdAt: `${sleepDate}T00:00:00.000Z`,
  updatedAt: `${sleepDate}T00:00:00.000Z`,
})

const entries: SleepEntry[] = [
  entry('2026-11-07', { wakeAt: at('2026-11-07', 7, 0), bedAt: at('2026-11-07', 23, 10) }),
  entry('2026-11-08', { wakeAt: at('2026-11-08', 12, 0), bedAt: at('2026-11-08', 22, 40) }),
  entry('2026-11-09', { wakeAt: at('2026-11-09', 8, 0) }),
]

describe('buildSleepSeries', () => {
  it('reads only the same day, so a 12:00 wake stays on its own date', () => {
    const series = buildSleepSeries(entries, 3, '2026-11-09')
    expect(series.map(day => day.date)).toEqual(['2026-11-07', '2026-11-08', '2026-11-09'])
    // 11-08 12:00 起床 = 06:00 起算 360，不再借 11-07 的列。
    expect(series[1]!.wakeMinute).toBe(360)
    expect(series[1]!.wakeAt).toBe(at('2026-11-08', 12, 0))
    expect(series[1]!.bedMinute).toBe((22 * 60 + 40) - 6 * 60)
    // 11-07 有起床但没有入睡。
    expect(series[0]!.wakeMinute).toBe(60)
    expect(series[0]!.bedMinute).toBeGreaterThan(1000)
  })

  it('marks a bedtime after midnight as next-day without changing its column', () => {
    const late = buildSleepSeries([entry('2026-11-09', { wakeAt: at('2026-11-09', 4, 0), bedAt: at('2026-11-10', 1, 30) })], 1, '2026-11-09')
    expect(late[0]!.date).toBe('2026-11-09')
    expect(late[0]!.bedNextDay).toBe(true)
    expect(late[0]!.bedMinute).toBe(18 * 60 + 90)
  })

  it('keeps missing days empty instead of borrowing neighbours', () => {
    const series = buildSleepSeries([entry('2026-11-08', { wakeAt: at('2026-11-08', 7, 30) })], 3, '2026-11-09')
    expect(series.map(day => day.wakeMinute)).toEqual([undefined, 90, undefined])
    expect(series.every(day => day.bedMinute === undefined)).toBe(true)
  })
})

describe('sleepChartLayout', () => {
  const layout = sleepChartLayout(buildSleepSeries(entries, 3, '2026-11-09'), { width: 264, height: 148 })

  it('puts the wake line above the bedtime line', () => {
    const wake = layout.wakeDots.find(point => point.date === '2026-11-08')!
    const bed = layout.bedDots.find(point => point.date === '2026-11-08')!
    expect(wake.y).toBeLessThan(bed.y)
  })

  it('places midnight at 18/24 of the plot (06:00 → next 06:00)', () => {
    const plotHeight = layout.plotBottom - layout.plotTop
    expect(layout.midnightY).toBeCloseTo(layout.plotTop + plotHeight * 0.75, 5)
  })

  it('uses one continuous axis with 6-hour ticks', () => {
    const axis = sleepChartLayout(buildSleepSeries([], 3, '2026-11-09'), { width: 264, height: 148 })
    expect(axis.grid.map(line => line.minute)).toEqual([0, 360, 720, 1080, 1440])
    expect(axis.grid.map(line => line.label)).toEqual(['06', '12', '18', '00', '06'])
    const ys = axis.grid.map(line => line.y)
    const steps = ys.slice(1).map((value, index) => value - ys[index]!)
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(0.001)
  })

  it('maps an x position to a day column for hover', () => {
    const axis = sleepChartLayout(buildSleepSeries([], 3, '2026-11-09'), { width: 264, height: 148 })
    expect(columnAtX(axis, axis.left + 1)).toBe(0)
    expect(columnAtX(axis, axis.left + axis.step * 1.5)).toBe(1)
    expect(columnAtX(axis, axis.left + axis.step * 2.5)).toBe(2)
    expect(columnAtX(axis, axis.left - 5)).toBeUndefined()
    expect(columnAtX(axis, axis.left + axis.step * 3 + 5)).toBeUndefined()
  })

  it('breaks each line independently when a day is missing a value', () => {
    const gapped = sleepChartLayout(buildSleepSeries([
      entry('2026-11-06', { wakeAt: at('2026-11-06', 7, 0), bedAt: at('2026-11-06', 23, 30) }),
      entry('2026-11-07', { wakeAt: at('2026-11-07', 7, 10) }), // 缺入睡
      entry('2026-11-08', { wakeAt: at('2026-11-08', 7, 20), bedAt: at('2026-11-08', 23, 40) }),
      entry('2026-11-09', { wakeAt: at('2026-11-09', 7, 30) }),
    ], 4, '2026-11-09'), { width: 264, height: 148 })
    expect(gapped.wakeSegments).toHaveLength(1)
    expect(gapped.bedSegments).toHaveLength(2)
  })

  it('labels the x axis from oldest to today', () => {
    const axis = sleepChartLayout(buildSleepSeries([], 5, '2026-11-09'), { width: 264, height: 148 })
    expect(axis.ticks.map(tick => tick.label)).toEqual(['11/05', '11/07', '11/09'])
    expect(axis.ticks.map(tick => tick.anchor)).toEqual(['start', 'middle', 'end'])
    expect(axis.ticks[0]!.x).toBeLessThan(axis.ticks[1]!.x)
    expect(axis.ticks[1]!.x).toBeLessThan(axis.ticks[2]!.x)
  })
})

describe('sleep chart helpers', () => {
  it('converts axis minutes back to clock labels', () => {
    expect(axisClockLabel(0)).toBe('06:00')
    expect(axisClockLabel((22 * 60 + 40) - 6 * 60)).toBe('22:40')
    expect(axisClockLabel(18 * 60 + 90)).toBe('01:30')
  })

  it('draws a smooth curve through the same points without leaving the plot', () => {
    const chart = sleepChartLayout(buildSleepSeries(entries, 3, '2026-11-09'), { width: 264, height: 148 })
    const segment = chart.bedSegments[0]!
    expect(segment.length).toBeGreaterThan(1)
    const path = smoothSegmentPath(segment, 148)
    expect(path.startsWith('M ')).toBe(true)
    expect(path.split('C').length - 1).toBe(segment.length - 1)
    const numbers = path.split(/[\s,]+/).map(Number).filter(value => !Number.isNaN(value))
    const ys = numbers.filter((_, index) => index % 2 === 1)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(chart.plotTop)
    expect(Math.max(...ys)).toBeLessThanOrEqual(chart.plotBottom)
  })

  it('finds the latest complete night for the summary', () => {
    expect(latestCompleteNight(entries, '2026-11-10')?.date).toBe('2026-11-08')
  })
})
