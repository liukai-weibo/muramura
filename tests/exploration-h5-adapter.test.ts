import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../apps/client/src/pages/index/api-client'
import { isApiClientUnknownOutcome } from '../apps/client/src/pages/index/api-client'
import { captureDraftAfterWrite, explorationListReadState, isCurrentExplorationRequest, mayUnlockUnknownOutcome } from '../apps/client/src/pages/index/exploration-session-state'
import { canModifyItemExplorationContext, itemExplorationReadState } from '../apps/client/src/pages/index/item-exploration-state'

describe('探索主线 H5 API Adapter 与会话保护', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('只通过冻结 loopback 路由读取主线和历史，并携带取消信号', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    await apiClient.listExplorationTracks(controller.signal)
    await apiClient.listDeletedExplorationTracks(controller.signal)
    await apiClient.getExplorationTrackHistory('track-1', controller.signal)

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/exploration-tracks', expect.objectContaining({ signal: controller.signal }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/exploration-tracks/deleted', expect.objectContaining({ signal: controller.signal }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/v1/exploration-tracks/track-1/history', expect.objectContaining({ signal: controller.signal }))
  })

  it('主线内捕获只在最终提交时发送一次原子 items 请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'item-1' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiClient.createIdea({ title: '预约体验课', explorationTrack: { type: 'existing', trackId: 'track-1' } })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/items', expect.objectContaining({ method: 'POST', body: JSON.stringify({ title: '预约体验课', explorationTrack: { type: 'existing', trackId: 'track-1' } }) }))
  })

  it('旧请求不能覆盖新选择，失败写入保留草稿', () => {
    expect(isCurrentExplorationRequest(3, 4)).toBe(false)
    expect(isCurrentExplorationRequest(4, 4)).toBe(true)
    expect(captureDraftAfterWrite('仍在编辑的事项', false)).toBe('仍在编辑的事项')
    expect(captureDraftAfterWrite('已提交事项', true)).toBe('')
  })

  it('将事项关联读取状态诚实区分，已删除和不可用关联始终只读', () => {
    const available = { status: 'available', itemId: 'item-1', track: { id: 'track-1', name: '可用', createdAt: '2026-07-25T00:00:00.000Z', updatedAt: '2026-07-25T00:00:00.000Z' } } as const
    const deleted = { status: 'track-deleted', itemId: 'item-1', track: { ...available.track, deletedAt: '2026-07-25T01:00:00.000Z' } } as const
    const unavailable = { status: 'unavailable', itemId: 'item-1', trackId: 'missing-track' } as const

    expect(itemExplorationReadState({ loading: true, error: '' })).toBe('loading')
    expect(itemExplorationReadState({ loading: false, error: '读取失败' })).toBe('error')
    expect(itemExplorationReadState({ loading: false, error: '' })).toBe('empty')
    expect(itemExplorationReadState({ loading: false, error: '', context: deleted })).toBe('track-deleted')
    expect(itemExplorationReadState({ loading: false, error: '', context: unavailable })).toBe('unavailable')
    expect(canModifyItemExplorationContext(available)).toBe(true)
    expect(canModifyItemExplorationContext(deleted)).toBe(false)
    expect(canModifyItemExplorationContext(unavailable)).toBe(false)
  })

  it('通过冻结关联 Adapter 读取、替换与移除，不产生额外写入', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ status: 'available', itemId: 'item-1', track: { id: 'track-1', name: '主线', createdAt: '2026-07-25T00:00:00.000Z', updatedAt: '2026-07-25T00:00:00.000Z' } }), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    await apiClient.getItemExplorationTrack('item-1')
    await apiClient.assignItemToExplorationTrack('item-1', 'track-2')
    await apiClient.removeItemFromExplorationTrack('item-1')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/items/item-1/exploration-track', expect.objectContaining({ signal: undefined }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/items/item-1/exploration-track', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ trackId: 'track-2' }) }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/v1/items/item-1/exploration-track', expect.objectContaining({ method: 'DELETE' }))
  })

  it.each([
    ['创建主线', () => apiClient.createExplorationTrack('可能已创建')],
    ['改名主线', () => apiClient.renameExplorationTrack('track-1', '可能已改名')],
    ['删除主线', () => apiClient.deleteExplorationTrack('track-1')],
    ['恢复主线', () => apiClient.restoreExplorationTrack('track-1')],
    ['关联事项', () => apiClient.assignItemToExplorationTrack('item-1', 'track-1')],
    ['移除关联', () => apiClient.removeItemFromExplorationTrack('item-1')],
    ['原子捕获', () => apiClient.createIdea({ title: '可能已提交', explorationTrack: { type: 'existing', trackId: 'track-1' } })],
  ])('%s 在响应丢失时进入 unknown-outcome，且没有重发', async (_label, operation) => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('response lost'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(operation()).rejects.toSatisfy(isApiClientUnknownOutcome)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('页面关闭式 Abort 的写请求同样保持 unknown-outcome，而读请求仍保留 Abort', async () => {
    const aborted = new DOMException('page closing', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(aborted))
    await expect(apiClient.createIdea({ title: '页面关闭' }, new AbortController().signal)).rejects.toSatisfy(isApiClientUnknownOutcome)
  })

  it('MySQL 503 读取保持既有错误，不降级为空主线或无关联', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: { message: 'MYSQL_UNAVAILABLE' } }), { status: 503 }))))
    await expect(apiClient.listExplorationTracks()).rejects.toThrow('MYSQL_UNAVAILABLE')
    await expect(apiClient.getItemExplorationTrack('item-1')).rejects.toThrow('MYSQL_UNAVAILABLE')
  })

  it('主线初始 503 显示读取错误，已有真实列表在后续 503 时不被覆盖为空态', () => {
    expect(explorationListReadState({ loading: true, hasSucceeded: false, hasEntries: false })).toBe('loading')
    expect(explorationListReadState({ loading: false, hasSucceeded: false, hasEntries: false })).toBe('error')
    expect(explorationListReadState({ loading: true, hasSucceeded: true, hasEntries: true })).toBe('content')
    expect(explorationListReadState({ loading: true, hasSucceeded: true, hasEntries: false })).toBe('empty')
    expect(explorationListReadState({ loading: false, hasSucceeded: true, hasEntries: true })).toBe('content')
    expect(explorationListReadState({ loading: false, hasSucceeded: true, hasEntries: false })).toBe('empty')
  })

  it('unknown-outcome 在读取进行中或读取失败时保持锁，仅在全部真实读取成功后解锁', () => {
    expect(mayUnlockUnknownOutcome([])).toBe(false)
    expect(mayUnlockUnknownOutcome([false])).toBe(false)
    expect(mayUnlockUnknownOutcome([true, false])).toBe(false)
    expect(mayUnlockUnknownOutcome([true, true])).toBe(true)
  })
})
