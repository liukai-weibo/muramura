import { describe, expect, it } from 'vitest'
import { compositeMoodLevel } from '../apps/client/src/pages/index/features/mood/mood-levels'
import type { MoodLevel } from '@knowledge-base/contracts'

describe('compositeMoodLevel', () => {
  it('returns undefined for empty array', () => {
    expect(compositeMoodLevel([])).toBeUndefined()
  })

  it('returns the single value for one entry', () => {
    expect(compositeMoodLevel([3])).toBe(3)
  })

  it('averages and rounds: 2.5 -> 3', () => {
    expect(compositeMoodLevel([2, 3])).toBe(3)
  })

  it('averages and rounds: 4.5 -> 5', () => {
    expect(compositeMoodLevel([4, 5])).toBe(5)
  })

  it('averages and rounds: 1.5 -> 2', () => {
    expect(compositeMoodLevel([1, 2])).toBe(2)
  })

  it('clamps below 1 to 1', () => {
    // All level 1 entries still round to 1; there's no valid score below 1
    expect(compositeMoodLevel([1, 1])).toBe(1)
  })

  it('handles many entries from all levels', () => {
    const levels: MoodLevel[] = [5, 4, 3, 2, 1, 5, 4, 3, 2, 1]
    expect(compositeMoodLevel(levels)).toBe(3)
  })
})
