import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  advanceApiClientAuthenticationContext,
  apiClient,
  isApiClientUnknownOutcome,
  setApiClientAdminForbiddenHandler,
} from '../apps/client/src/pages/index/api-client'

const member = { id: 'user 一', username: 'alice', roles: ['member'], createdAt: '2026-07-30T00:00:00.000Z', deletedAt: null }
const administrator = { ...member, roles: ['member', 'platform_admin'] }

describe('platform administration API client', () => {
  afterEach(() => {
    setApiClientAdminForbiddenHandler(undefined)
    vi.unstubAllGlobals()
  })

  it('uses the user-management same-origin routes with exact query and bodies', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [member], page: 2, pageSize: 20, total: 21 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(administrator), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revokedSessionCount: 3 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(member), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...member, deletedAt: '2026-07-30T01:00:00.000Z' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(member), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiClient.listPlatformUsers({ page: 2, query: ' %_王 ' })
    await apiClient.setPlatformUserRoles(member.id, { roles: ['member', 'ordinary_admin'], operationId: '11111111-1111-4111-8111-111111111111' })
    await apiClient.revokePlatformUserSessions(member.id, { operationId: '22222222-2222-4222-8222-222222222222' })
    await apiClient.getPlatformUser(member.id)
    await apiClient.softDeletePlatformUser(member.id, { operationId: '33333333-3333-4333-8333-333333333333' })
    await apiClient.restorePlatformUser(member.id, { operationId: '44444444-4444-4444-8444-444444444444' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/admin/users?page=2&query=%25_%E7%8E%8B', expect.objectContaining({ credentials: 'same-origin' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/admin/users/user%20%E4%B8%80/roles', expect.objectContaining({
      method: 'PUT', credentials: 'same-origin', body: JSON.stringify({ roles: ['member', 'ordinary_admin'], operationId: '11111111-1111-4111-8111-111111111111' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/v1/admin/users/user%20%E4%B8%80/revoke-sessions', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ operationId: '22222222-2222-4222-8222-222222222222' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/v1/admin/users/user%20%E4%B8%80', expect.objectContaining({ credentials: 'same-origin' }))
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/v1/admin/users/user%20%E4%B8%80/soft-delete', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ operationId: '33333333-3333-4333-8333-333333333333' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/v1/admin/users/user%20%E4%B8%80/restore', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ operationId: '44444444-4444-4444-8444-444444444444' }),
    }))
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/pageSize|actorUserId|cookie|audit/i)
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it.each([
    [{ items: [], page: 2, pageSize: 20, total: 0 }, 'wrong page'],
    [{ items: [], page: 1, pageSize: 10, total: 0 }, 'wrong page size'],
    [{ items: [], page: 1, pageSize: 20, total: -1 }, 'negative total'],
    [{ items: [member, member], page: 1, pageSize: 20, total: 2 }, 'duplicate id'],
    [{ items: [{ ...member, roles: [] }], page: 1, pageSize: 20, total: 1 }, 'missing member'],
    [{ items: [{ ...member, roles: ['platform_admin', 'member'] }], page: 1, pageSize: 20, total: 1 }, 'unordered roles'],
    [{ items: [{ ...member, roles: ['member', 'owner'] }], page: 1, pageSize: 20, total: 1 }, 'unknown role'],
    [{ items: [{ ...member, createdAt: 'today' }], page: 1, pageSize: 20, total: 1 }, 'invalid date'],
    [{ items: [{ ...member, deletedAt: 'today' }], page: 1, pageSize: 20, total: 1 }, 'invalid deleted date'],
    [{ items: [{ ...member, passwordHash: 'secret' }], page: 1, pageSize: 20, total: 1 }, 'unexpected sensitive field'],
  ])('rejects the whole malformed user page: %s', async (body, _label) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })))
    await expect(apiClient.listPlatformUsers({ page: 1 })).rejects.toBeInstanceOf(Error)
  })

  it('blocks invalid client parameters before fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiClient.listPlatformUsers({ page: 0 })).rejects.toThrow('请求参数无效')
    await expect(apiClient.listPlatformUsers({ page: 1, query: 'x'.repeat(81) })).rejects.toThrow('请求参数无效')
    await expect(apiClient.setPlatformUserRoles('bad/id', { roles: ['member'], operationId: crypto.randomUUID() })).rejects.toThrow('请求参数无效')
    await expect(apiClient.revokePlatformUserSessions(member.id, { operationId: 'not-a-uuid' })).rejects.toThrow('请求参数无效')
    await expect(apiClient.softDeletePlatformUser(member.id, { operationId: 'not-a-uuid' })).rejects.toThrow('请求参数无效')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats malformed or mismatched successful writes as unknown without retrying', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...member, id: 'another-user' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revokedSessionCount: -1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...member, deletedAt: 'not-a-date' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient.setPlatformUserRoles(member.id, { roles: ['member'], operationId: crypto.randomUUID() })).rejects.toSatisfy(isApiClientUnknownOutcome)
    await expect(apiClient.revokePlatformUserSessions(member.id, { operationId: crypto.randomUUID() })).rejects.toSatisfy(isApiClientUnknownOutcome)
    await expect(apiClient.softDeletePlatformUser(member.id, { operationId: crypto.randomUUID() })).rejects.toSatisfy(isApiClientUnknownOutcome)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('preserves explicit 404/409/503 errors and does not retry', async () => {
    const fetchMock = vi.fn()
    for (const [status, code] of [[404, 'NOT_FOUND'], [409, 'CONFLICT'], [503, 'MYSQL_UNAVAILABLE']] as const) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code, message: code, requestId: `req-${status}` } }), { status }))
    }
    vi.stubGlobal('fetch', fetchMock)
    for (const status of [404, 409, 503]) {
      await expect(apiClient.setPlatformUserRoles(member.id, { roles: ['member'], operationId: crypto.randomUUID() })).rejects.toMatchObject({ status, requestId: `req-${status}` })
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('fires management 403 only for the current authentication context', async () => {
    const forbidden = vi.fn()
    setApiClientAdminForbiddenHandler(forbidden)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'denied', requestId: 'req-current' } }), { status: 403 })))
    await expect(apiClient.listPlatformUsers({ page: 1 })).rejects.toMatchObject({ status: 403 })
    expect(forbidden).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-current' }))

    let resolveOld!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveOld = resolve })))
    const old = apiClient.listPlatformUsers({ page: 1 })
    advanceApiClientAuthenticationContext()
    resolveOld(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'denied' } }), { status: 403 }))
    await expect(old).rejects.toMatchObject({ status: 403 })
    expect(forbidden).toHaveBeenCalledTimes(1)
  })

  it('does not treat an unrelated business 403 as management access revocation', async () => {
    const forbidden = vi.fn()
    setApiClientAdminForbiddenHandler(forbidden)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'denied' } }), { status: 403 })))
    await expect(apiClient.listItems()).rejects.toMatchObject({ status: 403 })
    expect(forbidden).not.toHaveBeenCalled()
  })
})
