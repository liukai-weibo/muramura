import { describe, expect, it } from 'vitest'
import { moodEventChecks, moodEventTier } from '../apps/client/src/pages/index/features/mood/mood-levels'

// 日历已由「按状态档位着色」改为「按当天事件条数着色」。
// 分档边界：0 条空白 / 1–2 ✓ / 3–10 ✓✓ / 11+ ✓✓✓。
describe('mood event calendar tier', () => {
  it('maps entry counts to the agreed buckets', () => {
    expect(moodEventTier(1)).toBe('one')
    expect(moodEventTier(2)).toBe('one')
    expect(moodEventTier(3)).toBe('two')
    expect(moodEventTier(10)).toBe('two')
    expect(moodEventTier(11)).toBe('three')
    expect(moodEventTier(50)).toBe('three')
  })

  it('keeps days without events blank', () => {
    expect(moodEventTier(0)).toBe('none')
    expect(moodEventTier(-1)).toBe('none')
  })

  it('exposes a check count that matches each tier', () => {
    expect(moodEventChecks('none')).toBe(0)
    expect(moodEventChecks('one')).toBe(1)
    expect(moodEventChecks('two')).toBe(2)
    expect(moodEventChecks('three')).toBe(3)
  })

  it('never renders checks for an empty day', () => {
    expect(moodEventChecks(moodEventTier(0))).toBe(0)
  })
})
