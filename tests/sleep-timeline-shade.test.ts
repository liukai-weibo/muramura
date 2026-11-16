import { describe, expect, it } from 'vitest'
import type { SleepEntry } from '@knowledge-base/contracts'
import { sleepBandFill, sleepShadeWindows } from '../apps/client/src/pages/index/features/daily-notes/sleep/sleep-timeline-shade'

/** 用东八区时间造记录，避免测试受运行机器时区影响。 */
const at = (isoLocal: string): string => new Date(`${isoLocal}+08:00`).toISOString()

const entry = (date: string, wakeLocal?: string, bedLocal?: string): SleepEntry => {
  const stamp = at(`${date}T00:00`)
  return {
    id: `sleep-${date}-${wakeLocal ?? 'none'}-${bedLocal ?? 'none'}`,
    sleepDate: date,
    createdAt: stamp,
    updatedAt: stamp,
    ...(wakeLocal ? { wakeAt: at(wakeLocal) } : {}),
    ...(bedLocal ? { bedAt: at(bedLocal) } : {}),
  }
}

describe('sleepShadeWindows', () => {
  it('covers midnight to wake time for a normal night', () => {
    const windows = sleepShadeWindows([
      entry('2026-11-15', '2026-11-15T08:30', '2026-11-15T23:40'),
      entry('2026-11-16', '2026-11-16T08:30'),
    ], '2026-11-16')
    expect(windows).toEqual([{ startMinute: 0, endMinute: 510, estimated: false }])
  })

  it('starts at the real bedtime when the previous record slept after midnight', () => {
    const windows = sleepShadeWindows([
      entry('2026-11-15', '2026-11-15T08:00', '2026-11-16T01:20'),
      entry('2026-11-16', '2026-11-16T08:30'),
    ], '2026-11-16')
    expect(windows).toEqual([{ startMinute: 80, endMinute: 510, estimated: false }])
  })

  it('shades the evening from bedtime to midnight', () => {
    const windows = sleepShadeWindows([
      entry('2026-11-15', '2026-11-15T08:30', '2026-11-15T23:40'),
      entry('2026-11-16', '2026-11-16T08:30', '2026-11-16T23:10'),
    ], '2026-11-16')
    expect(windows).toEqual([
      { startMinute: 0, endMinute: 510, estimated: false },
      { startMinute: 1390, endMinute: 1440, estimated: false },
    ])
  })

  it('marks a wake-only record as estimated from midnight', () => {
    const windows = sleepShadeWindows([entry('2026-11-16', '2026-11-16T08:30')], '2026-11-16')
    expect(windows).toEqual([{ startMinute: 0, endMinute: 510, estimated: true }])
  })

  it('returns nothing without sleep data', () => {
    expect(sleepShadeWindows([], '2026-11-16')).toEqual([])
    expect(sleepShadeWindows([entry('2026-11-16', undefined, '2026-11-16T23:00')], '2026-11-17')).toEqual([])
  })

  it('ignores a bedtime that belongs to the next day', () => {
    // 11-17 00:40 的入睡属于下一夜，不该在 11-16 的晚上画阴影；
    // 当天只有起床时间，所以只留一段从 00:00 起的估计阴影。
    const windows = sleepShadeWindows([entry('2026-11-16', '2026-11-16T08:30', '2026-11-17T00:40')], '2026-11-16')
    expect(windows).toEqual([{ startMinute: 0, endMinute: 510, estimated: true }])
  })

  it('merges both windows of the same day without disturbing each other', () => {
    const windows = sleepShadeWindows([
      entry('2026-11-15', '2026-11-15T08:30', '2026-11-15T23:40'),
      entry('2026-11-16', '2026-11-16T08:30', '2026-11-16T23:10'),
    ], '2026-11-16')
    expect(windows).toEqual([
      { startMinute: 0, endMinute: 510, estimated: false },
      { startMinute: 1390, endMinute: 1440, estimated: false },
    ])
  })
})

describe('sleepBandFill', () => {
  it('splits a 06:40–08:30 sleep into partial hour bands', () => {
    const fills = sleepBandFill([{ startMinute: 400, endMinute: 510 }])
    expect(fills.get(6)).toMatchObject({ from: 40 / 60, to: 1 })
    expect(fills.get(7)).toMatchObject({ from: 0, to: 1 })
    expect(fills.get(8)).toMatchObject({ from: 0, to: 30 / 60 })
    expect(fills.size).toBe(3)
  })

  it('stops at an exact hour boundary', () => {
    const fills = sleepBandFill([{ startMinute: 0, endMinute: 480 }])
    expect(fills.get(7)).toMatchObject({ from: 0, to: 1 })
    expect(fills.has(8)).toBe(false)
  })

  it('keeps the estimated flag only when every overlapping window is estimated', () => {
    const fills = sleepBandFill([
      { startMinute: 0, endMinute: 120, estimated: true },
      { startMinute: 60, endMinute: 180 },
    ])
    expect(fills.get(0)?.estimated).toBe(true)
    expect(fills.get(1)?.estimated).toBe(false)
    expect(fills.get(1)).toMatchObject({ from: 0, to: 1 })
  })
})
