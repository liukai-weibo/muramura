import type {
  ActivityAuditRecorder,
  ExplorationTrackRepository,
  ItemRepository,
  MethodRepository,
  TrashEntry,
  TrashFilter,
  TrashPurgeEntry,
  TrashPurgeRepository,
} from '@knowledge-base/contracts'
import { BusinessError } from '@knowledge-base/domain'
import { safeAuditRecord } from './audit'

export const TRASH_RETENTION_DAYS = 30

/** 跨事项与方法共用的回收站保留期边界。 */
export function trashCutoff(now = new Date()): string {
  return new Date(now.getTime() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

/** 统一回收站的确定性排序规则。 */
export function sortTrashEntries(entries: readonly TrashEntry[]): TrashEntry[] {
  const typeOrder: Record<TrashEntry['type'], number> = { item: 0, method: 1, 'exploration-track': 2 }
  return [...entries].sort((left, right) => right.deletedAt.localeCompare(left.deletedAt) || typeOrder[left.type] - typeOrder[right.type] || left.id.localeCompare(right.id))
}

export class TrashApplicationService {
  constructor(
    private readonly itemRepository: ItemRepository,
    private readonly methodRepository: MethodRepository,
    private readonly explorationTrackRepository: ExplorationTrackRepository,
    private readonly purgeRepository?: TrashPurgeRepository,
    private readonly auditRecorder?: ActivityAuditRecorder,
  ) {}

  async listTrashEntries(filter: TrashFilter): Promise<TrashEntry[]> {
    await Promise.all([
      this.itemRepository.purgeDeletedBefore(trashCutoff()),
      this.methodRepository.purgeDeletedBefore(trashCutoff()),
    ])
    if (filter === 'item') return sortTrashEntries((await this.itemRepository.listDeleted()).map((item) => ({ type: 'item' as const, id: item.id, title: item.title, deletedAt: item.deletedAt! })))
    if (filter === 'method') return sortTrashEntries((await this.methodRepository.listDeleted()).map((method) => ({ type: 'method' as const, id: method.id, title: method.title, deletedAt: method.deletedAt! })))
    if (filter === 'exploration-track') return sortTrashEntries((await this.explorationTrackRepository.listDeleted()).map(({ track }) => ({ type: 'exploration-track' as const, id: track.id, title: track.name, deletedAt: track.deletedAt })))
    const [items, methods, explorationTracks] = await Promise.all([
      this.itemRepository.listDeleted(),
      this.methodRepository.listDeleted(),
      this.explorationTrackRepository.listDeleted(),
    ])
    return sortTrashEntries([
      ...items.map((item) => ({ type: 'item' as const, id: item.id, title: item.title, deletedAt: item.deletedAt! })),
      ...methods.map((method) => ({ type: 'method' as const, id: method.id, title: method.title, deletedAt: method.deletedAt! })),
      ...explorationTracks.map(({ track }) => ({ type: 'exploration-track' as const, id: track.id, title: track.name, deletedAt: track.deletedAt })),
    ])
  }

  async purge(entries: readonly TrashPurgeEntry[]): Promise<void> {
    if (!entries.length) throw new BusinessError('TRASH_EMPTY_SELECTION', '至少选择一条回收站记录')
    if (!this.purgeRepository) throw new BusinessError('TRASH_EMPTY_SELECTION', '回收站永久删除能力不可用')
    const keys = entries.map((entry) => `${entry.type}:${entry.id}`)
    if (new Set(keys).size !== keys.length) throw new BusinessError('TRASH_DUPLICATE_SELECTION', '回收站记录不能重复选择')
    await this.purgeRepository.purge(entries)
    for (const entry of entries) {
      const module = entry.type === 'item' ? 'item' as const : entry.type === 'method' ? 'method' as const : 'exploration_track' as const
      await safeAuditRecord(this.auditRecorder, { module, action: 'purge', entityId: entry.id, snapshot: JSON.stringify({ type: entry.type }) })
    }
  }

}
