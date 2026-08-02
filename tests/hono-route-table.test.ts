import { describe, expect, it } from 'vitest'
import type { MySqlConnectionConfig } from '@knowledge-base/storage-mysql'
import { buildHonoApp } from '../apps/api/src/hono/app'
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
  'ALL /api/v1/admin/users/:userId/revoke-sessions',
  'ALL /api/v1/admin/users/:userId/roles',
  'ALL /api/v1/auth/login',
  'ALL /api/v1/auth/logout',
  'ALL /api/v1/auth/register',
  'ALL /api/v1/backup/restore',
  'ALL /api/v1/reviews/complete',
  'DELETE /api/v1/exploration-tracks/:id',
  'DELETE /api/v1/items/:id',
  'DELETE /api/v1/items/:id/exploration-track',
  'DELETE /api/v1/methods/:id',
  'GET /api/v1/admin/users',
  'GET /api/v1/auth/session',
  'GET /api/v1/backup',
  'GET /api/v1/dashboard',
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
  'PATCH /api/v1/exploration-tracks/:id',
  'PATCH /api/v1/items/:id/content',
  'POST /api/v1/admin/users/:userId/revoke-sessions',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/register',
  'POST /api/v1/backup/restore',
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
  'PUT /api/v1/admin/users/:userId/roles',
  'PUT /api/v1/items/:id/exploration-track',
]

describe('hono route table', () => {
  it('mounts every route under the single versioned prefix', () => {
    const app = buildHonoApp(root, config)
    const table = [...new Set(app.routes.map((route) => `${route.method} ${route.path}`))].sort()
    expect(table).toEqual(expectedRouteTable)
  })
})
