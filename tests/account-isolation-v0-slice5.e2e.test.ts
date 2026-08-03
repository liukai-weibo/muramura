import crypto from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import http, { type Server } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiServer } from '../apps/api/src/index'
import { createMySqlPool, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD'].every((name) => Boolean(process.env[name]))
const h5Root = join(process.cwd(), 'apps/client/dist')
const contentType = (path: string) => ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(path)] ?? 'application/octet-stream')

let database = ''
let appUser = ''
let migratorUser = ''
let appPassword = ''
let migratorPassword = ''
let root: ReturnType<typeof createMySqlPool>
let normalApi: Server
let faultApi: Server
let h5: Server
let browser: Browser
let normalApiPort = 0
let faultApiPort = 0
let activeApiPort = 0
const calls = new Map<string, number>()

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)))
}

function close(server: Server | undefined): Promise<void> {
  if (!server?.listening) return Promise.resolve()
  server.closeAllConnections()
  return new Promise((resolve) => server.close(() => resolve()))
}

function startH5Proxy(): Server {
  return http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
      const route = `${request.method ?? 'GET'} ${url.pathname}`
      calls.set(route, (calls.get(route) ?? 0) + 1)
      const headers = { ...request.headers }
      delete headers.host
      delete headers.origin
      const upstream = http.request({ host: '127.0.0.1', port: activeApiPort, method: request.method, path: url.pathname + url.search, headers }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
        upstreamResponse.pipe(response)
      })
      upstream.on('error', () => {
        response.writeHead(502, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'upstream unavailable', requestId: crypto.randomUUID() } }))
      })
      request.pipe(upstream)
      return
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '')
    const file = normalize(join(h5Root, relative))
    if (!file.startsWith(h5Root)) { response.writeHead(403); response.end(); return }
    try {
      response.writeHead(200, { 'content-type': contentType(file) })
      createReadStream(file).pipe(response)
    } catch {
      response.writeHead(404); response.end()
    }
  })
}

function apiJson(path: string, value: unknown): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: normalApiPort, path, method: 'POST', headers: { 'content-type': 'application/json' } }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString()
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: raw ? JSON.parse(raw) : undefined })
      })
    })
    request.on('error', reject)
    request.end(JSON.stringify(value))
  })
}

async function pageAndContext(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.setDefaultTimeout(5_000)
  return { context, page }
}

async function fillCredentials(page: Page, username: string, password = 'password-123'): Promise<void> {
  const fields = page.locator('.auth-field input')
  await fields.nth(0).fill(username)
  await fields.nth(1).fill(password)
}

describe.runIf(enabled)('online account isolation V0 slice 5 temporary-database browser QA', () => {
  beforeAll(async () => {
    expect(readFileSync(join(h5Root, 'index.html'), 'utf8')).toContain('<div id="app"></div>')
    const suffix = crypto.randomUUID().replaceAll('-', '')
    database = `kb_v0s5_${suffix}`
    appUser = `kb_v0s5_app_${suffix.slice(0, 16)}`
    migratorUser = `kb_v0s5_mig_${suffix.slice(0, 16)}`
    appPassword = crypto.randomUUID()
    migratorPassword = crypto.randomUUID()
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``)
    await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword])
    await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${database}\`.* TO '${appUser}'@'%'`)
    await root.query(`GRANT SELECT,INSERT,UPDATE,CREATE,ALTER,INDEX,REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`)
    const config = (user: string, password: string): MySqlConnectionConfig => ({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 2 })
    const migrator = createMySqlPool(config(migratorUser, migratorPassword))
    await runMySqlMigrations(migrator, `${process.cwd()}/migrations`)
    await migrator.end()
    normalApi = createApiServer(config(appUser, appPassword))
    faultApi = createApiServer(config(appUser, `wrong-${crypto.randomUUID()}`))
    normalApiPort = await listen(normalApi)
    faultApiPort = await listen(faultApi)
    activeApiPort = normalApiPort
    h5 = startH5Proxy()
    await listen(h5)
    browser = await chromium.launch({ headless: true })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await close(h5)
    await close(faultApi)
    await close(normalApi)
    if (root) {
      await root.query(`DROP DATABASE IF EXISTS \`${database}\``)
      await root.query(`DROP USER IF EXISTS '${appUser}'@'%'`)
      await root.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`)
      await root.end()
    }
  })

  it('completes the real H5 register/session/logout gate with real cookie attributes', async () => {
    activeApiPort = normalApiPort
    calls.clear()
    const { context, page } = await pageAndContext()
    const username = `browser_${crypto.randomUUID()}`
    try {
      await page.goto(`http://127.0.0.1:${(h5.address() as { port: number }).port}/index.html`)
      await page.locator('.auth-gate-card').waitFor()
      expect(await page.locator('.app-shell').count()).toBe(0)
      expect(calls.get('GET /api/v1/items') ?? 0).toBe(0)
      await page.locator('.auth-mode-switch > :nth-child(2)').click()
      await fillCredentials(page, username)
      const registeredResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/register'))
      await page.locator('.auth-primary-button').click()
      const registered = await registeredResponse
      expect(registered.status()).toBe(201)
      await page.locator('.app-shell').waitFor()
      expect(calls.get('POST /api/v1/auth/register')).toBe(1)
      expect(calls.get('GET /api/v1/auth/session')).toBe(2)
      expect(calls.get('GET /api/v1/items')).toBe(1)
      const cookies = await context.cookies()
      const session = cookies.find((cookie) => cookie.name === 'kb_session')
      expect(session).toMatchObject({ httpOnly: true, secure: false, sameSite: 'Lax', path: '/' })
      expect(session?.expires ?? 0).toBeGreaterThan(Date.now() / 1_000)
      expect(JSON.stringify(await registered.json())).not.toMatch(/password|hash|token|secret/i)
      await page.locator('.navigation-logout').click()
      await page.locator('.auth-gate-card').waitFor()
      expect(calls.get('POST /api/v1/auth/logout')).toBe(1)
      expect((await context.cookies()).some((cookie) => cookie.name === 'kb_session')).toBe(false)
    } finally { await context.close() }
  }, 30_000)

  it('does not resend a completed login response loss or completed logout Abort and confirms only by session GET', async () => {
    activeApiPort = normalApiPort
    calls.clear()
    const username = `unknown_${crypto.randomUUID()}`
    expect((await apiJson('/api/v1/auth/register', { username, password: 'password-123' })).status).toBe(201)
    const { context, page } = await pageAndContext()
    try {
      await page.goto(`http://127.0.0.1:${(h5.address() as { port: number }).port}/index.html`)
      await page.locator('.auth-gate-card').waitFor()
      await page.evaluate(() => {
        const originalFetch = window.fetch.bind(window)
        ;(window as unknown as { qaLoginWrites: number }).qaLoginWrites = 0
        window.fetch = async (input, init) => {
          const response = await originalFetch(input, init)
          if (String(input).endsWith('/api/v1/auth/login')) {
            ;(window as unknown as { qaLoginWrites: number }).qaLoginWrites += 1
            throw new TypeError('response delivery discarded')
          }
          return response
        }
      })
      await fillCredentials(page, username)
      await page.locator('.auth-primary-button').click()
      await page.locator('.auth-confirm-session .auth-primary-button').waitFor()
      expect(await page.locator('.auth-field input').nth(0).inputValue()).toBe(username)
      expect(await page.locator('.auth-field input').nth(1).inputValue()).toBe('password-123')
      expect(await page.evaluate(() => (window as unknown as { qaLoginWrites: number }).qaLoginWrites)).toBe(1)
      await page.locator('.auth-confirm-session .auth-primary-button').click()
      await page.locator('.app-shell').waitFor()
      expect(calls.get('POST /api/v1/auth/login')).toBe(1)

      await page.evaluate(() => {
        const currentFetch = window.fetch.bind(window)
        ;(window as unknown as { qaLogoutWrites: number }).qaLogoutWrites = 0
        window.fetch = async (input, init) => {
          const response = await currentFetch(input, init)
          if (String(input).endsWith('/api/v1/auth/logout')) {
            ;(window as unknown as { qaLogoutWrites: number }).qaLogoutWrites += 1
            throw new DOMException('page closed', 'AbortError')
          }
          return response
        }
      })
      await page.locator('.navigation-logout').click()
      await page.locator('.navigation-session-confirm').waitFor()
      expect(await page.locator('.app-shell').count()).toBe(1)
      expect(await page.evaluate(() => (window as unknown as { qaLogoutWrites: number }).qaLogoutWrites)).toBe(1)
      await page.locator('.navigation-session-confirm').click()
      await page.locator('.auth-gate-card').waitFor()
      expect(calls.get('POST /api/v1/auth/logout')).toBe(1)
    } finally { await context.close() }
  }, 30_000)

  it('shows a real wrong-password MySQL 503 and recovers only after explicit GET rereads', async () => {
    calls.clear()
    activeApiPort = faultApiPort
    const { context, page } = await pageAndContext()
    try {
      await context.addCookies([{
        name: 'kb_session',
        value: crypto.randomBytes(32).toString('base64url'),
        url: `http://127.0.0.1:${(h5.address() as { port: number }).port}`,
        httpOnly: true,
        sameSite: 'Lax',
      }])
      const sessionResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/session'))
      await page.goto(`http://127.0.0.1:${(h5.address() as { port: number }).port}/index.html`)
      const sessionResponse = await sessionResponsePromise
      expect(sessionResponse.status()).toBe(503)
      expect(await sessionResponse.json()).toMatchObject({ error: { code: 'MYSQL_UNAVAILABLE', requestId: expect.any(String) } })
      await page.locator('.auth-gate-error').waitFor()
      expect(await page.locator('.auth-gate-error').textContent()).toMatch(/requestId/)
      expect(await page.locator('.app-shell').count()).toBe(0)
      expect(calls.get('GET /api/v1/items') ?? 0).toBe(0)
      const before = new Map(calls)
      await page.waitForTimeout(200)
      expect(calls).toEqual(before)

      activeApiPort = normalApiPort
      await page.getByText('重新读取当前会话').click()
      await page.locator('.auth-mode-switch').waitFor()
      expect(calls.get('GET /api/v1/auth/session')).toBe(2)
      expect(calls.get('POST /api/v1/auth/login') ?? 0).toBe(0)
    } finally {
      activeApiPort = normalApiPort
      await context.close()
    }
  }, 30_000)
})
