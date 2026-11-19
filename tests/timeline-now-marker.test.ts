import { describe, expect, it } from 'vitest'
import { nowLinePosition } from '../apps/client/src/pages/index/features/daily-notes/timeline-layout'
import { readFileSync } from 'node:fs'

const timeline = readFileSync(new URL('../apps/client/src/pages/index/features/daily-notes/entry-timeline-view.tsx', import.meta.url), 'utf8')
const modal = readFileSync(new URL('../apps/client/src/pages/index/features/daily-notes/entry-record-modal.tsx', import.meta.url), 'utf8')
const theme = readFileSync(new URL('../apps/client/src/pages/index/cream-ui-theme.scss', import.meta.url), 'utf8')

describe('nowLinePosition', () => {
  it('puts early hours in the am column', () => {
    expect(nowLinePosition(0)).toEqual({ side: 'am', topPercent: 0 })
    expect(nowLinePosition(431).side).toBe('am')
    expect(nowLinePosition(431).topPercent).toBeCloseTo((431 / 720) * 100, 6)
  })

  it('switches to the pm column at noon', () => {
    expect(nowLinePosition(720)).toEqual({ side: 'pm', topPercent: 0 })
    expect(nowLinePosition(1439).topPercent).toBeCloseTo((719 / 720) * 100, 6)
  })

  it('clamps out-of-range minutes', () => {
    expect(nowLinePosition(-5)).toEqual({ side: 'am', topPercent: 0 })
    expect(nowLinePosition(5000).side).toBe('pm')
  })
})

describe('now marker in the timeline', () => {
  it('renders a dashed line instead of tinting the whole hour band', () => {
    expect(theme).toContain('.daily-note-now-line {')
    expect(theme).toContain('border-top: 1px dashed')
    expect(theme).toContain('pointer-events: none;')
    expect(theme).not.toContain('.daily-note-band.is-now { background')
    expect(timeline).not.toContain("isToday && nowHour === hour ? 'is-now'")
  })

  it('ticks the clock and positions the line from real minutes', () => {
    expect(timeline).toContain('setInterval(() => setClock(currentMinute()), 30_000)')
    expect(timeline).toContain('nowLinePosition(clock)')
  })

  it('prefills the current real minute when the clicked hour is now', () => {
    expect(timeline).toContain('minute: isToday && hour === nowHour ? clock % 60 : 0')
    expect(modal).toContain('initialMinute')
    expect(modal).toContain('pad(initialMinute ?? 0)')
  })
})
describe('empty timeline hint', () => {
  it('sits in normal flow above the grid instead of covering the hour labels', () => {
    const rule = theme.match(/\.daily-note-bands-empty \{[^}]*\}/)?.[0] ?? ''
    expect(rule).not.toContain('position: absolute')
    expect(rule).not.toContain('inset: 0')
    expect(timeline.indexOf("className='daily-note-bands-empty'")).toBeLessThan(timeline.indexOf("className='daily-note-bands'"))
  })
})