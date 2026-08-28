import { describe, expect, it } from 'vitest'
import type {
  ExplorationTrack,
  ExplorationTrackRepository,
  ExplorationTrackWorkflowRepository,
  Item,
  ItemRepository,
  PreparedExplorationTrackSelection,
} from '@knowledge-base/contracts'
import { ExplorationTrackApplicationService, ItemApplicationService } from '@knowledge-base/application'

const item: Item = {
  id: 'item-1', title: '事项', content: '', status: 'idea_to_try',
  createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z',
}

function repository(): ExplorationTrackRepository {
  return {
    create: async input => ({ id: input.id, name: input.name, createdAt: input.createdAt, updatedAt: input.createdAt }),
    getById: async () => undefined,
    rename: async (id, input) => ({ id, name: input.name, createdAt: input.updatedAt, updatedAt: input.updatedAt }),
    softDelete: async () => undefined,
    restore: async id => ({ id, name: '恢复', createdAt: item.createdAt, updatedAt: item.updatedAt }),
    listActive: async () => [], listSelectable: async () => [], listDeleted: async () => [],
    archive: async () => undefined, restoreFromArchive: async id => ({ id, name: '恢复', createdAt: item.createdAt, updatedAt: item.updatedAt }),
    listArchived: async () => [],
    getHistory: async () => undefined, getItemContext: async () => undefined,
    listItemsByTrackAndStatus: async () => [],
  }
}

describe('探索主线 S2 Application', () => {
  it('在 Application 统一规范创建与改名的名称', async () => {
    const calls: Array<{ name: string; normalizedName: string }> = []
    const trackRepository = repository()
    trackRepository.create = async input => {
      calls.push(input)
      return { id: input.id, name: input.name, createdAt: input.createdAt, updatedAt: input.createdAt }
    }
    const service = new ExplorationTrackApplicationService(trackRepository, {} as ExplorationTrackWorkflowRepository)

    await service.createExplorationTrack('  ＡＢＣ  ')
    expect(calls).toEqual([{ id: expect.any(String), name: 'ABC', normalizedName: 'abc', createdAt: expect.any(String) }])
    await expect(service.createExplorationTrack('   ')).rejects.toThrow('主线名称不能为空')
    await expect(service.createExplorationTrack('𠮷'.repeat(81))).rejects.toThrow('主线名称最多 80 个字符')
  })

  it('captureIdea 无选择时保持既有 Repository 创建，new 选择委派已规范化 workflow', async () => {
    const created: unknown[] = []
    const delegated: PreparedExplorationTrackSelection[] = []
    const itemRepository = { create: async (input: unknown) => { created.push(input); return item } } as ItemRepository
    const workflow: ExplorationTrackWorkflowRepository = {
      createItemWithExplorationTrack: async (_input, selection) => { delegated.push(selection); return item },
      assignItemToExplorationTrack: async () => ({ status: 'no-association', itemId: item.id }),
      removeItemFromExplorationTrack: async () => undefined,
    }
    const service = new ItemApplicationService(itemRepository, workflow)

    await service.createIdea({ title: '  原样路径  ' })
    await service.createIdea({ title: '关联事项', explorationTrack: { type: 'new', name: '  ＦＯＯ  ' } })
    await service.createIdea({ title: '已有事项', explorationTrack: { type: 'existing', trackId: 'track-1' } })

    expect(created).toEqual([{ title: '原样路径', content: '', status: 'doing' }])
    expect(delegated).toEqual([
      { type: 'new', name: 'FOO', normalizedName: 'foo' },
      { type: 'existing', trackId: 'track-1' },
    ])
  })
})
