import { describe, expect, it } from 'vitest'
import type { SleepChartDay } from '../apps/client/src/pages/index/features/daily-notes/sleep/sleep-chart'
import { buildSleepSparkline } from '../apps/client/src/pages/index/home-dashboard/home-sleep-sparkline'

const day = (date: string, wakeMinute?: number, bedMinute?: number): SleepChartDay => ({
  date,
  ...(wakeMinute !== undefined ? { wakeMinute } : {}),
  ...(bedMinute !== undefined ? { bedMinute } : {}),
})

describe('home sleep sparkline', () => {
  it('places wake above bed on the same 06 → 06 scale', () => {
    const layout = buildSleepSparkline([
      day('2026-11-08', 60, 1050),
      day('2026-11-09', 90, 1080),
    ], 96, 40)
    expect(layout.wakeSegments).toHaveLength(1)
    expect(layout.bedSegments).toHaveLength(1)
    expect(layout.wakeSegments[0]![0]!.y).toBeLessThan(layout.bedSegments[0]![0]!.y)
  })

  it('breaks each line when a day is missing', () => {
    const layout = buildSleepSparkline([
      day('2026-11-06', 60, 1050),
      day('2026-11-07', 80), // 缺入睡
      day('2026-11-08', 70, 1060),
    ], 96, 40)
    expect(layout.wakeSegments).toHaveLength(1)
    expect(layout.bedSegments).toHaveLength(2)
  })

  it('keeps a single point so isolated days still show', () => {
    const layout = buildSleepSparkline([day('2026-11-09', 90)], 96, 40)
    expect(layout.wakeSegments).toHaveLength(1)
    expect(layout.wakeSegments[0]).toHaveLength(1)
    expect(layout.bedSegments).toHaveLength(0)
  })

  it('spreads x evenly from the first to the last day', () => {
    const layout = buildSleepSparkline([day('a', 60), day('b', 60), day('c', 60)], 96, 40)
    const xs = layout.wakeSegments[0]!.map(point => point.x)
    expect(xs[0]).toBeCloseTo(3, 5)
    expect(xs[2]).toBeCloseTo(93, 5)
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!, 5)
  })
})
