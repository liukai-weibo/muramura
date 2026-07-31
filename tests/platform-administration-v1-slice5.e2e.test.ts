import crypto from 'node:crypto'
import type { BrowserContext, Page } from 'playwright'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cookieAttributes,
  slice5ExecutionEnabled,
  Slice5Harness,
  type HttpResult,
} from './helpers/platform-administration-v1-slice5-harness'

interface RegisteredUser {
  id: string
  username: string
  password: string
  cookie: string
  context?: BrowserContext
  page?: Page
}

interface AuthBody {
  user: { id: string; username: string; roles: string[]; createdAt: string }
}

const suite = slice5ExecutionEnabled ? describe.sequential : describe.skip
const harness = new Slice5Harness()
const users = new Map<string, RegisteredUser>()
let activeAdmin!: RegisteredUser

function password(): string {
  const value = `S5-${crypto.randomBytes(18).toString('base64url')}`
  harness.rememberSecret(value)
  return value
}

function operationId(): string {
  const value = crypto.randomUUID()
  harness.rememberSecret(value)
  return value
}

function expectError(response: HttpResult<any>, status: number, code: string): void {
  expect(response.status).toBe(status)
  expect(response.body).toMatchObject({ error: { code, requestId: expect.any(String) } })
  expect(response.headers['cache-control']).toBe('no-store')
  expect(response.headers['x-request-id']).toBe(response.body.error.requestId)
}

async function registerApi(username: string): Promise<RegisteredUser> {
  const secret = password()
  const response = await harness.proxyRequest<AuthBody>('/api/v1/auth/register', { method: 'POST', body: { username, password: secret } })
  expect(response.status).toBe(201)
  expect(response.body.user.roles).toEqual(['member'])
  expect(JSON.stringify(response.body)).not.toMatch(/password|hash|token|secret|cookie/i)
  const user = { id: response.body.user.id, username, password: secret, cookie: harness.cookieOf(response) }
  users.set(username, user)
  return user
}

async function registerH5(username: string): Promise<RegisteredUser> {
  const secret = password()
  const { context, page } = await harness.context()
  await page.goto(`http://127.0.0.1:${harness.h5Port}/index.html`)
  await page.locator('.auth-gate-card').waitFor()
  await page.locator('.auth-mode-switch > :nth-child(2)').click()
  const fields = page.locator('.auth-field input')
  await fields.nth(0).fill(username)
  await fields.nth(1).fill(secret)
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/register'))
  await page.locator('.auth-primary-button').click()
  const response = await responsePromise
  expect(response.status()).toBe(201)
  const body = await response.json() as AuthBody
  await page.locator('.app-shell').waitFor()
  const cookies = await context.cookies()
  const session = cookies.find(cookie => cookie.name === 'kb_session')
  expect(session).toMatchObject({ httpOnly: true, secure: false, sameSite: 'Lax', path: '/' })
  expect(session?.expires ?? 0).toBeGreaterThan(Date.now() / 1000)
  harness.rememberSecret(session?.value)
  const cookie = `kb_session=${session?.value}`
  const user = { id: body.user.id, username, password: secret, cookie, context, page }
  users.set(username, user)
  return user
}

async function loginApi(user: RegisteredUser): Promise<string> {
  const response = await harness.proxyRequest<AuthBody>('/api/v1/auth/login', { method: 'POST', body: { username: user.username, password: user.password } })
  expect(response.status).toBe(200)
  return harness.cookieOf(response)
}

async function openManagement(user: RegisteredUser): Promise<Page> {
  if (!user.context || !user.page) {
    const pair = await harness.context()
    user.context = pair.context; user.page = pair.page
    const value = user.cookie.slice(user.cookie.indexOf('=') + 1)
    await user.context.addCookies([{ name: 'kb_session', value, url: `http://127.0.0.1:${harness.h5Port}`, httpOnly: true, sameSite: 'Lax' }])
    harness.rememberSecret(value)
    await user.page.goto(`http://127.0.0.1:${harness.h5Port}/index.html`)
    await user.page.locator('.app-shell').waitFor()
  }
  const page = user.page
  const navigation = page.locator('.navigation-item').filter({ hasText: '用户管理' })
  await navigation.waitFor()
  await navigation.click()
  await page.locator('.platform-administration-title').waitFor()
  await page.locator('.platform-administration-skeleton').waitFor({ state: 'detached' })
  return page
}

async function clearManagementSearch(page: Page): Promise<void> {
  const search = page.getByRole('textbox', { name: '按用户名搜索' })
  await search.fill('')
  await page.locator('.platform-administration-search-button').click()
  await page.getByText('第 1 / 2 页', { exact: true }).waitFor()
}

async function locateManagementUser(page: Page, username: string): Promise<void> {
  const search = page.getByRole('textbox', { name: '按用户名搜索' })
  await search.fill(username)
  await page.locator('.platform-administration-search-button').click()
  const row = page.locator('.platform-user-row').filter({ hasText: username })
  await row.waitFor()
  expect(await row.count()).toBe(1)
  await row.getByRole('button', { name: `管理${username}` }).waitFor()
}

async function manageRole(page: Page, username: string, action: 'grant' | 'revoke', mode?: 'drop' | 'fault'): Promise<void> {
  const row = page.locator('.platform-user-row').filter({ hasText: username })
  await row.waitFor()
  await row.getByRole('button', { name: `管理${username}` }).click()
  await row.getByText(action === 'grant' ? '授予管理员' : '撤销管理员', { exact: true }).click()
  if (mode === 'drop') harness.setMode('drop-next-completed-write-response')
  if (mode === 'fault') harness.setMode('route-next-request-to-mysql-unavailable-api')
  await page.locator('.platform-confirmation').getByText(action === 'grant' ? '确认授予' : '撤销管理员', { exact: true }).click()
}

async function revokeSessions(page: Page, username: string, drop = false): Promise<void> {
  const row = page.locator('.platform-user-row').filter({ hasText: username })
  await row.waitFor()
  await row.getByRole('button', { name: `管理${username}` }).click()
  await row.getByText('撤销全部会话', { exact: true }).click()
  if (drop) harness.setMode('drop-next-completed-write-response')
  await page.locator('.platform-confirmation').getByText('撤销全部会话', { exact: true }).click()
}

function writeCount(method: string, fragment: string): number {
  return harness.network.filter(record => record.method === method && record.path.includes(fragment)).length
}

function observeTruncatedWrite(page: Page, pathFragment: string): { verify: () => Promise<void> } {
  const responseSeen = page.waitForResponse(response => response.url().includes(pathFragment) && response.request().method() !== 'GET')
  const failureSeen = page.waitForEvent('requestfailed', {
    predicate: request => request.url().includes(pathFragment) && request.method() !== 'GET',
  })
  return {
    verify: async () => {
      const [response, failedRequest] = await Promise.all([responseSeen, failureSeen])
      expect(response.status()).toBe(200)
      expect(failedRequest.failure()?.errorText).toContain('ERR_CONTENT_LENGTH_MISMATCH')
    },
  }
}

function expectSingleCompletedWrite(method: string, pathFragment: string, before: number): void {
  const records = harness.network.filter(record => record.method === method && record.path.includes(pathFragment))
  expect(records).toHaveLength(before + 1)
  expect(records.at(-1)).toMatchObject({ method, status: 200, operationId: '<redacted>' })
}

suite('platform administration V1 slice 5 random Schema 6 full-chain isolated QA', () => {
  beforeAll(async () => { await harness.setup() }, 120_000)

  afterAll(async () => { await harness.cleanup() }, 120_000)

  it('rejects Schema 5 before listening, accepts unchanged 006, and exposes only random Schema 6 health', async () => {
    expect(harness.startupFacts).toEqual({ schema5Rejected: true, schema6Allowed: true })
    expect(await harness.schemaFacts()).toEqual({ version: 6, tableCount: 17, platformTableCount: 2 })
    expect(harness.normalApiPort).not.toBe(32146)
    expect(harness.h5Port).not.toBe(10086)
    expect(harness.faultApiPort).not.toBe(32146)
    const direct = await harness.request<any>('/health')
    const proxy = await harness.proxyRequest<any>('/health')
    for (const response of [direct, proxy]) expect(response).toMatchObject({ status: 200, body: { status: 'ready', database: harness.names.database, schemaVersion: 6 } })
    expect(JSON.stringify(harness.grantFacts)).not.toMatch(/GRANT OPTION|ALL PRIVILEGES/i)
  })

  it('bootstraps the only initial administrator and refreshes the old real Cookie without relogin', async () => {
    const admin = await registerH5(`s5_admin_${harness.names.runId.slice(0, 8)}`)
    const memberA = await registerH5(`s5_member_a_${harness.names.runId.slice(0, 8)}`)
    await registerH5(`s5_member_b_${harness.names.runId.slice(0, 8)}`)
    expect(await admin.page!.locator('.navigation-item').filter({ hasText: '用户管理' }).count()).toBe(0)
    const sessionBefore = await harness.proxyRequest<AuthBody>('/api/v1/auth/session', { cookie: admin.cookie })
    expect(sessionBefore.body.user.roles).toEqual(['member'])

    const initialized = await harness.runInitialAdmin(admin.id)
    expect(initialized).toEqual({ code: 0, status: 'granted', database: harness.names.database, userId: admin.id })
    const sessionAfter = await harness.proxyRequest<AuthBody>('/api/v1/auth/session', { cookie: admin.cookie })
    expect(sessionAfter.body.user.roles).toEqual(['member', 'platform_admin'])
    await admin.page!.reload()
    await admin.page!.locator('.navigation-item').filter({ hasText: '用户管理' }).waitFor()
    await openManagement(admin)

    expect(await harness.runInitialAdmin(admin.id)).toEqual({ code: 0, status: 'already-initialized', database: harness.names.database, userId: admin.id })
    const other = await harness.runInitialAdmin(memberA.id)
    expect(other.code).toBe(1)
    const [audit] = await harness.app!.query<Array<RowDataPacket & { count: number }>>("SELECT COUNT(*) count FROM security_audit_events WHERE action_code='platform_admin_granted' AND actor_user_id IS NULL")
    expect(Number(audit[0]?.count)).toBe(1)
    activeAdmin = admin
  }, 60_000)

  it('uses real registration, fixed twenty-row pages, literal search, refresh, and no internal data in H5', async () => {
    const literalUsername = `literal%_=${harness.names.runId.slice(0, 6)}`
    await registerApi(literalUsername)
    while (users.size < 24) await registerApi(`s5_page_${String(users.size).padStart(2, '0')}_${harness.names.runId.slice(0, 5)}`)
    const page = await openManagement(activeAdmin)
    const first = await harness.proxyRequest<any>('/api/v1/admin/users?page=1', { cookie: activeAdmin.cookie })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ page: 1, pageSize: 20, total: users.size })
    expect(first.body.items).toHaveLength(20)
    const second = await harness.proxyRequest<any>('/api/v1/admin/users?page=2', { cookie: activeAdmin.cookie })
    expect(second.body.items).toHaveLength(users.size - 20)
    const literal = await harness.proxyRequest<any>(`/api/v1/admin/users?page=1&query=${encodeURIComponent('%_=')}`, { cookie: activeAdmin.cookie })
    expect(literal.body.items.map((entry: { username: string }) => entry.username)).toEqual([literalUsername])
    expect(Object.keys(literal.body.items[0])).toEqual(['id', 'username', 'roles', 'createdAt'])

    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    const search = page.getByLabel('按用户名搜索')
    expect(await page.locator('.app-shell').count()).toBe(1)
    const networkBeforeInput = harness.network.length
    await search.fill('%_=')
    await page.waitForTimeout(100)
    expect(pageErrors).toEqual([])
    if (await page.locator('.app-shell').count() !== 1) {
      const statuses = harness.network.slice(networkBeforeInput).map(record => record.status).join('-') || 'none'
      const gate = await page.locator('.auth-gate-card').count() ? 'auth-gate' : 'no-auth-gate'
      const location = page.isClosed() ? 'closed' : new URL(page.url()).pathname.replace(/[^a-z0-9._/-]/gi, '') || 'root'
      const rootCount = page.isClosed() ? -1 : await page.locator('#app').count()
      const childCount = page.isClosed() ? -1 : await page.locator('#app > *').count()
      const consoleClass = consoleErrors.some(message => /currentTarget|null|value/i.test(message)) ? 'event-value-error' : consoleErrors.length ? 'console-error' : 'no-console-error'
      throw new Error(`SLICE5_H5_SEARCH_WORKSPACE_UNMOUNTED_${gate}_${statuses}_${location}_${rootCount}_${childCount}_${consoleClass}`)
    }
    await page.locator('.platform-administration-search-button').click()
    await page.locator('.platform-user-row').filter({ hasText: literalUsername }).waitFor()
    await page.getByText('清除', { exact: true }).click()
    await page.locator('.platform-user-row').first().waitFor()
    await page.getByText('下一页', { exact: true }).click()
    await page.getByText('第 2 / 2 页', { exact: true }).waitFor()
    await page.getByText('上一页', { exact: true }).click()
    await page.getByText('第 1 / 2 页', { exact: true }).waitFor()
    await page.getByText('刷新', { exact: true }).click()
    await page.getByText('正在读取最新用户信息').waitFor({ state: 'detached' })
    const text = await page.locator('.platform-administration').textContent()
    for (const user of users.values()) expect(text).not.toContain(user.id)
    expect(text).not.toMatch(/password|hash|cookie|session secret|audit|email/i)
  }, 60_000)

  it('completes H5 role and session management with live old-Cookie role refresh and 403 teardown', async () => {
    const adminPage = await openManagement(activeAdmin)
    const memberA = [...users.values()].find(user => user.username.includes('member_a_'))!
    const beforePut = writeCount('PUT', `/admin/users/${memberA.id}/roles`)
    await locateManagementUser(adminPage, memberA.username)
    await manageRole(adminPage, memberA.username, 'grant')
    await adminPage.getByText('已授予平台管理员权限。').waitFor()
    expect(writeCount('PUT', `/admin/users/${memberA.id}/roles`) - beforePut).toBe(1)
    expect(harness.network.at(-1)).toMatchObject({ method: 'PUT', operationId: '<redacted>', status: 200 })
    expect((await harness.proxyRequest<AuthBody>('/api/v1/auth/session', { cookie: memberA.cookie })).body.user.roles).toEqual(['member', 'platform_admin'])
    await memberA.page!.reload()
    await openManagement(memberA)

    await locateManagementUser(adminPage, memberA.username)
    await manageRole(adminPage, memberA.username, 'revoke')
    await adminPage.getByText('已撤销平台管理员权限。').waitFor()
    const forbiddenResponse = memberA.page!.waitForResponse(response => response.url().includes('/api/v1/admin/users') && response.status() === 403)
    await memberA.page!.getByText('刷新', { exact: true }).click()
    expect((await forbiddenResponse).status()).toBe(403)
    const actionTitle = memberA.page!.locator('.global-module-title')
    await actionTitle.waitFor()
    expect(await actionTitle.count()).toBe(1)
    expect(await actionTitle.textContent()).toBe('行动')
    expect(await memberA.page!.locator('.platform-administration').count()).toBe(0)
    expect(await memberA.page!.locator('.navigation-item').filter({ hasText: '用户管理' }).count()).toBe(0)
    expect((await harness.proxyRequest<AuthBody>('/api/v1/auth/session', { cookie: memberA.cookie })).body.user.roles).toEqual(['member'])

    const target = await registerApi(`s5_sessions_${harness.names.runId.slice(0, 6)}`)
    const secondCookie = await loginApi(target)
    const beforePost = writeCount('POST', `/admin/users/${target.id}/revoke-sessions`)
    await locateManagementUser(adminPage, target.username)
    await revokeSessions(adminPage, target.username)
    await adminPage.getByText(/已撤销 \d+ 个登录会话。/).waitFor()
    expect(writeCount('POST', `/admin/users/${target.id}/revoke-sessions`) - beforePost).toBe(1)
    expectError(await harness.proxyRequest('/api/v1/auth/session', { cookie: target.cookie }), 401, 'UNAUTHORIZED')
    expectError(await harness.proxyRequest('/api/v1/auth/session', { cookie: secondCookie }), 401, 'UNAUTHORIZED')
    expect((await harness.proxyRequest('/api/v1/admin/users?page=1', { cookie: activeAdmin.cookie })).status).toBe(200)
    expectError(await harness.proxyRequest(`/api/v1/admin/users/${activeAdmin.id}/revoke-sessions`, { method: 'POST', cookie: activeAdmin.cookie, body: { operationId: operationId() } }), 403, 'FORBIDDEN')
  }, 60_000)

  it('enforces member 403, target 404, operation conflict, actor downgrade, self protection, and concurrent mutual revoke', async () => {
    const member = [...users.values()].find(user => user.username.includes('member_a_'))!
    const target = await registerApi(`s5_errors_${harness.names.runId.slice(0, 6)}`)
    const beforeSecurity = await harness.app!.query('SELECT * FROM security_audit_events ORDER BY id')
    for (const response of [
      await harness.proxyRequest('/api/v1/admin/users?page=1', { cookie: member.cookie }),
      await harness.proxyRequest(`/api/v1/admin/users/${target.id}/roles`, { method: 'PUT', cookie: member.cookie, body: { roles: ['member', 'platform_admin'], operationId: operationId() } }),
      await harness.proxyRequest(`/api/v1/admin/users/${target.id}/revoke-sessions`, { method: 'POST', cookie: member.cookie, body: { operationId: operationId() } }),
      await harness.proxyRequest('/api/v1/admin/users/missing/roles', { method: 'PUT', cookie: member.cookie, body: { invalid: true } }),
    ]) expectError(response, 403, 'FORBIDDEN')
    expect(await harness.app!.query('SELECT * FROM security_audit_events ORDER BY id')).toEqual(beforeSecurity)
    expectError(await harness.proxyRequest('/api/v1/admin/users/missing/roles', { method: 'PUT', cookie: activeAdmin.cookie, body: { roles: ['member'], operationId: operationId() } }), 404, 'NOT_FOUND')
    expectError(await harness.proxyRequest(`/api/v1/admin/users/${activeAdmin.id}/roles`, { method: 'PUT', cookie: activeAdmin.cookie, body: { roles: ['member'], operationId: operationId() } }), 403, 'FORBIDDEN')

    const replay = operationId()
    expect((await harness.proxyRequest(`/api/v1/admin/users/${target.id}/roles`, { method: 'PUT', cookie: activeAdmin.cookie, body: { roles: ['member', 'platform_admin'], operationId: replay } })).status).toBe(200)
    expectError(await harness.proxyRequest(`/api/v1/admin/users/${target.id}/roles`, { method: 'PUT', cookie: activeAdmin.cookie, body: { roles: ['member'], operationId: replay } }), 409, 'CONFLICT')

    const actorConnection = await harness.app!.getConnection()
    try {
      await actorConnection.beginTransaction()
      await actorConnection.query("SELECT user_id FROM user_roles FORCE INDEX (user_roles_role_user_idx) WHERE role_code='platform_admin' ORDER BY user_id FOR UPDATE")
      const auditBefore = Number((await harness.app!.query<any[]>("SELECT COUNT(*) count FROM security_audit_events"))[0][0].count)
      const pending = harness.proxyRequest(`/api/v1/admin/users/${target.id}/roles`, { method: 'PUT', cookie: activeAdmin.cookie, body: { roles: ['member'], operationId: operationId() } })
      await new Promise(resolve => setTimeout(resolve, 50))
      await actorConnection.query("DELETE FROM user_roles WHERE user_id=? AND role_code='platform_admin'", [activeAdmin.id])
      await actorConnection.commit()
      expectError(await pending, 403, 'FORBIDDEN')
      expect(Number((await harness.app!.query<any[]>("SELECT COUNT(*) count FROM security_audit_events"))[0][0].count)).toBe(auditBefore)
    } finally {
      try { await actorConnection.rollback() } catch { /* committed path */ }
      actorConnection.release()
      await harness.app!.query("INSERT IGNORE INTO user_roles(user_id,role_code,granted_by_user_id,created_at) VALUES (?,'platform_admin',NULL,UTC_TIMESTAMP(3))", [activeAdmin.id])
    }

    const adminB = target
    const adminBCookie = adminB.cookie
    const auditBeforeMutual = Number((await harness.app!.query<any[]>("SELECT COUNT(*) count FROM security_audit_events WHERE action_code='platform_admin_revoked'"))[0][0].count)
    const [aResult, bResult] = await Promise.all([
      harness.proxyRequest(`/api/v1/admin/users/${adminB.id}/roles`, { method: 'PUT', cookie: activeAdmin.cookie, body: { roles: ['member'], operationId: operationId() } }),
      harness.proxyRequest(`/api/v1/admin/users/${activeAdmin.id}/roles`, { method: 'PUT', cookie: adminBCookie, body: { roles: ['member'], operationId: operationId() } }),
    ])
    expect([aResult.status, bResult.status].sort()).toEqual([200, 403])
    const [admins] = await harness.app!.query<Array<RowDataPacket & { user_id: string }>>("SELECT user_id FROM user_roles WHERE role_code='platform_admin' ORDER BY user_id")
    expect(admins).toHaveLength(1)
    expect(Number((await harness.app!.query<any[]>("SELECT COUNT(*) count FROM security_audit_events WHERE action_code='platform_admin_revoked'"))[0][0].count) - auditBeforeMutual).toBe(1)
    const adminBSession = await harness.proxyRequest<AuthBody>('/api/v1/auth/session', { cookie: adminBCookie })
    const activeSession = await harness.proxyRequest<AuthBody>('/api/v1/auth/session', { cookie: activeAdmin.cookie })
    activeAdmin = adminBSession.body.user.roles.includes('platform_admin') ? adminB : activeAdmin
    expect((adminBSession.body.user.roles.includes('platform_admin') ? 1 : 0) + (activeSession.body.user.roles.includes('platform_admin') ? 1 : 0)).toBe(1)
  }, 60_000)

  it('keeps role and session unknown outcomes honest across dropped responses, 503, Abort, and explicit rereads', async () => {
    const page = await openManagement(activeAdmin)
    const targetA = await registerApi(`s5_unknown_a_${harness.names.runId.slice(0, 5)}`)
    const targetB = await registerApi(`s5_unknown_b_${harness.names.runId.slice(0, 5)}`)

    await clearManagementSearch(page)
    await locateManagementUser(page, targetA.username)
    const beforeA = writeCount('PUT', `/admin/users/${targetA.id}/roles`)
    const targetAEvidence = observeTruncatedWrite(page, `/admin/users/${targetA.id}/roles`)
    await manageRole(page, targetA.username, 'grant', 'drop')
    await targetAEvidence.verify()
    const targetARow = page.locator('.platform-user-row').filter({ hasText: targetA.username })
    await targetARow.getByText('操作结果尚未确认。请显式刷新用户列表确认真实角色。').waitFor()
    await targetARow.getByText('刷新用户列表', { exact: true }).waitFor()
    expect(await targetARow.getByRole('button', { name: `管理${targetA.username}` }).count()).toBe(0)
    expect(await targetARow.locator('.platform-target-notice').textContent()).not.toMatch(/requestId/)
    expectSingleCompletedWrite('PUT', `/admin/users/${targetA.id}/roles`, beforeA)

    await clearManagementSearch(page)
    await locateManagementUser(page, targetB.username)
    const beforeB = writeCount('PUT', `/admin/users/${targetB.id}/roles`)
    const targetBEvidence = observeTruncatedWrite(page, `/admin/users/${targetB.id}/roles`)
    await manageRole(page, targetB.username, 'grant', 'drop')
    await targetBEvidence.verify()
    await page.locator('.platform-user-row').filter({ hasText: targetB.username }).getByText('刷新用户列表', { exact: true }).waitFor()
    expectSingleCompletedWrite('PUT', `/admin/users/${targetB.id}/roles`, beforeB)

    await locateManagementUser(page, targetA.username)
    await page.locator('.platform-user-row').filter({ hasText: targetA.username }).getByRole('button', { name: `管理${targetA.username}` }).waitFor()
    await locateManagementUser(page, targetB.username)
    await page.locator('.platform-user-row').filter({ hasText: targetB.username }).getByRole('button', { name: `管理${targetB.username}` }).waitFor()

    await clearManagementSearch(page)
    const target503 = await registerApi(`s5_unknown_503_${harness.names.runId.slice(0, 5)}`)
    await locateManagementUser(page, target503.username)
    await manageRole(page, target503.username, 'grant', 'fault')
    const target503Row = page.locator('.platform-user-row').filter({ hasText: target503.username })
    const notice503 = target503Row.locator('.platform-target-notice')
    await notice503.getByText('操作结果尚未确认。请显式刷新用户列表确认真实角色。').waitFor()
    expect(await notice503.textContent()).toMatch(/requestId/)
    expect(await target503Row.getByRole('button', { name: `管理${target503.username}` }).count()).toBe(0)
    const readsBefore503Recovery = writeCount('GET', '/api/v1/admin/users')
    const writesBefore503Recovery = writeCount('PUT', `/admin/users/${target503.id}/roles`)
    await target503Row.locator('.platform-user-actions').getByText('刷新用户列表', { exact: true }).click()
    await target503Row.getByRole('button', { name: `管理${target503.username}` }).waitFor()
    expect(writeCount('GET', '/api/v1/admin/users') - readsBefore503Recovery).toBe(1)
    expect(writeCount('PUT', `/admin/users/${target503.id}/roles`)).toBe(writesBefore503Recovery)
    expect(await target503Row.locator('.platform-target-notice').count()).toBe(0)

    await clearManagementSearch(page)
    const abortTarget = await registerApi(`s5_unknown_abort_${harness.names.runId.slice(0, 5)}`)
    await locateManagementUser(page, abortTarget.username)
    await page.evaluate(() => {
      const original = window.fetch.bind(window)
      let armed = true
      window.fetch = async (input, init) => {
        const response = await original(input, init)
        if (armed && String(input).includes('/roles')) { armed = false; throw new DOMException('delivery aborted', 'AbortError') }
        return response
      }
    })
    await manageRole(page, abortTarget.username, 'grant')
    const abortTargetRow = page.locator('.platform-user-row').filter({ hasText: abortTarget.username })
    const abortNotice = abortTargetRow.locator('.platform-target-notice')
    await abortNotice.getByText('操作结果尚未确认。请显式刷新用户列表确认真实角色。', { exact: true }).waitFor()
    expect(await abortTargetRow.getByRole('button', { name: `管理${abortTarget.username}` }).count()).toBe(0)
    const readsBeforeAbortRecovery = writeCount('GET', '/api/v1/admin/users')
    const writesBeforeAbortRecovery = writeCount('PUT', `/admin/users/${abortTarget.id}/roles`)
    await abortTargetRow.locator('.platform-user-actions').getByText('刷新用户列表', { exact: true }).click()
    await abortTargetRow.getByRole('button', { name: `管理${abortTarget.username}` }).waitFor()
    expect(writeCount('GET', '/api/v1/admin/users') - readsBeforeAbortRecovery).toBe(1)
    expect(writeCount('PUT', `/admin/users/${abortTarget.id}/roles`)).toBe(writesBeforeAbortRecovery)
    expect(await abortTargetRow.locator('.platform-target-notice').count()).toBe(0)

    await clearManagementSearch(page)
    const sessionTarget = await registerApi(`s5_session_unknown_${harness.names.runId.slice(0, 5)}`)
    await locateManagementUser(page, sessionTarget.username)
    const sessionPostsBefore = writeCount('POST', `/admin/users/${sessionTarget.id}/revoke-sessions`)
    const sessionEvidence = observeTruncatedWrite(page, `/admin/users/${sessionTarget.id}/revoke-sessions`)
    await revokeSessions(page, sessionTarget.username, true)
    await sessionEvidence.verify()
    const sessionRow = page.locator('.platform-user-row').filter({ hasText: sessionTarget.username })
    await sessionRow.getByText('再次撤销会话').waitFor()
    expect(await sessionRow.getByRole('button', { name: `管理${sessionTarget.username}` }).count()).toBe(0)
    expect(await sessionRow.locator('.platform-target-notice').textContent()).not.toMatch(/requestId/)
    expectSingleCompletedWrite('POST', `/admin/users/${sessionTarget.id}/revoke-sessions`, sessionPostsBefore)
    await page.getByText('刷新', { exact: true }).click()
    await page.getByText('正在读取最新用户信息').waitFor({ state: 'detached' })
    await sessionRow.getByText('再次撤销会话').click()
    await page.locator('.platform-confirmation').getByText('取消', { exact: true }).click()
    await sessionRow.getByText('再次撤销会话').waitFor()
    await sessionRow.getByText('再次撤销会话').click()
    await page.locator('.platform-confirmation').getByText('撤销全部会话', { exact: true }).click()
    await sessionRow.getByText('当前没有需要撤销的有效会话。').waitFor()
    expect(writeCount('POST', `/admin/users/${sessionTarget.id}/revoke-sessions`) - sessionPostsBefore).toBe(2)
    expect(harness.distinctOperationIds('POST', `/admin/users/${sessionTarget.id}/revoke-sessions`)).toBe(2)
  }, 120_000)

  it('does not let platform_admin bypass ten business collections or current-user Backup scope', async () => {
    const ownerA = activeAdmin
    const ownerB = await registerApi(`s5_owner_b_${harness.names.runId.slice(0, 6)}`)
    expect((await harness.proxyRequest(`/api/v1/admin/users/${ownerB.id}/roles`, { method: 'PUT', cookie: ownerA.cookie, body: { roles: ['member', 'platform_admin'], operationId: operationId() } })).status).toBe(200)

    const track = await harness.proxyRequest<any>('/api/v1/exploration-tracks', { method: 'POST', cookie: ownerA.cookie, body: { name: `s5-track-${harness.names.runId.slice(0, 6)}` } })
    const trackId = track.body.id as string
    const source = await harness.proxyRequest<any>('/api/v1/items', { method: 'POST', cookie: ownerA.cookie, body: { title: 's5-owner-source', explorationTrack: { type: 'existing', trackId } } })
    const itemId = source.body.id as string
    await harness.proxyRequest(`/api/v1/items/${itemId}/start`, { method: 'POST', cookie: ownerA.cookie, body: { startAction: 'act' } })
    const completed = await harness.proxyRequest<any>('/api/v1/reviews/complete', { method: 'POST', cookie: ownerA.cookie, body: {
      itemId, actualAction: 'done', result: 's5-owner-result', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: 's5-owner-derived',
      method: { title: 's5-owner-method', applicable: 's5-owner-needle', steps: 'step' },
    } })
    expect(completed.status).toBe(201)
    const reviewId = completed.body.review.id as string
    const methodId = completed.body.method.id as string
    const derivedId = completed.body.createdIdea.id as string
    const applied = await harness.proxyRequest<any>('/api/v1/method-applications', { method: 'POST', cookie: ownerA.cookie, body: { methodId, title: 's5-owner-applied' } })
    const appliedId = applied.body.id as string

    expect((await harness.proxyRequest<any>('/api/v1/items', { cookie: ownerB.cookie })).body).toEqual([])
    expect((await harness.proxyRequest<any>('/api/v1/methods', { cookie: ownerB.cookie })).body).toEqual([])
    expect((await harness.proxyRequest<any>('/api/v1/exploration-tracks', { cookie: ownerB.cookie })).body).toEqual([])
    expect((await harness.proxyRequest<any>('/api/v1/search?query=s5-owner-needle', { cookie: ownerB.cookie })).body).toEqual([])
    expect((await harness.proxyRequest<any>('/api/v1/dashboard?window=all', { cookie: ownerB.cookie })).body.metrics.newItems).toBe(0)

    const before = await harness.businessSnapshot()
    const crossResponses = [
      await harness.proxyRequest(`/api/v1/items/${itemId}`, { cookie: ownerB.cookie }),
      await harness.proxyRequest(`/api/v1/items/${itemId}/status-events`, { cookie: ownerB.cookie }),
      await harness.proxyRequest(`/api/v1/items/${itemId}/exploration-track`, { cookie: ownerB.cookie }),
      await harness.proxyRequest(`/api/v1/reviews/${reviewId}`, { cookie: ownerB.cookie }),
      await harness.proxyRequest(`/api/v1/reviews/by-item/${itemId}`, { cookie: ownerB.cookie }),
      await harness.proxyRequest(`/api/v1/methods/${methodId}/versions`, { cookie: ownerB.cookie }),
      await harness.proxyRequest(`/api/v1/methods/${methodId}/evidence`, { cookie: ownerB.cookie }),
      await harness.proxyRequest(`/api/v1/methods/by-review/${reviewId}`, { cookie: ownerB.cookie }),
      await harness.proxyRequest(`/api/v1/method-applications/${appliedId}/context`, { cookie: ownerB.cookie }),
      await harness.proxyRequest(`/api/v1/exploration-tracks/${trackId}/history`, { cookie: ownerB.cookie }),
      await harness.proxyRequest(`/api/v1/items/${itemId}/status`, { method: 'POST', cookie: ownerB.cookie, body: { status: 'abandoned' } }),
      await harness.proxyRequest(`/api/v1/items/${itemId}/exploration-track`, { method: 'PUT', cookie: ownerB.cookie, body: { trackId } }),
      await harness.proxyRequest(`/api/v1/items/${itemId}`, { method: 'DELETE', cookie: ownerB.cookie }),
      await harness.proxyRequest(`/api/v1/exploration-tracks/${trackId}`, { method: 'DELETE', cookie: ownerB.cookie }),
    ]
    for (const response of crossResponses) expectError(response, 404, 'NOT_FOUND')
    expect(await harness.businessSnapshot()).toEqual(before)

    await harness.proxyRequest(`/api/v1/items/${derivedId}`, { method: 'DELETE', cookie: ownerA.cookie })
    expectError(await harness.proxyRequest(`/api/v1/items/${derivedId}/restore`, { method: 'POST', cookie: ownerB.cookie, body: {} }), 404, 'NOT_FOUND')
    await harness.proxyRequest(`/api/v1/items/${derivedId}/restore`, { method: 'POST', cookie: ownerA.cookie, body: {} })
    await harness.proxyRequest(`/api/v1/exploration-tracks/${trackId}`, { method: 'DELETE', cookie: ownerA.cookie })
    expectError(await harness.proxyRequest(`/api/v1/exploration-tracks/${trackId}/restore`, { method: 'POST', cookie: ownerB.cookie, body: {} }), 404, 'NOT_FOUND')
    await harness.proxyRequest(`/api/v1/exploration-tracks/${trackId}/restore`, { method: 'POST', cookie: ownerA.cookie, body: {} })
    await harness.proxyRequest(`/api/v1/methods/${methodId}`, { method: 'DELETE', cookie: ownerA.cookie })
    expectError(await harness.proxyRequest(`/api/v1/methods/${methodId}/restore`, { method: 'POST', cookie: ownerB.cookie, body: {} }), 404, 'NOT_FOUND')
    await harness.proxyRequest(`/api/v1/methods/${methodId}/restore`, { method: 'POST', cookie: ownerA.cookie, body: {} })

    const ownerABackup = await harness.proxyRequest<any>('/api/v1/backup', { cookie: ownerA.cookie })
    const ownerBBackup = await harness.proxyRequest<any>('/api/v1/backup', { cookie: ownerB.cookie })
    expect(JSON.stringify(ownerBBackup.body)).not.toContain(itemId)
    const beforeConflict = await harness.businessSnapshot()
    expectError(await harness.proxyRequest('/api/v1/backup/restore', { method: 'POST', cookie: ownerB.cookie, body: ownerABackup.body }), 409, 'CONFLICT')
    expect(await harness.businessSnapshot()).toEqual(beforeConflict)
    expect(JSON.stringify(ownerABackup.body)).not.toMatch(/owner_user_id|userId|password|hash|cookie|session|audit/i)

    const retained = await harness.proxyRequest<any>('/api/v1/items', { method: 'POST', cookie: ownerA.cookie, body: { title: 's5-retained-source' } })
    await harness.proxyRequest(`/api/v1/items/${retained.body.id}/start`, { method: 'POST', cookie: ownerA.cookie, body: { startAction: 'act' } })
    await harness.proxyRequest('/api/v1/reviews/complete', { method: 'POST', cookie: ownerA.cookie, body: {
      itemId: retained.body.id, actualAction: 'done', result: 's5-retained-result', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '',
      method: { title: 's5-retained-method', applicable: 's5-retained-needle', steps: 'step' },
    } })
    await harness.proxyRequest(`/api/v1/methods/${methodId}`, { method: 'DELETE', cookie: ownerA.cookie })
    await harness.app!.query('UPDATE methods SET deleted_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 31 DAY) WHERE id=? AND owner_user_id=?', [methodId, ownerA.id])
    expect((await harness.proxyRequest('/api/v1/trash?filter=method', { cookie: ownerA.cookie })).status).toBe(200)
    const [owners] = await harness.app!.query<Array<RowDataPacket & { table_name: string; owner_user_id: string; count: number }>>(`SELECT 'items' table_name,owner_user_id,COUNT(*) count FROM items GROUP BY owner_user_id UNION ALL SELECT 'reviews',owner_user_id,COUNT(*) FROM reviews GROUP BY owner_user_id UNION ALL SELECT 'methods',owner_user_id,COUNT(*) FROM methods GROUP BY owner_user_id UNION ALL SELECT 'method_evidence',owner_user_id,COUNT(*) FROM method_evidence GROUP BY owner_user_id UNION ALL SELECT 'method_versions',owner_user_id,COUNT(*) FROM method_versions GROUP BY owner_user_id UNION ALL SELECT 'method_applications',owner_user_id,COUNT(*) FROM method_applications GROUP BY owner_user_id UNION ALL SELECT 'item_status_events',owner_user_id,COUNT(*) FROM item_status_events GROUP BY owner_user_id UNION ALL SELECT 'item_links',owner_user_id,COUNT(*) FROM item_links GROUP BY owner_user_id UNION ALL SELECT 'method_tombstones',owner_user_id,COUNT(*) FROM method_tombstones GROUP BY owner_user_id UNION ALL SELECT 'exploration_tracks',owner_user_id,COUNT(*) FROM exploration_tracks GROUP BY owner_user_id`)
    expect(new Set(owners.map(row => row.table_name))).toEqual(new Set(['items', 'reviews', 'methods', 'method_evidence', 'method_versions', 'method_applications', 'item_status_events', 'item_links', 'method_tombstones', 'exploration_tracks']))
    expect(owners.every(row => row.owner_user_id === ownerA.id && Number(row.count) > 0)).toBe(true)
  }, 120_000)

  it('keeps public DTOs and permitted evidence free of credentials, secrets, hashes, audit data, and operation IDs', async () => {
    const session = await harness.proxyRequest<AuthBody>('/api/v1/auth/session', { cookie: activeAdmin.cookie })
    expect(Object.keys(session.body.user)).toEqual(['id', 'username', 'roles', 'createdAt'])
    expect(JSON.stringify(session.body)).not.toMatch(/password|hash|token|secret|cookie|audit|email/i)
    const attributes = cookieAttributes(await harness.proxyRequest('/api/v1/auth/login', { method: 'POST', body: { username: activeAdmin.username, password: activeAdmin.password } }))
    expect(attributes).toEqual({ httpOnly: true, sameSiteLax: true, pathRoot: true, expires: true, secure: false })
    expect(harness.network.every(record => record.operationId === 'absent' || record.operationId === '<redacted>')).toBe(true)
    expect(harness.sensitiveFindings()).toEqual([])
  })
})
