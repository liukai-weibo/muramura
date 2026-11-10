import { describe, expect, it } from 'vitest'
import { BackupApplicationService } from '../packages/application/src/backup'
import type { BackupRepository, SleepBackupStore, SleepEntry } from '@knowledge-base/contracts'

function stubRepository(): BackupRepository {
  return {
    async exportData() { return { items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [] } },
    async replaceData() { return undefined },
  }
}

const sleep: SleepEntry = {
  id: 'sleep-1',
  sleepDate: '2026-11-09',
  wakeAt: '2026-11-08T23:10:00.000Z', // 11-09 07:10
  bedAt: '2026-11-09T15:40:00.000Z', // 11-09 23:40
  note: '还行',
  createdAt: '2026-11-09T16:00:00.000Z',
  updatedAt: '2026-11-09T16:00:00.000Z',
}

function stubSleep(seed: SleepEntry[] = []) {
  const entries = [...seed]
  const store: SleepBackupStore = {
    async exportBackup() { return entries },
    async replaceBackup(values) { entries.splice(0, entries.length, ...values) },
  }
  return { store, entries }
}

const buildService = (store: SleepBackupStore) =>
  new BackupApplicationService(stubRepository(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, store)

const documentWith = (version: number, sleepEntries: unknown[]) => ({
  format: 'knowledge-base-backup',
  version,
  exportedAt: '2026-11-09T02:00:00.000Z',
  appVersion: '0.2.0',
  data: {
    items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [],
    itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [],
    dailyNotes: [], dailyNoteEntries: [], moodEntries: [], mealEntries: [], dailySummaries: [],
    dailyDietRecommendations: [], homeAiCards: [], homeAiCardCaches: [], sleepEntries,
  },
})

describe('backup V13 sleep semantics', () => {
  it('exports version 13 carrying the new per-day shape', async () => {
    const backup = await buildService(stubSleep([sleep]).store).createBackup()
    expect(backup.version).toBe(13)
    expect((backup as { data: { sleepEntries: SleepEntry[] } }).data.sleepEntries).toHaveLength(1)
  })

  it('restores V13 entries as-is', async () => {
    const backup = await buildService(stubSleep([sleep]).store).createBackup()
    const target = stubSleep()
    const service = buildService(target.store)
    await service.restoreBackup(await service.parseAndValidate(JSON.stringify(backup)))
    expect(target.entries[0]).toMatchObject({ sleepDate: '2026-11-09', wakeAt: sleep.wakeAt, bedAt: sleep.bedAt })
  })

  it('converts a V12 cross-day entry into a wake row and a bedtime row', () => {
    // V12：sleep_date=11-09 = 11-08 晚 + 11-09 早。
    const legacy = documentWith(12, [{
      id: 'old-1', sleepDate: '2026-11-09',
      bedAt: '2026-11-08T15:40:00.000Z',
      wakeAt: '2026-11-08T23:10:00.000Z',
      note: '旧备注',
      createdAt: '2026-11-09T01:00:00.000Z', updatedAt: '2026-11-09T01:00:00.000Z',
    }])
    const service = buildService(stubSleep().store)
    const parsed = service.parseAndValidate(JSON.stringify(legacy))
    expect(parsed.version).toBe(13)
    const entries = (parsed as { data: { sleepEntries: SleepEntry[] } }).data.sleepEntries
    expect(entries.map(entry => entry.sleepDate)).toEqual(['2026-11-08', '2026-11-09'])
    expect(entries[0]).toMatchObject({ sleepDate: '2026-11-08', bedAt: '2026-11-08T15:40:00.000Z' })
    expect(entries[0]!.wakeAt).toBeUndefined()
    expect(entries[1]).toMatchObject({ sleepDate: '2026-11-09', wakeAt: '2026-11-08T23:10:00.000Z', note: '旧备注' })
  })

  it('merges a V12 bedtime that belongs to the same new-model day as a wake row', () => {
    // V12：11-09 的起床 + 11-10 的入睡（其实是 11-09 晚上）→ 合并成 11-09 的完整一天。
    const legacy = documentWith(12, [
      { id: 'day-09', sleepDate: '2026-11-09', bedAt: '2026-11-08T15:40:00.000Z', wakeAt: '2026-11-08T23:10:00.000Z', createdAt: '2026-11-09T01:00:00.000Z', updatedAt: '2026-11-09T01:00:00.000Z' },
      { id: 'day-10', sleepDate: '2026-11-10', bedAt: '2026-11-09T15:40:00.000Z', wakeAt: '2026-11-09T23:00:00.000Z', createdAt: '2026-11-10T01:00:00.000Z', updatedAt: '2026-11-10T01:00:00.000Z' },
    ])
    const parsed = buildService(stubSleep().store).parseAndValidate(JSON.stringify(legacy))
    const entries = (parsed as { data: { sleepEntries: SleepEntry[] } }).data.sleepEntries
    expect(entries).toHaveLength(3)
    expect(entries.find(entry => entry.sleepDate === '2026-11-09')).toMatchObject({
      sleepDate: '2026-11-09',
      wakeAt: '2026-11-08T23:10:00.000Z',
      bedAt: '2026-11-09T15:40:00.000Z',
    })
  })

  it('rejects invalid V13 rows', () => {
    const service = buildService(stubSleep().store)
    const sameDayMorningBed = documentWith(13, [{ ...sleep, bedAt: '2026-11-08T15:40:00.000Z' }])
    let thrown: unknown
    try { service.parseAndValidate(JSON.stringify(sameDayMorningBed)) } catch (error) { thrown = error }
    expect(thrown).toMatchObject({ code: 'INVALID_BACKUP' })

    const empty = documentWith(13, [{ ...sleep, wakeAt: undefined, bedAt: undefined }])
    let emptyError: unknown
    try { service.parseAndValidate(JSON.stringify(empty)) } catch (error) { emptyError = error }
    expect(emptyError).toMatchObject({ code: 'INVALID_BACKUP' })

    const duplicate = documentWith(13, [sleep, { ...sleep, id: 'sleep-2' }])
    let duplicateError: unknown
    try { service.parseAndValidate(JSON.stringify(duplicate)) } catch (error) { duplicateError = error }
    expect(duplicateError).toMatchObject({ code: 'INVALID_BACKUP' })
  })

  it('rejects a wake time that is not after the previous bedtime', () => {
    const service = buildService(stubSleep().store)
    const broken = documentWith(13, [
      {
        id: 'bed-07', sleepDate: '2026-11-07', bedAt: '2026-11-07T22:00:00.000Z',
        createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z',
      },
      {
        id: 'wake-08', sleepDate: '2026-11-08', wakeAt: '2026-11-07T21:00:00.000Z',
        createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z',
      },
    ])
    let thrown: unknown
    try { service.parseAndValidate(JSON.stringify(broken)) } catch (error) { thrown = error }
    expect(thrown).toMatchObject({ code: 'INVALID_BACKUP' })
  })

  it('restoring a V11 backup leaves sleep empty instead of failing', async () => {
    const legacy = {
      format: 'knowledge-base-backup', version: 11, exportedAt: '2026-11-01T00:00:00.000Z', appVersion: '0.2.0',
      data: {
        items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [],
        itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [],
        dailyNotes: [], dailyNoteEntries: [], moodEntries: [], mealEntries: [], dailySummaries: [],
        dailyDietRecommendations: [], homeAiCards: [], homeAiCardCaches: [],
      },
    }
    const target = stubSleep([sleep])
    const service = buildService(target.store)
    await service.restoreBackup(await service.parseAndValidate(JSON.stringify(legacy)))
    expect(target.entries).toEqual([])
  })
})
