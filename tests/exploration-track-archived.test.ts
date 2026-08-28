import { describe, expect, it } from 'vitest'
import type { ActivityAuditRecorder, ExplorationTrack, ExplorationTrackListEntry, ExplorationTrackRepository, Item } from '../packages/contracts/src'
import { ExplorationTrackApplicationService, ItemApplicationService } from '../packages/application/src'

/** 内存仓储：真实模拟归档状态迁移，验证 service 行为与列表可见性。 */
function memoryRepository() {
  let tracks: ExplorationTrack[] = []
  const create = async (input: { id: string; name: string; normalizedName: string; createdAt: string }): Promise<ExplorationTrack> => { const t = { id: input.id, name: input.name, createdAt: input.createdAt, updatedAt: input.createdAt }; tracks = [...tracks, t]; return t }
  const getById = async (id: string) => tracks.find(t => t.id === id)
  const archive = async (id: string, archivedAt: string) => {
    const t = tracks.find(x => x.id === id)
    if (!t || t.deletedAt) throw new Error('EXPLORATION_TRACK_NOT_FOUND')
    if (t.archivedAt) throw new Error('EXPLORATION_TRACK_ALREADY_ARCHIVED')
    tracks = tracks.map(x => x.id === id ? { ...x, archivedAt, updatedAt: archivedAt } : x)
  }
  const restoreFromArchive = async (id: string, updatedAt: string) => {
    const t = tracks.find(x => x.id === id)
    if (!t || t.deletedAt) throw new Error('EXPLORATION_TRACK_NOT_FOUND')
    if (!t.archivedAt) throw new Error('EXPLORATION_TRACK_NOT_ARCHIVED')
    const rest = { ...t, updatedAt }; delete (rest as { archivedAt?: string }).archivedAt
    tracks = tracks.map(x => x.id === id ? rest : x)
    return rest
  }
  const listActive = async (): Promise<ExplorationTrackListEntry[]> => tracks.filter(t => !t.deletedAt && !t.archivedAt).map(track => ({ track }))
  const listArchived = async (): Promise<ExplorationTrackListEntry[]> => tracks.filter(t => !t.deletedAt && Boolean(t.archivedAt)).map(track => ({ track }))
  const listSelectable = async (): Promise<ExplorationTrack[]> => tracks.filter(t => !t.deletedAt && !t.archivedAt)
  const seed = async (track: ExplorationTrack) => { tracks = [...tracks, track] }
  const repository = { create, getById, archive, restoreFromArchive, listActive, listArchived, listSelectable, rename: async (id: string, input: { name: string; normalizedName: string; updatedAt: string }) => { const t = await getById(id); return { ...t!, name: input.name, updatedAt: input.updatedAt } }, softDelete: async () => undefined, restore: async (id: string) => ({ id, name: 'r', createdAt: '', updatedAt: '' }), updateDescription: async (id: string, input: { description: string; updatedAt: string }) => ({ ...(await getById(id))!, description: input.description, updatedAt: input.updatedAt }), listDeleted: async () => [], getHistory: async () => undefined, getItemContext: async () => undefined, listItemsByTrackAndStatus: async () => [] } as unknown as ExplorationTrackRepository
  return { repository, seed, current: () => tracks }
}

const auditEvents: Array<{ action: string; module: string }> = []
const auditRecorder: ActivityAuditRecorder = {
  async record(event: { module: string; action: string }) { auditEvents.push({ module: event.module, action: event.action }) },
} as unknown as ActivityAuditRecorder

describe('exploration track archive', () => {
  it('archive moves track out of active list and into archived list', async () => {
    const mem = memoryRepository()
    await mem.seed({ id: 't1', name: '存钱买房', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' })
    const service = new ExplorationTrackApplicationService(mem.repository, {} as never, auditRecorder)
    expect(await service.listActiveExplorationTracks()).toHaveLength(1)
    await service.archiveExplorationTrack('t1')
    expect(await service.listActiveExplorationTracks()).toHaveLength(0)
    const archived = await service.listArchivedExplorationTracks()
    expect(archived).toHaveLength(1)
    expect(archived[0]!.track.id).toBe('t1')
    expect(archived[0]!.track.archivedAt).toBeTruthy()
    expect(auditEvents.some(e => e.action === 'archive' && e.module === 'exploration_track')).toBe(true)
  })
  it('unarchive restores the track to active list and records restore audit', async () => {
    const mem = memoryRepository()
    await mem.seed({ id: 't1', name: '存钱买房', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', archivedAt: '2026-08-10T00:00:00.000Z' })
    const service = new ExplorationTrackApplicationService(mem.repository, {} as never, auditRecorder)
    await service.restoreExplorationTrackFromArchive('t1')
    expect(await service.listActiveExplorationTracks()).toHaveLength(1)
    expect(await service.listArchivedExplorationTracks()).toHaveLength(0)
    expect(auditEvents.some(e => e.action === 'restore' && e.module === 'exploration_track')).toBe(true)
  })
  it('archived tracks are excluded from the selectable list', async () => {
    const mem = memoryRepository()
    await mem.seed({ id: 't1', name: '存钱买房', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', archivedAt: '2026-08-10T00:00:00.000Z' })
    await mem.seed({ id: 't2', name: '学习二胡', createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' })
    const service = new ExplorationTrackApplicationService(mem.repository, {} as never)
    const selectable = await service.listSelectableExplorationTracks()
    expect(selectable.map(t => t.id)).toEqual(['t2'])
  })
  it('archive rejects already archived and deleted tracks', async () => {
    const mem = memoryRepository()
    await mem.seed({ id: 't1', name: 'a', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', archivedAt: '2026-08-10T00:00:00.000Z' })
    await mem.seed({ id: 't2', name: 'b', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', deletedAt: '2026-08-05T00:00:00.000Z' })
    const service = new ExplorationTrackApplicationService(mem.repository, {} as never)
    await expect(service.archiveExplorationTrack('t1')).rejects.toThrow('EXPLORATION_TRACK_ALREADY_ARCHIVED')
    await expect(service.archiveExplorationTrack('t2')).rejects.toThrow('EXPLORATION_TRACK_NOT_FOUND')
  })
  it('unarchive rejects a never-archived track', async () => {
    const mem = memoryRepository()
    await mem.seed({ id: 't1', name: 'a', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' })
    const service = new ExplorationTrackApplicationService(mem.repository, {} as never)
    await expect(service.restoreExplorationTrackFromArchive('t1')).rejects.toThrow('EXPLORATION_TRACK_NOT_ARCHIVED')
  })
  it('listItems hides items belonging to archived tracks', async () => {
    const items: Item[] = [
      { id: 'i1', title: '独立事项', content: '', status: 'doing', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
      { id: 'i2', title: '归档大项内行动', content: '', status: 'doing', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', explorationTrackId: 't-archived' },
      { id: 'i3', title: '活跃大项内行动', content: '', status: 'doing', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', explorationTrackId: 't-active' },
    ]
    const repo = { purgeDeletedBefore: async () => undefined, list: async () => items } as unknown as ItemApplicationService extends { repository: infer R } ? R : never
    const service = new ItemApplicationService(repo, undefined, undefined, async () => new Set(['t-archived']))
    const visible = await service.listItems()
    expect(visible.map(i => i.id).sort()).toEqual(['i1', 'i3'])
  })
  it('listItems keeps all items when no archived tracks exist', async () => {
    const items: Item[] = [{ id: 'i1', title: '独立事项', content: '', status: 'doing', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }]
    const repo = { purgeDeletedBefore: async () => undefined, list: async () => items } as unknown as ItemApplicationService extends { repository: infer R } ? R : never
    const service = new ItemApplicationService(repo, undefined, undefined, async () => new Set())
    expect(await service.listItems()).toHaveLength(1)
  })
})
