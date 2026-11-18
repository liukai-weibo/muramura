import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SleepEntry } from '@knowledge-base/contracts'
import { sleepShadeWindows, sleepSideIntervals, sleepShadeLabel, snapSleepWindowToHours } from '../apps/client/src/pages/index/features/daily-notes/sleep/sleep-timeline-shade'

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

describe('snapSleepWindowToHours', () => {
  it('starts at the hour that contains the bedtime and ends after the wake hour', () => {
    expect(snapSleepWindowToHours({ startMinute: 390, endMinute: 420 })).toMatchObject({ startMinute: 360, endMinute: 480 })
    expect(snapSleepWindowToHours({ startMinute: 400, endMinute: 510 })).toMatchObject({ startMinute: 360, endMinute: 540 })
    expect(snapSleepWindowToHours({ startMinute: 60, endMinute: 360 })).toMatchObject({ startMinute: 60, endMinute: 420 })
  })

  it('keeps the estimated flag and clamps at midnight', () => {
    expect(snapSleepWindowToHours({ startMinute: 0, endMinute: 510, estimated: true })).toMatchObject({ estimated: true })
    expect(snapSleepWindowToHours({ startMinute: 1390, endMinute: 1440 })).toMatchObject({ startMinute: 1380, endMinute: 1440 })
  })
})

describe('sleepSideIntervals', () => {
  it('snaps to whole hours and lifts the block by a third of a row', () => {
    expect(sleepSideIntervals([{ startMinute: 390, endMinute: 420 }], 'am')).toEqual([{ from: 340, to: 460 }])
    expect(sleepSideIntervals([{ startMinute: 400, endMinute: 510 }], 'am')).toEqual([{ from: 340, to: 520 }])
    expect(sleepSideIntervals([{ startMinute: 60, endMinute: 360 }], 'am')).toEqual([{ from: 40, to: 400 }])
  })

  it('clamps the lifted start at midnight', () => {
    expect(sleepSideIntervals([{ startMinute: 0, endMinute: 510 }], 'am')).toEqual([{ from: 0, to: 520 }])
  })

  it('keeps an evening window that reaches midnight ending at 24:00', () => {
    expect(sleepSideIntervals([{ startMinute: 1390, endMinute: 1440 }], 'pm')).toEqual([{ from: 640, to: 720 }])
  })

  it('splits a window that crosses noon into the two columns after snapping and lifting', () => {
    expect(sleepSideIntervals([{ startMinute: 690, endMinute: 780 }], 'am')).toEqual([{ from: 640, to: 720 }])
    expect(sleepSideIntervals([{ startMinute: 690, endMinute: 780 }], 'pm')).toEqual([{ from: 0, to: 100 }])
  })

  it('returns nothing without windows', () => {
    expect(sleepSideIntervals([], 'am')).toEqual([])
  })
})

describe('sleepShadeLabel', () => {
  it('formats a single window', () => {
    expect(sleepShadeLabel([{ startMinute: 400, endMinute: 510 }])).toBe('06:40–08:30')
  })

  it('joins both windows of the day', () => {
    expect(sleepShadeLabel([
      { startMinute: 0, endMinute: 510 },
      { startMinute: 1390, endMinute: 1440 },
    ])).toBe('00:00–08:30 · 23:10–24:00')
  })

  it('marks a wake-only window as estimated', () => {
    expect(sleepShadeLabel([{ startMinute: 0, endMinute: 510, estimated: true }])).toBe('00:00–08:30 · 估计')
  })

  it('returns an empty label without windows', () => {
    expect(sleepShadeLabel([])).toBe('')
  })
})
describe('timeline sleep haze styles', () => {
  const theme = readFileSync(new URL('../apps/client/src/pages/index/cream-ui-theme.scss', import.meta.url), 'utf8')

  it('feathers the span on every edge instead of drawing borders', () => {
    const rule = theme.match(/\.daily-note-sleep-span \{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('linear-gradient(to bottom')
    expect(rule).toContain('transparent 0')
    expect(rule).toContain('min(28px, 25%)')
    expect(rule).toContain('calc(100% - min(28px, 25%))')
    expect(rule).toContain('mask-image: linear-gradient(to right, transparent 0, #000 6px')
    expect(rule).toContain('pointer-events: none;')
    expect(rule).not.toMatch(/border-(top|right|bottom|left)\b/)
    expect(theme).not.toContain('.daily-note-sleep-block')
    expect(theme).not.toContain('repeating-linear-gradient(90deg, rgba(120, 105, 140')
  })

  it('keeps a soft spine on the axis side for both columns', () => {
    expect(theme).toContain('.daily-note-sleep-span::after {')
    expect(theme).toContain('.daily-note-band-side.is-am .daily-note-sleep-span::after { right: 0; }')
    expect(theme).toContain('.daily-note-band-side.is-pm .daily-note-sleep-span::after { left: 0; }')
    expect(theme).toContain('border-radius: 999px;')
  })

  it('defines the Morandi haze and spine tokens for both themes', () => {
    expect(theme).toContain('--sleep-haze: rgba(148, 140, 160, .15);')
    expect(theme).toContain('--sleep-spine: rgba(148, 140, 160, .38);')
    expect(theme).toContain('--sleep-haze: rgba(168, 158, 184, .20);')
    expect(theme).toContain('--sleep-spine: rgba(178, 166, 196, .46);')
  })
})