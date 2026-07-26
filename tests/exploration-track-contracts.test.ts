import { describe, expect, it } from 'vitest'

import { itemStatuses, type AvailableExplorationTrack, type CurrentAssociatedGroup, type DeletedExplorationTrack, type ExplorationTrackHistory, type ExplorationTrackSelection, type Item, type ItemExplorationTrackContext } from '@knowledge-base/contracts'

const activeTrack = {
  id: 'track-1',
  name: '探索主线',
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
} satisfies AvailableExplorationTrack

const deletedTrack = {
  ...activeTrack,
  deletedAt: '2026-07-24T01:00:00.000Z',
} satisfies DeletedExplorationTrack

const singleTrackAssociation: Pick<Item, 'explorationTrackId'> = {
  explorationTrackId: activeTrack.id,
}

describe('探索主线 S1 基础 Contracts', () => {
  it('表达单一显式选择，而非隐式或多主线关联', () => {
    const selection = { type: 'existing', trackId: activeTrack.id } satisfies ExplorationTrackSelection
    const newSelection = { type: 'new', name: '新的探索主线' } satisfies ExplorationTrackSelection

    expect(selection).toEqual({ type: 'existing', trackId: 'track-1' })
    expect(newSelection).toEqual({ type: 'new', name: '新的探索主线' })
  })

  it('由类型系统强制关联上下文的互斥生命周期', () => {
    const contexts = [
      { status: 'no-association', itemId: 'item-1' },
      { status: 'available', itemId: 'item-1', track: activeTrack },
      { status: 'track-deleted', itemId: 'item-1', track: deletedTrack },
      { status: 'unavailable', itemId: 'item-1', trackId: 'missing-track' },
    ] satisfies ItemExplorationTrackContext[]
    const availableWithUndefined = {
      status: 'available',
      itemId: 'item-2',
      track: { ...activeTrack, deletedAt: undefined },
    } satisfies ItemExplorationTrackContext

    // @ts-expect-error available 主线不能携带 deletedAt 字符串。
    const invalidAvailable = { status: 'available', itemId: 'item-1', track: { ...activeTrack, deletedAt: '2026-07-24T01:00:00.000Z' } } satisfies ItemExplorationTrackContext
    // @ts-expect-error 已删除主线必须保留 deletedAt 字符串。
    const invalidDeleted = { status: 'track-deleted', itemId: 'item-1', track: activeTrack } satisfies ItemExplorationTrackContext

    expect(singleTrackAssociation.explorationTrackId).toBe(activeTrack.id)
    expect(availableWithUndefined.status).toBe('available')
    expect(contexts.map(context => context.status)).toEqual([
      'no-association',
      'available',
      'track-deleted',
      'unavailable',
    ])
    expect(invalidAvailable).toBeDefined()
    expect(invalidDeleted).toBeDefined()
  })

  it('固定当前关联状态范围及历史读模型的软删除生命周期', () => {
    const group = {
      status: 'doing',
      items: [],
      hasMore: false,
    } satisfies CurrentAssociatedGroup
    const history = {
      track: { ...activeTrack, deletedAt: '2026-07-24T01:00:00.000Z' },
      lifecycle: 'deleted',
      currentAssociatedItems: [group],
      history: [],
      abandonedHistory: [],
    } satisfies ExplorationTrackHistory

    expect(itemStatuses).toContain(group.status)
    expect(history.track.deletedAt).toBeDefined()
    expect(history.lifecycle).toBe('deleted')
  })
})
