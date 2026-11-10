import { describe, expect, it } from 'vitest'
import {
  addDays,
  bedDateForWake,
  isWithinSleepFutureTolerance,
  isValidSleepBed,
  isValidSleepWake,
  minuteOfDayLabel,
  sleepAxisMinute,
  sleepClockLabel,
  sleepDurationLabel,
  sleepDurationMinutes,
  sleepIsoAt,
} from '@knowledge-base/contracts'
import { inferSleepFromDay } from '../apps/client/src/pages/index/features/daily-notes/sleep/sleep-suggestion'

describe('sleep ordering rules', () => {
  it('accepts wake times anywhere on the same day', () => {
    expect(isValidSleepWake('2026-11-09', '2026-11-08T23:10:00.000Z')).toBe(true) // 07:10
    expect(isValidSleepWake('2026-11-09', '2026-11-09T05:00:00.000Z')).toBe(true) // 13:00
    expect(isValidSleepWake('2026-11-09', '2026-11-09T23:10:00.000Z')).toBe(false) // 次日 07:10
  })

  it('derives the bedtime day from the wake time', () => {
    // 07:10 起床：23:40 入睡是当天；06:00 入睡自动算次日。
    expect(isValidSleepBed('2026-11-09', '2026-11-09T15:40:00.000Z', '2026-11-08T23:10:00.000Z')).toBe(true)
    expect(isValidSleepBed('2026-11-09', '2026-11-09T22:00:00.000Z', '2026-11-08T23:10:00.000Z')).toBe(true) // 次日 06:00
    expect(isValidSleepBed('2026-11-09', '2026-11-08T22:00:00.000Z', '2026-11-08T23:10:00.000Z')).toBe(false) // 当天 06:00
    // 次日 05:00 虽然很早，但仍晚于起床，属于合法顺延。
    expect(isValidSleepBed('2026-11-09', '2026-11-09T21:00:00.000Z', '2026-11-08T23:10:00.000Z')).toBe(true)
  })

  it('treats every hour as same-day when there is no wake record', () => {
    expect(isValidSleepBed('2026-11-09', '2026-11-09T09:00:00.000Z')).toBe(true) // 当天 17:00
    expect(isValidSleepBed('2026-11-09', '2026-11-08T22:00:00.000Z')).toBe(true) // 当天 06:00
    expect(isValidSleepBed('2026-11-09', '2026-11-09T22:00:00.000Z')).toBe(false) // 次日 06:00
  })

  it('allows a bedtime equal to the wake time (zero hours)', () => {
    expect(isValidSleepBed('2026-11-09', '2026-11-08T23:00:00.000Z', '2026-11-08T23:00:00.000Z')).toBe(true)
    expect(bedDateForWake('2026-11-09', 7 * 60, 7 * 60)).toBe('2026-11-09')
  })

  it('computes the inferred bedtime date', () => {
    expect(bedDateForWake('2026-11-09', 23 * 60 + 40, 7 * 60 + 10)).toBe('2026-11-09')
    expect(bedDateForWake('2026-11-09', 6 * 60, 7 * 60 + 10)).toBe('2026-11-10')
    expect(bedDateForWake('2026-11-09', 6 * 60)).toBe('2026-11-09')
  })

  it('adds days without depending on the process timezone', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('sleep durations', () => {
  it('measures one night across midnight', () => {
    expect(sleepDurationMinutes('2026-11-09T15:40:00.000Z', '2026-11-09T23:10:00.000Z')).toBe(7 * 60 + 30)
  })

  it('rejects reversed, equal or absurd durations', () => {
    expect(sleepDurationMinutes('2026-11-09T23:10:00.000Z', '2026-11-09T15:40:00.000Z')).toBeUndefined()
    expect(sleepDurationMinutes('2026-11-09T23:10:00.000Z', '2026-11-09T23:10:00.000Z')).toBeUndefined()
    expect(sleepDurationMinutes('2026-11-08T00:00:00.000Z', '2026-11-09T10:00:00.000Z')).toBeUndefined()
  })

  it('formats labels with and without minutes', () => {
    expect(sleepDurationLabel(450)).toBe('7h30m')
    expect(sleepDurationLabel(480)).toBe('8h')
    expect(sleepDurationLabel(45)).toBe('45m')
  })
})

describe('sleep axis mapping', () => {
  it('maps 18:00 to the top and noon next day to the bottom', () => {
    expect(sleepAxisMinute('2026-11-09T10:00:00.000Z')).toBe(0) // 18:00
    expect(sleepAxisMinute('2026-11-09T15:40:00.000Z')).toBe(340) // 23:40
    expect(sleepAxisMinute('2026-11-09T16:00:00.000Z')).toBe(360) // 00:00
    expect(sleepAxisMinute('2026-11-09T23:10:00.000Z')).toBe(790) // 07:10
    expect(sleepAxisMinute('2026-11-10T04:00:00.000Z')).toBe(1080) // 12:00
    expect(sleepAxisMinute('2026-11-10T04:30:00.000Z')).toBe(1080)
  })

  it('roundtrips local time through UTC', () => {
    const iso = sleepIsoAt('2026-11-08', 23, 5)!
    expect(iso).toBe('2026-11-08T15:05:00.000Z')
    expect(sleepClockLabel(iso)).toBe('23:05')
  })

  it('labels minutes of day', () => {
    expect(minuteOfDayLabel(720)).toBe('12:00')
    expect(minuteOfDayLabel(1410)).toBe('23:30')
  })
})

describe('inferSleepFromDay', () => {
  const entry = (id: string, recordedAt: string) => ({
    id, dailyNoteId: 'note', entryDate: recordedAt.slice(0, 10), recordedAt,
    timePrecision: 'minute' as const, content: '...', createdAt: recordedAt, updatedAt: recordedAt,
  })

  it('takes the first morning note and the last evening note of the same day', () => {
    const suggestion = inferSleepFromDay([
      entry('a', '2026-11-09T00:10:00.000Z'), // 08:10 早晨
      entry('b', '2026-11-09T15:40:00.000Z'), // 23:40 晚上
      entry('c', '2026-11-09T16:30:00.000Z'), // 次日 00:30，按 18–04 窗口计入
      entry('d', '2026-11-09T03:00:00.000Z'), // 11:00 上午
    ])
    expect(suggestion.wake).toEqual({ hour: 8, minute: 10 })
    expect(suggestion.bed).toEqual({ hour: 0, minute: 30 })
  })

  it('takes the last evening note, including after midnight', () => {
    const suggestion = inferSleepFromDay([
      entry('a', '2026-11-09T14:00:00.000Z'), // 22:00
      entry('b', '2026-11-09T18:30:00.000Z'), // 次日 02:30
    ])
    expect(suggestion.bed).toEqual({ hour: 2, minute: 30 })
  })

  it('ignores notes without a sleep-relevant time', () => {
    expect(inferSleepFromDay([entry('x', '2026-11-09T06:00:00.000Z')]).wake).toBeUndefined()
    expect(inferSleepFromDay([entry('x', '2026-11-09T06:00:00.000Z')]).bed).toBeUndefined()
  })
})

describe('sleep future tolerance', () => {
  const now = Date.parse('2026-11-30T15:30:00.000Z') // 东八区 23:30

  it('allows a bedtime that is a few minutes ahead', () => {
    expect(isWithinSleepFutureTolerance('2026-11-30T16:00:00.000Z', now)).toBe(true) // 次日 00:00，+30 分钟
    expect(isWithinSleepFutureTolerance('2026-11-30T16:29:00.000Z', now)).toBe(true)
  })

  it('rejects more than one hour ahead', () => {
    expect(isWithinSleepFutureTolerance('2026-11-30T16:31:00.000Z', now)).toBe(false)
    expect(isWithinSleepFutureTolerance('2026-12-01T00:00:00.000Z', now)).toBe(false)
  })

  it('always allows past times and rejects invalid input', () => {
    expect(isWithinSleepFutureTolerance('2026-11-30T10:00:00.000Z', now)).toBe(true)
    expect(isWithinSleepFutureTolerance('not-a-date', now)).toBe(false)
  })
})
