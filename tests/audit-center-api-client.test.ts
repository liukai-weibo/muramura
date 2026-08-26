import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../apps/client/src/pages/index/api-client'

const eventWithEntity = {
  id: 'event-1',
  actorUserId: 'actor-1',
  actorUsername: '张三',
  module: 'mood',
  action: 'create',
  entityId: 'mood-1',
  snapshot: '{"content":"心情不错"}',
  riskLevel: 'normal',
  createdAt: '2026-08-25T08:00:00.000Z',
}
const eventWithoutEntity = {
  id: 'event-2',
  actorUserId: 'actor-1',
  actorUsername: '张三',
  module: 'meal',
  action: 'update',
  snapshot: '{"breakfast":"包子"}',
  riskLevel: 'normal',
  createdAt: '2026-08-25T08:01:00.000Z',
}
const page = (items: unknown[], page = 1, pageSize = 20, total = items.length) => ({ items, page, pageSize, total })

describe('audit center API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts audit events with and without entityId keys', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(page([eventWithEntity, eventWithoutEntity])), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await apiClient.listActivityAuditEvents({ page: 1, pageSize: 20 })
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ id: 'event-1', entityId: 'mood-1' })
    const second = result.items[1]
    expect(second).toBeDefined()
    expect(second).toMatchObject({ id: 'event-2', module: 'meal', action: 'update' })
    expect('entityId' in second!).toBe(false)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/audit/events?page=1&pageSize=20', expect.objectContaining({ credentials: 'same-origin' }))
  })

  it.each<[Record<string, unknown>, string]>([
    [{ ...eventWithEntity, entityId: null }, 'null entityId'],
    [{ ...eventWithEntity, missing: '模块' }, 'extra key'],
    [{ ...eventWithoutEntity, snapshot: 5 }, 'non-string snapshot'],
    [{ ...eventWithEntity, module: 'unknown' }, 'unknown module'],
  ])('rejects malformed audit events: %s', async (item) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(page([item])), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiClient.listActivityAuditEvents({ page: 1, pageSize: 20 })).rejects.toThrow('审计事件响应结构无效。')
  })

  it('passes the merged search parameter to the list request', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(page([eventWithEntity])), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await apiClient.listActivityAuditEvents({ search: '张三', page: 1, pageSize: 20 })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/audit/events?page=1&pageSize=20&search=%E5%BC%A0%E4%B8%89', expect.objectContaining({ credentials: 'same-origin' }))
    const exportUrl = apiClient.buildActivityAuditExportUrl({ search: '快照内容', modules: ['item'], from: '2026-08-01' })
    expect(exportUrl).toBe('/api/v1/admin/audit/export?modules=item&from=2026-08-01&search=%E5%BF%AB%E7%85%A7%E5%86%85%E5%AE%B9')
  })

  it('accepts the newly extended module/action enums', async () => {
    const extended = {
      id: 'event-3', actorUserId: 'actor-1', actorUsername: '张三',
      module: 'exploration_track', action: 'assign',
      entityId: 'item-1', snapshot: '{"trackId":"track-1"}', riskLevel: 'normal',
      createdAt: '2026-08-25T09:00:00.000Z',
    }
    const extended2 = {
      ...extended, id: 'event-4', module: 'ai_config', action: 'update',
    }
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(page([extended, extended2])), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await apiClient.listActivityAuditEvents({ page: 1, pageSize: 20 })
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ module: 'exploration_track', action: 'assign' })
    expect(result.items[1]).toMatchObject({ module: 'ai_config', action: 'update' })
  })
})