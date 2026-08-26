import { describe, expect, it } from 'vitest'
import { BackupApplicationService } from '../packages/application/src/backup'
import type { BackupRepository, HomeAiCard, HomeAiCardBackupStore, HomeAiCardCache } from '@knowledge-base/contracts'

function stubRepository(): BackupRepository {
  return {
    async exportData() { return { items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [] } },
    async replaceData() { return undefined },
  }
}
function stubHomeAiCards(): HomeAiCardBackupStore & { cards: HomeAiCard[]; caches: HomeAiCardCache[] } {
  const cards: HomeAiCard[] = [{
    id: 'card-1', cardTitle: '本周复盘', aiPrompt: '总结我这一周的状态', cardSize: 'medium', cardTheme: 'cream', refreshMode: 'daily',
    sortIndex: 0, isHidden: false, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
  }]
  const caches: HomeAiCardCache[] = [{
    id: 'cache-1', cardId: 'card-1', cacheDate: '2026-08-25', aiOutput: '输出内容', createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
  }]
  return {
    cards,
    caches,
    async exportBackup() { return { cards, caches } },
    async replaceBackup(values) { cards.splice(0, cards.length, ...values.cards); caches.splice(0, caches.length, ...values.caches) },
  }
}

describe('backup V10 home ai cards', () => {
  it('exports version 10 with homeAiCards and homeAiCardCaches and restores them back', async () => {
    const store = stubHomeAiCards()
    const service = new BackupApplicationService(stubRepository(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, store)
    const backup = await service.createBackup()
    expect(backup.version).toBe(10)
    expect((backup as any).data.homeAiCards).toHaveLength(1)
    expect((backup as any).data.homeAiCardCaches).toHaveLength(1)
    const restored = new BackupApplicationService(stubRepository(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, store)
    const parsed = await restored.parseAndValidate(JSON.stringify(backup)) as any
    await restored.restoreBackup(parsed)
    expect(store.cards).toHaveLength(1)
    expect(store.caches).toHaveLength(1)
    expect(store.cards[0]).toMatchObject({ cardTitle: '本周复盘' })
    expect(store.caches[0]).toMatchObject({ cardId: 'card-1', cacheDate: '2026-08-25', aiOutput: '输出内容' })
  })

  it('restores legacy version 9 as empty home ai cards', async () => {
    const legacy = {
      format: 'knowledge-base-backup',
      version: 9,
      exportedAt: '2026-08-25T00:00:00.000Z',
      appVersion: '0.1.9',
      data: { items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [], dailyNotes: [], moodEntries: [], mealEntries: [], dailySummaries: [], dailyDietRecommendations: [] },
    }
    const store = stubHomeAiCards()
    const service = new BackupApplicationService(stubRepository(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, store)
    await service.restoreBackup(await service.parseAndValidate(JSON.stringify(legacy)))
    expect(store.cards).toHaveLength(0)
    expect(store.caches).toHaveLength(0)
  })

  it('rejects invalid card rows and orphan caches', async () => {
    const service = new BackupApplicationService(stubRepository(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, stubHomeAiCards())
    const base = stubHomeAiCards()
    const valid = await new BackupApplicationService(stubRepository(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, base).createBackup() as any
    await expect(() => service.parseAndValidate(JSON.stringify({ ...valid, data: { ...valid.data, homeAiCards: [{ ...valid.data.homeAiCards[0]!, cardSize: 'huge' }] } }))).toThrow('非法枚举值')
    await expect(() => service.parseAndValidate(JSON.stringify({ ...valid, data: { ...valid.data, homeAiCards: [{ ...valid.data.homeAiCards[0]!, cardTitle: '' }] } }))).toThrow('无效标题')
    await expect(() => service.parseAndValidate(JSON.stringify({ ...valid, data: { ...valid.data, homeAiCardCaches: [{ ...valid.data.homeAiCardCaches[0]!, cardId: 'missing-card' }] } }))).toThrow('引用无效')
    await expect(() => service.parseAndValidate(JSON.stringify({ ...valid, data: { ...valid.data, homeAiCardCaches: [valid.data.homeAiCardCaches[0], valid.data.homeAiCardCaches[0]] } }))).toThrow('重复缓存')
  })
})