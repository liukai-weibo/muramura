import { describe, expect, it } from 'vitest'
import { DailySummaryApplicationService } from '../packages/application/src/daily-summaries'
import type { DailySummary, DailySummaryInput, DailySummaryRepository } from '@knowledge-base/contracts'

function inMemoryRepository(): DailySummaryRepository & { rows: Map<string, DailySummary> } {
  const rows = new Map<string, DailySummary>()
  return {
    rows,
    async listRange(from?: string, to?: string): Promise<DailySummary[]> {
      let list = [...rows.values()].sort((a, b) => a.entryDate.localeCompare(b.entryDate))
      if (from) list = list.filter(entry => entry.entryDate >= from)
      if (to) list = list.filter(entry => entry.entryDate <= to)
      return list
    },
    async getByDate(entryDate: string): Promise<DailySummary | undefined> {
      return rows.get(entryDate)
    },
    async upsertForDate(input: DailySummaryInput): Promise<DailySummary> {
      const existing = rows.get(input.entryDate)
      const summary: DailySummary = {
        id: existing?.id ?? 'summary-1',
        entryDate: input.entryDate,
        content: input.content,
        createdAt: existing?.createdAt ?? '2026-08-24T00:00:00.000Z',
        updatedAt: '2026-08-24T01:00:00.000Z',
      }
      rows.set(input.entryDate, summary)
      return summary
    },
  }
}

describe('daily summary application service', () => {
  it('upserts same date keeping the latest content', async () => {
    const repository = inMemoryRepository()
    const service = new DailySummaryApplicationService(repository)
    const first = await service.upsertForDate({ entryDate: '2026-08-24', content: '第一条小结' })
    const second = await service.upsertForDate({ entryDate: '2026-08-24', content: '更新的小结' })
    expect(first.id).toBe(second.id)
    expect(second.content).toBe('更新的小结')
    expect(await service.getByDate('2026-08-24')).toMatchObject({ entryDate: '2026-08-24', content: '更新的小结' })
    expect(repository.rows.size).toBe(1)
  })

  it('keeps different dates separate and filters by range', async () => {
    const repository = inMemoryRepository()
    const service = new DailySummaryApplicationService(repository)
    await service.upsertForDate({ entryDate: '2026-08-20', content: 'a' })
    await service.upsertForDate({ entryDate: '2026-08-22', content: 'b' })
    await service.upsertForDate({ entryDate: '2026-08-23', content: 'c' })
    const range = await service.listRange('2026-08-21', '2026-08-22')
    expect(range.map(entry => entry.entryDate)).toEqual(['2026-08-22'])
  })

  it('returns undefined for a missing date', async () => {
    const service = new DailySummaryApplicationService(inMemoryRepository())
    expect(await service.getByDate('2026-08-01')).toBeUndefined()
  })

  it('rejects invalid dates, empty content and future dates', async () => {
    const service = new DailySummaryApplicationService(inMemoryRepository())
    await expect(service.upsertForDate({ entryDate: '2026/08/24', content: 'x' })).rejects.toMatchObject({ code: 'DAILY_SUMMARY_INVALID' })
    await expect(service.upsertForDate({ entryDate: '2026-08-24', content: '   ' })).rejects.toMatchObject({ code: 'DAILY_SUMMARY_INVALID' })
    await expect(service.getByDate('bad')).rejects.toMatchObject({ code: 'DAILY_SUMMARY_INVALID' })
    await expect(service.listRange('2026-8-1')).rejects.toMatchObject({ code: 'DAILY_SUMMARY_INVALID' })
    const now = new Date()
    const future = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate() + 5).padStart(2, '0')
    await expect(service.upsertForDate({ entryDate: future, content: 'x' })).rejects.toMatchObject({ code: 'DAILY_SUMMARY_INVALID' })
  })

  it('rejects over-length content', async () => {
    const service = new DailySummaryApplicationService(inMemoryRepository())
    await expect(service.upsertForDate({ entryDate: '2026-08-24', content: 'x'.repeat(4001) })).rejects.toMatchObject({ code: 'DAILY_SUMMARY_INVALID' })
  })
})
