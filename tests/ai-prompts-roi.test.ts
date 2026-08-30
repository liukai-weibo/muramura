import { describe, expect, it } from 'vitest'
import { STRONG_STRATEGIST_PROMPT } from '../packages/application/src/ai-prompts/strong-strategist-prompt'

describe('ROI prioritization rules in action-advice prompts', () => {
  it('instructs: compare exploration track 30d returns first, then items inside the best track, else item-level only', () => {
    const prompt = STRONG_STRATEGIST_PROMPT
    expect(prompt).toContain('近期回报取舍')
    // step 1: track-level comparison first
    expect(prompt).toContain('先比较各【探索主线】的近 30 天回报信号')
    // step 2: item-level inside the chosen track
    expect(prompt).toContain('再在该主线内比较各【事项】的回报')
    // step 3: fallback to item-level only when no track / item without track
    expect(prompt).toContain('跳过主线级，直接对所有事项比较近期回报')
    // order: 1 before 2 before 3
    const i1 = prompt.indexOf('先比较各【探索主线】')
    const i2 = prompt.indexOf('再在该主线内比较各【事项】')
    const i3 = prompt.indexOf('跳过主线级')
    expect(i1).toBeGreaterThanOrEqual(0)
    expect(i2).toBeGreaterThan(i1)
    expect(i3).toBeGreaterThan(i2)
  })

  it('forbids inventing ROI numbers and requires grounding in injected records plus content judgment', () => {
    const prompt = STRONG_STRATEGIST_PROMPT
    expect(prompt).toContain('只依据注入的上下文记录判断')
    expect(prompt).toContain('不得编造回报率、百分比、评分或虚构数据')
    expect(prompt).toContain('结合事项的实际内容权衡')
    expect(prompt).toContain('不盲目只取排序首位')
  })
})
