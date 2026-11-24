import { describe, expect, it } from 'vitest'
import { SleepNoteSyncService, parseSleepKeyword } from '@knowledge-base/application'
import type { SleepEntry } from '@knowledge-base/contracts'
import { DailyNoteApplicationService } from '@knowledge-base/application'
import type { DailyNote, DailyNoteRepository } from '@knowledge-base/contracts'

const note: DailyNote = { id: 'note-1', entryDate: '2026-11-24', content: '', createdAt: '2026-11-24T00:00:00.000Z', updatedAt: '2026-11-24T00:00:00.000Z' }

const sleepEntry = (values: Partial<SleepEntry>): SleepEntry => ({
  id: 'sleep-1', sleepDate: '2026-11-24',
  createdAt: '2026-11-24T00:00:00.000Z', updatedAt: '2026-11-24T00:00:00.000Z',
  ...values,
})

function sleepStore(existing: SleepEntry[] = []) {
  const saves: Array<[string, { wakeAt?: string; bedAt?: string }]> = []
  return {
    saves,
    store: {
      listRange: async () => existing,
      save: async (sleepDate: string, patch: { wakeAt?: string; bedAt?: string }) => {
        saves.push([sleepDate, patch])
        return { deleted: false }
      },
    },
  }
}

// 全用东八区时间，和线上判定一致。
const at = (iso: string) => new Date(iso).toISOString()

describe('parseSleepKeyword', () => {
  it('recognises wake and bed keywords', () => {
    expect(parseSleepKeyword('起床')).toBe('wake')
    expect(parseSleepKeyword('现在睡觉')).toBe('bed')
  })

  it('ignores text without a keyword or with both', () => {
    expect(parseSleepKeyword('出门盒马买吃的')).toBeUndefined()
    expect(parseSleepKeyword('起床后又要睡觉')).toBeUndefined()
  })
})

describe('SleepNoteSyncService', () => {
  it('writes the earliest wake of the day', async () => {
    const first = sleepStore()
    await new SleepNoteSyncService(first.store).syncFromNote('起床', at('2026-11-24T04:00:00+08:00'))
    expect(first.saves).toEqual([['2026-11-24', { wakeAt: at('2026-11-24T04:00:00+08:00') }]])

    const earlier = sleepStore([sleepEntry({ wakeAt: at('2026-11-24T04:00:00+08:00') })])
    await new SleepNoteSyncService(earlier.store).syncFromNote('起床', at('2026-11-24T03:10:00+08:00'))
    expect(earlier.saves).toHaveLength(1)
    expect(earlier.saves[0]![1].wakeAt).toBe(at('2026-11-24T03:10:00+08:00'))
  })

  it('does not let a later wake overwrite the earlier one', async () => {
    const { saves, store } = sleepStore([sleepEntry({ wakeAt: at('2026-11-24T04:00:00+08:00') })])
    await new SleepNoteSyncService(store).syncFromNote('起床', at('2026-11-24T05:00:00+08:00'))
    expect(saves).toHaveLength(0)
  })

  it('ignores wakes before 03:00', async () => {
    const { saves, store } = sleepStore()
    await new SleepNoteSyncService(store).syncFromNote('起床', at('2026-11-24T02:30:00+08:00'))
    expect(saves).toHaveLength(0)
  })

  it('writes the latest bedtime inside 20:00–next 12:00', async () => {
    const evening = sleepStore()
    await new SleepNoteSyncService(evening.store).syncFromNote('睡觉', at('2026-11-24T23:30:00+08:00'))
    expect(evening.saves).toEqual([['2026-11-24', { bedAt: at('2026-11-24T23:30:00+08:00') }]])

    const later = sleepStore([sleepEntry({ bedAt: at('2026-11-24T21:00:00+08:00') })])
    await new SleepNoteSyncService(later.store).syncFromNote('睡觉', at('2026-11-24T23:30:00+08:00'))
    expect(later.saves[0]![1].bedAt).toBe(at('2026-11-24T23:30:00+08:00'))

    const afterMidnight = sleepStore([sleepEntry({ bedAt: at('2026-11-24T23:30:00+08:00') })])
    await new SleepNoteSyncService(afterMidnight.store).syncFromNote('睡觉', at('2026-11-25T01:30:00+08:00'))
    expect(afterMidnight.saves[0]![0]).toBe('2026-11-24')
  })

  it('does not let an earlier bedtime overwrite the later one', async () => {
    const { saves, store } = sleepStore([sleepEntry({ bedAt: at('2026-11-24T23:30:00+08:00') })])
    await new SleepNoteSyncService(store).syncFromNote('睡觉', at('2026-11-24T21:00:00+08:00'))
    expect(saves).toHaveLength(0)
  })

  it('ignores bedtimes between 12:00 and 20:00', async () => {
    const { saves, store } = sleepStore()
    await new SleepNoteSyncService(store).syncFromNote('睡觉', at('2026-11-24T15:00:00+08:00'))
    expect(saves).toHaveLength(0)
  })
})

function repository(overrides: Partial<DailyNoteRepository> = {}): DailyNoteRepository {
  return {
    getToday: async () => undefined,
    getOrCreateToday: async () => note,
    getOrCreateByDate: async date => ({ ...note, entryDate: date }),
    listMine: async () => [],
    updateMine: async () => undefined,
    appendToday: async () => note,
    getMine: async () => note,
    setAiConversationId: async () => undefined,
    listActionFactsForDate: async () => [],
    listEntries: async () => [],
    getMineWithEntries: async () => undefined,
    createEntry: async (_id, input) => ({
      id: 'entry-1', dailyNoteId: 'note-1', entryDate: '2026-11-24',
      recordedAt: input.recordedAt ?? at('2026-11-24T04:00:00+08:00'),
      timePrecision: 'minute', content: input.content,
      createdAt: '2026-11-24T04:00:00.000Z', updatedAt: '2026-11-24T04:00:00.000Z',
    }),
    updateEntry: async () => undefined,
    deleteEntry: async () => true,
    clearEntries: async () => true,
    exportEntryBackup: async () => [],
    materializeLegacyContent: async () => undefined,
    ...overrides,
  }
}

describe('daily note entry → sleep', () => {
  it('syncs the entry time when the note says 起床', async () => {
    const calls: Array<[string, string]> = []
    const sleepSync = { syncFromNote: async (content: string, recordedAt: string) => { calls.push([content, recordedAt]) } }
    const service = new DailyNoteApplicationService(repository(), undefined, undefined, sleepSync)
    await service.createEntry('note-1', { content: '起床', recordedAt: at('2026-11-24T04:00:00+08:00') })
    expect(calls).toEqual([['起床', at('2026-11-24T04:00:00+08:00')]])
  })

  it('still saves the entry when sleep sync fails', async () => {
    const service = new DailyNoteApplicationService(repository(), undefined, undefined, {
      syncFromNote: async () => { throw new Error('sleep down') },
    })
    await expect(service.createEntry('note-1', { content: '起床' })).resolves.toMatchObject({ id: 'entry-1' })
  })

  it('syncs the quick-record path as well', async () => {
    const calls: Array<[string, string]> = []
    const service = new DailyNoteApplicationService(
      repository({ appendToday: async () => note }),
      undefined,
      undefined,
      { syncFromNote: async (content: string, recordedAt: string) => { calls.push([content, recordedAt]) } },
    )
    await service.appendToday('睡觉')
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]).toBe('睡觉')
  })
})
