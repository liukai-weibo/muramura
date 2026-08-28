import { describe, expect, it } from 'vitest'
import { formatInTimeZone, formatAnchorPrompt } from '@knowledge-base/application'

describe('AI time awareness tools', () => {
  it('converts ISO to user time zone HH:mm', () => {
    expect(formatInTimeZone('2026-08-27T05:10:00.000Z', 'Asia/Shanghai')).toBe('13:10')
    expect(formatInTimeZone('2026-08-27T05:10:00.000Z', 'UTC')).toBe('05:10')
  })
  it('falls back to server time on invalid time zone', () => {
    const at = formatInTimeZone('2026-08-27T05:10:00.000Z', 'Not/AZone')
    expect(at).toMatch(/^\d{2}:\d{2}$/)
  })
  it('returns empty for invalid or missing iso', () => {
    expect(formatInTimeZone(undefined, 'Asia/Shanghai')).toBe('')
    expect(formatInTimeZone('not-a-date', 'Asia/Shanghai')).toBe('')
  })
  it('builds a human readable anchor prompt with time zone label', () => {
    const anchor = formatAnchorPrompt('Asia/Shanghai')
    expect(anchor).toMatch(/^现在是 /)
    expect(anchor).toContain('用户本地时区 Asia/Shanghai')
  })
})
