import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

type MockOptions = {
  initialSession?: boolean
  sessionFailure?: 503
  loginFailure?: 401
  duplicateRegistration?: boolean
  logoutFailure?: 503
  businessUnauthorized?: boolean
}

const root = join(process.cwd(), 'apps/client/dist')
const authSession = { user: { id: 'auth-user', username: 'alice', createdAt: '2026-07-30T00:00:00.000Z' } }
const contentType = (path: string) => ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(path)] ?? 'application/octet-stream')
let browser: Browser

function startMockH5(options: MockOptions = {}): Promise<{ server: Server; url: string; calls: Map<string, number>; setSession: (value: boolean) => void }> {
  const calls = new Map<string, number>()
  let hasSession = options.initialSession ?? false
  const count = (path: string) => calls.set(path, (calls.get(path) ?? 0) + 1)
  const json = (response: import('node:http').ServerResponse, value: unknown, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) }
  const error = (response: import('node:http').ServerResponse, status: number, code: string, message: string, requestId: string) => json(response, { error: { code, message, requestId } }, status)
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname.startsWith('/api/v1/')) {
      const route = `${request.method ?? 'GET'} ${url.pathname}`
      count(route)
      if (url.pathname === '/api/v1/auth/session') {
        if (options.sessionFailure) return error(response, 503, 'MYSQL_UNAVAILABLE', 'database unavailable', 'session-503')
        return hasSession ? json(response, authSession) : error(response, 401, 'UNAUTHORIZED', 'authentication required', 'session-401')
      }
      if (url.pathname === '/api/v1/auth/login' && request.method === 'POST') {
        if (options.loginFailure) return error(response, 401, 'UNAUTHORIZED', 'invalid username or password', 'login-401')
        hasSession = true
        return json(response, authSession)
      }
      if (url.pathname === '/api/v1/auth/register' && request.method === 'POST') {
        if (options.duplicateRegistration) return error(response, 409, 'CONFLICT', 'username already exists', 'register-409')
        hasSession = true
        return json(response, authSession, 201)
      }
      if (url.pathname === '/api/v1/auth/logout' && request.method === 'POST') {
        if (options.logoutFailure) return error(response, 503, 'MYSQL_UNAVAILABLE', 'database unavailable', 'logout-503')
        hasSession = false
        response.writeHead(204); response.end(); return
      }
      if (options.businessUnauthorized) return error(response, 401, 'UNAUTHORIZED', 'authentication required', 'business-401')
      if (url.pathname === '/api/v1/items' || url.pathname === '/api/v1/items/trash' || url.pathname === '/api/v1/methods') return json(response, [])
      return json(response, [])
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '')
    const file = normalize(join(root, relative))
    if (!file.startsWith(root)) { response.writeHead(403); response.end(); return }
    try { response.writeHead(200, { 'content-type': contentType(file) }); response.end(readFileSync(file)) }
    catch { response.writeHead(404); response.end() }
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    resolve({ server, url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/index.html`, calls, setSession: (value) => { hasSession = value } })
  }))
}

async function closeMock(page: Page, server: Server) {
  await page.close()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function fillCredentials(page: Page) {
  const inputs = page.locator('.auth-field input')
  await inputs.nth(0).fill('alice')
  await inputs.nth(1).fill('password-123')
}

async function newTestPage(): Promise<Page> {
  const page = await browser.newPage()
  page.setDefaultTimeout(3_000)
  return page
}

describe('H5 authentication gate browser flow', () => {
  beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 60_000)
  afterAll(async () => { await browser?.close() })

  it('keeps unauthenticated users outside the workbench, then enters only after login and a real session read', async () => {
    const mock = await startMockH5()
    const page = await newTestPage()
    try {
      await page.goto(mock.url)
      await page.locator('.auth-gate-card').waitFor()
      expect(await page.locator('.app-shell').count()).toBe(0)
      expect(mock.calls.get('GET /api/v1/items') ?? 0).toBe(0)
      await fillCredentials(page)
      await page.locator('.auth-primary-button').click()
      await page.locator('.app-shell').waitFor()
      expect(mock.calls.get('POST /api/v1/auth/login')).toBe(1)
      expect(mock.calls.get('GET /api/v1/auth/session')).toBe(2)
      expect(mock.calls.get('GET /api/v1/items')).toBe(1)
      await page.locator('.navigation-logout').click()
      await page.locator('.auth-gate-card').waitFor()
      expect(await page.locator('.app-shell').count()).toBe(0)
      expect(mock.calls.get('POST /api/v1/auth/logout')).toBe(1)
    } finally { await closeMock(page, mock.server) }
  }, 20_000)

  it('shows confirmed login and duplicate-registration failures with request ids while preserving drafts', async () => {
    for (const options of [{ loginFailure: 401 as const }, { duplicateRegistration: true }]) {
      const mock = await startMockH5(options)
      const page = await newTestPage()
      try {
        await page.goto(mock.url)
        await page.locator('.auth-gate-card').waitFor()
        if (options.duplicateRegistration) await page.locator('.auth-mode-switch > :nth-child(2)').click()
        await fillCredentials(page)
        await page.locator('.auth-primary-button').click()
        await page.locator('.auth-gate-error').waitFor()
        expect(await page.locator('.auth-gate-error').textContent()).toContain(options.duplicateRegistration ? 'register-409' : 'login-401')
        expect(await page.locator('.auth-field input').nth(0).inputValue()).toBe('alice')
        expect(await page.locator('.auth-field input').nth(1).inputValue()).toBe('password-123')
        expect(await page.locator('.app-shell').count()).toBe(0)
      } finally { await closeMock(page, mock.server) }
    }
  }, 20_000)

  it('keeps a 503 session failure as an explicit gate error without reading business data or retrying', async () => {
    const mock = await startMockH5({ sessionFailure: 503 })
    const page = await newTestPage()
    try {
      await page.goto(mock.url)
      await page.locator('.auth-gate-error').waitFor()
      expect(await page.locator('.auth-gate-error').textContent()).toContain('session-503')
      expect(await page.locator('.auth-mode-switch').count()).toBe(0)
      const before = new Map(mock.calls)
      await page.waitForTimeout(200)
      expect(mock.calls).toEqual(before)
      expect(mock.calls.get('GET /api/v1/items') ?? 0).toBe(0)
    } finally { await closeMock(page, mock.server) }
  }, 20_000)

  it('never resends a response-lost login and enters only after the user explicitly rereads the session', async () => {
    const mock = await startMockH5()
    const page = await newTestPage()
    try {
      await page.goto(mock.url)
      await page.locator('.auth-gate-card').waitFor()
      await page.evaluate(() => {
        const originalFetch = window.fetch.bind(window)
        ;(window as unknown as { authWriteCount: number }).authWriteCount = 0
        window.fetch = (input, init) => {
          if (String(input).endsWith('/api/v1/auth/login')) {
            ;(window as unknown as { authWriteCount: number }).authWriteCount += 1
            return Promise.reject(new TypeError('response lost'))
          }
          return originalFetch(input, init)
        }
      })
      mock.setSession(true)
      await fillCredentials(page)
      await page.locator('.auth-primary-button').click()
      await page.locator('.auth-confirm-session .auth-primary-button').waitFor()
      expect(await page.evaluate(() => (window as unknown as { authWriteCount: number }).authWriteCount)).toBe(1)
      expect(await page.locator('.auth-field input').nth(0).inputValue()).toBe('alice')
      await page.locator('.auth-confirm-session .auth-primary-button').click()
      await page.locator('.app-shell').waitFor()
      expect(await page.evaluate(() => (window as unknown as { authWriteCount: number }).authWriteCount)).toBe(1)
    } finally { await closeMock(page, mock.server) }
  }, 20_000)

  it('keeps an unknown logout in the workbench and confirms the still-valid session without resending logout', async () => {
    const mock = await startMockH5({ initialSession: true })
    const page = await newTestPage()
    try {
      await page.goto(mock.url)
      await page.locator('.app-shell').waitFor()
      await page.evaluate(() => {
        const originalFetch = window.fetch.bind(window)
        ;(window as unknown as { authWriteCount: number }).authWriteCount = 0
        window.fetch = (input, init) => {
          if (String(input).endsWith('/api/v1/auth/logout')) {
            ;(window as unknown as { authWriteCount: number }).authWriteCount += 1
            return Promise.reject(new TypeError('response lost'))
          }
          return originalFetch(input, init)
        }
      })
      await page.locator('.navigation-logout').click()
      await page.locator('.navigation-session-confirm').waitFor()
      expect(await page.locator('.app-shell').count()).toBe(1)
      await page.locator('.navigation-session-confirm').click()
      await page.getByText('当前会话仍有效，未退出。').waitFor()
      expect(await page.evaluate(() => (window as unknown as { authWriteCount: number }).authWriteCount)).toBe(1)
    } finally { await closeMock(page, mock.server) }
  }, 20_000)

  it('keeps the authenticated workbench and shows the real error when logout returns 503', async () => {
    const mock = await startMockH5({ initialSession: true, logoutFailure: 503 })
    const page = await newTestPage()
    try {
      await page.goto(mock.url)
      await page.locator('.app-shell').waitFor()
      await page.locator('.navigation-logout').click()
      await page.getByText(/logout-503/).waitFor()
      expect(await page.locator('.app-shell').count()).toBe(1)
      expect(mock.calls.get('POST /api/v1/auth/logout')).toBe(1)
      const before = new Map(mock.calls)
      await page.waitForTimeout(200)
      expect(mock.calls).toEqual(before)
    } finally { await closeMock(page, mock.server) }
  }, 20_000)

  it('returns to the login gate when an authenticated business request receives 401', async () => {
    const mock = await startMockH5({ initialSession: true, businessUnauthorized: true })
    const page = await newTestPage()
    try {
      await page.goto(mock.url)
      await page.getByText('当前会话已过期，请重新登录。').waitFor()
      expect(await page.locator('.app-shell').count()).toBe(0)
      expect(await page.locator('.auth-gate-card').count()).toBe(1)
    } finally { await closeMock(page, mock.server) }
  }, 20_000)
})
