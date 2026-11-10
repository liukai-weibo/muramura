import { describe, expect, it } from 'vitest'
import type { SleepEntry } from '@knowledge-base/contracts'
import { buildHomeSleepSummary } from '../apps/client/src/pages/index/home-dashboard/home-sleep-summary'

const entry = (sleepDate: string, fields: { wakeAt?: string; bedAt?: string }): SleepEntry => ({
  id: `sleep-${sleepDate}`,
  sleepDate,
  ...fields,
  createdAt: `${sleepDate}T00:00:00.000Z`,
  updatedAt: `${sleepDate}T00:00:00.000Z`,
})

const yesterdayBed = entry('2026-11-08', { bedAt: '2026-11-08T15:40:00.000Z' }) // 23:40
const todayWake = entry('2026-11-09', { wakeAt: '2026-11-08T23:10:00.000Z' }) // 07:10

describe('home sleep summary', () => {
  it('shows last night duration when both ends exist', () => {
    const summary = buildHomeSleepSummary([yesterdayBed, todayWake], '2026-11-09')
    expect(summary.state).toBe('complete')
    expect(summary.title).toBe('23:40 → 07:10')
    expect(summary.description).toBe('7h30m · 昨晚已记录')
  })

  it('shows wake only when tonight is not recorded yet', () => {
    const summary = buildHomeSleepSummary([todayWake], '2026-11-09')
    expect(summary.state).toBe('wake-only')
    expect(summary.title).toBe('今早 07:10 起床')
    expect(summary.description).toBe('今晚待记录')
  })

  it('shows bed only when the wake-up is missing', () => {
    const summary = buildHomeSleepSummary([yesterdayBed], '2026-11-09')
    expect(summary.state).toBe('bed-only')
    expect(summary.title).toBe('昨晚 23:40 入睡')
    expect(summary.description).toBe('起床待补')
  })

  it('stays empty rather than borrowing an older complete night', () => {
    const older = [
      entry('2026-11-07', { bedAt: '2026-11-07T15:00:00.000Z' }),
      entry('2026-11-08', { wakeAt: '2026-11-07T23:00:00.000Z' }),
    ]
    const summary = buildHomeSleepSummary(older, '2026-11-09')
    expect(summary.state).toBe('empty')
    expect(summary.title).toBe('昨晚还没记录')
  })

  it('falls back to wake-only when the duration is implausible', () => {
    const weirdBed = entry('2026-11-08', { bedAt: '2026-11-07T23:00:00.000Z' }) // 07:00
    const sameTimeWake = entry('2026-11-09', { wakeAt: '2026-11-08T23:00:00.000Z' }) // 07:00 次日
    const summary = buildHomeSleepSummary([weirdBed, sameTimeWake], '2026-11-09')
    expect(summary.state).toBe('wake-only')
  })
})
