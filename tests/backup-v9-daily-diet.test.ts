import { describe, expect, it } from 'vitest'
import { BackupApplicationService } from '../packages/application/src/backup'
import type { BackupRepository, DailyDietRecommendation, DailyDietRecommendationBackupStore, DailySummaryBackupStore, MealEntryBackupStore, MoodEntryBackupStore, DailyNoteBackupStore, AiConversationBackupStore, AiPreferenceBackupStore } from '@knowledge-base/contracts'

function stubRepository(): BackupRepository {
  return {
    async exportData() { return { items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [] } },
    async replaceData() { return undefined },
  }
}
function stubDiet(): DailyDietRecommendationBackupStore & { rows: DailyDietRecommendation[] } {
  const rows: DailyDietRecommendation[] = [{ id: 'd1', entryDate: '2026-08-24', content: '推荐内容', createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z' }]
  return { rows, async exportBackup() { return rows }, async replaceBackup(values) { rows.splice(0, rows.length, ...values) } }
}

describe('backup V9 daily diet recommendations', () => {
  it('exports version 9 with dailyDietRecommendations and restores them back', async () => {
    const diet = stubDiet()
    const service = new BackupApplicationService(stubRepository(), undefined, undefined, undefined, undefined, undefined, undefined, diet)
    const backup = await service.createBackup()
    expect(backup.version).toBe(9)
    expect((backup as any).data.dailyDietRecommendations).toHaveLength(1)
    const restored = new BackupApplicationService(stubRepository(), undefined, undefined, undefined, undefined, undefined, undefined, diet)
    const parsed = await restored.parseAndValidate(JSON.stringify(backup)) as any
    await restored.restoreBackup(parsed)
    expect(diet.rows).toHaveLength(1)
    expect(diet.rows[0]).toMatchObject({ entryDate: '2026-08-24', content: '推荐内容' })
  })

  it('restores legacy version 8 as empty dailyDietRecommendations', async () => {
    const legacy = {
      format: 'knowledge-base-backup',
      version: 8,
      exportedAt: '2026-08-24T00:00:00.000Z',
      appVersion: '0.1.8',
      data: { items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [], dailyNotes: [], moodEntries: [], mealEntries: [], dailySummaries: [] },
    }
    const diet = stubDiet()
    const service = new BackupApplicationService(stubRepository(), undefined, undefined, undefined, undefined, undefined, undefined, diet)
    await service.restoreBackup(await service.parseAndValidate(JSON.stringify(legacy)))
    expect(diet.rows).toHaveLength(0)
  })
})
