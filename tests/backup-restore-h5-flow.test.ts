import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

type Failure = 'items' | 'methods' | 'trash-items' | 'trash-entries' | 'tracks' | 'history' | 'abort' | 'response-lost'

const root = join(process.cwd(), 'apps/client/dist')
const oldItem = { id: 'old-item', title: '旧事项事实', content: '', status: 'idea_to_try', createdAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z' }
const oldTrashItem = { ...oldItem, id: 'old-trash-item', title: '旧回收站事实', status: 'abandoned' }
const oldMethod = { id: 'old-method', title: '旧方法事实', applicable: '', unsuitable: '', steps: '', version: 1, validationCount: 0, createdAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z' }
const oldTrack = { id: 'old-track', name: '旧长期探索事实', createdAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z' }
const backup = { format: 'knowledge-base-backup', version: 3, exportedAt: '2026-07-29T00:00:00.000Z', appVersion: 'test', data: { items: [], reviews: [], methods: [], explorationTracks: [] } }
const history = { track: oldTrack, currentAssociatedItems: [], history: [], abandonedHistory: [] }
const authSession = { user: { id: 'test-user', username: 'backup-test', roles: ['member'], createdAt: '2026-07-30T00:00:00.000Z' } }
const contentType = (path: string) => ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(path)] ?? 'application/octet-stream')

let browser: Browser

function startMockH5(failure: Failure): Promise<{ server: Server; url: string; calls: Map<string, number> }> {
  const calls = new Map<string, number>()
  let restored = false
  const count = (path: string) => calls.set(path, (calls.get(path) ?? 0) + 1)
  const json = (response: import('node:http').ServerResponse, value: unknown, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) }
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname.startsWith('/api/v1/')) {
      const path = `${request.method ?? 'GET'} ${url.pathname}${url.search}`
      count(path)
      if (url.pathname === '/api/v1/auth/session' && request.method === 'GET') return json(response, authSession)
      if (url.pathname === '/api/v1/backup' && request.method === 'GET') return json(response, backup)
      if (url.pathname === '/api/v1/backup/restore' && request.method === 'POST') {
        restored = true
        if (failure === 'response-lost') { request.socket.destroy(); return }
        response.writeHead(204); response.end(); return
      }
      const failed = restored && ((failure === 'items' && url.pathname === '/api/v1/items')
        || (failure === 'trash-items' && url.pathname === '/api/v1/items/trash')
        || (failure === 'methods' && url.pathname === '/api/v1/methods')
        || (failure === 'trash-entries' && url.pathname === '/api/v1/trash')
        || (failure === 'tracks' && url.pathname === '/api/v1/exploration-tracks')
        || (failure === 'history' && url.pathname === '/api/v1/exploration-tracks/old-track/history'))
      if (failed) return json(response, { error: { code: 'MYSQL_UNAVAILABLE', message: '受控读取失败' } }, 503)
      if (url.pathname === '/api/v1/items') return json(response, [oldItem])
      if (url.pathname === '/api/v1/items/trash') return json(response, [oldTrashItem])
      if (url.pathname === '/api/v1/methods') return json(response, [oldMethod])
      if (url.pathname === '/api/v1/trash') return json(response, [])
      if (url.pathname === '/api/v1/exploration-tracks') return json(response, [{ track: oldTrack }])
      if (url.pathname === '/api/v1/exploration-tracks/old-track/history') return json(response, history)
      return json(response, { error: { message: '未处理的测试请求' } }, 404)
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '')
    const file = normalize(join(root, relative))
    if (!file.startsWith(root)) { response.writeHead(403); response.end(); return }
    try {
      const content = readFileSync(file)
      response.writeHead(200, { 'content-type': contentType(file) }); response.end(content)
    } catch { response.writeHead(404); response.end() }
  })
  return new Promise((resolve) => {
    const listen = () => server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      if (port >= 6665 && port <= 6669) { server.close(listen); return }
      resolve({ server, url: `http://127.0.0.1:${port}/index.html`, calls })
    })
    listen()
  })
}

async function openRestore(page: Page, url: string, abortTracks: boolean) {
  await page.goto(url)
  await page.getByText('旧事项事实').waitFor({ state: 'visible' })
  await page.locator('.navigation-item').filter({ hasText: '长期探索' }).click()
  await page.locator('.exploration-row-name', { hasText: '旧长期探索事实' }).waitFor({ state: 'visible' })
  await page.locator('.navigation-settings .navigation-item').click()
  if (abortTracks) {
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window)
      let restoreConfirmed = false
      window.fetch = (input, init) => {
        const url = String(input)
        if (restoreConfirmed && url.endsWith('/api/v1/exploration-tracks')) return Promise.reject(new DOMException('aborted by test', 'AbortError'))
        const result = originalFetch(input, init)
        if (url.endsWith('/api/v1/backup/restore') && init?.method === 'POST') return result.then((response) => { restoreConfirmed = true; return response })
        return result
      }
    })
  }
  await page.locator('input[type=file]').setInputFiles({ name: 'restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await page.locator('.restore-confirm .delete-confirm-button').click()
}

async function openRestorePreview(page: Page, url: string, explorationTrackCount: number) {
  await page.goto(url)
  await page.locator('.navigation-settings .navigation-item').click()
  const document = { ...backup, data: { ...backup.data, explorationTracks: Array.from({ length: explorationTrackCount }, (_, index) => ({ ...oldTrack, id: `preview-track-${index}` })) } }
  await page.locator('input[type=file]').setInputFiles({ name: 'preview.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) })
  await page.locator('.restore-confirm').waitFor({ state: 'visible' })
}

describe('Backup restore H5 failure boundaries', () => {
  beforeAll(() => {
    return chromium.launch({ headless: true }).then((value) => { browser = value })
  }, 60_000)

  afterAll(async () => { await browser?.close() })

  it.each<Failure>(['items', 'methods', 'trash-items', 'trash-entries', 'tracks', 'history', 'abort', 'response-lost'])('keeps old facts locked without retry after %s', async (failure) => {
    const mock = await startMockH5(failure)
    const page = await browser.newPage()
    page.setDefaultTimeout(5_000)
    try {
      await openRestore(page, mock.url, failure === 'abort')
      await page.locator('.restore-progress').waitFor({ state: 'visible' })
      expect(await page.locator('.navigation-status').textContent()).toContain('1 条事项 · 1 条方法')
      expect(await page.locator('.data-status-grid').textContent()).toContain('1回收站')
      expect(await page.getByText('恢复完成；覆盖前的数据已自动下载为安全备份').count()).toBe(0)
      expect(await page.getByText('还没有长期探索。').count()).toBe(0)
      if (failure !== 'abort') {
        const expectedMessage = failure === 'response-lost' ? '提交结果未确认' : '恢复失败'
        await page.waitForFunction((value) => document.querySelector('.backup-message')?.textContent?.includes(value), expectedMessage)
        expect(await page.locator('.backup-message').textContent()).toContain(expectedMessage)
      }
      if (failure === 'abort') await page.waitForTimeout(300)
      const before = new Map(mock.calls)
      await page.waitForTimeout(180)
      expect(mock.calls).toEqual(before)
    } finally {
      await page.close()
      await new Promise<void>((resolve) => mock.server.close(() => resolve()))
    }
  }, 30_000)

  it.each([0, 2])('shows %s exploration tracks from the selected Backup V3 preview', async (explorationTrackCount) => {
    const mock = await startMockH5('items')
    const page = await browser.newPage()
    page.setDefaultTimeout(5_000)
    try {
      await openRestorePreview(page, mock.url, explorationTrackCount)
      expect(await page.locator('.restore-confirm').textContent()).toContain(`${explorationTrackCount} 条长期探索`)
    } finally {
      await page.close()
      await new Promise<void>((resolve) => mock.server.close(() => resolve()))
    }
  })
})
