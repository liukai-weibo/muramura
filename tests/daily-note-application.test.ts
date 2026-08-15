import { describe, expect, it } from 'vitest'
import { DailyNoteApplicationService } from '@knowledge-base/application'
import type { DailyNote, DailyNoteRepository } from '@knowledge-base/contracts'

const note: DailyNote = { id: 'note-1', entryDate: '2026-08-12', content: '', createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z' }

describe('daily note application', () => {
  it('reads today without creating a note', async () => {
    let created = false
    const repository: DailyNoteRepository = { getToday: async () => undefined, getOrCreateToday: async () => { created = true; return note }, listMine: async () => [], updateMine: async () => undefined, appendToday: async () => note, getMine: async () => undefined, setAiConversationId: async () => undefined, listActionFactsForDate: async () => [] }
    await expect(new DailyNoteApplicationService(repository).getToday()).resolves.toBeUndefined()
    expect(created).toBe(false)
  })

  it('rejects blank quick notes before writing', async () => {
    let appended = false
    const repository: DailyNoteRepository = { getToday: async () => undefined, getOrCreateToday: async () => note, listMine: async () => [], updateMine: async () => undefined, appendToday: async () => { appended = true; return note }, getMine: async () => undefined, setAiConversationId: async () => undefined, listActionFactsForDate: async () => [] }
    await expect(new DailyNoteApplicationService(repository).appendToday('   ')).rejects.toMatchObject({ code: 'DAILY_NOTE_INVALID' })
    expect(appended).toBe(false)
  })
})
