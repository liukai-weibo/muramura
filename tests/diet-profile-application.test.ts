import { describe, expect, it, vi } from 'vitest'
import { DietProfileApplicationService } from '../packages/application/src/diet-profile'
import type { DietProfile, DietProfileRepository, ActivityAuditEventDraft } from '@knowledge-base/contracts'

function makeService(recorder?: { record: (d: ActivityAuditEventDraft) => Promise<void> }) {
  const repo: DietProfileRepository = {
    async getMine(): Promise<DietProfile | undefined> { return undefined },
    async upsertMine(input): Promise<DietProfile> {
      return {
        ...input,
        createdAt: '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-08-20T01:00:00.000Z',
      }
    },
  }
  const audit = recorder ?? { record: async () => {} }
  return { service: new DietProfileApplicationService(repo, audit as never, 'user-1'), audit }
}

describe('diet profile application service', () => {
  it('upserts a full profile and records daily_diet/update audit', async () => {
    const record = vi.fn(async () => {})
    const { service } = makeService({ record })
    const saved = await service.upsertMine({ heightCm: 178, weightKg: 81, age: 30, gender: 'male', goal: 'lose_fat', activity: 'sedentary', healthNote: '乳糖不耐受' })
    expect(saved.heightCm).toBe(178)
    expect(saved.healthNote).toBe('乳糖不耐受')
    const draft = record.mock.calls[0][0] as ActivityAuditEventDraft
    expect(draft.module).toBe('daily_diet')
    expect(draft.action).toBe('update')
    expect(draft.entityId).toBe('user-1')
    const snapshot = JSON.parse(draft.snapshot ?? '{}') as Record<string, unknown>
    expect(snapshot.heightCm).toBe(178)
    expect(snapshot.goal).toBe('lose_fat')
  })

  it('rejects invalid gender/goal/activity values', async () => {
    const { service } = makeService()
    await expect(service.upsertMine({ gender: 'alien' as never })).rejects.toMatchObject({ code: 'DIET_PROFILE_INVALID' })
    await expect(service.upsertMine({ goal: 'x' as never })).rejects.toMatchObject({ code: 'DIET_PROFILE_INVALID' })
    await expect(service.upsertMine({ activity: 'x' as never })).rejects.toMatchObject({ code: 'DIET_PROFILE_INVALID' })
  })

  it('rejects invalid numbers and overlong health note', async () => {
    const { service } = makeService()
    await expect(service.upsertMine({ heightCm: -5 })).rejects.toMatchObject({ code: 'DIET_PROFILE_INVALID' })
    await expect(service.upsertMine({ weightKg: 0 })).rejects.toMatchObject({ code: 'DIET_PROFILE_INVALID' })
    await expect(service.upsertMine({ healthNote: 'x'.repeat(501) })).rejects.toMatchObject({ code: 'DIET_PROFILE_INVALID' })
  })

  it('records no audit when no recorder is provided', async () => {
    const service = new DietProfileApplicationService({
      async getMine() { return undefined },
      async upsertMine(input) { return { ...input, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T01:00:00.000Z' } },
    } as never, undefined, 'user-1')
    await expect(service.upsertMine({ heightCm: 170 })).resolves.toMatchObject({ heightCm: 170 })
  })
})
