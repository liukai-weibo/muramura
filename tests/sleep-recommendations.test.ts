import { describe, expect, it } from 'vitest'
import type { SleepEntry } from '@knowledge-base/contracts'
import { buildSleepRecommendations, SLEEP_FREQUENT_MIN_SAMPLES } from '../apps/client/src/pages/index/features/daily-notes/sleep/sleep-recommendations'

const entry = (sleepDate: string, fields: { wakeAt?: string; bedAt?: string }): SleepEntry => ({
  id: `sleep-${sleepDate}`,
  sleepDate,
  ...fields,
  createdAt: `${sleepDate}T00:00:00.000Z`,
  updatedAt: `${sleepDate}T00:00:00.000Z`,
})

describe('sleep time recommendations', () => {
  it('ranks the most frequent wake time and prefills it after 3 repeats', () => {
    const entries = [
      entry('2026-11-06', { wakeAt: '2026-11-05T23:00:00.000Z' }), // 07:00
      entry('2026-11-07', { wakeAt: '2026-11-06T23:00:00.000Z' }),
      entry('2026-11-08', { wakeAt: '2026-11-07T23:00:00.000Z' }),
      entry('2026-11-09', { wakeAt: '2026-11-08T23:30:00.000Z' }), // 07:30
    ]
    const result = buildSleepRecommendations(entries, '2026-11-10', 'minute')
    expect(result.wake[0]).toMatchObject({ hour: 7, minute: 0, count: 3 })
    expect(result.wake.map(chip => chip.label)).toEqual(['07:00', '07:30'])
    expect(result.wakeSamples).toBe(4)
    expect(result.defaultWake?.label).toBe('07:00')
  })

  it('does not prefill when the pattern is weak', () => {
    const entries = [
      entry('2026-11-08', { wakeAt: '2026-11-07T23:10:00.000Z' }),
      entry('2026-11-09', { wakeAt: '2026-11-08T23:50:00.000Z' }),
    ]
    const result = buildSleepRecommendations(entries, '2026-11-10', 'minute')
    expect(result.defaultWake).toBeUndefined()
    expect(result.wakeSamples).toBe(2)
  })

  it('groups by hour in hour precision', () => {
    const entries = [
      entry('2026-11-08', { wakeAt: '2026-11-07T23:10:00.000Z' }), // 07:10
      entry('2026-11-09', { wakeAt: '2026-11-08T23:50:00.000Z' }), // 07:50
    ]
    const result = buildSleepRecommendations(entries, '2026-11-10', 'hour')
    expect(result.wake[0]).toMatchObject({ hour: 7, minute: 0, count: 2 })
  })

  it('returns no chips without history instead of fake defaults', () => {
    const result = buildSleepRecommendations([], '2026-11-10', 'minute')
    expect(result.wake).toEqual([])
    expect(result.bed).toEqual([])
    expect(result.wakeSamples).toBe(0)
    expect(result.bedSamples).toBe(0)
    expect(result.defaultWake).toBeUndefined()
  })

  it('ignores records older than 14 days and today itself', () => {
    const entries = [
      entry('2026-10-20', { wakeAt: '2026-10-19T23:00:00.000Z' }),
      entry('2026-10-21', { wakeAt: '2026-10-20T23:00:00.000Z' }),
      entry('2026-10-22', { wakeAt: '2026-10-21T23:00:00.000Z' }),
      entry('2026-11-10', { wakeAt: '2026-11-10T00:00:00.000Z' }),
    ]
    const result = buildSleepRecommendations(entries, '2026-11-10', 'minute')
    expect(result.wakeSamples).toBe(0)
    expect(result.wake).toEqual([])
  })

  it('returns bed suggestions from history', () => {
    const entries = [
      entry('2026-11-08', { bedAt: '2026-11-08T15:00:00.000Z' }), // 23:00
      entry('2026-11-09', { bedAt: '2026-11-09T15:00:00.000Z' }),
    ]
    const result = buildSleepRecommendations(entries, '2026-11-10', 'minute')
    expect(result.bed[0]).toMatchObject({ hour: 23, minute: 0, count: 2 })
    expect(result.bedSamples).toBe(2)
  })

  it('only shows frequent chips after 10 samples', () => {
    expect(SLEEP_FREQUENT_MIN_SAMPLES).toBe(10)
    const entries = Array.from({ length: 9 }, (_, index) => {
      const day = 6 + index
      const date = `2026-11-${String(day).padStart(2, '0')}`
      return entry(date, { wakeAt: `${date}T23:00:00.000Z` })
    })
    expect(buildSleepRecommendations(entries, '2026-11-20', 'hour').wakeSamples).toBe(9)
  })
})
