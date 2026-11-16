import { describe, expect, it } from 'vitest'
import { normalizeSleepRoundness, SLEEP_CURVE_DEFAULT, sleepStylePreference } from '../apps/client/src/pages/index/features/daily-notes/sleep/sleep-chart-preferences'
import { buildSleepSparkline } from '../apps/client/src/pages/index/home-dashboard/home-sleep-sparkline'

describe('sleep curve preferences', () => {
  it('defaults to smooth but respects an explicit straight-line preference', () => {
    expect(sleepStylePreference(null)).toBe('smooth')
    expect(sleepStylePreference('bad')).toBe('smooth')
    expect(sleepStylePreference('linear')).toBe('linear')
  })
  it('uses a rounder default and limits corrupt/out-of-range storage', () => {
    expect(SLEEP_CURVE_DEFAULT).toBe(0.95)
    expect(normalizeSleepRoundness(NaN)).toBe(0.95)
    expect(normalizeSleepRoundness(5)).toBe(1)
    expect(normalizeSleepRoundness(-1)).toBe(0.3)
  })
  it('amplifies homepage changes without moving the two bands into each other', () => {
    const chart = buildSleepSparkline([{ date: 'a', wakeMinute: 60, bedMinute: 1000 }, { date: 'b', wakeMinute: 120, bedMinute: 1060 }], 96, 40)
    const wake = chart.wakeSegments[0]!, bed = chart.bedSegments[0]!
    expect(wake[1]!.y - wake[0]!.y).toBeGreaterThan((60 / 1440) * 34)
    expect(Math.max(...wake.map(p => p.y))).toBeLessThan(Math.min(...bed.map(p => p.y)))
    for (const p of [...wake, ...bed]) { expect(p.y).toBeGreaterThanOrEqual(3); expect(p.y).toBeLessThanOrEqual(37) }
  })
})
