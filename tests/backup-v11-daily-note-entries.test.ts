import { describe, expect, it } from 'vitest'
import { BackupApplicationService } from '../packages/application/src/backup'
import type { BackupRepository, DailyNote, DailyNoteBackupStore, DailyNoteEntry } from '@knowledge-base/contracts'

function stubRepository(): BackupRepository {
  return {
    async exportData() { return { items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [] } },
    async replaceData() { return undefined },
  }
}

const note: DailyNote = { id: 'note-1', entryDate: '2026-10-17', content: '', createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:30:00.000Z' }

function stubDailyNotes(seedNotes: DailyNote[] = [], seedEntries: DailyNoteEntry[] = []) {
  const notes = [...seedNotes]
  const entries = [...seedEntries]
  let materialized = 0
  const store: DailyNoteBackupStore = {
    async exportBackup() { return notes },
    async exportEntryBackup() { return entries },
    async replaceBackup(values) { notes.splice(0, notes.length, ...values); entries.splice(0, entries.length) },
    async replaceEntryBackup(values) { entries.splice(0, entries.length, ...values) },
    async materializeLegacyContent() {
      materialized += 1
      for (const value of notes) {
        if (!value.content.trim()) continue
        if (entries.some(entry => entry.dailyNoteId === value.id)) continue
        entries.push({ id: `legacy-${value.id}`, dailyNoteId: value.id, entryDate: value.entryDate, recordedAt: value.createdAt, timePrecision: 'day', content: value.content, createdAt: value.createdAt, updatedAt: value.updatedAt })
      }
    },
  }
  return { store, notes, entries, materializedCount: () => materialized }
}

const entry: DailyNoteEntry = { id: 'entry-1', dailyNoteId: 'note-1', entryDate: '2026-10-17', recordedAt: '2026-10-17T06:23:00.000Z', timePrecision: 'minute', content: '开了周会', createdAt: '2026-10-17T06:23:00.000Z', updatedAt: '2026-10-17T06:23:00.000Z' }

describe('backup V11 daily note entries', () => {
  it('exports version 11 carrying entries and restores them', async () => {
    const { store, entries } = stubDailyNotes([note], [entry])
    const service = new BackupApplicationService(stubRepository(), undefined, undefined, store)
    const backup = await service.createBackup()
    expect(backup.version).toBe(11)
    expect((backup as any).data.dailyNoteEntries).toHaveLength(1)

    const restored = stubDailyNotes()
    const target = new BackupApplicationService(stubRepository(), undefined, undefined, restored.store)
    await target.restoreBackup(await target.parseAndValidate(JSON.stringify(backup)))
    expect(restored.notes).toHaveLength(1)
    expect(restored.entries).toHaveLength(1)
    expect(restored.entries[0]).toMatchObject({ content: '开了周会', timePrecision: 'minute' })
    expect(entries).toHaveLength(1)
  })

  it('restores a V10 backup by materializing its whole-day text into a day entry', async () => {
    const legacy = {
      format: 'knowledge-base-backup',
      version: 10,
      exportedAt: '2026-10-01T00:00:00.000Z',
      appVersion: '0.1.9',
      data: {
        items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [],
        dailyNotes: [{ id: 'note-old', entryDate: '2026-09-30', content: '14:23\n旧的一整天', createdAt: '2026-09-30T06:23:00.000Z', updatedAt: '2026-09-30T06:23:00.000Z' }],
        moodEntries: [], mealEntries: [], dailySummaries: [], dailyDietRecommendations: [], homeAiCards: [], homeAiCardCaches: [],
      },
    }
    const restored = stubDailyNotes()
    const target = new BackupApplicationService(stubRepository(), undefined, undefined, restored.store)
    await target.restoreBackup(await target.parseAndValidate(JSON.stringify(legacy)))
    expect(restored.notes).toHaveLength(1)
    expect(restored.entries).toHaveLength(1)
    // 文本逐字保留，不再由服务端拆分猜测。
    expect(restored.entries[0]).toMatchObject({ timePrecision: 'day', content: '14:23\n旧的一整天' })
    expect(restored.materializedCount()).toBe(1)
  })

  it('keeps existing daily notes when restoring a V10 backup that carries them', async () => {
    // 回归：旧实现按版本白名单传 []，恢复 V8+ 备份会清空 dailyNotes。
    const legacy = {
      format: 'knowledge-base-backup',
      version: 10,
      exportedAt: '2026-10-01T00:00:00.000Z',
      appVersion: '0.1.9',
      data: {
        items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [],
        dailyNotes: [{ id: 'note-keep', entryDate: '2026-09-29', content: '要保留的正文', createdAt: '2026-09-29T01:00:00.000Z', updatedAt: '2026-09-29T01:00:00.000Z' }],
        moodEntries: [], mealEntries: [], dailySummaries: [], dailyDietRecommendations: [], homeAiCards: [], homeAiCardCaches: [],
      },
    }
    const restored = stubDailyNotes([note])
    const target = new BackupApplicationService(stubRepository(), undefined, undefined, restored.store)
    await target.restoreBackup(await target.parseAndValidate(JSON.stringify(legacy)))
    expect(restored.notes.map(value => value.id)).toEqual(['note-keep'])
    expect(restored.entries[0]?.content).toBe('要保留的正文')
  })

  it('rejects an entry pointing at a missing daily note', async () => {
    const service = new BackupApplicationService(stubRepository(), undefined, undefined, stubDailyNotes().store)
    const broken = {
      format: 'knowledge-base-backup', version: 11, exportedAt: '2026-10-17T00:00:00.000Z', appVersion: '0.2.0',
      data: {
        items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [],
        dailyNotes: [], dailyNoteEntries: [entry],
        moodEntries: [], mealEntries: [], dailySummaries: [], dailyDietRecommendations: [], homeAiCards: [], homeAiCardCaches: [],
      },
    }
    // parseAndValidate 是同步方法：直接调用并捕获抛出的错误。
    let thrown: unknown
    try { service.parseAndValidate(JSON.stringify(broken)) } catch (error) { thrown = error }
    expect(thrown).toMatchObject({ code: 'INVALID_BACKUP' })
  })
})
