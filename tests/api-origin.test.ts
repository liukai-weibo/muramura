import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { requestContext } from '../apps/api/src/hono/http'
import type { ApiEnv } from '../apps/api/src/hono/types'

// Hono is owned by the API workspace, not by the repository root.
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const { Hono } = requireApi('hono') as typeof import('../apps/api/node_modules/hono')
const app = new Hono<ApiEnv>()
app.use('*', requestContext)
app.get('/health', c => c.json({ status: 'ready' }))
// Exercise the same middleware before login, without a database or real credentials.
app.post('/api/v1/auth/login', c => c.json({ reachedLogin: true }))
app.options('*', c => c.body(null, 204))

describe('API origin validation', () => {
  it.each(['https://muramura.icu', 'https://www.muramura.icu', 'http://tauri.localhost', 'tauri://localhost'])(
    'allows health, login and preflight from %s', async origin => {
      for (const [path, method] of [['/health', 'GET'], ['/api/v1/auth/login', 'POST'], ['/api/v1/auth/login', 'OPTIONS']]) {
        const response = await app.request(path!, { method, headers: { origin } })
        expect(response.status).toBe(method === 'OPTIONS' ? 204 : 200)
        expect(response.headers.get('access-control-allow-origin')).toBe(origin)
        expect(response.headers.get('access-control-allow-credentials')).toBe('true')
        expect(response.headers.get('vary')).toBe('origin')
      }
    },
  )

  it.each(['https://muramura.icu.evil.example', 'https://evil.muramura.icu', 'http://muramura.icu', 'https://muramura.icu:444', 'null'])(
    'still rejects untrusted origin %s', async origin => {
      const response = await app.request('/api/v1/auth/login', { method: 'POST', headers: { origin } })
      expect(response.status).toBe(403)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
      expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED', message: '不允许的请求来源', requestId: expect.any(String) } })
    },
  )
})
