import { describe, expect, it } from 'vitest'
import { MoodEntryApplicationService } from '@knowledge-base/application'
import type { MoodEntry, MoodEntryInput, MoodEntryRepository } from '@knowledge-base/contracts'
import { utcDatePlusDays } from '../packages/application/src/date-utils'

const entry: MoodEntry = {
  id: 'mood-1',
  entryDate: '2026-08-20',
  content: '完成了一个长期拖延的事项',
  moodLevel: 5,
  tags: ['成就感'],
  response: '今晚早点休息，奖励自己',
  createdAt: '2026-08-20T10:00:00.000Z',
  updatedAt: '2026-08-20T10:00:00.000Z',
}

function createRepository(overrides?: Partial<MoodEntryRepository>): { repository: MoodEntryRepository; calls: { created: MoodEntryInput[]; updated: Array<{ id: string; input: MoodEntryInput }>; deleted: string[] } } {
  const calls = { created: [] as MoodEntryInput[], updated: [] as Array<{ id: string; input: MoodEntryInput }>, deleted: [] as string[] }
  const repository: MoodEntryRepository = {
    listRange: async () => [entry],
    create: async input => { calls.created.push(input); return entry },
    updateMine: async (id, input) => { calls.updated.push({ id, input }); return entry },
    deleteMine: async id => { calls.deleted.push(id); return true },
    ...overrides,
  }
  return { repository, calls }
}

describe('mood entry application', () => {
  it('rejects blank content before writing', async () => {
    const { repository, calls } = createRepository()
    await expect(new MoodEntryApplicationService(repository).create({ content: '   ', moodLevel: 3 })).rejects.toMatchObject({ code: 'MOOD_ENTRY_INVALID' })
    expect(calls.created).toHaveLength(0)
  })

  it('rejects content over the length limit', async () => {
    const { repository, calls } = createRepository()
    await expect(new MoodEntryApplicationService(repository).create({ content: 'x'.repeat(2001), moodLevel: 3 })).rejects.toMatchObject({ code: 'MOOD_ENTRY_INVALID' })
    expect(calls.created).toHaveLength(0)
  })

  it('rejects invalid mood level', async () => {
    const { repository, calls } = createRepository()
    await expect(new MoodEntryApplicationService(repository).create({ content: '事件', moodLevel: 6 as never })).rejects.toMatchObject({ code: 'MOOD_ENTRY_INVALID' })
    expect(calls.created).toHaveLength(0)
  })

  it('rejects malformed entries with future dates', async () => {
    const { repository } = createRepository()
    const future = '2999-12-31'
    await expect(new MoodEntryApplicationService(repository).create({ content: '事件', moodLevel: 3, entryDate: future })).rejects.toMatchObject({ code: 'MOOD_ENTRY_INVALID' })
  })

  it('allows UTC-today+1 (local today across timezones) and still rejects UTC+2', async () => {
    const { repository, calls } = createRepository()
    const service = new MoodEntryApplicationService(repository)
    // 东八区凌晨窗口：服务器 UTC 仍是昨天，UTC 今天+1 等于用户本地今天，必须允许
    await expect(service.create({ content: '凌晨记录', moodLevel: 3, entryDate: utcDatePlusDays(1) })).resolves.toBeDefined()
    await expect(service.create({ content: '明天之后', moodLevel: 3, entryDate: utcDatePlusDays(2) })).rejects.toMatchObject({ code: 'MOOD_ENTRY_INVALID' })
    expect(calls.created).toHaveLength(1)
  })

  it('defaults entry date to today when omitted', async () => {
    const { repository, calls } = createRepository()
    await new MoodEntryApplicationService(repository).create({ content: '事件', moodLevel: 3 })
    expect(calls.created).toHaveLength(1)
    expect(calls.created[0]!.entryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('normalizes tags: trims and dedupes', async () => {
    const { repository, calls } = createRepository()
    await new MoodEntryApplicationService(repository).create({ content: '事件', moodLevel: 3, tags: [' 工作 ', '工作', '散步'] })
    expect(calls.created[0]!.tags).toEqual(['工作', '散步'])
  })

  it('rejects more than 10 tags', async () => {
    const { repository, calls } = createRepository()
    const manyTags = Array.from({ length: 11 }, (_, i) => `tag-${i}`)
    await expect(new MoodEntryApplicationService(repository).create({ content: '事件', moodLevel: 3, tags: manyTags })).rejects.toMatchObject({ code: 'MOOD_ENTRY_INVALID' })
    expect(calls.created).toHaveLength(0)
  })

  it('turns not-found on update into a typed business error', async () => {
    const { repository } = createRepository({ updateMine: async () => undefined })
    await expect(new MoodEntryApplicationService(repository).updateMine('missing', { content: '事件', moodLevel: 3 })).rejects.toMatchObject({ code: 'MOOD_ENTRY_NOT_FOUND' })
  })

  it('turns not-found on delete into a typed business error', async () => {
    const { repository } = createRepository({ deleteMine: async () => false })
    await expect(new MoodEntryApplicationService(repository).deleteMine('missing')).rejects.toMatchObject({ code: 'MOOD_ENTRY_NOT_FOUND' })
  })

  it('lists range without validation', async () => {
    const { repository } = createRepository()
    const service = new MoodEntryApplicationService(repository)
    await expect(service.listRange('2026-08-01', '2026-08-31')).resolves.toEqual([entry])
  })
})
