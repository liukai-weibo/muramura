import { describe, expect, it } from 'vitest'
import type { SleepEntry } from '@knowledge-base/contracts'
import {
  SLEEP_DEFAULT_SETTINGS,
  isValidSleepRemindWindow,
  shouldPromptSleep,
} from '@knowledge-base/contracts'

const completeEntry: SleepEntry = {
  id: 'sleep-1',
  sleepDate: '2026-11-09',
  bedAt: '2026-11-08T15:40:00.000Z',
  wakeAt: '2026-11-09T07:10:00.000Z',
  createdAt: '2026-11-09T07:11:00.000Z',
  updatedAt: '2026-11-09T07:11:00.000Z',
}

const bedOnlyEntry: SleepEntry = { ...completeEntry, id: 'sleep-2', wakeAt: undefined }

const base = { today: '2026-11-09', settings: SLEEP_DEFAULT_SETTINGS }

describe('shouldPromptSleep', () => {
  it('prompts inside the window when today has no record', () => {
    expect(shouldPromptSleep({ ...base, nowMinute: 12 * 60, entry: undefined })).toBe(true)
    expect(shouldPromptSleep({ ...base, nowMinute: 18 * 60, entry: undefined })).toBe(true)
  })

  it('treats window edges as inclusive', () => {
    expect(shouldPromptSleep({ ...base, nowMinute: 12 * 60, entry: undefined })).toBe(true)
    expect(shouldPromptSleep({ ...base, nowMinute: 23 * 60 + 30, entry: undefined })).toBe(true)
  })

  it('stays quiet outside the window', () => {
    expect(shouldPromptSleep({ ...base, nowMinute: 11 * 60 + 59, entry: undefined })).toBe(false)
    expect(shouldPromptSleep({ ...base, nowMinute: 23 * 60 + 31, entry: undefined })).toBe(false)
    expect(shouldPromptSleep({ ...base, nowMinute: 3 * 60, entry: undefined })).toBe(false)
  })

  it('stays quiet once today is complete or already acknowledged', () => {
    expect(shouldPromptSleep({ ...base, nowMinute: 13 * 60, entry: completeEntry })).toBe(false)
    expect(shouldPromptSleep({
      ...base, nowMinute: 13 * 60, entry: undefined,
      settings: { ...SLEEP_DEFAULT_SETTINGS, lastPromptedDate: '2026-11-09' },
    })).toBe(false)
  })

  it('still asks for the wake time when only bedtime was recorded', () => {
    expect(shouldPromptSleep({ ...base, nowMinute: 13 * 60, entry: bedOnlyEntry })).toBe(true)
  })

  it('respects the reminder switch', () => {
    expect(shouldPromptSleep({
      ...base, nowMinute: 13 * 60, entry: undefined,
      settings: { ...SLEEP_DEFAULT_SETTINGS, remindEnabled: false },
    })).toBe(false)
  })

  it('ignores invalid minute-of-day input', () => {
    expect(shouldPromptSleep({ ...base, nowMinute: -1, entry: undefined })).toBe(false)
    expect(shouldPromptSleep({ ...base, nowMinute: 1440, entry: undefined })).toBe(false)
  })
})

describe('isValidSleepRemindWindow', () => {
  it('accepts same-day windows and rejects inverted or cross-day ones', () => {
    expect(isValidSleepRemindWindow(720, 1410)).toBe(true)
    expect(isValidSleepRemindWindow(0, 1439)).toBe(true)
    expect(isValidSleepRemindWindow(1410, 720)).toBe(false)
    expect(isValidSleepRemindWindow(720, 720)).toBe(false)
    expect(isValidSleepRemindWindow(-1, 600)).toBe(false)
    expect(isValidSleepRemindWindow(600, 1440)).toBe(false)
  })
})
