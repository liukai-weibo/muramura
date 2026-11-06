import { describe, expect, it } from 'vitest'
import {
  TIMELINE_BAND_COUNT,
  TIMELINE_BAND_PADDING,
  TIMELINE_CARD_HEIGHT,
  TIMELINE_CARD_MIN_HEIGHT,
  TIMELINE_MORE_HEIGHT,
  bandColumns,
  bandSlot,
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
  const rowHeight = bandRowHeight(698)

  it('uses two columns at the normal side width and falls back to one when narrow', () => {
    expect(bandColumns(431)).toBe(2)
    expect(bandColumns(299)).toBe(1)
    expect(bandColumns(0)).toBe(2)
  })

  it('keeps one or two cards at 22px in the near-axis row', () => {
    for (const count of [1, 2]) {
      const layout = bandLayout(count, rowHeight)
      expect(layout.visible).toBe(count)
      expect(layout.hidden).toBe(0)
      expect(layout.cardHeight).toBe(TIMELINE_CARD_HEIGHT)
      expect(bandCardTop(0, layout)).toBe(TIMELINE_BAND_PADDING)
      if (count === 2) expect(bandCardTop(1, layout)).toBe(TIMELINE_BAND_PADDING)
    }
  })

  it('fits six cards in two columns and three rows', () => {
    const layout = bandLayout(6, rowHeight)
    expect(layout).toMatchObject({ columns: 2, rows: 3, visible: 6, hidden: 0, cardHeight: TIMELINE_CARD_MIN_HEIGHT })
    expect(Array.from({ length: 6 }, (_, index) => bandSlot(index, layout))).toEqual([
      { column: 0, row: 0 }, { column: 0, row: 1 }, { column: 0, row: 2 },
      { column: 1, row: 0 }, { column: 1, row: 1 }, { column: 1, row: 2 },
    ])
  })

  it('keeps three and four cards at 22px across two rows', () => {
    for (const count of [3, 4]) {
      const layout = bandLayout(count, rowHeight)
      expect(layout.visible).toBe(count)
      expect(layout.hidden).toBe(0)
      expect(layout.rows).toBe(2)
      expect(layout.cardHeight).toBe(TIMELINE_CARD_HEIGHT)
    }
  })

  it('puts the overflow indicator in the last grid cell', () => {
    const layout = bandLayout(7, rowHeight)
    expect(layout).toMatchObject({ columns: 2, rows: 3, visible: 5, hidden: 2 })
    expect(bandSlot(layout.visible, layout)).toEqual({ column: 1, row: 2 })
    expect(bandMoreTop(layout) + TIMELINE_MORE_HEIGHT).toBeLessThanOrEqual(rowHeight)
  })

  it('folds safely on short rows and in one-column mode', () => {
    const shortRow = bandRowHeight(360)
    for (const columns of [1, 2] as const) {
      const layout = bandLayout(12, shortRow, columns)
      expect(layout.visible + layout.hidden).toBe(12)
      expect(bandMoreTop(layout) + TIMELINE_MORE_HEIGHT).toBeLessThanOrEqual(shortRow)
    }
    const narrow = bandLayout(6, rowHeight, 1)
    expect(narrow.columns).toBe(1)
    expect(narrow.visible + narrow.hidden).toBe(6)
    expect(narrow.hidden).toBeGreaterThan(0)
  })

  it('never lets a visible card or overflow indicator leave its band', () => {
    for (const height of RAIL_HEIGHTS) {
      const bandHeight = bandRowHeight(height)
      for (const columns of [1, 2] as const) {
        for (let count = 0; count <= 12; count += 1) {
          const layout = bandLayout(count, bandHeight, columns)
          expect(layout.visible + layout.hidden).toBe(count)
          if (layout.visible > 0) {
            for (let index = 0; index < layout.visible; index += 1) {
              expect(bandCardTop(index, layout) + layout.cardHeight).toBeLessThanOrEqual(bandHeight)
            }
          }
          if (layout.hidden > 0) expect(bandMoreTop(layout) + TIMELINE_MORE_HEIGHT).toBeLessThanOrEqual(bandHeight)
        }
      }
    }
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
