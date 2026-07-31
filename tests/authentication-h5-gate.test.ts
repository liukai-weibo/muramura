import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  advanceApiClientAuthenticationContext,
  apiClient,
  isApiClientUnknownOutcome,
  setApiClientUnauthorizedHandler,
} from '../apps/client/src/pages/index/api-client'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../apps/client/src/pages/index/index.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../apps/client/src/pages/index/index.scss', import.meta.url), 'utf8')

const session = {
  user: { id: 'user-1', username: 'alice', roles: ['member'], createdAt: '2026-07-30T00:00:00.000Z' },
}

describe('H5 authentication API adapter', () => {
  afterEach(() => {
    setApiClientUnauthorizedHandler(undefined)
    vi.unstubAllGlobals()
  })

  it('uses only the frozen cookie-session routes and never sends a user id or session token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 200 }))
      .mockResolvedValueOnce(new Response(undefined, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiClient.register({ username: 'alice', password: 'password-123' })
    await apiClient.login({ username: 'alice', password: 'password-123' })
    await apiClient.getCurrentSession()
    await apiClient.logout()

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/auth/register', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ username: 'alice', password: 'password-123' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/auth/login', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ username: 'alice', password: 'password-123' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/v1/auth/session', expect.objectContaining({ credentials: 'same-origin' }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/v1/auth/logout', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: '{}',
    }))
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/userId|passwordHash|sessionToken|kb_session/i)
  })

  it.each(['register', 'login', 'logout'] as const)('does not retry an unknown %s write outcome', async (operation) => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('response lost'))
    vi.stubGlobal('fetch', fetchMock)

    const request = operation === 'register'
      ? apiClient.register({ username: 'alice', password: 'password-123' })
      : operation === 'login'
        ? apiClient.login({ username: 'alice', password: 'password-123' })
        : apiClient.logout()

    await expect(request).rejects.toSatisfy(isApiClientUnknownOutcome)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats an aborted authentication write as unknown without retrying or inferring failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('page closed', 'AbortError'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient.login({ username: 'alice', password: 'password-123' })).rejects.toSatisfy(isApiClientUnknownOutcome)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends the current 401 to the gate but ignores a 401 from an older authentication context', async () => {
    const unauthorized = vi.fn()
    setApiClientUnauthorizedHandler(unauthorized)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'authentication required', requestId: 'req-1' } }), { status: 401 })))

    await expect(apiClient.listItems()).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED', requestId: 'req-1' })
    expect(unauthorized).toHaveBeenCalledTimes(1)

    let resolveOldRequest!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveOldRequest = resolve })))
    const oldRequest = apiClient.listItems()
    advanceApiClientAuthenticationContext()
    resolveOldRequest(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'authentication required' } }), { status: 401 }))
    await expect(oldRequest).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).toHaveBeenCalledTimes(1)
  })

  it('does not treat expected authentication-route 401 responses as a business-session override', async () => {
    const unauthorized = vi.fn()
    setApiClientUnauthorizedHandler(unauthorized)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'invalid username or password' } }), { status: 401 })))

    await expect(apiClient.login({ username: 'alice', password: 'wrong-pass' })).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).not.toHaveBeenCalled()
  })
})

describe('H5 authentication gate UI boundary', () => {
  it('pre-gates user management by the current session role and fully unloads it after management 403', () => {
    expect(page).toContain('const isPlatformAdministrator = hasPlatformAdminRole(session.user.roles)')
    expect(page).toContain("{isPlatformAdministrator && !managementAccessDenied && <View")
    expect(page).toContain("setActiveModule('actions')")
    expect(page).toContain('setAdministrationMounted(false)')
    expect(page).toContain('你的管理员权限已变化，无法继续访问用户管理。')
  })

  it('gives only the enabled logout button a visible hover response', () => {
    expect(styles).toContain('.navigation-logout:hover:not([disabled="true"])')
    expect(styles).toContain('background: #514c45; color: #fffaf2;')
    expect(styles).toContain('.navigation-logout:disabled, .navigation-session-confirm:disabled')
  })

  it('does not mount the business workspace before a real current session exists', () => {
    expect(page).toContain("if (authSession) return <AuthenticatedWorkspace")
    expect(page).toContain("void readCurrentSession('initial')")
    expect(page).toContain('确认完成前不会读取或展示业务数据。')
    expect(page.indexOf("if (authSession) return <AuthenticatedWorkspace")).toBeLessThan(page.indexOf("return <View className='auth-gate-shell'>"))
  })

  it('confirms login and registration through a real session read and preserves unknown-outcome drafts', () => {
    expect(page).toContain("await readCurrentSession('after-auth-write')")
    expect(page).toContain('setAuthUnknownOutcome(true)')
    expect(page).toContain('setAuthNeedsSessionConfirmation(true)')
    expect(page).toContain('未根据本地状态推断认证结果，也不会自动重发。')
    expect(page).toContain("source === 'after-auth-write' || source === 'manual'")
  })

  it('keeps an unknown logout in the current workspace until a factual session reread resolves it', () => {
    expect(page).toContain('setLogoutUnknownOutcome(true)')
    expect(page).toContain("readCurrentSession('confirm-unknown-logout')")
    expect(page).toContain('当前会话仍有效，未退出。')
    expect(page).toContain("setApiClientUnauthorizedHandler(() => enterUnauthenticatedGate('当前会话已过期，请重新登录。'))")
  })
})
