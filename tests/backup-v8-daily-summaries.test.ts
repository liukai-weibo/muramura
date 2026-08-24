import { describe, expect, it } from 'vitest'
import { BackupApplicationService } from '../packages/application/src/backup'
import type { BackupRepository, DailySummary, DailySummaryBackupStore, MealEntryBackupStore, MoodEntryBackupStore, DailyNoteBackupStore, AiConversationBackupStore, AiPreferenceBackupStore } from '@knowledge-base/contracts'

function stubRepository(): BackupRepository {
  return {
    async exportData() { return { items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [] } },
    async replaceData() { return undefined },
  }
}
function stubSummaries(): DailySummaryBackupStore & { rows: DailySummary[] } {
  const rows: DailySummary[] = [{ id: 's1', entryDate: '2026-08-24', content: '小结内容', createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z' }]
  return { rows, async exportBackup() { return rows }, async replaceBackup(values) { rows.splice(0, rows.length, ...values) } }
}

describe('backup V8 daily summaries', () => {
  it('exports version 8 with dailySummaries and restores them back', async () => {
    const summaries = stubSummaries()
    const service = new BackupApplicationService(stubRepository(), undefined, undefined, undefined, undefined, undefined, summaries)
    const backup = await service.createBackup()
    expect(backup.version).toBe(8)
    expect((backup as any).data.dailySummaries).toHaveLength(1)
    const restored = new BackupApplicationService(stubRepository(), undefined, undefined, undefined, undefined, undefined, summaries)
    const parsed = await restored.parseAndValidate(JSON.stringify(backup)) as any
    await restored.restoreBackup(parsed)
    expect(summaries.rows).toHaveLength(1)
    expect(summaries.rows[0]).toMatchObject({ entryDate: '2026-08-24', content: '小结内容' })
  })

  it('restores legacy version 7 as empty dailySummaries', async () => {
    const legacy = {
      format: 'knowledge-base-backup',
      version: 7,
      exportedAt: '2026-08-24T00:00:00.000Z',
      appVersion: '0.1.7',
      data: { items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [], dailyNotes: [], moodEntries: [], mealEntries: [] },
    }
    const summaries = stubSummaries()
    const service = new BackupApplicationService(stubRepository(), undefined, undefined, undefined, undefined, undefined, summaries)
    await service.restoreBackup(await service.parseAndValidate(JSON.stringify(legacy)))
    expect(summaries.rows).toHaveLength(0)
  })
})
