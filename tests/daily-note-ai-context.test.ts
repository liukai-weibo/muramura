import { describe, expect, it } from 'vitest'
import { formatKnowledgeContext } from '../packages/application/src/ai-context'
import type { DailyNoteEntry } from '@knowledge-base/contracts'

function entry(overrides: Partial<DailyNoteEntry> & Pick<DailyNoteEntry, 'entryDate' | 'recordedAt' | 'content'>): DailyNoteEntry {
  return {
    id: 'entry-1', dailyNoteId: 'note-1', timePrecision: 'minute',
    createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z', ...overrides,
  }
}

describe('daily notes in the AI context', () => {
  it('renders each entry with its record time', () => {
    const context = formatKnowledgeContext(undefined, '', undefined, [], 24000, [
      entry({ entryDate: '2026-10-16', recordedAt: '2026-10-16T06:23:00.000Z', content: '开了周会' }),
      entry({ id: 'entry-2', entryDate: '2026-10-16', recordedAt: '2026-10-16T14:05:00.000Z', content: '读完一章' }),
    ], 'Asia/Shanghai')
    expect(context).toContain('- 2026-10-16 14:23 | 开了周会')
    expect(context).toContain('- 2026-10-16 22:05 | 读完一章')
  })

  it('omits the clock for legacy day-precision entries', () => {
    const context = formatKnowledgeContext(undefined, '', undefined, [], 24000, [
      entry({ entryDate: '2026-08-12', recordedAt: '2026-08-12T01:00:00.000Z', content: '旧手记整篇', timePrecision: 'day' }),
    ], 'Asia/Shanghai')
    expect(context).toContain('- 2026-08-12 | 旧手记整篇')
    expect(context).not.toContain('- 2026-08-12 09:00')
  })

  it('orders entries newest first', () => {
    const context = formatKnowledgeContext(undefined, '', undefined, [], 24000, [
      entry({ id: 'old', entryDate: '2026-10-15', recordedAt: '2026-10-15T06:00:00.000Z', content: '较早' }),
      entry({ id: 'new', entryDate: '2026-10-17', recordedAt: '2026-10-17T06:00:00.000Z', content: '较新' }),
    ], 'Asia/Shanghai')
    expect(context.indexOf('较新')).toBeLessThan(context.indexOf('较早'))
  })

  it('caps how many entries reach the prompt', () => {
    const many = Array.from({ length: 400 }, (_unused, index) => entry({
      id: `entry-${index}`, entryDate: '2026-10-16',
      recordedAt: new Date(Date.UTC(2026, 9, 16, 0, index)).toISOString(), content: `内容${index}`,
    }))
    const context = formatKnowledgeContext(undefined, '', undefined, [], 400000, many, 'Asia/Shanghai')
    const lines = context.split('\n').filter(line => line.startsWith('- 2026-10-16'))
    expect(lines).toHaveLength(300)
  })

  it('says nothing about daily notes when there are none', () => {
    const context = formatKnowledgeContext(undefined, '', undefined, [], 24000)
    expect(context).not.toContain('Historical daily notes')
  })
})
