import { describe, expect, it } from 'vitest'
import { BackupApplicationService } from '../packages/application/src/backup'
import type { BackupRepository, MealEntry, MealEntryBackupStore } from '@knowledge-base/contracts'

function stubRepository(): BackupRepository {
  return {
    async exportData() {
      return {
        items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [],
        itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [],
        dailyNotes: [], dailyNoteEntries: [], moodEntries: [], mealEntries: [], dailySummaries: [],
        dailyDietRecommendations: [], homeAiCards: [], homeAiCardCaches: [], sleepEntries: [], tasks: [],
      } as unknown as ReturnType<BackupRepository['exportData']> extends Promise<infer T> ? T : never
    },
    async replaceData() { return undefined },
  }
}

const meal: MealEntry = {
  id: 'meal-1', entryDate: '2026-11-24', mealType: 'lunch', content: '凉菜',
  createdAt: '2026-11-24T04:00:00.000Z', updatedAt: '2026-11-24T04:00:00.000Z',
}

function stubMeals(seed: MealEntry[] = []) {
  const meals = [...seed]
  const store: MealEntryBackupStore = {
    async exportBackup() { return meals },
    async replaceBackup(values) { meals.splice(0, meals.length, ...values) },
  }
  return { store, meals }
}

const service = (store: MealEntryBackupStore) =>
  new BackupApplicationService(stubRepository(), undefined, undefined, undefined, undefined, store)

const baseCollections = {
  items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [],
  itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [],
  dailyNotes: [], dailyNoteEntries: [], moodEntries: [], mealEntries: [], dailySummaries: [],
  dailyDietRecommendations: [], homeAiCards: [], homeAiCardCaches: [], sleepEntries: [], tasks: [],
}

describe('backup V15 meals', () => {
  it('exports version 15 with meals that no longer carry satiety', async () => {
    const backup = await service(stubMeals([meal]).store).createBackup()
    expect(backup.version).toBe(16)
    const exported = (backup as unknown as { data: { mealEntries: Array<Record<string, unknown>> } }).data.mealEntries
    expect(exported).toHaveLength(1)
    expect(exported[0]).not.toHaveProperty('feeling')
  })

  it('drops the satiety field when upgrading a V14 backup', () => {
    const legacy = {
      format: 'knowledge-base-backup', version: 14,
      exportedAt: '2026-11-24T00:00:00.000Z', appVersion: '0.3.17',
      data: { ...baseCollections, mealEntries: [{ ...meal, feeling: 7 }] },
    }
    const parsed = service(stubMeals().store).parseAndValidate(JSON.stringify(legacy))
    expect(parsed.version).toBe(16)
    const entries = (parsed as unknown as { data: { mealEntries: Array<Record<string, unknown>> } }).data.mealEntries
    expect(entries[0]).toMatchObject({ id: 'meal-1', content: '凉菜' })
    expect(entries[0]).not.toHaveProperty('feeling')
  })

  it('rejects a V15 meal entry without content', () => {
    const broken = {
      format: 'knowledge-base-backup', version: 15,
      exportedAt: '2026-11-24T00:00:00.000Z', appVersion: '0.4.0',
      data: { ...baseCollections, mealEntries: [{ ...meal, content: 42 }] },
    }
    expect(() => service(stubMeals().store).parseAndValidate(JSON.stringify(broken))).toThrow(/三餐记录/)
  })
})
