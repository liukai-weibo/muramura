import { describe, expect, it } from 'vitest'
import {
  MOOD_PROMPTS,
  MOOD_PROMPT_SLICE_MS,
  currentMoodPrompt,
  moodPromptIndexAt,
  msUntilNextMoodPrompt,
} from '../apps/client/src/pages/index/home-dashboard/mood-prompts'

const at = (iso: string) => Date.parse(iso)

describe('mood prompts', () => {
  it('contains a unique, non-empty prompt pair list', () => {
    expect(MOOD_PROMPTS).toHaveLength(102)
    for (const prompt of MOOD_PROMPTS) {
      expect(prompt.question.trim().length).toBeGreaterThan(0)
      expect(prompt.desc.trim().length).toBeGreaterThan(0)
    }
    expect(new Set(MOOD_PROMPTS.map(prompt => prompt.question)).size).toBe(MOOD_PROMPTS.length)
  })

  it('keeps the same prompt inside a local 12-hour block', () => {
    const morningStart = at('2026-11-11T00:00:00+08:00')
    const morningEnd = at('2026-11-11T11:59:59+08:00')
    const afternoonStart = at('2026-11-11T12:00:00+08:00')
    const afternoonEnd = at('2026-11-11T23:59:59+08:00')
    expect(moodPromptIndexAt(morningEnd)).toBe(moodPromptIndexAt(morningStart))
    expect(moodPromptIndexAt(afternoonEnd)).toBe(moodPromptIndexAt(afternoonStart))
  })

  it('advances one prompt at local noon and midnight', () => {
    const morning = moodPromptIndexAt(at('2026-11-11T11:59:59+08:00'))
    const afternoon = moodPromptIndexAt(at('2026-11-11T12:00:00+08:00'))
    const nextMidnight = moodPromptIndexAt(at('2026-11-12T00:00:00+08:00'))
    expect(afternoon).toBe((morning + 1) % MOOD_PROMPTS.length)
    expect(nextMidnight).toBe((afternoon + 1) % MOOD_PROMPTS.length)
  })

  it('wraps after one full cycle', () => {
    const now = at('2026-11-11T09:00:00+08:00')
    expect(moodPromptIndexAt(now + MOOD_PROMPTS.length * MOOD_PROMPT_SLICE_MS)).toBe(moodPromptIndexAt(now))
    expect(currentMoodPrompt(now)).toBe(MOOD_PROMPTS[moodPromptIndexAt(now)])
  })

  it('computes time until the next 12-hour boundary', () => {
    expect(msUntilNextMoodPrompt(at('2026-11-11T11:00:00+08:00'))).toBe(60 * 60 * 1000)
    expect(msUntilNextMoodPrompt(at('2026-11-11T12:00:00+08:00'))).toBe(MOOD_PROMPT_SLICE_MS)
    expect(msUntilNextMoodPrompt(at('2026-11-11T23:30:00+08:00'))).toBe(30 * 60 * 1000)
  })
})
