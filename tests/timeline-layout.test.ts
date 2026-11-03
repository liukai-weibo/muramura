import { describe, expect, it } from 'vitest'
import {
  TIMELINE_BAND_COUNT,
  TIMELINE_BAND_PADDING,
  TIMELINE_CARD_HEIGHT,
  TIMELINE_CARD_MIN_HEIGHT,
  TIMELINE_MORE_HEIGHT,
  bandCardTop,
  bandHourOf,
  bandLayout,
  bandMoreTop,
  bandOfMinute,
  bandRowAt,
  bandRowHeight,
  bandRowOfHour,
  bandSideOfHour,
  bandKey,
  clampMinute,
  groupByBand,
  hourOfMinute,
  minuteOfHour,
} from '../apps/client/src/pages/index/features/daily-notes/timeline-layout'

/** 实际能出现的一屏高度：从很矮的窗口到 900px。 */
const RAIL_HEIGHTS = [360, 480, 620, 742, 900]

describe('band geometry', () => {
  it('splits every day into 12 rows per side', () => {
    for (const height of RAIL_HEIGHTS) {
      const rowHeight = bandRowHeight(height)
      expect(rowHeight * TIMELINE_BAND_COUNT).toBeCloseTo(height, 6)
    }
  })

  it('maps every hour to the right side and row', () => {
    expect(bandSideOfHour(0)).toBe('am')
    expect(bandSideOfHour(11)).toBe('am')
    expect(bandSideOfHour(12)).toBe('pm')
    expect(bandSideOfHour(23)).toBe('pm')
    expect(bandRowOfHour(0)).toBe(0)
    expect(bandRowOfHour(11)).toBe(11)
    expect(bandRowOfHour(12)).toBe(0)
    expect(bandRowOfHour(23)).toBe(11)
  })

  it('round-trips row and side back to the hour', () => {
    for (let hour = 0; hour <= 23; hour += 1) {
      const side = bandSideOfHour(hour)
      const row = bandRowOfHour(hour)
      expect(bandHourOf(row, side)).toBe(hour)
    }
  })

  it('clamps out-of-range hours instead of producing bad rows', () => {
    expect(bandRowOfHour(-3)).toBe(0)
    expect(bandRowOfHour(26)).toBe(TIMELINE_BAND_COUNT - 1)
    expect(bandHourOf(-1, 'am')).toBe(0)
    expect(bandHourOf(99, 'pm')).toBe(23)
  })

  it('finds the band of a minute of day', () => {
    expect(bandOfMinute(0)).toEqual({ hour: 0, side: 'am', row: 0, key: bandKey('am', 0) })
    expect(bandOfMinute(7 * 60 + 35)).toEqual({ hour: 7, side: 'am', row: 7, key: bandKey('am', 7) })
    expect(bandOfMinute(12 * 60)).toEqual({ hour: 12, side: 'pm', row: 0, key: bandKey('pm', 0) })
    expect(bandOfMinute(23 * 60 + 59)).toEqual({ hour: 23, side: 'pm', row: 11, key: bandKey('pm', 11) })
    expect(hourOfMinute(23 * 60 + 59)).toBe(23)
    expect(minuteOfHour(23 * 60 + 59)).toBe(59)
  })

  it('clamps minute helpers at both ends of the day', () => {
    expect(clampMinute(-10)).toBe(0)
    expect(clampMinute(1440)).toBe(1439)
    expect(clampMinute(90.4)).toBe(90)
  })

  it('turns a pointer offset into a clamped row', () => {
    const rowHeight = bandRowHeight(720)
    expect(bandRowAt(0, rowHeight)).toBe(0)
    expect(bandRowAt(rowHeight * 7 + 1, rowHeight)).toBe(7)
    expect(bandRowAt(-50, rowHeight)).toBe(0)
    expect(bandRowAt(99999, rowHeight)).toBe(TIMELINE_BAND_COUNT - 1)
  })
})

describe('cards inside one band', () => {
  it('keeps a single card at full height', () => {
    for (const height of RAIL_HEIGHTS) {
      const layout = bandLayout(1, bandRowHeight(height))
      expect(layout.visible).toBe(1)
      expect(layout.hidden).toBe(0)
      expect(layout.cardHeight).toBe(TIMELINE_CARD_HEIGHT)
    }
  })

  it('keeps two cards at full height on a normal screen', () => {
    for (const height of [620, 742, 900]) {
      const layout = bandLayout(2, bandRowHeight(height))
      expect(layout.visible).toBe(2)
      expect(layout.cardHeight).toBe(TIMELINE_CARD_HEIGHT)
    }
  })

  it('shrinks three cards until they fit', () => {
    for (const height of [742, 900]) {
      const rowHeight = bandRowHeight(height)
      const layout = bandLayout(3, rowHeight)
      expect(layout.visible).toBe(3)
      expect(layout.hidden).toBe(0)
      expect(layout.cardHeight).toBeGreaterThanOrEqual(TIMELINE_CARD_MIN_HEIGHT)
      expect(layout.cardHeight).toBeLessThanOrEqual(TIMELINE_CARD_HEIGHT)
      const lastBottom = bandCardTop(layout.visible - 1, layout) + layout.cardHeight
      expect(lastBottom).toBeLessThanOrEqual(rowHeight)
    }
    // 742px 是 1440×900 下的常见高度：三条并列时压到 18px 刚好放下。
    expect(bandLayout(3, bandRowHeight(742)).cardHeight).toBe(18)
  })

  it('folds what does not fit on a short window instead of clipping it', () => {
    // 620px 高的轨道每格只有 51.7px：三条 16px 卡片放不下，只能保留可见的一两条并折出「还有 N 条」。
    const rowHeight = bandRowHeight(620)
    const layout = bandLayout(3, rowHeight)
    expect(layout.hidden).toBeGreaterThan(0)
    expect(layout.visible + layout.hidden).toBe(3)
    expect(bandMoreTop(layout) + TIMELINE_MORE_HEIGHT).toBeLessThanOrEqual(rowHeight)
  })

  it('never lets a card leave its band', () => {
    for (const height of RAIL_HEIGHTS) {
      const rowHeight = bandRowHeight(height)
      for (let count = 0; count <= 6; count += 1) {
        const layout = bandLayout(count, rowHeight)
        if (layout.visible === 0) continue
        const lastBottom = bandCardTop(layout.visible - 1, layout) + layout.cardHeight
        expect(lastBottom).toBeLessThanOrEqual(rowHeight)
      }
    }
  })

  it('folds the rest into a counter once a band overflows', () => {
    const rowHeight = bandRowHeight(742)
    const layout = bandLayout(5, rowHeight)
    expect(layout.hidden).toBeGreaterThan(0)
    expect(layout.visible + layout.hidden).toBe(5)
    expect(layout.cardHeight).toBe(TIMELINE_CARD_MIN_HEIGHT)
    const moreBottom = bandMoreTop(layout) + TIMELINE_MORE_HEIGHT
    expect(moreBottom).toBeLessThanOrEqual(rowHeight)
  })

  it('accounts for every entry at any height', () => {
    for (const height of RAIL_HEIGHTS) {
      const rowHeight = bandRowHeight(height)
      for (let count = 0; count <= 8; count += 1) {
        const layout = bandLayout(count, rowHeight)
        expect(layout.visible + layout.hidden).toBe(count)
        expect(layout.visible).toBeLessThanOrEqual(count)
      }
    }
  })

  it('starts cards just below the band separator', () => {
    const layout = bandLayout(2, bandRowHeight(742))
    expect(bandCardTop(0, layout)).toBe(TIMELINE_BAND_PADDING)
    expect(bandCardTop(1, layout)).toBe(TIMELINE_BAND_PADDING + layout.cardHeight + layout.gap)
  })
})

describe('grouping entries into bands', () => {
  const entries = [
    { id: 'late', minute: 7 * 60 + 55 },
    { id: 'early', minute: 7 * 60 + 5 },
    { id: 'noon', minute: 12 * 60 },
    { id: 'night', minute: 23 * 60 + 30 },
  ]

  it('puts each entry in its own band and keeps minute order', () => {
    const groups = groupByBand(entries)
    expect([...groups.keys()].sort()).toEqual([bandKey('am', 7), bandKey('pm', 0), bandKey('pm', 11)].sort())
    expect(groups.get(bandKey('am', 7))!.map(entry => entry.id)).toEqual(['early', 'late'])
    expect(groups.get(bandKey('pm', 0))!.map(entry => entry.id)).toEqual(['noon'])
    expect(groups.get(bandKey('pm', 11))!.map(entry => entry.id)).toEqual(['night'])
  })

  it('keeps every entry exactly once', () => {
    const total = [...groupByBand(entries).values()].reduce((sum, list) => sum + list.length, 0)
    expect(total).toBe(entries.length)
  })

  it('returns no bands for an empty day', () => {
    expect(groupByBand([]).size).toBe(0)
  })
})
