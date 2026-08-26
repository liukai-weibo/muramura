import { describe, expect, it } from 'vitest'
import { HomeAiCardApplicationService } from '../packages/application/src/home-ai-cards'
import type { HomeAiCard, HomeAiCardCache, HomeAiCardInput, HomeAiCardRepository } from '@knowledge-base/contracts'

function inMemoryRepository(): HomeAiCardRepository & { rows: Map<string, HomeAiCard>; caches: HomeAiCardCache[] } {
  const rows = new Map<string, HomeAiCard>()
  const caches: HomeAiCardCache[] = []
  return {
    rows,
    caches,
    async list(): Promise<HomeAiCard[]> { return [...rows.values()].sort((a, b) => a.sortIndex - b.sortIndex) },
    async get(id: string): Promise<HomeAiCard | undefined> { return rows.get(id) },
    async create(input: HomeAiCardInput): Promise<HomeAiCard> {
      const id = 'card-' + (rows.size + 1)
      const max = [...rows.values()].reduce((acc, card) => Math.max(acc, card.sortIndex), -1)
      const card: HomeAiCard = { id, ...input, sortIndex: max + 1, isHidden: false, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z' }
      rows.set(id, card)
      return card
    },
    async update(id: string, input: HomeAiCardInput): Promise<HomeAiCard | undefined> {
      const existing = rows.get(id)
      if (!existing) return undefined
      const updated = { ...existing, ...input, updatedAt: '2026-08-25T01:00:00.000Z' }
      rows.set(id, updated)
      return updated
    },
    async delete(id: string): Promise<boolean> {
      rows.delete(id)
      for (let index = caches.length - 1; index >= 0; index -= 1) { if (caches[index]!.cardId === id) caches.splice(index, 1) }
      return true
    },
    async listCaches(cacheDate: string): Promise<HomeAiCardCache[]> { return caches.filter(cache => cache.cacheDate === cacheDate) },
    async getCache(cardId: string, cacheDate: string): Promise<HomeAiCardCache | undefined> { return caches.find(cache => cache.cardId === cardId && cache.cacheDate === cacheDate) },
    async upsertCache(cardId: string, cache: { cacheDate: string; aiOutput: string }): Promise<HomeAiCardCache> {
      const existingIndex = caches.findIndex(entry => entry.cardId === cardId && entry.cacheDate === cache.cacheDate)
      const value: HomeAiCardCache = { id: 'cache-1', cardId, cacheDate: cache.cacheDate, aiOutput: cache.aiOutput, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z' }
      if (existingIndex >= 0) caches[existingIndex] = value
      else caches.push(value)
      return value
    },
  }
}

const validInput: HomeAiCardInput = { cardTitle: '本周复盘', aiPrompt: '总结我这一周的状态', cardSize: 'medium', cardTheme: 'cream', refreshMode: 'daily' }

describe('home ai card application service', () => {
  it('creates cards with incrementing sort index and lists by sort order', async () => {
    const repository = inMemoryRepository()
    const service = new HomeAiCardApplicationService(repository)
    const first = await service.create({ ...validInput, cardTitle: 'A' })
    const second = await service.create({ ...validInput, cardTitle: 'B', cardSize: 'large' })
    expect(first.sortIndex).toBe(0)
    expect(second.sortIndex).toBe(1)
    expect(await service.list()).toMatchObject([{ cardTitle: 'A' }, { cardTitle: 'B' }])
  })

  it('updates an existing card and returns undefined for a missing one', async () => {
    const repository = inMemoryRepository()
    const service = new HomeAiCardApplicationService(repository)
    const created = await service.create(validInput)
    const updated = await service.update(created.id, { ...validInput, cardTitle: '改后标题', refreshMode: 'manual' })
    expect(updated).toMatchObject({ cardTitle: '改后标题', refreshMode: 'manual' })
    expect(await service.update('missing', validInput)).toBeUndefined()
  })

  it('deletes a card and its caches', async () => {
    const repository = inMemoryRepository()
    const service = new HomeAiCardApplicationService(repository)
    const card = await service.create(validInput)
    await service.upsertCache(card.id, '2026-08-25', '输出内容')
    expect(await service.delete(card.id)).toBe(true)
    expect(await service.list()).toHaveLength(0)
    expect(await service.listCaches('2026-08-25')).toHaveLength(0)
  })

  it('rejects invalid inputs', async () => {
    const service = new HomeAiCardApplicationService(inMemoryRepository())
    await expect(service.create({ ...validInput, cardTitle: '   ' })).rejects.toMatchObject({ code: 'HOME_AI_CARD_INVALID' })
    await expect(service.create({ ...validInput, aiPrompt: '' })).rejects.toMatchObject({ code: 'HOME_AI_CARD_INVALID' })
    await expect(service.create({ ...validInput, cardTitle: 'x'.repeat(51) })).rejects.toMatchObject({ code: 'HOME_AI_CARD_INVALID' })
    await expect(service.create({ ...validInput, aiPrompt: 'x'.repeat(2001) })).rejects.toMatchObject({ code: 'HOME_AI_CARD_INVALID' })
    await expect(service.create({ ...validInput, cardSize: 'huge' as never })).rejects.toMatchObject({ code: 'HOME_AI_CARD_INVALID' })
    await expect(service.create({ ...validInput, cardTheme: 'purple' as never })).rejects.toMatchObject({ code: 'HOME_AI_CARD_INVALID' })
    await expect(service.create({ ...validInput, refreshMode: 'hourly' as never })).rejects.toMatchObject({ code: 'HOME_AI_CARD_INVALID' })
  })

  it('rejects over-length and future caches', async () => {
    const repository = inMemoryRepository()
    const service = new HomeAiCardApplicationService(repository)
    const card = await service.create(validInput)
    await expect(service.upsertCache(card.id, '2026/08/25', 'x')).rejects.toMatchObject({ code: 'HOME_AI_CARD_CACHE_INVALID' })
    await expect(service.upsertCache(card.id, '2026-08-25', '   ')).rejects.toMatchObject({ code: 'HOME_AI_CARD_CACHE_INVALID' })
    await expect(service.upsertCache(card.id, '2026-08-25', 'x'.repeat(4001))).rejects.toMatchObject({ code: 'HOME_AI_CARD_CACHE_INVALID' })
    const now = new Date()
    const future = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate() + 5).padStart(2, '0')
    await expect(service.upsertCache(card.id, future, 'x')).rejects.toMatchObject({ code: 'HOME_AI_CARD_CACHE_INVALID' })
  })

  it('keeps different dates separate and upserts same card+date', async () => {
    const repository = inMemoryRepository()
    const service = new HomeAiCardApplicationService(repository)
    const card = await service.create(validInput)
    await service.upsertCache(card.id, '2026-08-24', '第一天')
    const second = await service.upsertCache(card.id, '2026-08-24', '更新')
    expect(second.aiOutput).toBe('更新')
    await service.upsertCache(card.id, '2026-08-25', '第二天')
    expect(await service.listCaches('2026-08-24')).toHaveLength(1)
    expect(await service.listCaches('2026-08-25')).toHaveLength(1)
  })

  it('rejects creating beyond the per-user card limit', async () => {
    const repository = inMemoryRepository()
    const service = new HomeAiCardApplicationService(repository)
    for (let index = 0; index < 12; index += 1) await service.create({ ...validInput, cardTitle: '卡' + index })
    await expect(service.create(validInput)).rejects.toMatchObject({ code: 'HOME_AI_CARD_INVALID' })
  })
})