import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apiClient,
  isApiClientUnknownOutcome,
  setApiClientAdminForbiddenHandler,
  setApiClientUnauthorizedHandler,
} from '../apps/client/src/pages/index/api-client'

const authUser = {
  id: 'user 一',
  username: 'alice',
  roles: ['member'],
  createdAt: '2026-08-04T00:00:00.000Z',
}
const platformUser = { ...authUser, deletedAt: null }

describe('account credential API client', () => {
  afterEach(() => {
    setApiClientUnauthorizedHandler(undefined)
    setApiClientAdminForbiddenHandler(undefined)
    vi.unstubAllGlobals()
  })

  it('uses the account and administrator credential routes with exact bodies', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...authUser, username: 'renamed' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...platformUser, username: 'managed-name' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revokedSessionCount: 2 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient.changeOwnUsername({ username: ' renamed ' })).resolves.toMatchObject({ username: 'renamed' })
    await expect(apiClient.changeOwnPassword({ currentPassword: 'password-old', newPassword: 'password-new' })).resolves.toBeUndefined()
    await expect(apiClient.updatePlatformUsername('user 一', {
      username: 'managed-name',
      operationId: '11111111-1111-4111-8111-111111111111',
    })).resolves.toMatchObject({ id: 'user 一', username: 'managed-name' })
    await expect(apiClient.resetPlatformUserPassword('user 一', {
      newPassword: 'password-reset',
      operationId: '22222222-2222-4222-8222-222222222222',
    })).resolves.toEqual({ revokedSessionCount: 2 })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/account/username', expect.objectContaining({
      method: 'PATCH', credentials: 'same-origin', body: JSON.stringify({ username: ' renamed ' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/account/password', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ currentPassword: 'password-old', newPassword: 'password-new' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/v1/admin/users/user%20%E4%B8%80/username', expect.objectContaining({
      method: 'PATCH', credentials: 'same-origin', body: JSON.stringify({ username: 'managed-name', operationId: '11111111-1111-4111-8111-111111111111' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/v1/admin/users/user%20%E4%B8%80/reset-password', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ newPassword: 'password-reset', operationId: '22222222-2222-4222-8222-222222222222' }),
    }))
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('treats malformed successful credential writes as unknown without retrying', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...authUser, passwordHash: 'unexpected' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...platformUser, id: 'another-user' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revokedSessionCount: -1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient.changeOwnUsername({ username: 'renamed' })).rejects.toSatisfy(isApiClientUnknownOutcome)
    await expect(apiClient.changeOwnPassword({ currentPassword: 'password-old', newPassword: 'password-new' })).rejects.toSatisfy(isApiClientUnknownOutcome)
    await expect(apiClient.updatePlatformUsername('user 一', { username: 'managed-name', operationId: crypto.randomUUID() })).rejects.toSatisfy(isApiClientUnknownOutcome)
    await expect(apiClient.resetPlatformUserPassword('user 一', { newPassword: 'password-reset', operationId: crypto.randomUUID() })).rejects.toSatisfy(isApiClientUnknownOutcome)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('keeps a wrong current password local but still expires a genuinely invalid session', async () => {
    const unauthorized = vi.fn()
    setApiClientUnauthorizedHandler(unauthorized)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: {
        code: 'UNAUTHORIZED',
        businessCode: 'AUTH_CURRENT_PASSWORD_INVALID',
        message: 'current password is invalid',
        requestId: 'req-password',
      } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: {
        code: 'UNAUTHORIZED',
        message: 'authentication required',
        requestId: 'req-session',
      } }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient.changeOwnPassword({ currentPassword: 'wrong-password', newPassword: 'password-new' })).rejects.toMatchObject({
      status: 401,
      businessCode: 'AUTH_CURRENT_PASSWORD_INVALID',
      requestId: 'req-password',
    })
    expect(unauthorized).not.toHaveBeenCalled()

    await expect(apiClient.changeOwnUsername({ username: 'renamed' })).rejects.toMatchObject({ status: 401, requestId: 'req-session' })
    expect(unauthorized).toHaveBeenCalledTimes(1)
  })

  it('blocks malformed administrator targets and operation ids before fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient.updatePlatformUsername('bad/id', { username: 'name', operationId: crypto.randomUUID() })).rejects.toThrow('请求参数无效')
    await expect(apiClient.resetPlatformUserPassword('user-1', { newPassword: 'password-new', operationId: 'not-a-uuid' })).rejects.toThrow('请求参数无效')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
