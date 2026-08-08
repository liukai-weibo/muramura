import { describe, expect, it } from 'vitest'
import type { MySqlConnectionConfig } from '@knowledge-base/storage-mysql'
import { buildHonoApp, buildRpcContractRoutes } from '../apps/api/src/index'
import type { RootHonoServices } from '../apps/api/src/hono/services'

const config = { database: 'unused' } as MySqlConnectionConfig
const root = {
  pool: {},
  config,
  auth: {},
  platformAdministration: {},
} as unknown as RootHonoServices

/**
 * 挂载后的完整路由表。前缀收拢、子应用嵌套或中间件调整都不允许改变这份清单，
 * 任何增删路由都必须显式同步到这里。
 */
const expectedRouteTable = [
  'ALL /*',
  'ALL /api/v1/*',
  'ALL /api/v1/admin/*',
  'DELETE /api/v1/admin/experimental/ai-config',
  'DELETE /api/v1/ai/preferences/:id',
  'DELETE /api/v1/experimental/ai-conversations/:id',
  'DELETE /api/v1/experimental/ai-conversations/:id/purge',
  'DELETE /api/v1/exploration-tracks/:id',
  'DELETE /api/v1/items/:id',
  'DELETE /api/v1/items/:id/exploration-track',
  'DELETE /api/v1/methods/:id',
  'DELETE /api/v1/trash/:type/:id',
  'GET /api/v1/admin/experimental/ai-config',
  'GET /api/v1/admin/users',
  'GET /api/v1/admin/users/:userId',
  'GET /api/v1/ai/preferences',
  'GET /api/v1/auth/session',
  'GET /api/v1/backup',
  'GET /api/v1/dashboard',
  'GET /api/v1/experimental/ai-conversation',
  'GET /api/v1/experimental/ai-conversations',
  'GET /api/v1/experimental/ai-conversations/:id',
  'GET /api/v1/experimental/ai-conversations/trash',
  'GET /api/v1/exploration-tracks',
  'GET /api/v1/exploration-tracks/:id/history',
  'GET /api/v1/exploration-tracks/deleted',
  'GET /api/v1/exploration-tracks/selectable',
  'GET /api/v1/items',
  'GET /api/v1/items/:id',
  'GET /api/v1/items/:id/exploration-track',
  'GET /api/v1/items/:id/status-events',
  'GET /api/v1/items/trash',
  'GET /api/v1/method-applications/:id/context',
  'GET /api/v1/method-source-displays',
  'GET /api/v1/methods',
  'GET /api/v1/methods/:id/evidence',
  'GET /api/v1/methods/:id/versions',
  'GET /api/v1/methods/by-review/:id',
  'GET /api/v1/reviews/:id',
  'GET /api/v1/reviews/by-item/:id',
  'GET /api/v1/search',
  'GET /api/v1/trash',
  'GET /docs',
  'GET /health',
  'GET /openapi.json',
  'OPTIONS /*',
  'PATCH /api/v1/account/username',
  'PATCH /api/v1/admin/users/:userId/username',
  'PATCH /api/v1/experimental/ai-conversations/:id/title',
  'PATCH /api/v1/exploration-tracks/:id',
  'PATCH /api/v1/items/:id/content',
  'POST /api/v1/account/password',
  'POST /api/v1/admin/users/:userId/reset-password',
  'POST /api/v1/admin/users/:userId/restore',
  'POST /api/v1/admin/users/:userId/revoke-sessions',
  'POST /api/v1/admin/users/:userId/soft-delete',
  'POST /api/v1/ai/preferences',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/register',
  'POST /api/v1/backup/restore',
  'POST /api/v1/experimental/ai-chat/stream',
  'POST /api/v1/experimental/ai-conversations',
  'POST /api/v1/experimental/ai-conversations/:id/archive',
  'POST /api/v1/experimental/ai-conversations/:id/restore',
  'POST /api/v1/exploration-tracks',
  'POST /api/v1/exploration-tracks/:id/restore',
  'POST /api/v1/items',
  'POST /api/v1/items/:id/restore',
  'POST /api/v1/items/:id/start',
  'POST /api/v1/items/:id/status',
  'POST /api/v1/method-applications',
  'POST /api/v1/methods/:id/restore',
  'POST /api/v1/reviews/complete',
  'POST /api/v1/trash/:type/:id/restore',
  'POST /api/v1/trash/purge',
  'PUT /api/v1/admin/experimental/ai-config',
  'PUT /api/v1/admin/users/:userId/roles',
  'PUT /api/v1/ai/preferences/:id',
  'PUT /api/v1/items/:id/exploration-track',
]

describe('hono route table', () => {
  it('mounts every route under the single versioned prefix', () => {
    const app = buildHonoApp(root, config)
    const table = [...new Set(app.routes.map((route) => `${route.method} ${route.path}`))].sort()
    expect(table).toEqual(expectedRouteTable)
  })

  it('keeps the RPC contract endpoints aligned with the runtime route tree', () => {
    const runtimeEndpoints = buildHonoApp(root, config).routes
      .map((route) => `${route.method} ${route.path}`)
      .filter((route) => !route.startsWith('ALL ')
        && !route.startsWith('OPTIONS ')
        && route !== 'GET /docs'
        && route !== 'GET /openapi.json')
      .sort()
    const rpcEndpoints = buildRpcContractRoutes(root, config).routes
      .map((route) => `${route.method} ${route.path}`)
      .sort()

    expect(rpcEndpoints).toEqual(runtimeEndpoints)
  })

  it('keeps authentication and administrator authorization in the runtime wrapper', async () => {
    const unauthenticatedRoot = {
      ...root,
      auth: { current: async () => null },
    } as unknown as RootHonoServices
    const unauthenticated = await buildHonoApp(unauthenticatedRoot, config)
      .request('/api/v1/items')
    expect(unauthenticated.status).toBe(401)

    const memberRoot = {
      ...root,
      auth: {
        current: async () => ({
          user: {
            id: 'member-1',
            username: 'member',
            roles: ['member'],
            createdAt: '2026-08-03T00:00:00.000Z',
          },
        }),
      },
    } as unknown as RootHonoServices
    const forbidden = await buildHonoApp(memberRoot, config)
      .request('/api/v1/admin/users')
    expect(forbidden.status).toBe(403)
  })

  it('publishes concrete OpenAPI schemas for RPC response models', async () => {
    const response = await buildHonoApp(root, config).request('/openapi.json')
    expect(response.status).toBe(200)
    const document = await response.json() as {
      components: { schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }> }
    }

    expect(document.components.schemas.Item?.properties).toMatchObject({
      id: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string' },
      status: { type: 'string' },
    })
    expect(document.components.schemas.Item?.required).toEqual(expect.arrayContaining([
      'id', 'title', 'content', 'status', 'createdAt', 'updatedAt',
    ]))
    expect(document.components.schemas.Review?.properties).toHaveProperty('actualAction')
    expect(document.components.schemas.DashboardReport?.properties).toHaveProperty('metricRecords')
    expect(document.components.schemas.BackupDocument?.properties).toBeUndefined()
    expect(document.components.schemas.BackupDocument).toHaveProperty('oneOf')
  })

  it('derives 405 vs 404 from registered routes instead of a hardcoded path list', async () => {
    const app = buildHonoApp(root, config)
    // 用公开路由验证：错误方法走 405，未知路径走 404（不依赖鉴权中间件）
    const methodNotAllowed = await app.request('/health', { method: 'PUT' })
    expect(methodNotAllowed.status).toBe(405)
    expect(await methodNotAllowed.json()).toMatchObject({
      error: { code: 'METHOD_NOT_ALLOWED' },
    })
    const missing = await app.request('/does-not-exist')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({
      error: { code: 'NOT_FOUND_ROUTE' },
    })
  })
})
