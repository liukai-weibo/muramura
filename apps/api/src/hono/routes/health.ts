import { Hono } from 'hono'
import { getMySqlHealth } from '@knowledge-base/storage-mysql'
import type { MySqlConnectionConfig } from '@knowledge-base/storage-mysql'
import type { HonoServices } from '../services'
import type { ApiEnv } from '../types'

export function createHealthRoutes(
  services: HonoServices,
  config: MySqlConnectionConfig,
) {
  return new Hono<ApiEnv>().get('/', async (context) => {
    try {
      const health = await getMySqlHealth(services.pool, config.database)
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
