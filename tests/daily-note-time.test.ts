import { describe, expect, it } from 'vitest'
import { dailyNoteAtMinute, dailyNoteClock, dailyNoteMinuteOfDay, dailyNoteSortEntries, parseQuickTimePrefix, parseSerializedDailyNote, serializeDailyNoteEntries } from '@knowledge-base/contracts'
import type { DailyNoteEntry } from '@knowledge-base/contracts'

function entry(overrides: Partial<DailyNoteEntry> & Pick<DailyNoteEntry, 'recordedAt' | 'content'>): DailyNoteEntry {
  return {
    id: 'entry-1', dailyNoteId: 'note-1', entryDate: '2026-10-28',
    timePrecision: 'minute', createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z', ...overrides,
  }
}

describe('daily note time helpers', () => {
  it('maps a UTC instant onto the Shanghai minute of day', () => {
    // 东八区 00:00 → UTC 前一日 16:00Z
    expect(dailyNoteMinuteOfDay('2026-10-27T16:00:00.000Z')).toBe(0)
    expect(dailyNoteMinuteOfDay('2026-10-27T16:01:00.000Z')).toBe(1)
    // 东八区 14:23
    expect(dailyNoteMinuteOfDay('2026-10-28T06:23:00.000Z')).toBe(14 * 60 + 23)
    // 东八区 23:59
    expect(dailyNoteMinuteOfDay('2026-10-28T15:59:00.000Z')).toBe(1439)
  })

  it('rebuilds the instant from a Shanghai date and minute', () => {
    expect(dailyNoteAtMinute('2026-10-28', 0)).toBe('2026-10-27T16:00:00.000Z')
    expect(dailyNoteAtMinute('2026-10-28', 14 * 60 + 23)).toBe('2026-10-28T06:23:00.000Z')
    expect(dailyNoteAtMinute('2026-10-28', 1439)).toBe('2026-10-28T15:59:00.000Z')
  })

  it('clamps out-of-range minutes instead of producing an invalid time', () => {
    expect(dailyNoteAtMinute('2026-10-28', -30)).toBe('2026-10-27T16:00:00.000Z')
    expect(dailyNoteAtMinute('2026-10-28', 5000)).toBe('2026-10-28T15:59:00.000Z')
  })

  it('rejects impossible dates and unparseable instants', () => {
    expect(dailyNoteAtMinute('2026-02-30', 60)).toBeUndefined()
    expect(dailyNoteAtMinute('2026-13-01', 60)).toBeUndefined()
    expect(dailyNoteMinuteOfDay('not-a-date')).toBeUndefined()
  })

  it('round-trips date plus minute through both helpers', () => {
    for (const minute of [0, 1, 59, 60, 359, 720, 1438, 1439]) {
      const instant = dailyNoteAtMinute('2026-12-31', minute)!
      expect(dailyNoteMinuteOfDay(instant)).toBe(minute)
      expect(dailyNoteClock(instant)?.date).toBe('2026-12-31')
    }
  })
})

describe('daily note entry ordering', () => {
  it('sorts by recordedAt, then createdAt, so split entries stay adjacent in order', () => {
    const sameMinute = '2026-10-28T06:23:00.000Z'
    const second = entry({ id: 'b', recordedAt: sameMinute, createdAt: '2026-10-28T06:23:05.000Z', content: '后半段' })
    const first = entry({ id: 'a', recordedAt: sameMinute, createdAt: '2026-10-28T06:23:01.000Z', content: '前半段' })
    const later = entry({ id: 'c', recordedAt: '2026-10-28T07:00:00.000Z', createdAt: '2026-10-28T07:00:00.000Z', content: '更晚' })
    expect(dailyNoteSortEntries([later, second, first]).map(item => item.content)).toEqual(['前半段', '后半段', '更晚'])
  })

  it('does not mutate the input array', () => {
    const list = [entry({ id: 'b', recordedAt: '2026-10-28T07:00:00.000Z', content: 'B' }), entry({ id: 'a', recordedAt: '2026-10-28T06:00:00.000Z', content: 'A' })]
    dailyNoteSortEntries(list)
    expect(list.map(item => item.content)).toEqual(['B', 'A'])
  })
})

describe('quick time prefix', () => {
  it('parses @MM-DD HH:MM and strips the marker', () => {
    expect(parseQuickTimePrefix('@10-26 15:30 补一条昨天的记录', '2026-10-28')).toEqual({ date: '2026-10-26', time: '15:30', rest: '补一条昨天的记录' })
  })

  it('parses an explicit year', () => {
    expect(parseQuickTimePrefix('@2025-01-02 08:05 年初的事', '2026-10-28')).toEqual({ date: '2025-01-02', time: '08:05', rest: '年初的事' })
  })

  it('parses a bare @HH:MM against the reference date', () => {
    expect(parseQuickTimePrefix('@15:30 下午开会', '2026-10-28')).toEqual({ date: '2026-10-28', time: '15:30', rest: '下午开会' })
  })

  it('rolls back a year when a bare month-day would land in the future', () => {
    // 1 月 3 日补 12-31，应该落到去年而不是今年年底
    expect(parseQuickTimePrefix('@12-31 23:00 跨年', '2026-01-03')?.date).toBe('2025-12-31')
    // 同一年内不早于参考日期则保持当年
    expect(parseQuickTimePrefix('@01-02 09:00 年初', '2026-01-03')?.date).toBe('2026-01-02')
  })

  it('ignores @ that is not at the start of the line', () => {
    expect(parseQuickTimePrefix('写给 @10-26 15:30 的那条', '2026-10-28')).toBeUndefined()
  })

  it('ignores a bare marker with no remaining content', () => {
    expect(parseQuickTimePrefix('@10-26 15:30', '2026-10-28')).toBeUndefined()
    expect(parseQuickTimePrefix('@15:30   ', '2026-10-28')).toBeUndefined()
  })

  it('rejects impossible times and dates', () => {
    expect(parseQuickTimePrefix('@10-26 25:30 不可能', '2026-10-28')).toBeUndefined()
    expect(parseQuickTimePrefix('@02-30 10:00 不存在的日期', '2026-10-28')).toBeUndefined()
    expect(parseQuickTimePrefix('@13-01 10:00 不存在的月份', '2026-10-28')).toBeUndefined()
  })
})

describe('daily note entry serialization', () => {
  it('keeps a single legacy entry byte-identical', () => {
    // 纯历史手记（整篇 day 精度）必须原样还原，旧客户端才无感。
    const legacy = entry({ recordedAt: '2026-08-12T01:00:00.000Z', content: '第一段\n\n14:23\n看起来像时间戳但属于正文', timePrecision: 'day' })
    expect(serializeDailyNoteEntries([legacy])).toBe('第一段\n\n14:23\n看起来像时间戳但属于正文')
  })

  it('serializes minute entries as HH:MM blocks in time order', () => {
    const later = entry({ id: 'b', recordedAt: '2026-10-28T14:05:00.000Z', content: '内容B' })
    const earlier = entry({ id: 'a', recordedAt: '2026-10-28T06:23:00.000Z', content: '内容A' })
    expect(serializeDailyNoteEntries([later, earlier])).toBe('14:23\n内容A\n\n22:05\n内容B')
  })

  it('round-trips through serialize and parse', () => {
    const entries = [
      entry({ id: 'a', recordedAt: '2026-10-28T06:23:00.000Z', content: '内容A' }),
      entry({ id: 'b', recordedAt: '2026-10-28T14:05:00.000Z', content: '内容B' }),
    ]
    expect(parseSerializedDailyNote(serializeDailyNoteEntries(entries))).toEqual([
      { time: '14:23', content: '内容A' },
      { time: '22:05', content: '内容B' },
    ])
  })

  it('keeps free text without a marker as a single day block', () => {
    expect(parseSerializedDailyNote('只有正文\n\n第二段正文')).toEqual([{ content: '只有正文\n\n第二段正文' }])
  })

  it('keeps leading text before the first marker instead of dropping it', () => {
    expect(parseSerializedDailyNote('前言一段\n\n14:23\n内容A')).toEqual([
      { content: '前言一段' },
      { time: '14:23', content: '内容A' },
    ])
  })

  it('treats empty text as no entries', () => {
    expect(parseSerializedDailyNote('   ')).toEqual([])
  })
})
