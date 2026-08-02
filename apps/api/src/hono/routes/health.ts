import { createRoute, z } from '@hono/zod-openapi'
import { getMySqlHealth } from '@knowledge-base/storage-mysql'
import type { MySqlConnectionConfig } from '@knowledge-base/storage-mysql'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'
import type { RootHonoServices } from '../services'

const healthReadySchema = z.object({
  status: z.literal('ready'),
  database: z.string(),
  schemaVersion: z.number(),
}).openapi('HealthReady')

const healthUnavailableSchema = z.object({
  status: z.literal('database-unavailable'),
  message: z.string(),
}).openapi('HealthUnavailable')

const healthRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Health'],
  summary: '健康检查',
  description: '探测本地 MySQL 是否可用并返回当前 schema 版本；无需登录。',
  responses: {
    200: jsonSuccess(healthReadySchema, '数据库就绪'),
    503: jsonSuccess(healthUnavailableSchema, '数据库不可用'),
  },
})

export function createHealthRoutes(
  root: RootHonoServices,
  config: MySqlConnectionConfig,
) {
  return createOpenApiApp()
    .openapi(healthRoute, async (context) => {
      try {
        const health = await getMySqlHealth(root.pool, config.database)
        return context.json({
          status: 'ready' as const,
          database: health.database,
          schemaVersion: health.schemaVersion,
        }, 200)
      } catch {
        return context.json({
          status: 'database-unavailable' as const,
          message: '本地 MySQL 候选环境当前不可用',
        }, 503)
      }
    })
}
