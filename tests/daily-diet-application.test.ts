import { describe, expect, it } from 'vitest'
import { DailyDietRecommendationApplicationService } from '../packages/application/src/daily-diet'
import type { DailyDietRecommendation, DailyDietRecommendationInput, DailyDietRecommendationRepository } from '@knowledge-base/contracts'

function inMemoryRepository(): DailyDietRecommendationRepository & { rows: Map<string, DailyDietRecommendation> } {
  const rows = new Map<string, DailyDietRecommendation>()
  return {
    rows,
    async listRange(from?: string, to?: string): Promise<DailyDietRecommendation[]> {
      let list = [...rows.values()].sort((a, b) => a.entryDate.localeCompare(b.entryDate))
      if (from) list = list.filter(entry => entry.entryDate >= from)
      if (to) list = list.filter(entry => entry.entryDate <= to)
      return list
    },
    async getByDate(entryDate: string): Promise<DailyDietRecommendation | undefined> {
      return rows.get(entryDate)
    },
    async upsertForDate(input: DailyDietRecommendationInput): Promise<DailyDietRecommendation> {
      const existing = rows.get(input.entryDate)
      const rec: DailyDietRecommendation = {
        id: existing?.id ?? 'diet-1',
        entryDate: input.entryDate,
        content: input.content,
        createdAt: existing?.createdAt ?? '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-08-20T01:00:00.000Z',
      }
      rows.set(input.entryDate, rec)
      return rec
    },
  }
}

describe('daily diet recommendation application service', () => {
  it('upserts same date keeping the latest content', async () => {
    const repository = inMemoryRepository()
    const service = new DailyDietRecommendationApplicationService(repository)
    const first = await service.upsertForDate({ entryDate: '2026-08-20', content: '第一条推荐' })
    const second = await service.upsertForDate({ entryDate: '2026-08-20', content: '更新的推荐' })
    expect(first.id).toBe(second.id)
    expect(second.content).toBe('更新的推荐')
    expect(await service.getByDate('2026-08-20')).toMatchObject({ entryDate: '2026-08-20', content: '更新的推荐' })
    expect(repository.rows.size).toBe(1)
  })

  it('keeps different dates separate and filters by range', async () => {
    const repository = inMemoryRepository()
    const service = new DailyDietRecommendationApplicationService(repository)
    await service.upsertForDate({ entryDate: '2026-08-20', content: 'a' })
    await service.upsertForDate({ entryDate: '2026-08-22', content: 'b' })
    await service.upsertForDate({ entryDate: '2026-08-23', content: 'c' })
    const range = await service.listRange('2026-08-21', '2026-08-22')
    expect(range.map(entry => entry.entryDate)).toEqual(['2026-08-22'])
  })

  it('returns undefined for a missing date', async () => {
    const service = new DailyDietRecommendationApplicationService(inMemoryRepository())
    expect(await service.getByDate('2026-08-01')).toBeUndefined()
  })

  it('rejects invalid dates, empty content and future dates', async () => {
    const service = new DailyDietRecommendationApplicationService(inMemoryRepository())
    await expect(service.upsertForDate({ entryDate: '2026/08/20', content: 'x' })).rejects.toMatchObject({ code: 'DIET_RECOMMENDATION_INVALID' })
    await expect(service.upsertForDate({ entryDate: '2026-08-20', content: '   ' })).rejects.toMatchObject({ code: 'DIET_RECOMMENDATION_INVALID' })
    await expect(service.getByDate('bad')).rejects.toMatchObject({ code: 'DIET_RECOMMENDATION_INVALID' })
    await expect(service.listRange('2026-8-1')).rejects.toMatchObject({ code: 'DIET_RECOMMENDATION_INVALID' })
    const now = new Date()
    const future = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate() + 5).padStart(2, '0')
    await expect(service.upsertForDate({ entryDate: future, content: 'x' })).rejects.toMatchObject({ code: 'DIET_RECOMMENDATION_INVALID' })
  })

  it('rejects over-length content', async () => {
    const service = new DailyDietRecommendationApplicationService(inMemoryRepository())
    await expect(service.upsertForDate({ entryDate: '2026-08-20', content: 'x'.repeat(1201) })).rejects.toMatchObject({ code: 'DIET_RECOMMENDATION_INVALID' })
  })
})
