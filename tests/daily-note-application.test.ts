import { describe, expect, it } from 'vitest'
import { DailyNoteApplicationService } from '@knowledge-base/application'
import type { DailyNote, DailyNoteEntry, DailyNoteRepository } from '@knowledge-base/contracts'

const note: DailyNote = { id: 'note-1', entryDate: '2026-08-12', content: '', createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z' }
const entry: DailyNoteEntry = { id: 'entry-1', dailyNoteId: 'note-1', entryDate: '2026-08-12', recordedAt: '2026-08-12T06:23:00.000Z', timePrecision: 'minute', content: '记录', createdAt: '2026-08-12T06:23:00.000Z', updatedAt: '2026-08-12T06:23:00.000Z' }
/** 东八区「今天」，用例里按需覆盖。 */
const shanghaiToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

function repository(overrides: Partial<DailyNoteRepository> = {}): DailyNoteRepository {
  return {
    getToday: async () => undefined,
    getOrCreateToday: async () => note,
    getOrCreateByDate: async date => ({ ...note, entryDate: date }),
    listMine: async () => [],
    updateMine: async () => undefined,
    appendToday: async () => note,
    getMine: async () => undefined,
    setAiConversationId: async () => undefined,
    listActionFactsForDate: async () => [],
    listEntries: async () => [],
    getMineWithEntries: async () => undefined,
    createEntry: async () => entry,
    updateEntry: async () => entry,
    deleteEntry: async () => true,
    clearEntries: async () => true,
    exportEntryBackup: async () => [],
    materializeLegacyContent: async () => undefined,
    ...overrides,
  }
}

describe('daily note application', () => {
  it('reads today without creating a note', async () => {
    let created = false
    const service = new DailyNoteApplicationService(repository({ getOrCreateToday: async () => { created = true; return note } }))
    await expect(service.getToday()).resolves.toBeUndefined()
    expect(created).toBe(false)
  })

  it('rejects blank quick notes before writing', async () => {
    let appended = false
    const service = new DailyNoteApplicationService(repository({ appendToday: async () => { appended = true; return note } }))
    await expect(service.appendToday('   ')).rejects.toMatchObject({ code: 'DAILY_NOTE_INVALID' })
    expect(appended).toBe(false)
  })

  it('rejects blank entry content before writing', async () => {
    let created = false
    const service = new DailyNoteApplicationService(repository({ getMine: async () => note, createEntry: async () => { created = true; return entry } }))
    await expect(service.createEntry('note-1', { content: '   ' })).rejects.toMatchObject({ code: 'DAILY_NOTE_INVALID' })
    expect(created).toBe(false)
  })

  it('accepts a same-day clock time and passes it through', async () => {
    const seen: Array<string | undefined> = []
    const service = new DailyNoteApplicationService(repository({
      getMine: async () => note,
      createEntry: async (_id, input) => { seen.push(input.recordedAt); return entry },
    }))
    await expect(service.createEntry('note-1', { content: '补记', recordedAt: '14:23' })).resolves.toMatchObject({ id: 'entry-1' })
    expect(seen).toEqual(['14:23'])
  })

  it('rejects creating an entry whose Shanghai date is another day', async () => {
    const service = new DailyNoteApplicationService(repository({ getMine: async () => note }))
    // 2026-08-13 01:00 东八区 → 属于 08-13，不属于 08-12
    await expect(service.createEntry('note-1', { content: '跨天', recordedAt: '2026-08-12T17:00:00.000Z' }))
      .rejects.toMatchObject({ code: 'DAILY_NOTE_INVALID' })
  })

  it('rejects a malformed clock time', async () => {
    const service = new DailyNoteApplicationService(repository({ getMine: async () => note }))
    await expect(service.createEntry('note-1', { content: '时间无效', recordedAt: '25:99' }))
      .rejects.toMatchObject({ code: 'DAILY_NOTE_INVALID' })
  })

  it('lets an update move the entry to another day', async () => {
    const seen: Array<string | undefined> = []
    const service = new DailyNoteApplicationService(repository({
      getMine: async () => note,
      updateEntry: async (_id, _entryId, input) => { seen.push(input.recordedAt); return { ...entry, entryDate: '2026-08-13', dailyNoteId: 'note-2' } },
    }))
    const moved = await service.updateEntry('note-1', 'entry-1', { content: '搬到明天', recordedAt: '2026-08-12T17:00:00.000Z' })
    expect(seen).toEqual(['2026-08-12T17:00:00.000Z'])
    expect(moved).toMatchObject({ entryDate: '2026-08-13', dailyNoteId: 'note-2' })
  })

  it('rejects moving with an unparseable timestamp', async () => {
    const service = new DailyNoteApplicationService(repository({ getMine: async () => note }))
    await expect(service.updateEntry('note-1', 'entry-1', { content: '坏了', recordedAt: 'yesterday-ish' }))
      .rejects.toMatchObject({ code: 'DAILY_NOTE_INVALID' })
  })
})

describe('daily note by date', () => {
  it('creates or returns the note of a past day', async () => {
    const asked: string[] = []
    const service = new DailyNoteApplicationService(repository({ getOrCreateByDate: async date => { asked.push(date); return { ...note, entryDate: date } } }))
    await expect(service.getOrCreateByDate('2026-08-01')).resolves.toMatchObject({ entryDate: '2026-08-01' })
    expect(asked).toEqual(['2026-08-01'])
  })

  it('rejects a future day, a malformed date and an impossible day', async () => {
    let asked = 0
    const service = new DailyNoteApplicationService(repository({ getOrCreateByDate: async date => { asked += 1; return { ...note, entryDate: date } } }))
    await expect(service.getOrCreateByDate('2999-01-01')).rejects.toMatchObject({ code: 'DAILY_NOTE_INVALID' })
    await expect(service.getOrCreateByDate('2026-8-1')).rejects.toMatchObject({ code: 'DAILY_NOTE_INVALID' })
    await expect(service.getOrCreateByDate('2026-02-30')).rejects.toMatchObject({ code: 'DAILY_NOTE_INVALID' })
    await expect(service.getOrCreateByDate('1999-12-31')).rejects.toMatchObject({ code: 'DAILY_NOTE_INVALID' })
    expect(asked).toBe(0)
  })

  it('allows today', async () => {
    const service = new DailyNoteApplicationService(repository())
    await expect(service.getOrCreateByDate(shanghaiToday)).resolves.toMatchObject({ entryDate: shanghaiToday })
  })
})
