import { describe, expect, it } from 'vitest'
import { DietProfileApplicationService } from '../packages/application/src/diet-profile'
import type { DietProfile, DietProfileInput, DietProfileRepository, ActivityAuditEventDraft, ActivityAuditRecorder } from '@knowledge-base/contracts'

function makeService() {
  const drafts: ActivityAuditEventDraft[] = []
  const repo: DietProfileRepository = {
    async getMine(): Promise<DietProfile | undefined> { return undefined },
    async upsertMine(input: DietProfileInput): Promise<DietProfile> {
      return { ...input, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T01:00:00.000Z' }
    },
  }
  const recorder: ActivityAuditRecorder = { record: async (d: ActivityAuditEventDraft) => { drafts.push(d) } }
  const service = new DietProfileApplicationService(repo, recorder, 'user-1')
  return { service, drafts }
}

describe('diet profile application service', () => {
  it('upserts a full profile and records daily_diet/update audit', async () => {
    const { service, drafts } = makeService()
    const saved = await service.upsertMine({ heightCm: 178, weightKg: 81, age: 30, gender: 'male', goal: 'lose_fat', activity: 'sedentary', healthNote: '乳糖不耐受' })
    expect(saved.heightCm).toBe(178)
    expect(saved.healthNote).toBe('乳糖不耐受')
    const draft = drafts[0]!
    expect(draft).toBeDefined()
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
    const repo: DietProfileRepository = {
      async getMine(): Promise<DietProfile | undefined> { return undefined },
      async upsertMine(input: DietProfileInput): Promise<DietProfile> {
        return { ...input, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T01:00:00.000Z' }
      },
    }
    const service = new DietProfileApplicationService(repo, undefined, 'user-1')
    await expect(service.upsertMine({ heightCm: 170 })).resolves.toMatchObject({ heightCm: 170 })
  })
})
